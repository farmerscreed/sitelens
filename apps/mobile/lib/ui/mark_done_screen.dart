import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../sync/sync_worker.dart';

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
      backgroundColor: kInk,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, scroll) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(b['code'] as String,
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
            const SizedBox(height: 4),
            const Text('Tap the stage you finished', style: TextStyle(color: kMuted)),
            const SizedBox(height: 12),
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
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final b in buildings)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                  title: Text(b['code'] as String,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
                  subtitle: Text(
                      (b['status'] as String? ?? '') == 'done' ? 'Finished ✓' : 'In progress',
                      style: TextStyle(
                          color: (b['status'] as String? ?? '') == 'done' ? kGood : kMuted)),
                  trailing: const Icon(Icons.chevron_right, color: kMuted),
                  onTap: () => _openBuilding(b),
                ),
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
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          leading: CircleAvatar(
            radius: 16,
            backgroundColor: done ? kGood.withOpacity(0.2) : kInkCard,
            child: done
                ? const Icon(Icons.check, color: kGood, size: 18)
                : Text('$seq', style: const TextStyle(color: kAccent, fontSize: 14)),
          ),
          title: Text(name,
              style: TextStyle(
                  fontSize: 16,
                  color: done ? kMuted : Colors.white,
                  decoration: done ? TextDecoration.lineThrough : null)),
          trailing: done
              ? null
              : FilledButton(
                  style: FilledButton.styleFrom(
                      minimumSize: const Size(96, 44), padding: const EdgeInsets.symmetric(horizontal: 14)),
                  onPressed: onTick,
                  child: const Text('Done ✓', style: TextStyle(fontSize: 15)),
                ),
        ),
      ),
    );
  }
}
