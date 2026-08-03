import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

// GoTrue session: email OTP now, Termii phone OTP later (same verify shape).
// Tokens persist in the app-private documents dir (Android app sandbox); the JWT
// carries active_org_id via the custom_access_token hook, which is what satisfies
// RLS and the SECURITY DEFINER fns. After login we make sure an active org is set
// (fn_set_active_org) and refresh so the claim lands in the token.
class Session {
  Session({required this.baseUrl, required this.anonKey});
  final String baseUrl;
  final String anonKey;

  String? accessToken;
  String? refreshToken;
  DateTime? expiresAt;
  String? orgId;      // active_org_id claim
  String? email;

  bool get signedIn => accessToken != null && refreshToken != null;

  static Future<Session> load({required String baseUrl, required String anonKey}) async {
    final s = Session(baseUrl: baseUrl, anonKey: anonKey);
    try {
      final f = await s._file();
      if (await f.exists()) {
        final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
        s.accessToken = j['access_token'] as String?;
        s.refreshToken = j['refresh_token'] as String?;
        s.email = j['email'] as String?;
        s.expiresAt = j['expires_at'] != null ? DateTime.tryParse(j['expires_at'] as String) : null;
        s._readClaims();
      }
    } catch (_) {/* corrupt session file → start signed out */}
    return s;
  }

  Future<File> _file() async {
    final dir = await getApplicationDocumentsDirectory();
    return File(p.join(dir.path, 'session.json'));
  }

  Future<void> _save() async {
    final f = await _file();
    await f.writeAsString(jsonEncode({
      'access_token': accessToken,
      'refresh_token': refreshToken,
      'email': email,
      'expires_at': expiresAt?.toIso8601String(),
    }));
  }

  Future<void> signOut() async {
    accessToken = null;
    refreshToken = null;
    orgId = null;
    email = null;
    try {
      final f = await _file();
      if (await f.exists()) await f.delete();
    } catch (_) {}
  }

  // Step 1: send the 6-digit code. create_user=false — field users are provisioned
  // by the org admin; a typo'd email must not mint a fresh empty account.
  Future<void> requestCode(String emailAddr) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/v1/otp'),
      headers: {'apikey': anonKey, 'Content-Type': 'application/json'},
      body: jsonEncode({'email': emailAddr.trim(), 'create_user': false}),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw AuthException(_msg(res.body, 'Could not send the code'));
    }
  }

  // Step 2: verify the code → session.
  Future<void> verifyCode(String emailAddr, String code) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/v1/verify'),
      headers: {'apikey': anonKey, 'Content-Type': 'application/json'},
      body: jsonEncode({'type': 'email', 'email': emailAddr.trim(), 'token': code.trim()}),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw AuthException(_msg(res.body, 'Wrong or expired code'));
    }
    _applyTokens(jsonDecode(res.body) as Map<String, dynamic>);
    email = emailAddr.trim();
    await _save();
  }

  Future<bool> refresh() async {
    final rt = refreshToken;
    if (rt == null) return false;
    final res = await http.post(
      Uri.parse('$baseUrl/auth/v1/token?grant_type=refresh_token'),
      headers: {'apikey': anonKey, 'Content-Type': 'application/json'},
      body: jsonEncode({'refresh_token': rt}),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) return false;
    _applyTokens(jsonDecode(res.body) as Map<String, dynamic>);
    await _save();
    return true;
  }

  void _applyTokens(Map<String, dynamic> j) {
    accessToken = j['access_token'] as String?;
    refreshToken = (j['refresh_token'] as String?) ?? refreshToken;
    final exp = j['expires_in'];
    if (exp is num) expiresAt = DateTime.now().add(Duration(seconds: exp.toInt()));
    _readClaims();
  }

  // active_org_id lives in the JWT payload (custom access-token hook).
  void _readClaims() {
    orgId = null;
    final t = accessToken;
    if (t == null) return;
    final parts = t.split('.');
    if (parts.length != 3) return;
    try {
      final payload = jsonDecode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map<String, dynamic>;
      final v = payload['active_org_id'];
      if (v is String && v.isNotEmpty) orgId = v;
    } catch (_) {}
  }

  String _msg(String body, String fallback) {
    try {
      final j = jsonDecode(body) as Map<String, dynamic>;
      return (j['msg'] ?? j['message'] ?? j['error_description'] ?? fallback).toString();
    } catch (_) {
      return fallback;
    }
  }
}

class AuthException implements Exception {
  AuthException(this.message);
  final String message;
  @override
  String toString() => message;
}
