import 'dart:convert';
import 'package:drift/drift.dart';
import '../../db/database.dart';
import '../../core/ids.dart';

// Writes a daily report to the local DB (source of truth) and enqueues it for sync.
// Returns immediately — the engineer is never blocked on the network (§13.1, NF-2/3).
class ReportRepository {
  ReportRepository(this.db);
  final AppDb db;

  Future<String> submitLocal({
    required String projectId,
    required DateTime reportDate,
    required String workSummary,
    String? weather,
    String? issues,
    String? buildingId,
    double? lon,
    double? lat,
    required List<String> mediaIds,
    bool isOffline = true,
  }) async {
    final id = newId();
    final key = newIdempotencyKey();

    await db.into(db.dailyReportsLocal).insert(DailyReportsLocalCompanion.insert(
          id: id,
          projectId: projectId,
          reportDate: reportDate,
          workSummary: workSummary,
          weather: Value(weather),
          issues: Value(issues),
          buildingId: Value(buildingId),
          lon: Value(lon),
          lat: Value(lat),
          idempotencyKey: key,
        ));

    // Enqueue the server mutation. The payload mirrors fn_submit_daily_report's args;
    // p_id + p_idempotency_key make a resend idempotent.
    await db.enqueue('submit_report', id, jsonEncode({
      'p_id': id,
      'p_project': projectId,
      'p_report_date': reportDate.toIso8601String().substring(0, 10),
      'p_work_summary': workSummary,
      'p_idempotency_key': key,
      'p_building': buildingId,
      'p_weather': weather,
      'p_issues': issues,
      'p_lon': lon,
      'p_lat': lat,
      'p_is_offline': isOffline,
      'p_media': mediaIds,
    }));
    return id;
  }
}
