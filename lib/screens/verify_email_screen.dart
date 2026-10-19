import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class VerifyEmailScreen extends StatefulWidget {
  final VoidCallback onRecheck;
  const VerifyEmailScreen({super.key, required this.onRecheck});

  @override
  State<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends State<VerifyEmailScreen> {
  bool _loading = false;
  String? _message;

  Future<void> _resend() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      await FirebaseAuth.instance.currentUser?.sendEmailVerification();
      setState(() => _message = 'E-mail de verificação reenviado.');
    } catch (e) {
      setState(() => _message = 'Erro ao reenviar: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _checkVerified() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      await FirebaseAuth.instance.currentUser?.reload();
      widget.onRecheck();
    } catch (e) {
      setState(() => _message = 'Erro ao verificar: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final email = FirebaseAuth.instance.currentUser?.email ?? '';
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.mark_email_unread,
                    color: Color(0xFF7C4DFF), size: 48),
                const SizedBox(height: 16),
                const Text(
                  'Confirme seu e-mail',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                Text(
                  'Enviamos um link de verificação para $email. Confirme e depois toque em "Já verifiquei".',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF888888), fontSize: 14),
                ),
                const SizedBox(height: 32),
                if (_loading)
                  const CircularProgressIndicator(color: Color(0xFF7C4DFF))
                else ...[
                  ElevatedButton(
                    onPressed: _checkVerified,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF7C4DFF),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 24, vertical: 14),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Já verifiquei'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: _resend,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Color(0xFF7C4DFF)),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 24, vertical: 14),
                    ),
                    child: const Text('Reenviar e-mail de verificação'),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => FirebaseAuth.instance.signOut(),
                    child: const Text('Sair',
                        style: TextStyle(color: Color(0xFF888888))),
                  ),
                ],
                if (_message != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _message!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFF00C853), fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
