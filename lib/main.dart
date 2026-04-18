import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'screens/sport_selector_screen.dart';
import 'services/prefs_service.dart';

const _firebaseOptions = FirebaseOptions(
  apiKey: 'AIzaSyBUUedKi0Y7kX4AzRBxOTuUQQeiqURXt2Y',
  authDomain: 'odds-app-edge.firebaseapp.com',
  projectId: 'odds-app-edge',
  storageBucket: 'odds-app-edge.firebasestorage.app',
  messagingSenderId: '29716291623',
  appId: '1:29716291623:web:de831afee353ceb74fae02',
  measurementId: 'G-L4C5879SXP',
);

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await PrefsService.init();
  await Firebase.initializeApp(options: _firebaseOptions);
  if (FirebaseAuth.instance.currentUser == null) {
    await FirebaseAuth.instance.signInAnonymously();
  }
  runApp(const OddsApp());
}

class OddsApp extends StatelessWidget {
  const OddsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Edge Finder',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF12121F),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF7C4DFF),
          secondary: Color(0xFF00C853),
        ),
      ),
      home: const SportSelectorScreen(),
    );
  }
}
