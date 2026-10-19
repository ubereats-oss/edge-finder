import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class AccessDeniedScreen extends StatelessWidget {
  final String? signedInEmail;
  const AccessDeniedScreen({super.key, this.signedInEmail});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.block, color: Colors.redAccent, size: 48),
                const SizedBox(height: 16),
                const Text(
                  'Acesso negado',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  signedInEmail == null
                      ? 'Esta conta não tem permissão para usar o app.'
                      : 'A conta $signedInEmail não tem permissão para usar o app.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF888888), fontSize: 14),
                ),
                const SizedBox(height: 32),
                OutlinedButton(
                  onPressed: () => FirebaseAuth.instance.signOut(),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Color(0xFF7C4DFF)),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                  ),
                  child: const Text('Sair e entrar com outra conta'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
