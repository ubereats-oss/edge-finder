import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../auth_config.dart';
import 'sport_selector_screen.dart';
import 'login_screen.dart';
import 'access_denied_screen.dart';
import 'verify_email_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final StreamSubscription<User?> _sub;
  User? _user;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _sub = FirebaseAuth.instance.authStateChanges().listen((user) {
      setState(() {
        _user = user;
        _loading = false;
      });
    });
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }

  // Após user.reload(), currentUser é atualizado no lugar, mas
  // authStateChanges não reemite — precisa forçar o rebuild manualmente.
  void _refreshFromCurrentUser() {
    setState(() => _user = FirebaseAuth.instance.currentUser);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: Color(0xFF12121F),
        body: Center(
          child: CircularProgressIndicator(color: Color(0xFF7C4DFF)),
        ),
      );
    }
    final user = _user;
    if (user == null) {
      return const LoginScreen();
    }
    if (user.email != kOwnerEmail) {
      return AccessDeniedScreen(signedInEmail: user.email);
    }
    if (!user.emailVerified) {
      return VerifyEmailScreen(onRecheck: _refreshFromCurrentUser);
    }
    return const SportSelectorScreen();
  }
}
