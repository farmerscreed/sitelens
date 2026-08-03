import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../sync/sync_worker.dart';

// Materials in / out. IN = a delivery arrived at the store; OUT = issued to a
// house (the server's balance guard rejects more than the store holds — AC-4).
// Queues offline like everything else. No prices anywhere on this screen.
//
// The material picker is a SEARCHABLE sheet, not a flat dropdown (founder
// feedback 2026-08-03): type a few letters to filter, and the materials you
// used most recently sit at the top — the storekeeper's daily three are always
// one tap away.
class MaterialsScreen extends StatefulWidget {
  const MaterialsScreen({super.key, required this.repo, required this.sync, required this.projectId});
  final Repo repo;
  final SyncWorker sync;
  final String projectId;

  @override
  State<MaterialsScreen> createState() => _MaterialsScreenState();
}

class _MaterialsScreenState extends State<MaterialsScreen> {
  List<Map<String, dynamic>> materials = [];
  List<Map<String, dynamic>> buildings = [];
  List<String> recentIds = [];
  String type = 'IN';
  String? materialId;
  String? buildingId;
  final qty = TextEditingController();
  final supplier = TextEditingController();
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    materials = await widget.repo.materials();
    buildings = await widget.repo.buildings(widget.projectId);
    final recent = await widget.repo.db.getKv('materials:recent');
    if (recent != null) {
      recentIds = (jsonDecode(recent) as List).cast<String>();
    }
    // Data-derived default: the material you used last time.
    materialId ??= recentIds.isNotEmpty && materials.any((m) => m['id'] == recentIds.first)
        ? recentIds.first
        : null;
    buildingId ??= buildings.isNotEmpty ? buildings.first['id'] as String : null;
    if (mounted) setState(() {});
  }

  Map<String, dynamic>? get _selected {
    for (final m in materials) {
      if (m['id'] == materialId) return m;
    }
    return null;
  }

  String get _unit => (_selected?['unit'] ?? '').toString();

  Future<void> _pickMaterial() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: kInk,
      isScrollControlled: true,
      builder: (ctx) => _MaterialPickerSheet(materials: materials, recentIds: recentIds),
    );
    if (picked != null) setState(() => materialId = picked);
  }

  Future<void> _save() async {
    final q = double.tryParse(qty.text.trim());
    if (materialId == null || q == null || q <= 0) return;
    setState(() => busy = true);
    await widget.repo.logMaterial(
      projectId: widget.projectId,
      materialId: materialId!,
      type: type,
      quantity: q,
      buildingId: type == 'OUT' ? buildingId : null,
      supplierName: type == 'IN' && supplier.text.trim().isNotEmpty ? supplier.text.trim() : null,
    );
    // Float this material to the top of "recent" for next time.
    recentIds = [materialId!, ...recentIds.where((id) => id != materialId)].take(8).toList();
    await widget.repo.db.putKv('materials:recent', jsonEncode(recentIds));
    widget.sync.drain();
    if (!mounted) return;
    setState(() { busy = false; qty.clear(); });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(type == 'IN'
            ? 'Delivery saved ✓ — the store updates itself'
            : 'Issue saved ✓ — it lands on the house')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Materials in / out')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // IN / OUT — one big obvious switch
        Row(children: [
          Expanded(
            child: ChoiceChip(
              label: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 6),
                  child: Center(child: Text('IN — delivery arrived', style: TextStyle(fontSize: 15)))),
              selected: type == 'IN',
              onSelected: (_) => setState(() => type = 'IN'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ChoiceChip(
              label: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 6),
                  child: Center(child: Text('OUT — used on a house', style: TextStyle(fontSize: 15)))),
              selected: type == 'OUT',
              onSelected: (_) => setState(() => type = 'OUT'),
            ),
          ),
        ]),
        const SizedBox(height: 16),

        // Material — searchable picker, recents on top.
        InkWell(
          onTap: _pickMaterial,
          borderRadius: BorderRadius.circular(14),
          child: InputDecorator(
            decoration: const InputDecoration(labelText: 'Material', suffixIcon: Icon(Icons.search, color: kMuted)),
            child: Text(
              _selected != null ? '${_selected!['name']} (${_selected!['unit']})' : 'Tap to find a material',
              style: TextStyle(fontSize: 16, color: _selected != null ? Colors.white : kMuted),
            ),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: qty,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 22, color: Colors.white),
          decoration: InputDecoration(labelText: _unit.isEmpty ? 'How much?' : 'How much? ($_unit)'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        if (type == 'OUT')
          DropdownButtonFormField<String>(
            value: buildingId,
            decoration: const InputDecoration(labelText: 'Which house?'),
            dropdownColor: kInkCard,
            items: [
              for (final b in buildings)
                DropdownMenuItem(
                    value: b['id'] as String,
                    child: Text(b['code'] as String, style: const TextStyle(color: Colors.white))),
            ],
            onChanged: (v) => setState(() => buildingId = v),
          )
        else
          TextField(
            controller: supplier,
            style: const TextStyle(fontSize: 16, color: Colors.white),
            decoration: const InputDecoration(labelText: 'Supplier (optional)'),
          ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: busy ||
                  materialId == null ||
                  double.tryParse(qty.text.trim()) == null ||
                  (type == 'OUT' && buildingId == null)
              ? null
              : _save,
          icon: Icon(type == 'IN' ? Icons.archive_outlined : Icons.unarchive_outlined),
          label: Text(busy ? 'Saving…' : (type == 'IN' ? 'Save delivery' : 'Save issue')),
        ),
        const SizedBox(height: 12),
        const Text('Works offline — saved items send themselves when there\'s network.',
            style: TextStyle(color: kMuted, fontSize: 13), textAlign: TextAlign.center),
      ]),
    );
  }
}

