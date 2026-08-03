import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/theme.dart';

// Email OTP in two taps: email → 6-digit code. (Phone OTP via Termii slots in
// later with the same verify shape.) Builder words, no jargon.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.onSignedIn});
  final Session session;
  final Future<void> Function() onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController();
  final code = TextEditingController();
  bool codeSent = false;
  bool busy = false;
  String? error;

  Future<void> _send() async {
    setState(() { busy = true; error = null; });
    try {
      await widget.session.requestCode(email.text);
      setState(() => codeSent = true);
    } catch (e) {
      setState(() => error = e.toString());
    } finally {
      setState(() => busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() { busy = true; error = null; });
    try {
      await widget.session.verifyCode(email.text, code.text);
      await widget.onSignedIn();
    } catch (e) {
      setState(() { error = e.toString(); busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 48),
              const Text('SiteLens',
                  style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: Colors.white)),
              const SizedBox(height: 6),
              const Text('Site reports made easy', style: TextStyle(fontSize: 16, color: kMuted)),
              const SizedBox(height: 40),
              if (!codeSent) ...[
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  style: const TextStyle(fontSize: 17, color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Your email'),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => busy || email.text.trim().isEmpty ? null : _send(),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: busy || email.text.trim().isEmpty ? null : _send,
                  child: Text(busy ? 'Sending…' : 'Send me a code'),
                ),
              ] else ...[
                Text('We sent a 6-digit code to ${email.text.trim()}',
                    style: const TextStyle(fontSize: 16, color: Colors.white)),
                const SizedBox(height: 16),
                TextField(
                  controller: code,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  autofocus: true,
                  style: const TextStyle(fontSize: 26, letterSpacing: 8, color: Colors.white),
                  decoration: const InputDecoration(labelText: 'Code', counterText: ''),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: busy || code.text.trim().length < 6 ? null : _verify,
                  child: Text(busy ? 'Checking…' : 'Sign in'),
                ),
                TextButton(
                  onPressed: busy ? null : () => setState(() { codeSent = false; code.clear(); }),
                  child: const Text('Use a different email', style: TextStyle(color: kMuted)),
                ),
              ],
              if (error != null) ...[
                const SizedBox(height: 16),
                Text(error!, style: const TextStyle(color: Colors.redAccent, fontSize: 15)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
