import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../db/database.dart';
import '../features/daily_report/report_repository.dart';
import '../sync/sync_worker.dart';
import 'camera_screen.dart';

// The 90-second flow (AC-14): which houses → photos → crew & notes → SEND.
// Everything is tap-first: building chips, a camera that opens straight away,
// +/- crew steppers pre-filled from yesterday. Typing is optional.
class ReportFlowScreen extends StatefulWidget {
  const ReportFlowScreen({super.key, required this.repo, required this.sync, required this.projectId});
  final Repo repo;
  final SyncWorker sync;
  final String projectId;

  @override
  State<ReportFlowScreen> createState() => _ReportFlowScreenState();
}

const kTrades = ['Masons', 'Carpenters', 'Steel benders', 'Tilers', 'Labourers'];
const kWeather = ['Sunny', 'Cloudy', 'Rain', 'Windy'];
const kMinPhotos = 3;

class _ReportFlowScreenState extends State<ReportFlowScreen> {
  int step = 0;
  List<Map<String, dynamic>> buildings = [];
  final selected = <String>{};          // building ids worked on today
  final mediaIds = <String>[];
  List<MediaLocalData> media = [];
  final crew = <String, int>{for (final t in kTrades) t: 0};
  String weather = 'Sunny';
  final issues = TextEditingController();
  bool sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    buildings = await widget.repo.buildings(widget.projectId);
    // Yesterday's crew as the starting point (data-derived defaults).
    final saved = await widget.repo.db.getKv('crew:last');
    if (saved != null) {
      final j = (jsonDecode(saved) as Map<String, dynamic>);
      for (final t in kTrades) {
        if (j[t] is int) crew[t] = j[t] as int;
      }
    }
    if (mounted) setState(() {});
  }

  String _codeOf(String id) =>
      (buildings.firstWhere((b) => b['id'] == id, orElse: () => {'code': 'house'})['code'] ?? 'house').toString();

  Future<void> _takePhoto() async {
    final projName = 'Project'; // stamp keeps it short; building carries the meaning
    final tagBuilding = selected.isNotEmpty ? selected.first : null;
    final id = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => CameraScreen(
        repo: widget.repo,
        buildingOptions: [for (final b in buildings.where((b) => selected.contains(b['id']))) b],
        defaultBuildingId: tagBuilding,
        stampPrefix: projName,
      ),
    ));
    if (id != null) {
      mediaIds.add(id);
      media = await widget.repo.todaysMedia();
      setState(() {});
    }
  }

  Future<void> _send() async {
    setState(() => sending = true);
    final codes = selected.map(_codeOf).join(', ');
    final crewTxt = crew.entries.where((e) => e.value > 0).map((e) => '${e.key} ${e.value}').join(', ');
    final summary = [
      if (codes.isNotEmpty) 'Worked on: $codes.',
      if (crewTxt.isNotEmpty) 'Crew: $crewTxt.',
    ].join(' ');

    await widget.repo.db.putKv('crew:last', jsonEncode(crew));
    final reports = ReportRepository(widget.repo.db);
    await reports.submitLocal(
      projectId: widget.projectId,
      reportDate: DateTime.now(),
      workSummary: summary.isEmpty ? 'Site day report' : summary,
      weather: weather,
      issues: issues.text.trim().isEmpty ? null : issues.text.trim(),
      buildingId: selected.isNotEmpty ? selected.first : null,
      mediaIds: mediaIds,
    );
    // Fire-and-forget: harmless offline, everything stays queued.
    widget.sync.drain();
    if (!mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Report saved ✓ — it sends by itself when there\'s network')));
  }

  @override
  Widget build(BuildContext context) {
    final titles = ['Which houses today?', 'Photos', 'Crew & notes'];
    return Scaffold(
      appBar: AppBar(title: Text('${step + 1}/3 · ${titles[step]}')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: _stepBody()),
              const SizedBox(height: 12),
              Row(children: [
                if (step > 0)
                  Expanded(
                    child: OutlinedButton(
                        onPressed: () => setState(() => step--), child: const Text('Back')),
                  ),
                if (step > 0) const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _nextEnabled() ? (step < 2 ? () => setState(() => step++) : (sending ? null : _send)) : null,
                    child: Text(step < 2 ? 'Next' : (sending ? 'Saving…' : 'SEND REPORT')),
                  ),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  bool _nextEnabled() {
    if (step == 0) return selected.isNotEmpty;
    if (step == 1) return mediaIds.length >= kMinPhotos;
    return !sending;
  }

  Widget _stepBody() {
    switch (step) {
      case 0:
        return ListView(children: [
          const Text('Tap every house you worked on', style: TextStyle(color: kMuted, fontSize: 15)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final b in buildings)
                FilterChip(
                  label: Text(b['code'] as String, style: const TextStyle(fontSize: 16)),
                  selected: selected.contains(b['id']),
                  onSelected: (on) => setState(() =>
                      on ? selected.add(b['id'] as String) : selected.remove(b['id'])),
                ),
            ],
          ),
          if (buildings.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: Text('No houses on this project yet — ask your manager.',
                  style: TextStyle(color: kMuted)),
            ),
        ]);
      case 1:
        final taken = media.where((m) => mediaIds.contains(m.id)).toList();
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(
            mediaIds.length >= kMinPhotos
                ? '${mediaIds.length} photos ✓'
                : '${mediaIds.length} of $kMinPhotos photos — ${kMinPhotos - mediaIds.length} more to go',
            style: TextStyle(
                fontSize: 16,
                color: mediaIds.length >= kMinPhotos ? kGood : kAccent,
                fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: GridView.count(
              crossAxisCount: 3,
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                for (final m in taken)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.file(File(m.localThumbPath), fit: BoxFit.cover),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _takePhoto,
            icon: const Icon(Icons.photo_camera),
            label: const Text('Take photo'),
          ),
        ]);
      default:
        return ListView(children: [
          const Text('How many people worked today?', style: TextStyle(color: kMuted, fontSize: 15)),
          const SizedBox(height: 8),
          for (final t in kTrades)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(child: Text(t, style: const TextStyle(fontSize: 17, color: Colors.white))),
                IconButton.outlined(
                  onPressed: crew[t]! > 0 ? () => setState(() => crew[t] = crew[t]! - 1) : null,
                  icon: const Icon(Icons.remove),
                ),
                SizedBox(
                    width: 44,
                    child: Text('${crew[t]}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 20, color: Colors.white, fontWeight: FontWeight.w700))),
                IconButton.outlined(
                  onPressed: () => setState(() => crew[t] = crew[t]! + 1),
                  icon: const Icon(Icons.add),
                ),
              ]),
            ),
          const SizedBox(height: 16),
          const Text('Weather', style: TextStyle(color: kMuted, fontSize: 15)),
          const SizedBox(height: 8),
          Wrap(spacing: 10, children: [
            for (final w in kWeather)
              ChoiceChip(
                label: Text(w, style: const TextStyle(fontSize: 15)),
                selected: weather == w,
                onSelected: (_) => setState(() => weather = w),
              ),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: issues,
            maxLines: 3,
            style: const TextStyle(color: Colors.white, fontSize: 16),
            decoration: const InputDecoration(
                labelText: 'Any problems today? (optional)',
                hintText: 'e.g. rain stopped work at 2pm'),
          ),
        ]);
    }
  }
}
