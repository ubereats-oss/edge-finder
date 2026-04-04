import 'dart:convert';
// ignore: avoid_web_libraries_in_flutter
import 'dart:html' as html;

class PrefsService {
  static double getBanca() {
    try {
      final raw = html.window.localStorage['banca'];
      if (raw == null) return 0;
      return double.tryParse(raw) ?? 0;
    } catch (_) {
      return 0;
    }
  }

  static void setBanca(double value) {
    try {
      html.window.localStorage['banca'] = value.toString();
    } catch (_) {}
  }
}
