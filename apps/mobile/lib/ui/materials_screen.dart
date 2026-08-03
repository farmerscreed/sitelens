import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../sync/sync_worker.dart';

// Materials in / out. IN = a delivery arrived at the store; OUT = issued to a
// house (the server's balance guard rejects more than the store holds — AC-4).
// Queues offline like everything else. No prices anywhere on this screen.
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
    materialId ??= materials.isNotEmpty ? materials.first['id'] as String : null;
    buildingId ??= buildings.isNotEmpty ? buildings.first['id'] as String : null;
    if (mounted) setState(() {});
  }

  String get _unit =>
      (materials.firstWhere((m) => m['id'] == materialId, orElse: () => {'unit': ''})['unit'] ?? '')
          .toString();

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

        DropdownButtonFormField<String>(
          value: materialId,
          decoration: const InputDecoration(labelText: 'Material'),
          dropdownColor: kInkCard,
          items: [
            for (final m in materials)
              DropdownMenuItem(
                  value: m['id'] as String,
                  child: Text('${m['name']} (${m['unit']})',
                      style: const TextStyle(color: Colors.white))),
          ],
          onChanged: (v) => setState(() => materialId = v),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: qty,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontSize: 22, color: Colors.white),
          decoration: InputDecoration(labelText: 'How much? ($_unit)'),
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
