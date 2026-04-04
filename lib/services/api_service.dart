import 'dart:convert';
import 'package:http/http.dart' as http;

const String _base = 'http://localhost:3001/api';

class FetchResult {
  final List<Map<String, dynamic>> data;
  final DateTime? lastUpdated;

  const FetchResult({required this.data, this.lastUpdated});
}

class ApiService {
  static Future<FetchResult> fetchTennisResults() async {
    final res = await http.get(Uri.parse('$_base/tennis/results'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar resultados de tênis');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<FetchResult> fetchNbaResults() async {
    final res = await http.get(Uri.parse('$_base/nba/results'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar resultados NBA');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<FetchResult> fetchNbaProps() async {
    final res = await http.get(Uri.parse('$_base/nba/props'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar props NBA');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<FetchResult> fetchNbaBrProps() async {
    final res = await http.get(Uri.parse('$_base/nba/props-br'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar props NBA BR');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<FetchResult> fetchMlbResults() async {
    final res = await http.get(Uri.parse('$_base/mlb/results'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar resultados MLB');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<FetchResult> fetchMlbProps() async {
    final res = await http.get(Uri.parse('$_base/mlb/props'));
    if (res.statusCode != 200) throw Exception('Erro ao buscar props MLB');
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return FetchResult(
      data: (body['data'] as List).cast<Map<String, dynamic>>(),
      lastUpdated: body['lastUpdated'] != null
          ? DateTime.tryParse(body['lastUpdated'])
          : null,
    );
  }

  static Future<String> post(String path) async {
    final res = await http.post(Uri.parse('$_base/$path'));
    final body = jsonDecode(res.body);
    if (body['ok'] != true) throw Exception(body['error'] ?? 'Erro desconhecido');
    return body['log'] as String? ?? '';
  }
}
