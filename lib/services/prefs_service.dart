import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class PrefsService {
  static SharedPreferences? _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    _migrateGeminiKey();
  }

  // Roda uma única vez: remove qualquer chave Gemini já salva localmente.
  // Cobre quem tinha a chave padrão antiga (removida do código nesta
  // correção) persistida por ter salvo o campo de Configurações enquanto
  // ele vinha pré-preenchido — depois da migração, o usuário decide de
  // novo se quer configurar uma chave própria.
  static void _migrateGeminiKey() {
    const flag = 'gemini_key_migrated_v1';
    if (_prefs?.getBool(flag) == true) return;
    _prefs?.remove('gemini_api_key');
    _prefs?.setBool(flag, true);
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
  // Sem valor padrão embutido — sem chave própria do usuário (salva ou via
  // --dart-define=GEMINI_API_KEY na build), getGeminiKey() devolve vazio e a
  // funcionalidade que depende do Gemini fica indisponível.

  static const _envGeminiKey = String.fromEnvironment('GEMINI_API_KEY', defaultValue: '');

  static String getGeminiKey() {
    final saved = _prefs?.getString('gemini_api_key') ?? '';
    return saved.isNotEmpty ? saved : _envGeminiKey;
  }

  static bool hasGeminiKey() => getGeminiKey().isNotEmpty;

  static void setGeminiKey(String value) {
    _prefs?.setString('gemini_api_key', value);
  }

  // ─── Caminho raiz do projeto ──────────────────────────────────────────────

  static String getProjectRootPath() {
    return _prefs?.getString('project_root_path') ?? '';
  }

  static void setProjectRootPath(String value) {
    _prefs?.setString('project_root_path', value);
  }
}
