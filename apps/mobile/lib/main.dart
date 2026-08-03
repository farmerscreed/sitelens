import 'dart:async';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'api/api_client.dart';
import 'core/session.dart';
import 'core/theme.dart';
import 'data/repo.dart';
import 'db/database.dart';
import 'sync/sync_worker.dart';
import 'ui/login_screen.dart';
import 'ui/today_screen.dart';

// SiteLens field app (Android 8+): the Site Engineer's tool, offline-first.
// Local SQLite is the source of truth; the sync worker drains queued work on
// reconnect + every 30 s (AC-1). Config via --dart-define (SUPABASE_URL/ANON_KEY).
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const url = String.fromEnvironment('SUPABASE_URL', defaultValue: 'http://10.0.2.2:54321');
  const anon = String.fromEnvironment('SUPABASE_ANON_KEY');
  runApp(const SiteLensApp(url: url, anonKey: anon));
}

class SiteLensApp extends StatefulWidget {
  const SiteLensApp({super.key, required this.url, required this.anonKey});
  final String url;
  final String anonKey;

  @override
  State<SiteLensApp> createState() => _SiteLensAppState();
}

class _SiteLensAppState extends State<SiteLensApp> {
  final AppDb db = AppDb();
  Session? session;
  ApiClient? api;
  SyncWorker? sync;
  Repo? repo;
  bool ready = false;
  Timer? heartbeat;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    final s = await Session.load(baseUrl: widget.url, anonKey: widget.anonKey);
    final a = ApiClient(s);
    final w = SyncWorker(db, a, s);
    final r = Repo(db, a, s);
    // Drain whenever connectivity returns, and every 30 s as a safety net.
    Connectivity().onConnectivityChanged.listen((_) => w.drain());
    heartbeat = Timer.periodic(const Duration(seconds: 30), (_) => w.drain());
    if (s.signedIn) {
      // Best-effort: refresh the token + make sure the org claim is present.
      try {
        await s.refresh();
        await r.ensureActiveOrg();
      } catch (_) {/* offline start is fine — cached data carries the day */}
    }
    setState(() {
      session = s; api = a; sync = w; repo = r; ready = true;
    });
  }

  @override
  void dispose() {
    heartbeat?.cancel();
    super.dispose();
  }

  Future<void> _afterSignIn() async {
    await repo!.ensureActiveOrg();
    setState(() {});
    sync!.drain();
  }

  Future<void> _signOut() async {
    await session!.signOut();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SiteLens',
      debugShowCheckedModeBanner: false,
      theme: siteLensTheme(),
      home: !ready
          ? const Scaffold(body: Center(child: CircularProgressIndicator(color: kAccent)))
          : session!.signedIn
              ? TodayScreen(repo: repo!, sync: sync!, onSignOut: _signOut)
              : LoginScreen(session: session!, onSignedIn: _afterSignIn),
    );
  }
}
