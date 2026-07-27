import 'dart:convert';
import 'package:http/http.dart' as http;

// Thin Supabase RPC client. Calls the SECURITY DEFINER functions built in M4 — the
// server enforces idempotency, so the sync worker can safely resend. Config comes from
// --dart-define (SUPABASE_URL, SUPABASE_ANON_KEY); the session JWT carries active_org_id.
class ApiClient {
  ApiClient({required this.baseUrl, required this.anonKey, required this.accessToken});
  final String baseUrl;      // e.g. http://10.0.2.2:54321
  final String anonKey;
  String accessToken;        // GoTrue session token (phone OTP)

  Future<dynamic> rpc(String fn, Map<String, dynamic> args) async {
    final res = await http.post(
      Uri.parse('$baseUrl/rest/v1/rpc/$fn'),
      headers: {
        'apikey': anonKey,
        'Authorization': 'Bearer $accessToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(args),
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return res.body.isEmpty ? null : jsonDecode(res.body);
    }
    throw ApiException(res.statusCode, res.body);
  }
}

class ApiException implements Exception {
  ApiException(this.status, this.body);
  final int status;
  final String body;
  // 4xx (except 401/timeout) are permanent — don't keep retrying a bad payload.
  bool get retryable => status == 0 || status == 401 || status >= 500;
  @override
  String toString() => 'ApiException($status): $body';
}
