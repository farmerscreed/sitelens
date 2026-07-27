import 'package:uuid/uuid.dart';

// All IDs are client-generated UUIDv7 — time-ordered, no server round-trip (§13.2).
// This is what lets the phone create records fully offline that still sort by time and
// never collide with the server.
final _uuid = Uuid();

String newId() => _uuid.v7();

// One idempotency_key per mutation. The server enforces it unique, so a retry over
// flaky 3G is a no-op instead of a duplicate (AC-1 / §13.2).
String newIdempotencyKey() => _uuid.v4();