// Search-first material picker: a text box filters as you type; with no search
// text, your recent materials head the list so the daily ones are one tap away.
class _MaterialPickerSheet extends StatefulWidget {
  const _MaterialPickerSheet({required this.materials, required this.recentIds});
  final List<Map<String, dynamic>> materials;
  final List<String> recentIds;

  @override
  State<_MaterialPickerSheet> createState() => _MaterialPickerSheetState();
}

class _MaterialPickerSheetState extends State<_MaterialPickerSheet> {
  String query = '';

  @override
  Widget build(BuildContext context) {
    final q = query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? widget.materials
        : widget.materials.where((m) => (m['name'] as String).toLowerCase().contains(q)).toList();
    final recent = q.isEmpty
        ? [
            for (final id in widget.recentIds)
              ...widget.materials.where((m) => m['id'] == id)
          ]
        : <Map<String, dynamic>>[];
    final recentSet = {for (final m in recent) m['id']};
    final rest = filtered.where((m) => !recentSet.contains(m['id'])).toList();

    Widget tile(Map<String, dynamic> m, {bool isRecent = false}) => ListTile(
          leading: isRecent ? const Icon(Icons.history, color: kAccent, size: 20) : null,
          title: Text('${m['name']} (${m['unit']})',
              style: const TextStyle(color: Colors.white, fontSize: 16)),
          onTap: () => Navigator.of(context).pop(m['id'] as String),
        );

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.85,
        builder: (_, scroll) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(
              autofocus: true,
              style: const TextStyle(color: Colors.white, fontSize: 17),
              decoration: const InputDecoration(
                  labelText: 'Type to find a material', prefixIcon: Icon(Icons.search, color: kMuted)),
              onChanged: (v) => setState(() => query = v),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(controller: scroll, children: [
                if (recent.isNotEmpty) ...[
                  const Padding(
                    padding: EdgeInsets.only(top: 8, bottom: 2),
                    child: Text('RECENT', style: TextStyle(color: kMuted, fontSize: 12, letterSpacing: 1.2)),
                  ),
                  for (final m in recent) tile(m, isRecent: true),
                  const Divider(color: Color(0xFF2A3242)),
                ],
                for (final m in rest) tile(m),
                if (rest.isEmpty && recent.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 24),
                    child: Center(child: Text('Nothing matches — check the spelling.',
                        style: TextStyle(color: kMuted))),
                  ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}
