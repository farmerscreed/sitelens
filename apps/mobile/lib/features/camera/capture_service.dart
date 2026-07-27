import 'dart:io';
import 'package:image/image.dart' as img;
import 'package:path/path.dart' as p;
import '../../core/ids.dart';
import '../../db/database.dart';
import 'package:drift/drift.dart';

// Three-derivative rule (§5.3), generated ON DEVICE so the small thumb uploads first
// even on 3G and the full-resolution original is NEVER destroyed (needed for training +
// forensics). The display copy is watermarked; the original is untouched.
//   thumb   ~50 KB   lists / portal timeline
//   display ~400 KB  watermarked, full-screen viewing
//   original full res, EXIF intact
class CaptureService {
  CaptureService(this.db, this.mediaDir);
  final AppDb db;
  final String mediaDir;

  // `original` is the freshly captured full-res file. GPS/time come from the device.
  Future<String> ingest(File original, {double? lon, double? lat, bool mockLocation = false}) async {
    final id = newId();
    final bytes = await original.readAsBytes();
    final decoded = img.decodeImage(bytes)!;

    // thumb + display are DERIVED; the original is copied byte-for-byte, never re-encoded.
    final thumb = img.copyResize(decoded, width: 320);
    final display = _watermark(img.copyResize(decoded, width: 1280),
        'SiteLens • ${DateTime.now().toIso8601String()}');

    final thumbPath = p.join(mediaDir, '$id.thumb.jpg');
    final displayPath = p.join(mediaDir, '$id.display.jpg');
    final originalPath = p.join(mediaDir, '$id.original.jpg');
    await File(thumbPath).writeAsBytes(img.encodeJpg(thumb, quality: 60));
    await File(displayPath).writeAsBytes(img.encodeJpg(display, quality: 80));
    await original.copy(originalPath); // untouched

    await db.into(db.mediaLocal).insert(MediaLocalCompanion.insert(
          id: id,
          reportId: const Value(null),
          localThumbPath: thumbPath,
          localDisplayPath: displayPath,
          localOriginalPath: originalPath,
          capturedAt: DateTime.now(),
          lon: Value(lon),
          lat: Value(lat),
          phashHex: Value(_phashHex(thumb)),
          mockLocation: Value(mockLocation),
        ));
    return id;
  }

  img.Image _watermark(img.Image im, String text) {
    img.drawString(im, text, font: img.arial14, x: 8, y: im.height - 20);
    return im;
  }

  // 64-bit average-hash (aHash) — a cheap perceptual hash for the duplicate flag.
  // Full near-duplicate detection (AI-1) is server-side in M6; this seeds media.phash.
  String _phashHex(img.Image im) {
    final g = img.grayscale(img.copyResize(im, width: 8, height: 8));
    var sum = 0;
    final vals = <int>[];
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        final v = img.getLuminance(g.getPixel(x, y)).toInt();
        vals.add(v);
        sum += v;
      }
    }
    final avg = sum ~/ 64;
    var bits = BigInt.zero;
    for (final v in vals) {
      bits = (bits << 1) | BigInt.from(v >= avg ? 1 : 0);
    }
    return bits.toRadixString(16).padLeft(16, '0');
  }
}
