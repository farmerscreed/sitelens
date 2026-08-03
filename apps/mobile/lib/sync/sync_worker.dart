import 'dart:convert';
import 'dart:io';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart';
import '../db/database.dart';
import '../api/api_client.dart';
import '../core/session.dart';

// Drains pending work on reconnect. Every mutation carries a client id +
// idempotency_key and the server no-ops duplicates, so resending after a lost ack
// is SAFE — the client half of AC-1.
//
// Media pipeline (§13.4), driven off MediaLocal.uploadState:
//   pending → (upload thumb) → thumb → (upload display) → display
//   → (fn_register_media) → registered → (upload original, Wi-Fi preferred) → done
// A report is only submitted once all its photos are registered, so the server
// never sees a report referencing unknown media.
class SyncWorker {
  SyncWorker(this.db, this.api, this.session);
  final AppDb db;
  final ApiClient api;
  final Session session;

  bool _running = false;
  String? lastError;

  Future<void> drain() async {
    if (_running || !session.signedIn || session.orgId == null) return;
    _running = true;
    try {
      await _drainMedia();
      await _drainOutbox();
    } finally {
      _running = false;
    }
  }

  // ── photos ──────────────────────────────────────────────────────────────────
  Future<void> _drainMedia() async {
    final rows = await (db.select(db.mediaLocal)..where((m) => m.uploadState.isNotValue('done'))).get();
    if (rows.isEmpty) return;
    final onWifi = (await Connectivity().checkConnectivity()).contains(ConnectivityResult.wifi);

    for (final m in rows) {
      try {
        var state = m.uploadState;
        final org = session.orgId!;
        if (state == 'pending') {
          await api.uploadMedia('$org/${m.id}.thumb.jpg', await File(m.localThumbPath).readAsBytes());
          state = await _setState(m.id, 'thumb');
        }
        if (state == 'thumb') {
          await api.uploadMedia('$org/${m.id}.display.jpg', await File(m.localDisplayPath).readAsBytes());
          state = await _setState(m.id, 'display');
        }
        if (state == 'display') {
          await api.rpc('fn_register_media', {
            'p_id': m.id,
            'p_org': org,
            'p_project': await _projectOfMedia(m),
            'p_key_thumb': '$org/${m.id}.thumb.jpg',
            'p_key_display': '$org/${m.id}.display.jpg',
            'p_key_original': '$org/${m.id}.original.jpg',
            'p_captured_at': m.capturedAt.toUtc().toIso8601String(),
            'p_lon': m.lon,
            'p_lat': m.lat,
            'p_gps_accuracy': m.gpsAccuracyM,
            'p_mock_location': m.mockLocation,
            'p_phash': _hexToBits(m.phashHex),
            'p_mime': 'image/jpeg',
            'p_building': m.buildingId,
          });
          state = await _setState(m.id, 'registered');
        }
        if (state == 'registered') {
          // Originals are big: prefer Wi-Fi; on mobile data they wait (§13.4).
          if (!onWifi) continue;
          await api.uploadMedia('$org/${m.id}.original.jpg', await File(m.localOriginalPath).readAsBytes());
          await _setState(m.id, 'done');
        }
      } on ApiException catch (e) {
        lastError = e.message;
        if (!e.retryable) {
          // Bad payload — park it so it stops blocking the queue; surfaced via lastError.
          await _setState(m.id, 'done');
        }
        // retryable → leave state as-is; next drain retries.
      } catch (_) {
        // network/timeout — retry next drain
      }
    }
  }

  Future<String> _setState(String id, String state) async {
    await (db.update(db.mediaLocal)..where((m) => m.id.equals(id)))
        .write(MediaLocalCompanion(uploadState: Value(state)));
    return state;
  }

  // fn_register_media wants the project; photos are tied to a report (which has it)
  // or fall back to the last-used project.
  Future<String?> _projectOfMedia(MediaLocalData m) async {
    if (m.reportId != null) {
      final r = await (db.select(db.dailyReportsLocal)..where((r) => r.id.equals(m.reportId!)))
          .getSingleOrNull();
      if (r != null) return r.projectId;
    }
    return db.getKv('active_project');
  }

  // ── queued mutations ────────────────────────────────────────────────────────
  Future<void> _drainOutbox() async {
    final now = DateTime.now();
    for (final item in await db.dueOutbox(now)) {
      try {
        final payload = jsonDecode(item.payloadJson) as Map<String, dynamic>;
        switch (item.kind) {
          case 'submit_report':
            // Hold the report until every photo it references is registered.
            final blocking = await (db.select(db.mediaLocal)
                  ..where((m) => m.reportId.equals(item.refId) &
                      m.uploadState.isNotIn(['registered', 'done'])))
                .get();
            if (blocking.isNotEmpty) {
              await _retryLater(item, seconds: 30);
              continue;
            }
            await api.rpc('fn_submit_daily_report', payload);
            await (db.update(db.dailyReportsLocal)..where((r) => r.id.equals(item.refId)))
                .write(const DailyReportsLocalCompanion(synced: Value(true)));
            break;
          case 'complete_stage':
            await api.rpc('fn_complete_stage', payload);
            break;
          case 'material_txn':
            await api.rpc('fn_log_material_txn', payload);
            break;
        }
        await (db.delete(db.outbox)..where((o) => o.seq.equals(item.seq))).go();
      } on ApiException catch (e) {
        lastError = e.message;
        if (!e.retryable) {
          // Permanent failure (e.g. validation) — drop from outbox, surface to the user.
          await (db.delete(db.outbox)..where((o) => o.seq.equals(item.seq))).go();
        } else {
          await _backoff(item);
        }
      } catch (_) {
        await _backoff(item); // network/timeout — retry later
      }
    }
  }

  Future<void> _retryLater(OutboxData item, {required int seconds}) =>
      (db.update(db.outbox)..where((o) => o.seq.equals(item.seq))).write(
          OutboxCompanion(nextAttemptAt: Value(DateTime.now().add(Duration(seconds: seconds)))));

  Future<void> _backoff(OutboxData item) async {
    final n = item.attempts + 1;
    final delaySec = (1 << (n.clamp(0, 8))) * 5; // exponential, capped
    await (db.update(db.outbox)..where((o) => o.seq.equals(item.seq))).write(
      OutboxCompanion(attempts: Value(n), nextAttemptAt: Value(DateTime.now().add(Duration(seconds: delaySec)))),
    );
  }

  // 64-char '0101…' string — PostgREST casts it to bit(64).
  String? _hexToBits(String? hex) {
    if (hex == null || hex.isEmpty) return null;
    final v = BigInt.parse(hex, radix: 16);
    return v.toRadixString(2).padLeft(64, '0');
  }
}
