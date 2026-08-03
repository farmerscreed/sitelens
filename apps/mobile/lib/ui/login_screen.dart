import 'package:flutter/material.dart';
import '../core/session.dart';
import '../core/theme.dart';
import 'widgets.dart';

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
      body: OrbBackdrop(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 64),
                const Center(child: BrandMark()),
                const SizedBox(height: 10),
                const Center(
                  child: Text('The site, in your pocket',
                      style: TextStyle(fontSize: 16, color: kMuted, letterSpacing: 0.2)),
                ),
                const SizedBox(height: 48),
                GlassCard(
                  padding: const EdgeInsets.all(22),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    if (!codeSent) ...[
                      const SectionLabel('Sign in'),
                      const SizedBox(height: 14),
                      TextField(
                        controller: email,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        style: const TextStyle(fontSize: 17, color: kText),
                        decoration: const InputDecoration(labelText: 'Your email'),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => busy || email.text.trim().isEmpty ? null : _send(),
                      ),
                      const SizedBox(height: 18),
                      GradientButton(
                        label: busy ? 'Sending…' : 'Send me a code',
                        icon: Icons.bolt_rounded,
                        onPressed: busy || email.text.trim().isEmpty ? null : _send,
                      ),
                    ] else ...[
                      const SectionLabel('Check your email'),
                      const SizedBox(height: 10),
                      Text('We sent a 6-digit code to\n${email.text.trim()}',
                          style: const TextStyle(fontSize: 16, color: kText, height: 1.4)),
                      const SizedBox(height: 16),
                      TextField(
                        controller: code,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        autofocus: true,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            fontSize: 30, letterSpacing: 12, color: kText, fontWeight: FontWeight.w700),
                        decoration: const InputDecoration(counterText: '', hintText: '••••••'),
                        onChanged: (_) => setState(() {}),
                      ),
                      const SizedBox(height: 18),
                      GradientButton(
                        label: busy ? 'Checking…' : 'Sign in',
                        icon: Icons.arrow_forward_rounded,
                        onPressed: busy || code.text.trim().length < 6 ? null : _verify,
                      ),
                      TextButton(
                        onPressed: busy ? null : () => setState(() { codeSent = false; code.clear(); }),
                        child: const Text('Use a different email', style: TextStyle(color: kMuted)),
                      ),
                    ],
                    if (error != null) ...[
                      const SizedBox(height: 14),
                      Row(children: [
                        const Icon(Icons.error_outline, color: kBad, size: 18),
                        const SizedBox(width: 8),
                        Expanded(child: Text(error!, style: const TextStyle(color: kBad, fontSize: 14.5))),
                      ]),
                    ],
                  ]),
                ),
                const Spacer(),
                const Center(
                  child: Text('Works fully offline once you\'re in',
                      style: TextStyle(color: kFaint, fontSize: 13)),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
