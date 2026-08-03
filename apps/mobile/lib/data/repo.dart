import 'dart:convert';
import 'package:drift/drift.dart';
import '../api/api_client.dart';
import '../core/ids.dart';
import '../core/session.dart';
import '../db/database.dart';

// Reference data (projects, buildings, stages, materials) fetched over PostgREST
// (RLS-scoped) and cached in the local KV so every list still renders offline.
// Field mutations (stage ticks, material IN/OUT) write to the outbox and return
// immediately — the engineer is never blocked on the network.
class Repo {
  Repo(this.db, this.api, this.session);
  final AppDb db;
  final ApiClient api;
  final Session session;

  // ── org bootstrap ───────────────────────────────────────────────────────────
  // The JWT must carry active_org_id for RLS. If it doesn't yet (first login),
  // pick the user's only/first org and refresh the token.
  Future<void> ensureActiveOrg() async {
    if (session.orgId != null) return;
    final orgs = await api.rpc('fn_my_orgs', {}) as List<dynamic>? ?? [];
    if (orgs.isEmpty) throw ApiException(403, '{"message":"Your login has no organisation yet — ask your admin to add you."}');
    final active = orgs.cast<Map<String, dynamic>>().where((o) => o['is_active_org'] == true).toList();
    if (active.isEmpty) {
      await api.rpc('fn_set_active_org', {'p_org': (orgs.first as Map<String, dynamic>)['org_id']});
    }
    await session.refresh(); // pull the claim into the token
  }

  // ── cached reads (network first, cache fallback) ────────────────────────────
  Future<List<Map<String, dynamic>>> _cached(String key, String query) async {
    try {
      final rows = await api.select(query);
      await db.putKv(key, jsonEncode(rows));
      return rows.cast<Map<String, dynamic>>();
    } catch (_) {
      final cached = await db.getKv(key);
      if (cached == null) return [];
      return (jsonDecode(cached) as List).cast<Map<String, dynamic>>();
    }
  }

  Future<List<Map<String, dynamic>>> projects() =>
      _cached('projects', 'projects?select=id,name&archived_at=is.null&order=name');

  Future<List<Map<String, dynamic>>> buildings(String projectId) => _cached(
      'buildings:$projectId',
      'buildings?select=id,code,status,current_stage_id,building_type_id'
      '&project_id=eq.$projectId&archived_at=is.null&order=code');

  Future<List<Map<String, dynamic>>> stages(String buildingTypeId) => _cached(
      'stages:$buildingTypeId',
      'type_stages?select=id,name,sequence,milestone&building_type_id=eq.$buildingTypeId&order=sequence');

  Future<List<Map<String, dynamic>>> progress(String buildingId) => _cached(
      'progress:$buildingId',
      'building_stage_progress?select=stage_id,status,completed_source&building_id=eq.$buildingId');

  Future<List<Map<String, dynamic>>> materials() =>
      _cached('materials', 'materials_catalog?select=id,name,unit&order=name');

  // ── field mutations (offline-first via the outbox) ──────────────────────────

  // Stage tick: lands on the board instantly once synced, labelled 'field'
  // (DECISIONS #65). Optimistically updates the cached progress so the app's own
  // lists reflect the tick immediately.
  Future<void> tickStageDone({required String buildingId, required String stageId}) async {
    await db.enqueue('complete_stage', buildingId,
        jsonEncode({'p_building': buildingId, 'p_stage': stageId, 'p_source': 'field'}));
    final cached = await db.getKv('progress:$buildingId');
    if (cached != null) {
      final rows = (jsonDecode(cached) as List).cast<Map<String, dynamic>>();
      var found = false;
      for (final r in rows) {
        if (r['stage_id'] == stageId) {
          r['status'] = 'done';
          r['completed_source'] = 'field';
          found = true;
        }
      }
      if (!found) rows.add({'stage_id': stageId, 'status': 'done', 'completed_source': 'field'});
      await db.putKv('progress:$buildingId', jsonEncode(rows));
    }
  }

  // Material IN (delivery) / OUT (issue to a building). Idempotent on the server
  // (AC-4 balance guard + no duplicate on resend).
  Future<void> logMaterial({
    required String projectId,
    required String materialId,
    required String type, // 'IN' | 'OUT'
    required double quantity,
    String? buildingId,
    String? supplierName,
    String? deliveryNote,
  }) async {
    final id = newId();
    await db.enqueue('material_txn', id, jsonEncode({
      'p_id': id,
      'p_project': projectId,
      'p_material': materialId,
      'p_type': type,
      'p_quantity': quantity,
      'p_idempotency_key': newIdempotencyKey(),
      'p_building': buildingId,
      'p_supplier_name': supplierName,
      'p_delivery_note': deliveryNote,
    }));
  }

  // ── today's report (local truth) ────────────────────────────────────────────
  Future<DailyReportsLocalData?> todaysReport(String projectId) async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    return (db.select(db.dailyReportsLocal)
          ..where((r) =>
              r.projectId.equals(projectId) &
              r.reportDate.isBiggerOrEqualValue(start) &
              r.reportDate.isSmallerThanValue(start.add(const Duration(days: 1))))
          ..orderBy([(r) => OrderingTerm.desc(r.reportDate)])
          ..limit(1))
        .getSingleOrNull();
  }

  Future<List<MediaLocalData>> mediaForReport(String reportId) =>
      (db.select(db.mediaLocal)..where((m) => m.reportId.equals(reportId))).get();

  Future<List<MediaLocalData>> todaysMedia() async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    return (db.select(db.mediaLocal)
          ..where((m) => m.capturedAt.isBiggerOrEqualValue(start))
          ..orderBy([(m) => OrderingTerm.desc(m.capturedAt)]))
        .get();
  }
}
