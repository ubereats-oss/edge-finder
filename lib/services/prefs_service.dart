import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class PrefsService {
  static SharedPreferences? _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // ─── Banca ───────────────────────────────────────────────────────────────

  static double getBanca() {
    return _prefs?.getDouble('banca') ?? 0;
  }

  static void setBanca(double value) {
    _prefs?.setDouble('banca', value);
  }

  // ─── Último bookmaker ─────────────────────────────────────────────────────

  static String? getLastBookmaker() {
    return _prefs?.getString('last_bookmaker');
  }

  static void setLastBookmaker(String value) {
    _prefs?.setString('last_bookmaker', value);
  }

  // ─── Bookmakers customizados ──────────────────────────────────────────────

  static List<String> getCustomBookmakers() {
    final raw = _prefs?.getString('custom_bookmakers');
    if (raw == null || raw.isEmpty) return [];
    try {
      return List<String>.from(jsonDecode(raw));
    } catch (_) {
      return [];
    }
  }

  static void addCustomBookmaker(String name) {
    final list = getCustomBookmakers();
    if (!list.contains(name)) {
      list.add(name);
      _prefs?.setString('custom_bookmakers', jsonEncode(list));
    }
  }
}
