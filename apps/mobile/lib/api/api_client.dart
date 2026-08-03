import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/session.dart';

// Thin Supabase client: RPC to the SECURITY DEFINER functions (the ONLY write path,
// Rule 1), PostgREST reads (RLS-scoped), and private-bucket uploads. A 401 triggers
// one token refresh + retry; the server enforces idempotency so the sync worker can
// safely resend any mutation.
class ApiClient {
  ApiClient(this.session);
  final Session session;

  String get _base => session.baseUrl;

  Map<String, String> _headers([Map<String, String>? extra]) => {
        'apikey': session.anonKey,
        'Authorization': 'Bearer ${session.accessToken}',
        ...?extra,
      };

  Future<http.Response> _withAuthRetry(Future<http.Response> Function() send) async {
    var res = await send();
    if (res.statusCode == 401 && await session.refresh()) {
      res = await send();
    }
    return res;
  }

  Future<dynamic> rpc(String fn, Map<String, dynamic> args) async {
    final res = await _withAuthRetry(() => http.post(
          Uri.parse('$_base/rest/v1/rpc/$fn'),
          headers: _headers({'Content-Type': 'application/json'}),
          body: jsonEncode(args),
        ));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return res.body.isEmpty ? null : jsonDecode(res.body);
    }
    throw ApiException(res.statusCode, res.body);
  }

  // PostgREST read, e.g. select('buildings?select=id,code&archived_at=is.null').
  Future<List<dynamic>> select(String query) async {
    final res = await _withAuthRetry(() => http.get(
          Uri.parse('$_base/rest/v1/$query'),
          headers: _headers(),
        ));
    if (res.statusCode >= 200 && res.statusCode < 300) {
      final v = jsonDecode(res.body);
      return v is List ? v : [v];
    }
    throw ApiException(res.statusCode, res.body);
  }

  // Upload one object into the private report-media bucket. x-upsert makes a
  // resend after a lost ack overwrite the same key — idempotent.
  Future<void> uploadMedia(String key, List<int> bytes, {String contentType = 'image/jpeg'}) async {
    final res = await _withAuthRetry(() => http.post(
          Uri.parse('$_base/storage/v1/object/report-media/$key'),
          headers: _headers({'Content-Type': contentType, 'x-upsert': 'true'}),
          body: bytes,
        ));
    if (res.statusCode >= 200 && res.statusCode < 300) return;
    throw ApiException(res.statusCode, res.body);
  }
}

class ApiException implements Exception {
  ApiException(this.status, this.body);
  final int status;
  final String body;
  // 4xx (except 401/timeout) are permanent — don't keep retrying a bad payload.
  bool get retryable => status == 0 || status == 401 || status == 408 || status == 429 || status >= 500;
  String get message {
    try {
      final j = jsonDecode(body) as Map<String, dynamic>;
      return (j['message'] ?? j['msg'] ?? j['error'] ?? body).toString();
    } catch (_) {
      return body;
    }
  }
  @override
  String toString() => 'ApiException($status): $body';
}
