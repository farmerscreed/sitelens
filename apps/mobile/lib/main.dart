import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'db/database.dart';
import 'api/api_client.dart';
import 'sync/sync_worker.dart';
import 'features/daily_report/report_repository.dart';

// Minimal field app wiring the offline pipeline. Real auth (phone OTP), camera capture,
// and project selection are wired in from here; this file shows the offline submit +
// reconnect-drain loop that delivers AC-1.
void main() {
  const url = String.fromEnvironment('SUPABASE_URL', defaultValue: 'http://10.0.2.2:54321');
  const anon = String.fromEnvironment('SUPABASE_ANON_KEY');
  runApp(SiteLensApp(url: url, anonKey: anon));
}

class SiteLensApp extends StatefulWidget {
  const SiteLensApp({super.key, required this.url, required this.anonKey});
  final String url;
  final String anonKey;
  @override
  State<SiteLensApp> createState() => _SiteLensAppState();
}

class _SiteLensAppState extends State<SiteLensApp> {
  late final AppDb db = AppDb();
  late final ApiClient api = ApiClient(baseUrl: widget.url, anonKey: widget.anonKey, accessToken: '');
  late final SyncWorker sync = SyncWorker(db, api, orgId: '');
  late final ReportRepository reports = ReportRepository(db);
  final summary = TextEditingController();
  String status = 'offline-first: writes go to local SQLite, then sync';

  @override
  void initState() {
    super.initState();
    // Drain the outbox whenever connectivity returns (§13.1).
    Connectivity().onConnectivityChanged.listen((_) => sync.drain());
  }

  Future<void> _submit() async {
    final id = await reports.submitLocal(
      projectId: 'demo-project',
      reportDate: DateTime.now(),
      workSummary: summary.text,
      mediaIds: const [],
    );
    setState(() => status = 'saved locally as $id — queued for sync');
    summary.clear();
    await sync.drain(); // try now; harmless if offline (stays queued, retried on reconnect)
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SiteLens',
      home: Scaffold(
        appBar: AppBar(title: const Text('Daily report')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            TextField(controller: summary, decoration: const InputDecoration(labelText: 'Work summary'), maxLines: 3),
            const SizedBox(height: 12),
            FilledButton(onPressed: _submit, child: const Text('Submit (works offline)')),
            const SizedBox(height: 16),
            Text(status, style: const TextStyle(color: Colors.grey)),
          ]),
        ),
      ),
    );
  }
}
