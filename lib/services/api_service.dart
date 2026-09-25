import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:firebase_auth/firebase_auth.dart';

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

class ModelReportResult {
  final List<Map<String, dynamic>> rows;
  final DateTime? generatedAt;
  const ModelReportResult({required this.rows, this.generatedAt});
}

class ApiService {
  // ── Token Firebase Auth ────────────────────────────────────────────────────
  static Future<String> _authToken() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw Exception('Usuário não autenticado');
    return await user.getIdToken() ?? '';
  }

  static String get _uid {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw Exception('Usuário não autenticado');
    return user.uid;
  }

  // ── Leitura do Firestore (pública — sem auth) ──────────────────────────────
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
        if (collection == 'results' && !_isDisplayableRecommendation(map)) {
          continue;
        }
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

  static bool _isDisplayableRecommendation(Map<String, dynamic> item) {
    final indicationId = item['indicationId'] as String?;
    if (indicationId == null || indicationId.trim().isEmpty) return false;

    final commenceRaw = item['commence_time'] ?? item['commenceTime'];
    if (commenceRaw is! String) return false;

    final commence = DateTime.tryParse(commenceRaw);
    if (commence == null) return false;

    return commence.toUtc().isAfter(DateTime.now().toUtc());
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
      final s = value['stringValue'] as String;
      final n = double.tryParse(s);
      if (n != null) return n;
      return s;
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
  static Future<FetchResult> fetchNhlProps() =>
      _fetchFirestore('results', 'nhl_props');
  static Future<FetchResult> fetchNflProps() =>
      _fetchFirestore('results', 'nfl_props');

  // ── Relatório de desempenho do modelo ──────────────────────────────────────
  // Documento 'summary' + continuação em 'summary_p1', 'summary_p2'... quando
  // o relatório não coube num documento só (mesmo padrão de odds_history).
  static Future<ModelReportResult> fetchModelReport() async {
    final token = await _authToken();
    final rows = <Map<String, dynamic>>[];
    DateTime? generatedAt;
    for (int i = -1; i < 20; i++) {
      final docId = i == -1 ? 'summary' : 'summary_p$i';
      final url = '$_firestoreBase/model_report/$docId';
      final res = await http.get(
        Uri.parse(url),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (res.statusCode != 200) {
        if (res.statusCode == 404 && i == -1) {
          // Nenhum relatório sincronizado ainda.
          return const ModelReportResult(rows: []);
        }
        if (res.statusCode == 404) break;
        throw Exception('Erro ao buscar relatório: ${res.statusCode}');
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final fields = body['fields'] as Map<String, dynamic>?;
      if (fields == null) break;

      if (i == -1) {
        final genStr = fields['generatedAt']?['stringValue'] as String?;
        if (genStr != null) generatedAt = DateTime.tryParse(genStr);
      }

      final dataField = fields['data'];
      final values = dataField?['arrayValue']?['values'] as List? ?? [];
      for (final item in values) {
        rows.add(_firestoreToMap(
            item['mapValue']?['fields'] as Map<String, dynamic>? ?? {}));
      }
    }
    return ModelReportResult(rows: rows, generatedAt: generatedAt);
  }

  static Future<FetchResult> _safeFetch(Future<FetchResult> f) async {
    try {
      return await f;
    } catch (_) {
      return const FetchResult(data: []);
    }
  }

  static Future<FetchResult> fetchAllProps() async {
    const sportLabels = ['NBA 🏀', 'MLB ⚾', 'NHL 🏒', 'NFL 🏈'];
    final results = await Future.wait([
      _safeFetch(fetchNbaBrProps()),
      _safeFetch(fetchMlbProps()),
      _safeFetch(fetchNhlProps()),
      _safeFetch(fetchNflProps()),
    ]);

    final allData = <Map<String, dynamic>>[];
    DateTime? lastUpdated;

    for (int i = 0; i < results.length; i++) {
      final r = results[i];
      for (final item in r.data) {
        allData.add({...item, 'sport': sportLabels[i]});
      }
      final lu = r.lastUpdated;
      if (lu != null) {
        if (lastUpdated == null || lu.isAfter(lastUpdated)) lastUpdated = lu;
      }
    }
    return FetchResult(data: allData, lastUpdated: lastUpdated);
  }

  // ── Apostas (Firestore autenticado) ───────────────────────────────────────
  static Future<List<Map<String, dynamic>>> fetchBets() async {
    final token = await _authToken();
    final allDocs = <dynamic>[];
    String? pageToken;
    do {
      final query =
          pageToken != null ? '?pageToken=${Uri.encodeComponent(pageToken)}' : '';
      final res = await http.get(
        Uri.parse('$_firestoreBase/bets$query'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (res.statusCode != 200) {
        throw Exception('Erro ao buscar apostas: ${res.statusCode}');
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      allDocs.addAll(body['documents'] as List? ?? []);
      pageToken = body['nextPageToken'] as String?;
    } while (pageToken != null);
    final bets = allDocs.map((doc) {
      final fields = doc['fields'] as Map<String, dynamic>? ?? {};
      final bet = _firestoreToMap(fields);
      if (bet['id'] == null || bet['id'] is! String) {
        final docName = doc['name'] as String;
        bet['id'] = docName.split('/').last;
      }
      return bet;
    }).toList();
    bets.sort((a, b) {
      final ca = (a['createdAt'] ?? '').toString();
      final cb = (b['createdAt'] ?? '').toString();
      return ca.compareTo(cb);
    });
    return bets;
  }

  static Future<Map<String, dynamic>> createBet(
      Map<String, dynamic> data) async {
    final token = await _authToken();
    final uid = _uid;
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final bet = {
      ...data,
      'id': id,
      'uid': uid,
      'createdAt': DateTime.now().toIso8601String(),
      'status': 'pending',
      'realValue': null,
      'won': null,
      'profit': null,
    };
    final url = '$_firestoreBase/bets/$id';
    final res = await http.patch(
      Uri.parse(url),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'fields': _mapToFirestore(bet)}),
    );
    if (res.statusCode != 200) {
      throw Exception('Erro ao registrar aposta');
    }
    return bet;
  }

  static Future<Map<String, dynamic>> updateBet(
      String id, Map<String, dynamic> data) async {
    final token = await _authToken();
    final url = '$_firestoreBase/bets/$id';
    final getRes = await http.get(
      Uri.parse(url),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (getRes.statusCode != 200) {
      throw Exception('Aposta não encontrada');
    }
    final current = _firestoreToMap(
        (jsonDecode(getRes.body)['fields'] as Map<String, dynamic>? ?? {}));
    final updated = {...current, ...data, 'id': id, 'uid': _uid};
    final patchRes = await http.patch(
      Uri.parse(url),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'fields': _mapToFirestore(updated)}),
    );
    if (patchRes.statusCode != 200) {
      throw Exception('Erro ao editar aposta');
    }
    return updated;
  }

  static Future<Map<String, dynamic>> resolveBet(String id) async {
    final token = await _authToken();
    final url = '$_firestoreBase/bets/$id';
    final getRes = await http.get(
      Uri.parse(url),
      headers: {'Authorization': 'Bearer $token'},
    );
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
      'uid': _uid,
      'status': 'resolved',
      'resolvedAt': DateTime.now().toIso8601String(),
    };
    final patchRes = await http.patch(
      Uri.parse(url),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'fields': _mapToFirestore(updated)}),
    );
    if (patchRes.statusCode != 200) {
      throw Exception('Erro ao salvar resolução');
    }
    return updated;
  }

  static Future<void> deleteBet(String id) async {
    final token = await _authToken();
    await http.delete(
      Uri.parse('$_firestoreBase/bets/$id'),
      headers: {'Authorization': 'Bearer $token'},
    );
  }

  // ── Resolução de apostas via ESPN ──────────────────────────────────────────

  // Detecta o caminho ESPN correto a partir do campo 'sport' salvo na aposta
  // ou, como fallback, pelo nome da prop.
  static String _espnSportPath(Map<String, dynamic> bet) {
    final sportLabel = (bet['sport'] as String? ?? '').toLowerCase();
    if (sportLabel.contains('nhl') || sportLabel.contains('hock')) return 'hockey/nhl';
    if (sportLabel.contains('mlb') || sportLabel.contains('base')) return 'baseball/mlb';
    if (sportLabel.contains('nba') || sportLabel.contains('basket')) return 'basketball/nba';
    final prop = bet['prop'] as String? ?? '';
    if (prop == 'hitsAllowed') return 'baseball/mlb';
    if (prop == 'shots' || prop == 'goals') return 'hockey/nhl';
    return 'basketball/nba';
  }

  static const _nbaStatKeys = <String, String>{
    'points': 'points',
    'rebounds': 'rebounds',
    'assists': 'assists',
    'steals': 'steals',
    'threes': 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
  };

  static const _nhlStatKeys = <String, String>{
    'shots': 'shots',
    'goals': 'goals',
    'assists': 'assists',
    'points': 'points',
  };

  static const _mlbStatKeys = <String, String>{
    'hitsAllowed': 'hits',
  };

  // Abreviações ESPN (campo 'labels') usadas como fallback quando 'keys' falha.
  static const _espnLabelFallback = <String, String>{
    'points': 'PTS',
    'rebounds': 'REB',
    'assists': 'AST',
    'steals': 'STL',
    'threes': '3PM',
    'shots': 'SOG',
    'goals': 'G',
    'hits': 'H',
    'hitsAllowed': 'H',
  };

  static Map<String, String> _statKeysForSport(String sportPath) {
    if (sportPath == 'hockey/nhl') return _nhlStatKeys;
    if (sportPath == 'baseball/mlb') return _mlbStatKeys;
    return _nbaStatKeys;
  }

  // Extrai o valor da stat de um boxscore ESPN.
  // Tenta primeiro o campo 'keys' (nomes completos), depois 'labels' (abreviações).
  static double? _extractStatFromBoxscore(
      Map<String, dynamic> sum,
      String prop,
      String statKey,
      String playerLastName,
      {bool pitchingOnly = false, String? extraLabel}) {
    final players = sum['boxscore']?['players'] as List? ?? [];
    for (final team in players) {
      for (final group in (team['statistics'] as List? ?? [])) {
        final keys = (group['keys'] as List?)?.cast<String>() ?? [];
        if (pitchingOnly) {
          final labels = (group['labels'] as List?)?.cast<String>() ?? [];
          final hasPitching = keys.contains('inningsPitched') ||
              keys.contains('ip') ||
              labels.contains('IP');
          if (!hasPitching) continue;
        }
        var colIdx = keys.indexOf(statKey);
        if (colIdx == -1) {
          final labels = (group['labels'] as List?)?.cast<String>() ?? [];
          final labelKey = _espnLabelFallback[prop] ?? '';
          if (labelKey.isNotEmpty) colIdx = labels.indexOf(labelKey);
          if (colIdx == -1 && extraLabel != null) colIdx = labels.indexOf(extraLabel);
          if (colIdx == -1) continue;
        }
        for (final athlete in (group['athletes'] as List? ?? [])) {
          final name =
              (athlete['athlete']['displayName'] as String).toLowerCase();
          if (name.contains(playerLastName)) {
            final statStr =
                (athlete['stats'] as List)[colIdx] as String? ?? '0';
            return double.tryParse(statStr.split('-').first) ?? 0;
          }
        }
      }
    }
    return null;
  }

  // Busca o evento ESPN para o jogo, tentando data principal, dia anterior
  // e, para NBA, o grupo de playoffs (groups=46).
  static Future<Map<String, dynamic>?> _findEspnEvent(
      String sport, String dateStr, String dateStrPrev, String t1, String t2) async {
    bool matches(dynamic e) {
      final competitors =
          (e['competitions'] as List).first['competitors'] as List;
      final names =
          competitors.map((c) => c['team']['displayName'] as String).toList();
      return names.any((n) => n.contains(t1)) &&
          names.any((n) => n.contains(t2));
    }

    Future<List> fetchEvents(String url) async {
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) return [];
      return (jsonDecode(res.body) as Map<String, dynamic>)['events'] as List? ?? [];
    }

    final base = 'https://site.api.espn.com/apis/site/v2/sports/$sport/scoreboard';
    for (final date in [dateStr, dateStrPrev]) {
      var events = await fetchEvents('$base?dates=$date');
      var ev = events.firstWhere(matches, orElse: () => null);
      if (ev != null) return ev as Map<String, dynamic>;
      // Fallback playoffs NBA
      if (sport == 'basketball/nba') {
        events = await fetchEvents('$base?dates=$date&groups=46');
        ev = events.firstWhere(matches, orElse: () => null);
        if (ev != null) return ev as Map<String, dynamic>;
      }
    }
    return null;
  }

  static Future<Map<String, dynamic>> _resolveViaEspn(
      Map<String, dynamic> bet) async {
    final commenceTime = bet['commence_time'] as String?;
    if (commenceTime == null) {
      throw Exception('Data do jogo não disponível');
    }
    final dt = DateTime.parse(commenceTime).toLocal();
    final dateStr =
        '${dt.year}${dt.month.toString().padLeft(2, '0')}${dt.day.toString().padLeft(2, '0')}';
    final dtPrev = dt.subtract(const Duration(days: 1));
    final dateStrPrev =
        '${dtPrev.year}${dtPrev.month.toString().padLeft(2, '0')}${dtPrev.day.toString().padLeft(2, '0')}';
    final sport = _espnSportPath(bet);
    final gameParts = (bet['game'] as String? ?? '').split(' x ');
    final t1 = gameParts.isNotEmpty ? gameParts[0].split(' ').last : '';
    final t2 = gameParts.length > 1 ? gameParts[1].split(' ').last : '';
    final event = await _findEspnEvent(sport, dateStr, dateStrPrev, t1, t2);
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
      final teamStr = (bet['team'] as String? ?? '').trim();
      if (teamStr.isEmpty) {
        throw Exception(
            'Time não informado nesta aposta. Edite a aposta e informe o time para poder resolver.');
      }
      final won = (winner['team']['displayName'] as String)
          .contains(teamStr.split(' ').last);
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
        'https://site.api.espn.com/apis/site/v2/sports/$sport/summary?event=${event['id']}';
    final sumRes = await http.get(Uri.parse(sumUrl));
    if (sumRes.statusCode != 200) {
      throw Exception('Erro ao buscar box score ESPN');
    }
    final sum = jsonDecode(sumRes.body) as Map<String, dynamic>;
    final prop = bet['prop'] as String? ?? '';
    final isMlb = sport == 'baseball/mlb';
    final statMap = _statKeysForSport(sport);
    final statKey = statMap[prop] ?? prop;
    final playerLastName =
        (bet['player'] as String? ?? '').split(' ').last.toLowerCase();
    double? realValue = _extractStatFromBoxscore(
        sum, prop, statKey, playerLastName, pitchingOnly: isMlb);
    // ESPN NHL não tem coluna direta de points — calcula como goals + assists
    if (realValue == null && sport == 'hockey/nhl' && prop == 'points') {
      final g = _extractStatFromBoxscore(sum, 'goals', 'goals', playerLastName, extraLabel: 'G');
      final a = _extractStatFromBoxscore(sum, 'assists', 'assists', playerLastName, extraLabel: 'A');
      if (g != null || a != null) realValue = (g ?? 0) + (a ?? 0);
    }
    // Jogador DNP (lesão/ausência) — Pinnacle anula a aposta
    if (realValue == null) {
      return {'realValue': 0, 'won': false, 'profit': 0.0, 'voided': true};
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
    final baseId = type == 'props'
        ? 'basketball_nba_props_$month'
        : 'basketball_nba_h2h_$month';

    final all = <Map<String, dynamic>>[];

    for (int i = -1; i < 50; i++) {
      final docId = i == -1 ? baseId : '${baseId}_p$i';
      final url = '$_firestoreBase/odds_history/$docId';
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) {
        if (i == -1) continue;
        break;
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final fields = body['fields'] as Map<String, dynamic>?;
      if (fields == null) break;
      final dataField = fields['data'];
      if (dataField == null) break;
      final values = dataField['arrayValue']?['values'] as List? ?? [];
      for (final item in values) {
        all.add(_firestoreToMap(
            item['mapValue']?['fields'] as Map<String, dynamic>? ?? {}));
      }
    }

    return all.where((r) => r['savedDate'] == date).toList();
  }

  static Future<Map<String, dynamic>> fetchLiveStatAndTime(
      Map<String, dynamic> bet) async {
    final commenceTime = bet['commence_time'] as String?;
    if (commenceTime == null) throw Exception('Data do jogo não disponível');
    final dtLocal = DateTime.parse(commenceTime).toLocal();
    final dateStr =
        '${dtLocal.year}${dtLocal.month.toString().padLeft(2, '0')}${dtLocal.day.toString().padLeft(2, '0')}';
    final dtPrev2 = dtLocal.subtract(const Duration(days: 1));
    final dateStrPrev2 =
        '${dtPrev2.year}${dtPrev2.month.toString().padLeft(2, '0')}${dtPrev2.day.toString().padLeft(2, '0')}';
    final sport = _espnSportPath(bet);
    final gameParts = (bet['game'] as String? ?? '').split(' x ');
    final t1 = gameParts.isNotEmpty ? gameParts[0].split(' ').last : '';
    final t2 = gameParts.length > 1 ? gameParts[1].split(' ').last : '';
    final event = await _findEspnEvent(sport, dateStr, dateStrPrev2, t1, t2);
    if (event == null) throw Exception('Jogo não encontrado no ESPN');
    final comp = (event['competitions'] as List).first;
    final statusType = comp['status']?['type'] as Map<String, dynamic>?;
    final completed = statusType?['completed'] as bool? ?? false;
    final state = statusType?['state'] as String? ?? 'pre';
    final clock = comp['status']?['displayClock'] as String? ?? '';
    final period = comp['status']?['period'] as int? ?? 0;
    final isNhl = sport == 'hockey/nhl';
    final isMlb = sport == 'baseball/mlb';
    String timeInfo;
    if (completed) {
      timeInfo = 'Encerrado';
    } else if (state == 'in') {
      if (isMlb) {
        timeInfo = 'Entrada ${period > 0 ? period : "?"}';
      } else if (isNhl) {
        final periodLabel = period <= 3
            ? 'P$period'
            : (period == 4 ? 'Prorrogação' : 'Shootout');
        final clockParts = clock.split(':');
        final clockSecs = clockParts.length == 2
            ? (int.tryParse(clockParts[0]) ?? 0) * 60 +
                (int.tryParse(clockParts[1]) ?? 0)
            : 0;
        final periodsLeft = period < 3 ? 3 - period : 0;
        final totalSecsLeft = periodsLeft * 20 * 60 + clockSecs;
        final totalMins = totalSecsLeft ~/ 60;
        final totalSecs = totalSecsLeft % 60;
        final totalStr =
            '${totalMins.toString().padLeft(2, '0')}:${totalSecs.toString().padLeft(2, '0')}';
        timeInfo = period <= 3
            ? '$periodLabel — $clock restantes\n$totalStr restantes para o fim do tempo'
            : '$periodLabel — $clock restantes';
      } else {
        final clockParts = clock.split(':');
        final clockSecs = clockParts.length == 2
            ? (int.tryParse(clockParts[0]) ?? 0) * 60 +
                (int.tryParse(clockParts[1]) ?? 0)
            : 0;
        final quartersLeft = 4 - period;
        final totalSecsLeft = quartersLeft * 12 * 60 + clockSecs;
        final totalMins = totalSecsLeft ~/ 60;
        final totalSecs = totalSecsLeft % 60;
        final totalStr =
            '${totalMins.toString().padLeft(2, '0')}:${totalSecs.toString().padLeft(2, '0')}';
        timeInfo =
            'Q$period — $clock restantes\n$totalStr restantes para o final da partida';
      }
    } else {
      timeInfo = 'Não iniciado';
    }
    if (state != 'in' && !completed) {
      return {
        'state': state,
        'timeInfo': timeInfo,
        'realValue': null,
        'completed': false
      };
    }
    final sumRes = await http.get(Uri.parse(
        'https://site.api.espn.com/apis/site/v2/sports/$sport/summary?event=${event['id']}'));
    if (sumRes.statusCode != 200) {
      throw Exception('Erro ao buscar box score ESPN');
    }
    final sum = jsonDecode(sumRes.body) as Map<String, dynamic>;
    final prop = bet['prop'] as String? ?? '';
    final statMap = _statKeysForSport(sport);
    final statKey = statMap[prop] ?? prop;
    final playerLastName =
        (bet['player'] as String? ?? '').split(' ').last.toLowerCase();
    double? realValue;
    int minutesPlayed = 0;
    for (final team in (sum['boxscore']?['players'] as List? ?? [])) {
      for (final grp in (team['statistics'] as List? ?? [])) {
        final keys = (grp['keys'] as List?)?.cast<String>() ?? [];
        if (isMlb) {
          final labels = (grp['labels'] as List?)?.cast<String>() ?? [];
          final hasPitching = keys.contains('inningsPitched') ||
              keys.contains('ip') ||
              labels.contains('IP');
          if (!hasPitching) continue;
        }
        var colIdx = keys.indexOf(statKey);
        if (colIdx == -1) {
          final labels = (grp['labels'] as List?)?.cast<String>() ?? [];
          final labelKey = _espnLabelFallback[prop] ?? '';
          if (labelKey.isNotEmpty) colIdx = labels.indexOf(labelKey);
          if (colIdx == -1 && isNhl && prop == 'assists') colIdx = labels.indexOf('A');
          if (colIdx == -1) continue;
        }
        for (final athlete in (grp['athletes'] as List? ?? [])) {
          final name =
              (athlete['athlete']['displayName'] as String).toLowerCase();
          if (name.contains(playerLastName)) {
            final statStr =
                (athlete['stats'] as List)[colIdx] as String? ?? '0';
            realValue = double.tryParse(statStr.split('-').first) ?? 0;
            final minKey = isNhl ? 'timeOnIce' : 'minutes';
            final minIdx = keys.indexOf(minKey);
            if (minIdx != -1) {
              minutesPlayed = int.tryParse(
                      ((athlete['stats'] as List)[minIdx] as String? ?? '0')
                          .split(':')
                          .first) ??
                  0;
            }
          }
        }
      }
    }
    // ESPN NHL não tem coluna direta de points — calcula como goals + assists
    if (realValue == null && isNhl && prop == 'points') {
      final boxsum = {'boxscore': sum['boxscore']};
      final g = _extractStatFromBoxscore(boxsum, 'goals', 'goals', playerLastName, extraLabel: 'G');
      final a = _extractStatFromBoxscore(boxsum, 'assists', 'assists', playerLastName, extraLabel: 'A');
      if (g != null || a != null) realValue = (g ?? 0) + (a ?? 0);
    }
    return {
      'state': state,
      'timeInfo': timeInfo,
      'realValue': realValue,
      'completed': completed,
      'minutesPlayed': minutesPlayed,
    };
  }

  // ── Migração: adiciona uid a apostas antigas ──────────────────────────────
  static Future<int> migrateOldBets() async {
    final token = await _authToken();
    final uid = _uid;
    final res = await http.get(
      Uri.parse('$_firestoreBase/bets'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (res.statusCode != 200) {
      throw Exception('Erro na migração: ${res.statusCode}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final documents = body['documents'] as List? ?? [];
    int count = 0;
    for (final doc in documents) {
      final fields = doc['fields'] as Map<String, dynamic>? ?? {};
      if (!fields.containsKey('uid')) {
        final betId = (doc['name'] as String).split('/').last;
        await http.patch(
          Uri.parse('$_firestoreBase/bets/$betId'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({
            'fields': {...fields, 'uid': {'stringValue': uid}},
          }),
        );
        count++;
      }
    }
    return count;
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
      'nhl/update-props': 'nhl',
      'nfl/update-props': 'nfl',
    };
    final sport = sportMap[path] ?? 'all';
    await triggerUpdate(sport);
    return 'Workflow iniciado para $sport';
  }
}
