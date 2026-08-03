import 'dart:io';
import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:path_provider/path_provider.dart';
import '../core/theme.dart';
import '../data/repo.dart';
import '../features/camera/capture_service.dart';

// In-app capture ONLY (F-9.3 — no gallery import). Each shot is stamped with GPS +
// time + house (burned into the display copy, F-9.4). Outside the geofence the shot
// is still allowed — the server flags it, never blocks it (F-9.5).
class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    required this.repo,
    required this.buildingOptions,
    this.defaultBuildingId,
    this.stampPrefix = 'SiteLens',
  });
  final Repo repo;
  final List<Map<String, dynamic>> buildingOptions;
  final String? defaultBuildingId;
  final String stampPrefix;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  CameraController? controller;
  String? buildingId;
  bool taking = false;
  String? error;

  @override
  void initState() {
    super.initState();
    buildingId = widget.defaultBuildingId;
    _init();
  }

  Future<void> _init() async {
    try {
      final cams = await availableCameras();
      final back = cams.firstWhere(
          (c) => c.lensDirection == CameraLensDirection.back,
          orElse: () => cams.first);
      controller = CameraController(back, ResolutionPreset.high, enableAudio: false);
      await controller!.initialize();
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) setState(() => error = 'Camera not available: $e');
    }
  }

  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  Future<Position?> _position() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return null;
      return await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
        ).timeout(const Duration(seconds: 6));
    } catch (_) {
      return null; // no GPS is allowed — the photo still counts (F-9.5)
    }
  }

  Future<void> _shoot() async {
    final c = controller;
    if (c == null || taking) return;
    setState(() => taking = true);
    try {
      final shot = await c.takePicture();
      final pos = await _position();
      final dir = await getApplicationDocumentsDirectory();
      final code = widget.buildingOptions
          .firstWhere((b) => b['id'] == buildingId, orElse: () => {'code': ''})['code']
          ?.toString();
      final capture = CaptureService(widget.repo.db, dir.path);
      final id = await capture.ingest(
        File(shot.path),
        buildingId: buildingId,
        stampLine: [widget.stampPrefix, if (code != null && code.isNotEmpty) code].join(' · '),
        lon: pos?.longitude,
        lat: pos?.latitude,
        gpsAccuracyM: pos?.accuracy,
        mockLocation: pos?.isMocked ?? false,
      );
      if (mounted) Navigator.of(context).pop(id);
    } catch (e) {
      if (mounted) setState(() { error = 'Could not take the photo: $e'; taking = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, title: const Text('Take photo')),
      body: Column(children: [
        Expanded(
          child: error != null
              ? Center(child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(error!, style: const TextStyle(color: Colors.redAccent, fontSize: 16))))
              : (c == null || !c.value.isInitialized)
                  ? const Center(child: CircularProgressIndicator(color: kAccent))
                  : CameraPreview(c),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(children: [
              if (widget.buildingOptions.length > 1)
                Wrap(spacing: 8, children: [
                  for (final b in widget.buildingOptions)
                    ChoiceChip(
                      label: Text(b['code'] as String),
                      selected: buildingId == b['id'],
                      onSelected: (_) => setState(() => buildingId = b['id'] as String),
                    ),
                ]),
              const SizedBox(height: 12),
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: kAccentSheen,
                  boxShadow: glow(kAccent, strength: 0.6, blur: 30),
                ),
                padding: const EdgeInsets.all(5),
                child: Container(
                  decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.black),
                  padding: const EdgeInsets.all(3),
                  child: Material(
                    color: Colors.transparent,
                    shape: const CircleBorder(),
                    clipBehavior: Clip.antiAlias,
                    child: InkWell(
                      onTap: taking ? null : _shoot,
                      child: Ink(
                        decoration: const BoxDecoration(shape: BoxShape.circle, gradient: kAccentSheen),
                        child: Center(
                          child: taking
                              ? const CircularProgressIndicator(color: Colors.black)
                              : const Icon(Icons.photo_camera_rounded, size: 36, color: Colors.black),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
