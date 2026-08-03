import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../db/database.dart';
import '../sync/sync_worker.dart';
import 'report_flow_screen.dart';
import 'mark_done_screen.dart';
import 'materials_screen.dart';

// The whole home screen: today's report status (the one thing that matters),
// two quick actions, and a quiet sync chip. No menus, no dashboard.
class TodayScreen extends StatefulWidget {
  const TodayScreen({super.key, required this.repo, required this.sync, required this.onSignOut});
  final Repo repo;
  final SyncWorker sync;
  final Future<void> Function() onSignOut;

  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> {
  List<Map<String, dynamic>> projects = [];
  String? projectId;
  DailyReportsLocalData? report;
  int pending = 0;
  Timer? ticker;

  @override
  void initState() {
    super.initState();
    _load();
    ticker = Timer.periodic(const Duration(seconds: 10), (_) => _refreshStatus());
  }

  @override
  void dispose() {
    ticker?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    projects = await widget.repo.projects();
    final saved = await widget.repo.db.getKv('active_project');
    projectId = (saved != null && projects.any((p) => p['id'] == saved))
        ? saved
        : (projects.isNotEmpty ? projects.first['id'] as String : null);
    if (projectId != null) await widget.repo.db.putKv('active_project', projectId!);
    await _refreshStatus();
  }

  Future<void> _refreshStatus() async {
    if (!mounted) return;
    final r = projectId != null ? await widget.repo.todaysReport(projectId!) : null;
    final n = await widget.repo.db.pendingCount();
    if (!mounted) return;
    setState(() { report = r; pending = n; });
  }

  Future<void> _startReport() async {
    if (projectId == null) return;
    await Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => ReportFlowScreen(repo: widget.repo, sync: widget.sync, projectId: projectId!)));
    await _refreshStatus();
  }

  @override
  Widget build(BuildContext context) {
    final sent = report != null && report!.synced;
    final saved = report != null && !report!.synced;

    return Scaffold(
      appBar: AppBar(
        title: const Text('SiteLens'),
        actions: [
          if (pending > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(
                label: Text('$pending to send', style: const TextStyle(fontSize: 13)),
                avatar: const Icon(Icons.cloud_upload_outlined, size: 18, color: kAccent),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.logout, color: kMuted),
            tooltip: 'Sign out',
            onPressed: () async => widget.onSignOut(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async { await _load(); await widget.sync.drain(); await _refreshStatus(); },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (projects.length > 1) ...[
              DropdownButtonFormField<String>(
                value: projectId,
                decoration: const InputDecoration(labelText: 'Project'),
                dropdownColor: kInkCard,
                items: [
                  for (final p in projects)
                    DropdownMenuItem(value: p['id'] as String,
                        child: Text(p['name'] as String, style: const TextStyle(color: Colors.white))),
                ],
                onChanged: (v) async {
                  projectId = v;
                  if (v != null) await widget.repo.db.putKv('active_project', v);
                  await _refreshStatus();
                },
              ),
              const SizedBox(height: 16),
            ],

            // ── today's report — the one big thing ──
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(children: [
                      Icon(sent ? Icons.check_circle : Icons.today,
                          color: sent ? kGood : kAccent, size: 28),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          sent
                              ? 'Today\'s report sent ✓'
                              : saved
                                  ? 'Report saved — will send when network returns'
                                  : 'Today\'s report — not started',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: projectId == null ? null : _startReport,
                      icon: Icon(sent || saved ? Icons.add_a_photo : Icons.play_arrow),
                      label: Text(sent || saved ? 'Add to today\'s report' : 'Start today\'s report'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // ── quick actions ──
            OutlinedButton.icon(
              icon: const Icon(Icons.task_alt, color: kGood),
              label: const Text('Mark work done'),
              onPressed: projectId == null
                  ? null
                  : () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => MarkDoneScreen(repo: widget.repo, sync: widget.sync, projectId: projectId!))),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              icon: const Icon(Icons.inventory_2_outlined, color: kAccent),
              label: const Text('Materials in / out'),
              onPressed: projectId == null
                  ? null
                  : () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => MaterialsScreen(repo: widget.repo, sync: widget.sync, projectId: projectId!))),
            ),

            if (widget.sync.lastError != null) ...[
              const SizedBox(height: 20),
              Text('Last problem: ${widget.sync.lastError}',
                  style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
            ],
            const SizedBox(height: 24),
            const Center(
              child: Text('Pull down to refresh', style: TextStyle(color: kMuted, fontSize: 13)),
            ),
          ],
        ),
      ),
    );
  }
}
