import 'dart:convert';
import 'package:http/http.dart' as http;

// ── Configuração Firebase ──────────────────────────────────────────────────────
const _projectId = 'odds-app-edge';
const _firestoreBase =
    'https://firestore.googleapis.com/v1/projects/$_projectId/databases/(default)/documents';

// ── Configuração GitHub Actions ────────────────────────────────────────────────
const _githubRepo = 'ubereats-oss/edge-finder';

class FetchResult {
  final List<Map<String, dynamic>> data;
  final DateTime? lastUpdated;
  const FetchResult({required this.data, this.lastUpdated});
}

class ApiService {
  // ── Leitura do Firestore ───────────────────────────────────────────────────
  static Future<FetchResult> _fetchFirestore(
      String collection, String document) async {
    final url = '$_firestoreBase/$collection/$document';
    final res = await http.get(Uri.parse(url));
    if (res.statusCode != 200) {
      throw Exception(
          'Erro ao buscar $collection/$document: ${res.statusCode}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final fields = body['fields'] as Map<String, dynamic>?;
    if (fields == null) {
      return const FetchResult(data: []);
    }

    final dataField = fields['data'];
    final List<Map<String, dynamic>> data = [];
    if (dataField != null) {
      final values = dataField['arrayValue']?['values'] as List? ?? [];
      for (final item in values) {
        final map = _firestoreToMap(
            item['mapValue']?['fields'] as Map<String, dynamic>? ?? {});
        data.add(map);
      }
    }

    DateTime? lastUpdated;
    final luField = fields['lastUpdated'];
    if (luField != null) {
      final luStr = luField['stringValue'] as String?;
      if (luStr != null) {
        lastUpdated = DateTime.tryParse(luStr);
      }
    }
    return FetchResult(data: data, lastUpdated: lastUpdated);
  }

  // ── Conversão Firestore → Map ──────────────────────────────────────────────
  static Map<String, dynamic> _firestoreToMap(Map<String, dynamic> fields) {
    final result = <String, dynamic>{};
    for (final entry in fields.entries) {
      result[entry.key] = _firestoreValue(entry.value as Map<String, dynamic>);
    }
    return result;
  }

  static dynamic _firestoreValue(Map<String, dynamic> value) {
    if (value.containsKey('stringValue')) {
      return value['stringValue'];
    }
    if (value.containsKey('integerValue')) {
      return int.tryParse(value['integerValue'].toString()) ?? 0;
    }
    if (value.containsKey('doubleValue')) {
      return (value['doubleValue'] as num).toDouble();
    }
    if (value.containsKey('booleanValue')) {
      return value['booleanValue'] as bool;
    }
    if (value.containsKey('nullValue')) {
      return null;
    }
    if (value.containsKey('arrayValue')) {
      final values = value['arrayValue']['values'] as List? ?? [];
      return values
          .map((v) => _firestoreValue(v as Map<String, dynamic>))
          .toList();
    }
    if (value.containsKey('mapValue')) {
      return _firestoreToMap(
          value['mapValue']['fields'] as Map<String, dynamic>? ?? {});
    }
    return null;
  }

  // ── Endpoints de leitura ───────────────────────────────────────────────────
  static Future<FetchResult> fetchTennisResults() =>
      _fetchFirestore('results', 'tennis');
  static Future<FetchResult> fetchNbaResults() =>
      _fetchFirestore('results', 'nba_h2h');
  static Future<FetchResult> fetchNbaProps() =>
      _fetchFirestore('results', 'nba_props');
  static Future<FetchResult> fetchNbaBrProps() =>
      _fetchFirestore('results', 'nba_props_br');
  static Future<FetchResult> fetchMlbResults() =>
      _fetchFirestore('results', 'mlb_h2h');
  static Future<FetchResult> fetchMlbProps() =>
      _fetchFirestore('results', 'mlb_props');

  // ── Apostas (Firestore) ────────────────────────────────────────────────────
  static Future<List<Map<String, dynamic>>> fetchBets() async {
    final url = '$_firestoreBase/bets';
    final res = await http.get(Uri.parse(url));
    if (res.statusCode != 200) {
      throw Exception('Erro ao buscar apostas');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final documents = body['documents'] as List? ?? [];
    return documents.map((doc) {
      final fields = doc['fields'] as Map<String, dynamic>? ?? {};
      return _firestoreToMap(fields);
    }).toList()
      ..sort((a, b) => (a['createdAt'] as String? ?? '')
          .compareTo(b['createdAt'] as String? ?? ''));
  }

  static Future<Map<String, dynamic>> createBet(
      Map<String, dynamic> data) async {
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final bet = {
      ...data,
      'id': id,
      'createdAt': DateTime.now().toIso8601String(),
      'status': 'pending',
      'realValue': null,
      'won': null,
      'profit': null,
    };
    final url = '$_firestoreBase/bets/$id';
    final res = await http.patch(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'fields': _mapToFirestore(bet)}),
    );
    if (res.statusCode != 200) {
      throw Exception('Erro ao registrar aposta');
    }
    return bet;
  }

  static Future<Map<String, dynamic>> updateBet(
      String id, Map<String, dynamic> data) async {
    final url = '$_firestoreBase/bets/$id';
    final getRes = await http.get(Uri.parse(url));
    if (getRes.statusCode != 200) {
      throw Exception('Aposta não encontrada');
    }
    final current = _firestoreToMap(
        (jsonDecode(getRes.body)['fields'] as Map<String, dynamic>? ?? {}));
    final updated = {...current, ...data, 'id': id};
    final patchRes = await http.patch(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'fields': _mapToFirestore(updated)}),
    );
    if (patchRes.statusCode != 200) {
      throw Exception('Erro ao editar aposta');
    }
    return updated;
  }

  static Future<Map<String, dynamic>> resolveBet(String id) async {
    final url = '$_firestoreBase/bets/$id';
    final getRes = await http.get(Uri.parse(url));
    if (getRes.statusCode != 200) {
      throw Exception('Aposta não encontrada');
    }
    final bet = _firestoreToMap(
        (jsonDecode(getRes.body)['fields'] as Map<String, dynamic>? ?? {}));
    final resolved = await _resolveViaEspn(bet);
    final updated = {
      ...bet,
      ...resolved,
      'id': id,
      'status': 'resolved',
      'resolvedAt': DateTime.now().toIso8601String(),
    };
    final patchRes = await http.patch(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'fields': _mapToFirestore(updated)}),
    );
    if (patchRes.statusCode != 200) {
      throw Exception('Erro ao salvar resolução');
    }
    return updated;
  }

  static Future<void> deleteBet(String id) async {
    await http.delete(Uri.parse('$_firestoreBase/bets/$id'));
  }

  // ── Resolução de apostas via ESPN ──────────────────────────────────────────
  static Future<Map<String, dynamic>> _resolveViaEspn(
      Map<String, dynamic> bet) async {
    final commenceTime = bet['commence_time'] as String?;
    if (commenceTime == null) {
      throw Exception('Data do jogo não disponível');
    }
    final dt = DateTime.parse(commenceTime).toUtc();
    final dateStr =
        '${dt.year}${dt.month.toString().padLeft(2, '0')}${dt.day.toString().padLeft(2, '0')}';
    const sport = 'basketball/nba';
    final sbUrl =
        'https://site.api.espn.com/apis/site/v2/sports/$sport/scoreboard?dates=$dateStr';
    final sbRes = await http.get(Uri.parse(sbUrl));
    if (sbRes.statusCode != 200) {
      throw Exception('Erro ao buscar scoreboard ESPN');
    }
    final sb = jsonDecode(sbRes.body) as Map<String, dynamic>;
    final events = sb['events'] as List? ?? [];
    final gameParts = (bet['game'] as String? ?? '').split(' x ');
    final t1 = gameParts.isNotEmpty ? gameParts[0].split(' ').last : '';
    final t2 = gameParts.length > 1 ? gameParts[1].split(' ').last : '';
    final event = events.firstWhere(
      (e) {
        final competitors =
            (e['competitions'] as List).first['competitors'] as List;
        final names =
            competitors.map((c) => c['team']['displayName'] as String).toList();
        return names.any((n) => n.contains(t1)) &&
            names.any((n) => n.contains(t2));
      },
      orElse: () => null,
    );
    if (event == null) {
      throw Exception('Jogo não encontrado no ESPN');
    }
    final comp = (event['competitions'] as List).first;
    if (!(comp['status']?['type']?['completed'] as bool? ?? false)) {
      throw Exception('Jogo ainda não encerrado');
    }
    if (bet['type'] == 'h2h') {
      final competitors = comp['competitors'] as List;
      final winner = competitors.firstWhere((c) => c['winner'] == true,
          orElse: () => null);
      if (winner == null) {
        throw Exception('Resultado indisponível');
      }
      final loser = competitors.firstWhere((c) => c['winner'] != true);
      final won = (winner['team']['displayName'] as String)
          .contains((bet['team'] as String? ?? '').split(' ').last);
      final profit = won
          ? double.parse((((bet['odds'] as num).toDouble() - 1) *
                  (bet['stake'] as num).toDouble())
              .toStringAsFixed(2))
          : -(bet['stake'] as num).toDouble();
      return {
        'realValue':
            '${winner['team']['displayName']} ${winner['score']}-${loser['score']}',
        'won': won,
        'profit': double.parse(profit.toStringAsFixed(2)),
      };
    }
    final sumUrl =
        'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event['id']}';
    final sumRes = await http.get(Uri.parse(sumUrl));
    if (sumRes.statusCode != 200) {
      throw Exception('Erro ao buscar box score ESPN');
    }
    final sum = jsonDecode(sumRes.body) as Map<String, dynamic>;
    const statMap = {
      'points': 'points',
      'rebounds': 'rebounds',
      'assists': 'assists',
      'steals': 'steals',
      'threes': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
    };
    final statKey =
        statMap[bet['prop'] as String? ?? ''] ?? (bet['prop'] as String? ?? '');
    final playerLastName =
        (bet['player'] as String? ?? '').split(' ').last.toLowerCase();
    double? realValue;
    final players = sum['boxscore']?['players'] as List? ?? [];
    for (final team in players) {
      for (final group in (team['statistics'] as List? ?? [])) {
        final keys = (group['keys'] as List?)?.cast<String>() ?? [];
        final colIdx = keys.indexOf(statKey);
        if (colIdx == -1) {
          continue;
        }
        for (final athlete in (group['athletes'] as List? ?? [])) {
          final name =
              (athlete['athlete']['displayName'] as String).toLowerCase();
          if (name.contains(playerLastName)) {
            final statStr =
                (athlete['stats'] as List)[colIdx] as String? ?? '0';
            realValue = double.tryParse(statStr.split('-').first) ?? 0;
          }
        }
      }
    }
    if (realValue == null) {
      throw Exception('Stat não encontrada no ESPN');
    }
    final side = bet['side'] as String? ?? 'Over';
    final line = (bet['line'] as num).toDouble();
    final odds = (bet['odds'] as num).toDouble();
    final stake = (bet['stake'] as num).toDouble();
    final won = side == 'Over' ? realValue > line : realValue < line;
    final profit = won
        ? double.parse(((odds - 1) * stake).toStringAsFixed(2))
        : double.parse((-stake).toStringAsFixed(2));
    return {'realValue': realValue, 'won': won, 'profit': profit};
  }

  // ── Histórico de odds ──────────────────────────────────────────────────────
  static Future<List<Map<String, dynamic>>> fetchNbaHistory(
      String date, String type) async {
    final month = date.substring(0, 7);
    final docId = type == 'props'
        ? 'basketball_nba_props_$month'
        : 'basketball_nba_h2h_$month';
    final url = '$_firestoreBase/odds_history/$docId';
    final res = await http.get(Uri.parse(url));
    if (res.statusCode != 200) {
      return [];
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final fields = body['fields'] as Map<String, dynamic>?;
    if (fields == null) {
      return [];
    }
    final dataField = fields['data'];
    if (dataField == null) {
      return [];
    }
    final values = dataField['arrayValue']?['values'] as List? ?? [];
    final all = values
        .map((item) => _firestoreToMap(
            item['mapValue']?['fields'] as Map<String, dynamic>? ?? {}))
        .toList();
    return all
        .where((r) => r['savedDate'] == date && r['bookmaker'] == 'pinnacle')
        .toList();
  }

  // ── Acionar workflow GitHub Actions ────────────────────────────────────────
  static Future<void> triggerUpdate(String sport) async {
    final token =
        const String.fromEnvironment('GITHUB_TOKEN', defaultValue: '');
    if (token.isEmpty) {
      throw Exception('Token GitHub não configurado');
    }
    final url =
        'https://api.github.com/repos/$_githubRepo/actions/workflows/update_model.yml/dispatches';
    final res = await http.post(
      Uri.parse(url),
      headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'ref': 'main',
        'inputs': {'sport': sport},
      }),
    );
    if (res.statusCode != 204) {
      throw Exception('Erro ao acionar workflow: ${res.statusCode}');
    }
  }

  // ── Verificar status do workflow ───────────────────────────────────────────
  static Future<String> getWorkflowStatus() async {
    final token =
        const String.fromEnvironment('GITHUB_TOKEN', defaultValue: '');
    if (token.isEmpty) {
      return 'unknown';
    }
    final url =
        'https://api.github.com/repos/$_githubRepo/actions/workflows/update_model.yml/runs?per_page=1';
    final res = await http.get(
      Uri.parse(url),
      headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/vnd.github+json',
      },
    );
    if (res.statusCode != 200) {
      return 'unknown';
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final runs = body['workflow_runs'] as List? ?? [];
    if (runs.isEmpty) {
      return 'unknown';
    }
    return runs.first['status'] as String? ?? 'unknown';
  }

  // ── Conversão Map → Firestore ──────────────────────────────────────────────
  static Map<String, dynamic> _mapToFirestore(Map<String, dynamic> map) {
    final result = <String, dynamic>{};
    for (final entry in map.entries) {
      result[entry.key] = _valueToFirestore(entry.value);
    }
    return result;
  }

  static Map<String, dynamic> _valueToFirestore(dynamic value) {
    if (value == null) {
      return {'nullValue': null};
    }
    if (value is bool) {
      return {'booleanValue': value};
    }
    if (value is int) {
      return {'integerValue': value.toString()};
    }
    if (value is double) {
      return {'doubleValue': value};
    }
    if (value is String) {
      return {'stringValue': value};
    }
    if (value is List) {
      return {
        'arrayValue': {
          'values': value.map(_valueToFirestore).toList(),
        }
      };
    }
    if (value is Map<String, dynamic>) {
      return {
        'mapValue': {
          'fields': _mapToFirestore(value),
        }
      };
    }
    return {'stringValue': value.toString()};
  }

  // ── Legado post() ──────────────────────────────────────────────────────────
  static Future<String> post(String path) async {
    const sportMap = {
      'tennis/update-ranking': 'tennis',
      'tennis/update-odds': 'tennis',
      'tennis/run-model': 'tennis',
      'nba/update-scores': 'nba',
      'nba/update-odds': 'nba',
      'nba/run-model': 'nba',
      'nba/update-props': 'nba',
      'nba/run-props-model': 'nba',
      'nba/update-props-br': 'nba_br',
      'nba/run-props-br-model': 'nba_br',
      'mlb/update-scores': 'mlb',
      'mlb/update-odds': 'mlb',
      'mlb/run-model': 'mlb',
      'mlb/update-props': 'mlb',
      'mlb/run-props-model': 'mlb',
    };
    final sport = sportMap[path] ?? 'all';
    await triggerUpdate(sport);
    return 'Workflow iniciado para $sport';
  }
}
