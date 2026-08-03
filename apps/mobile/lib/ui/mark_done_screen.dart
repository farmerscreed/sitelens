import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../sync/sync_worker.dart';
import 'widgets.dart';

// Mark work done: pick a house, tick the stage that finished. The tick queues
// offline and lands on the office board the moment there's network — labelled
// "from field" (DECISIONS #65). Done stages show ✓ and stop being tappable.
class MarkDoneScreen extends StatefulWidget {
  const MarkDoneScreen({super.key, required this.repo, required this.sync, required this.projectId});
  final Repo repo;
  final SyncWorker sync;
  final String projectId;

  @override
  State<MarkDoneScreen> createState() => _MarkDoneScreenState();
}

class _MarkDoneScreenState extends State<MarkDoneScreen> {
  List<Map<String, dynamic>> buildings = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    buildings = await widget.repo.buildings(widget.projectId);
    if (mounted) setState(() {});
  }

  Future<void> _openBuilding(Map<String, dynamic> b) async {
    final stages = await widget.repo.stages(b['building_type_id'] as String);
    final progress = await widget.repo.progress(b['id'] as String);
    final statusOf = {for (final p in progress) p['stage_id']: p['status']};
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      backgroundColor: kInk2,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.72,
        builder: (_, scroll) => Padding(
          padding: const EdgeInsets.all(18),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Center(
              child: Container(
                width: 42, height: 4,
                decoration: BoxDecoration(color: kFaint.withOpacity(0.4), borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 14),
            Row(children: [
              const IconOrb(Icons.home_work_rounded, size: 40),
              const SizedBox(width: 12),
              Text(b['code'] as String,
                  style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: kText)),
            ]),
            const SizedBox(height: 4),
            const Padding(
              padding: EdgeInsets.only(left: 52),
              child: Text('Tap the stage you finished', style: TextStyle(color: kMuted)),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: ListView(controller: scroll, children: [
                for (final s in stages)
                  _StageTile(
                    name: s['name'] as String,
                    seq: s['sequence'] as int,
                    status: (statusOf[s['id']] ?? 'not_started') as String,
                    onTick: () async {
                      await widget.repo.tickStageDone(
                          buildingId: b['id'] as String, stageId: s['id'] as String);
                      widget.sync.drain();
                      if (ctx.mounted) Navigator.of(ctx).pop();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                            content: Text(
                                '${b['code']} · ${s['name']} marked done ✓ — the board updates itself')));
                      }
                    },
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mark work done')),
      body: OrbBackdrop(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            for (final b in buildings)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: GlassCard(
                  padding: const EdgeInsets.all(16),
                  onTap: () => _openBuilding(b),
                  child: Row(children: [
                    IconOrb(Icons.home_work_rounded,
                        color: (b['status'] as String? ?? '') == 'done' ? kGood : kAccent),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(b['code'] as String,
                            style: const TextStyle(
                                fontSize: 18, fontWeight: FontWeight.w800, color: kText)),
                        const SizedBox(height: 3),
                        Row(children: [
                          StatusDot((b['status'] as String? ?? '') == 'done' ? kGood : kAccent, size: 6),
                          const SizedBox(width: 6),
                          Text((b['status'] as String? ?? '') == 'done' ? 'Finished ✓' : 'In progress',
                              style: TextStyle(
                                  fontSize: 13,
                                  color: (b['status'] as String? ?? '') == 'done' ? kGood : kMuted)),
                        ]),
                      ]),
                    ),
                    const Icon(Icons.chevron_right_rounded, color: kFaint),
                  ]),
                ),
              ),
            if (buildings.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 32),
                child: Center(
                    child: Text('No houses on this project yet.', style: TextStyle(color: kMuted))),
              ),
          ],
        ),
      ),
    );
  }
}

class _StageTile extends StatelessWidget {
  const _StageTile({required this.name, required this.seq, required this.status, required this.onTick});
  final String name;
  final int seq;
  final String status;
  final VoidCallback onTick;

  @override
  Widget build(BuildContext context) {
    final done = status == 'done';
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: GlassCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        borderColor: done ? kGood.withOpacity(0.25) : null,
        child: Row(children: [
          Container(
            width: 34, height: 34,
            decoration: BoxDecoration(
              color: done ? kGood.withOpacity(0.16) : kGlassHi,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(color: done ? kGood.withOpacity(0.4) : kBorder),
            ),
            child: done
                ? const Icon(Icons.check_rounded, color: kGood, size: 19)
                : Center(
                    child: Text('$seq',
                        style: const TextStyle(color: kAccent, fontSize: 14, fontWeight: FontWeight.w800))),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Text(name,
                style: TextStyle(
                    fontSize: 16,
                    color: done ? kFaint : kText,
                    decoration: done ? TextDecoration.lineThrough : null)),
          ),
          if (!done)
            SizedBox(
              width: 104,
              child: GradientButton(label: 'Done ✓', height: 42, onPressed: onTick),
            ),
        ]),
      ),
    );
  }
}
