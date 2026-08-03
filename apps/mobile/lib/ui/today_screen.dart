import 'dart:async';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../db/database.dart';
import '../sync/sync_worker.dart';
import 'report_flow_screen.dart';
import 'mark_done_screen.dart';
import 'materials_screen.dart';
import 'widgets.dart';

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

  String get _dateLine {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final now = DateTime.now();
    return '${days[now.weekday - 1]}, ${now.day} ${months[now.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final sent = report != null && report!.synced;
    final saved = report != null && !report!.synced;

    return Scaffold(
      body: OrbBackdrop(
        child: SafeArea(
          child: RefreshIndicator(
            color: kAccent,
            backgroundColor: kInk2,
            onRefresh: () async { await _load(); await widget.sync.drain(); await _refreshStatus(); },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 24),
              children: [
                // ── top bar: brand · sync state · sign out ──
                Row(children: [
                  const BrandMark(compact: true),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                    decoration: BoxDecoration(
                      color: kGlass,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: kBorder),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      StatusDot(pending > 0 ? kAccent : kGood),
                      const SizedBox(width: 7),
                      Text(pending > 0 ? '$pending to send' : 'All sent',
                          style: const TextStyle(color: kMuted, fontSize: 12.5, fontWeight: FontWeight.w600)),
                    ]),
                  ),
                  const SizedBox(width: 6),
                  IconButton(
                    icon: const Icon(Icons.logout_rounded, color: kFaint, size: 22),
                    tooltip: 'Sign out',
                    onPressed: () async => widget.onSignOut(),
                  ),
                ]),
                const SizedBox(height: 18),

                if (projects.length > 1) ...[
                  DropdownButtonFormField<String>(
                    value: projectId,
                    decoration: const InputDecoration(labelText: 'Project'),
                    dropdownColor: kInk2,
                    items: [
                      for (final p in projects)
                        DropdownMenuItem(value: p['id'] as String,
                            child: Text(p['name'] as String, style: const TextStyle(color: kText))),
                    ],
                    onChanged: (v) async {
                      projectId = v;
                      if (v != null) await widget.repo.db.putKv('active_project', v);
                      await _refreshStatus();
                    },
                  ),
                  const SizedBox(height: 16),
                ],

                // ── the hero: today's report ──
                GlassCard(
                  padding: const EdgeInsets.all(22),
                  glowColor: sent ? kGood : kAccent,
                  borderColor: sent ? kGood.withOpacity(0.35) : kAccent.withOpacity(0.3),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      IconOrb(sent ? Icons.verified_rounded : Icons.today_rounded,
                          color: sent ? kGood : kAccent),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          SectionLabel(_dateLine),
                          const SizedBox(height: 4),
                          Text(
                            sent
                                ? 'Report sent ✓'
                                : saved
                                    ? 'Saved — sends when there\'s network'
                                    : 'Today\'s report',
                            style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w800,
                                letterSpacing: -0.3,
                                color: sent ? kGood : kText),
                          ),
                        ]),
                      ),
                    ]),
                    const SizedBox(height: 18),
                    GradientButton(
                      label: sent || saved ? 'Add to today\'s report' : 'Start today\'s report',
                      icon: sent || saved ? Icons.add_a_photo_rounded : Icons.play_arrow_rounded,
                      onPressed: projectId == null ? null : _startReport,
                    ),
                  ]),
                ),
                const SizedBox(height: 22),

                // ── quick actions ──
                const SectionLabel('Quick actions'),
                const SizedBox(height: 10),
                GlassCard(
                  padding: const EdgeInsets.all(16),
                  onTap: projectId == null
                      ? null
                      : () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MarkDoneScreen(repo: widget.repo, sync: widget.sync, projectId: projectId!))),
                  child: Row(children: [
                    const IconOrb(Icons.task_alt_rounded, color: kGood),
                    const SizedBox(width: 14),
                    const Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Mark work done',
                            style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: kText)),
                        SizedBox(height: 2),
                        Text('Tick a finished stage — the board updates itself',
                            style: TextStyle(fontSize: 13, color: kMuted)),
                      ]),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: kFaint),
                  ]),
                ),
                const SizedBox(height: 12),
                GlassCard(
                  padding: const EdgeInsets.all(16),
                  onTap: projectId == null
                      ? null
                      : () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => MaterialsScreen(repo: widget.repo, sync: widget.sync, projectId: projectId!))),
                  child: Row(children: [
                    const IconOrb(Icons.inventory_2_rounded),
                    const SizedBox(width: 14),
                    const Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Materials in / out',
                            style: TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: kText)),
                        SizedBox(height: 2),
                        Text('Deliveries into the store, issues to a house',
                            style: TextStyle(fontSize: 13, color: kMuted)),
                      ]),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: kFaint),
                  ]),
                ),

                if (widget.sync.lastError != null) ...[
                  const SizedBox(height: 18),
                  GlassCard(
                    borderColor: kBad.withOpacity(0.4),
                    child: Row(children: [
                      const Icon(Icons.error_outline, color: kBad, size: 18),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Text('Last problem: ${widget.sync.lastError}',
                              style: const TextStyle(color: kBad, fontSize: 13))),
                    ]),
                  ),
                ],
                const SizedBox(height: 26),
                const Center(
                  child: Text('Pull down to refresh', style: TextStyle(color: kFaint, fontSize: 12.5)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
