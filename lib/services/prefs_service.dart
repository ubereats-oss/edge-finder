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

  // ─── Migração de apostas ──────────────────────────────────────────────────

  static bool getBetsMigrated() => _prefs?.getBool('bets_migrated') ?? false;
  static void setBetsMigrated() => _prefs?.setBool('bets_migrated', true);

  // ─── Gemini API Key ───────────────────────────────────────────────────────

  static const _envGeminiKey = String.fromEnvironment(
    'GEMINI_API_KEY',
    defaultValue: 'AIzaSyAqHhpVvCZtIRu0Z9Cw8aYVVeBcCcTPYCI',
  );

  static String getGeminiKey() {
    final saved = _prefs?.getString('gemini_api_key') ?? '';
    return saved.isNotEmpty ? saved : _envGeminiKey;
  }

  static void setGeminiKey(String value) {
    _prefs?.setString('gemini_api_key', value);
  }
}
