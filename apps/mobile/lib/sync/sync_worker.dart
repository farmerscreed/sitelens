import 'dart:convert';
import 'package:drift/drift.dart';
import '../db/database.dart';
import '../api/api_client.dart';

// Drains the outbox on reconnect. Because every mutation carries a client id +
// idempotency_key and the server no-ops a duplicate, resending after a lost ack is
// SAFE — this is the client half of the AC-1 guarantee. Media uploads happen first
// (thumbs), then the report references them (§13.4).
class SyncWorker {
  SyncWorker(this.db, this.api, {required this.orgId});
  final AppDb db;
  final ApiClient api;
  final String orgId;

  Future<void> drain() async {
    final now = DateTime.now();
    for (final item in await db.dueOutbox(now)) {
      try {
        final payload = jsonDecode(item.payloadJson) as Map<String, dynamic>;
        switch (item.kind) {
          case 'register_media':
            await api.rpc('fn_register_media', {'p_org': orgId, ...payload});
            await (db.update(db.mediaLocal)..where((m) => m.id.equals(item.refId)))
                .write(const MediaLocalCompanion(uploadState: Value('done')));
            break;
          case 'submit_report':
            await api.rpc('fn_submit_daily_report', payload);
            await (db.update(db.dailyReportsLocal)..where((r) => r.id.equals(item.refId)))
                .write(const DailyReportsLocalCompanion(synced: Value(true)));
            break;
        }
        // Success → remove from outbox.
        await (db.delete(db.outbox)..where((o) => o.seq.equals(item.seq))).go();
      } on ApiException catch (e) {
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

  Future<void> _backoff(OutboxData item) async {
    final n = item.attempts + 1;
    final delaySec = (1 << (n.clamp(0, 8))) * 5; // exponential, capped
    await (db.update(db.outbox)..where((o) => o.seq.equals(item.seq))).write(
      OutboxCompanion(attempts: Value(n), nextAttemptAt: Value(DateTime.now().add(Duration(seconds: delaySec)))),
    );
  }
}
