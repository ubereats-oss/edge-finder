import 'dart:convert';
import 'package:http/http.dart' as http;

class EdgeEvaluatorService {
  // ── Algoritmo Local ───────────────────────────────────────────────────────

  // Normaliza para 0-1 independente de escala de entrada (0-1 ou 0-100)
  static double _toProb(num? v, double fallback) {
    if (v == null) return fallback;
    final d = v.toDouble();
    return d > 1 ? d / 100 : d;
  }

  static double calibratedProb(Map<String, dynamic> p) {
    final model = _toProb(p['modelProb'], 0.50);
    final market = _toProb(p['impliedProb'], 0.50);
    final side = p['side'] as String? ?? 'Over';
    final line = (p['line'] as num?)?.toDouble() ?? 0;
    final avg5 = (p['playerAvg5'] as num?)?.toDouble();
    final avg10 = (p['playerAvg10'] as num?)?.toDouble();

    double confidence = 0.5;
    if (p['inefficientMarket'] == true) confidence += 0.1;
    if (p['lowSample'] == true) confidence -= 0.2;
    if (avg5 != null && avg10 != null) {
      if (side == 'Over') {
        if (avg5 > line && avg10 > line) confidence += 0.1;
        if (avg5 < line && avg10 < line) confidence -= 0.1;
      } else {
        if (avg5 < line && avg10 < line) confidence += 0.1;
        if (avg5 > line && avg10 > line) confidence -= 0.1;
      }
    }
    confidence = confidence.clamp(0.2, 0.7);
    return market + confidence * (model - market);
  }

  static const int _minBets = 15;
  static const int _maxBets = 20;

  static double _kelly(Map<String, dynamic> p) {
    final stored = (p['kelly'] as num?)?.toDouble();
    if (stored != null) return stored;
    final prob = (p['_probCalibrada'] as double?) ?? calibratedProb(p);
    final odds = (p['odds'] as num?)?.toDouble() ?? 2.0;
    if (odds <= 1) return 0;
    return ((prob * odds - 1) / (odds - 1) * 100).clamp(0.0, 100.0);
  }

  static double _stdOutlierZ(Map<String, dynamic> p) {
    final avg5 = (p['playerAvg5'] as num?)?.toDouble();
    final avg = (p['playerAvg'] as num?)?.toDouble();
    final std = (p['playerStd'] as num?)?.toDouble();

    if (avg5 == null || avg == null || std == null || std <= 0) return 0;

    return ((avg5 - avg).abs() / std);
  }

  static bool _isStdOutlierAgainstBet(Map<String, dynamic> p) {
    final side = p['side'] as String? ?? 'Over';
    final avg5 = (p['playerAvg5'] as num?)?.toDouble();
    final avg = (p['playerAvg'] as num?)?.toDouble();
    final std = (p['playerStd'] as num?)?.toDouble();

    if (avg5 == null || avg == null || std == null || std <= 0) return false;

    final z = _stdOutlierZ(p);
    if (z < 1.25) return false;

    if (side == 'Over') return avg5 < avg - std;
    return avg5 > avg + std;
  }

  static int _contradictionLevel(Map<String, dynamic> p) {
    final side = p['side'] as String? ?? 'Over';
    final line = (p['line'] as num?)?.toDouble() ?? 0;
    final avg5 = (p['playerAvg5'] as num?)?.toDouble();

    if (avg5 == null || line <= 0) return 0;

    if (_isStdOutlierAgainstBet(p)) return 2;

    if (side == 'Under') {
      if (avg5 > line * 1.15) return 2;
      if (avg5 > line) return 1;
      return 0;
    }

    if (avg5 < line * 0.85) return 2;
    if (avg5 < line) return 1;
    return 0;
  }

  static int lastQualifiedCount = 0;

  // Floors absolutos — nunca relaxados (odds, kelly, edge mínimo absoluto, cs)
  static bool _absoluteFloors(Map<String, dynamic> p) {
    final odds = (p['odds'] as num?)?.toDouble() ?? 0;
    if (odds < 1.45 || odds > 2.40) return false;
    if (_kelly(p) < 2.0) return false;
    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    if (edge < 2.5) return false;
    final cs = (p['_contextScore'] as int?) ?? 0;
    if (cs <= -2) return false;
    return true;
  }

  // minEdgePct em percentual (ex: 3.0 = 3%)
  static bool _baseFloors(
      Map<String, dynamic> p, double minProb, double minEdgePct) {
    if (!_absoluteFloors(p)) return false;
    final prob = (p['_probCalibrada'] as double?) ?? calibratedProb(p);
    if (prob < minProb) return false;
    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    if (edge < minEdgePct) return false;
    return true;
  }

  static bool _passesContradiction(Map<String, dynamic> p) {
    final cl = (p['_contradictionLevel'] as int?) ?? _contradictionLevel(p);
    if (cl == 0) return true;

    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    if (cl == 1) return edge >= 8 && _kelly(p) >= 4;

    final confirmed = (p['_contextConfirmed'] as bool?) ?? false;
    final status = p['_contextStatus'] as String? ?? 'unknown';

    if (_isStdOutlierAgainstBet(p) && !confirmed) return false;

    return (edge >= 25 && _kelly(p) >= 8) ||
        (confirmed && status == 'positive');
  }

  static List<Map<String, dynamic>> adaptiveFilter(
      List<Map<String, dynamic>> props) {
    bool full(Map<String, dynamic> p) =>
        _baseFloors(p, 0.55, 3.0) && _passesContradiction(p);

    // Relaxado: prob 0.52, edge 2.5 — contradição mantida igual
    bool relaxed(Map<String, dynamic> p) {
      if (!_absoluteFloors(p)) return false;
      if (!_passesContradiction(p)) return false;
      final prob = (p['_probCalibrada'] as double?) ?? calibratedProb(p);
      if (prob < 0.52) return false;
      return true;
    }

    var result = props.where(full).toList();
    if (result.length < _minBets) result = props.where(relaxed).toList();
    lastQualifiedCount = result.length;
    return result;
  }

  static double _computeScoreFinal(Map<String, dynamic> p) {
    final prob = (p['_probCalibrada'] as double?) ?? calibratedProb(p);
    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    final cl = (p['_contradictionLevel'] as int?) ?? 0;
    final status = p['_contextStatus'] as String? ?? 'unknown';
    final confirmed = (p['_contextConfirmed'] as bool?) ?? false;
    final lowSample = p['lowSample'] == true;
    final side = p['side'] as String? ?? 'Over';
    final line = (p['line'] as num?)?.toDouble() ?? 0;
    final avg5 = (p['playerAvg5'] as num?)?.toDouble();
    final avg10 = (p['playerAvg10'] as num?)?.toDouble();

    final stdOutlierAgainstBet = _isStdOutlierAgainstBet(p);

    final double consistencyScore;
    if (cl == 2) {
      consistencyScore = stdOutlierAgainstBet ? 0.0 : 0.1;
    } else if (cl == 1) {
      consistencyScore = 0.3;
    } else {
      final f5 = avg5 != null &&
          line > 0 &&
          ((side == 'Over' && avg5 >= line) ||
              (side == 'Under' && avg5 <= line));
      final f10 = avg10 != null &&
          line > 0 &&
          ((side == 'Over' && avg10 >= line) ||
              (side == 'Under' && avg10 <= line));

      if (avg5 != null && avg10 != null) {
        consistencyScore = f5 && f10
            ? 1.0
            : f10
                ? 0.7
                : 0.5;
      } else {
        consistencyScore = avg5 != null ? (f5 ? 0.8 : 0.3) : 0.5;
      }
    }

    double probAdj = prob;

    if (stdOutlierAgainstBet && !confirmed) {
      probAdj = probAdj * 0.75;
    }

    double s =
        50 * probAdj + 30 * (edge / 30).clamp(0.0, 1.0) + 20 * consistencyScore;

    if (status == 'positive') s += 10;
    if (status == 'negative') s -= 20;
    if (cl == 2 && !confirmed) s -= 25;
    if (lowSample) s -= 10;

    return s.clamp(0.0, 100.0);
  }

  static List<Map<String, dynamic>> rankLocal(
      List<Map<String, dynamic>> props) {
    final filtered = adaptiveFilter(props);
    final scored = filtered.map((p) {
      final sf = _computeScoreFinal(p);
      final prob = (p['_probCalibrada'] as double?) ?? calibratedProb(p);
      final edge = (p['edge'] as num?)?.toDouble() ?? 0;
      final ev = edge * prob;
      return {...p, '_scoreFinal': sf, '_localScore': sf, '_evScore': ev};
    }).toList();

    scored.sort((a, b) {
      final aNeg = (a['_contextStatus'] as String?) == 'negative' ? 1 : 0;
      final bNeg = (b['_contextStatus'] as String?) == 'negative' ? 1 : 0;
      if (aNeg != bNeg) return aNeg.compareTo(bNeg);

      final sCmp =
          (b['_scoreFinal'] as double).compareTo(a['_scoreFinal'] as double);
      if (sCmp != 0) return sCmp;

      final evCmp =
          (b['_evScore'] as double).compareTo(a['_evScore'] as double);
      if (evCmp != 0) return evCmp;

      return _kelly(b).compareTo(_kelly(a));
    });

    // Validação final + cap
    final valid = scored.where((p) {
      final edge = (p['edge'] as num?)?.toDouble() ?? 0;
      if (edge < 2.5 || _kelly(p) < 2.0) return false;
      final odds = (p['odds'] as num?)?.toDouble() ?? 0;
      if (odds < 1.45 || odds > 2.40) return false;
      final cl = (p['_contradictionLevel'] as int?) ?? 0;
      if (cl == 2 && edge < 20) return false;
      return true;
    }).toList();

    lastQualifiedCount = valid.length;
    return valid.take(_maxBets).toList();
  }

  // Alias mantido para compatibilidade interna
  static double _computeLocalScore(Map<String, dynamic> p) =>
      _computeScoreFinal(p);

  static String generateLocalJustification(Map<String, dynamic> p) {
    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    final modelProb = (p['modelProb'] as num?)?.toDouble() ?? 50;
    final impliedProb = (p['impliedProb'] as num?)?.toDouble() ?? 50;
    final kelly = (p['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample = p['lowSample'] == true;
    final inefficientMarket = p['inefficientMarket'] == true;
    final playerAvg = (p['playerAvg'] as num?)?.toDouble();
    final playerAvg5 = (p['playerAvg5'] as num?)?.toDouble();
    final playerAvg10 = (p['playerAvg10'] as num?)?.toDouble();
    final playerStd = (p['playerStd'] as num?)?.toDouble();
    final line = (p['line'] as num?)?.toDouble() ?? 0;
    final side = p['side'] as String? ?? 'Over';

    final parts = <String>[];

    // 1. Qualidade do edge
    final gap = modelProb - impliedProb;
    if (edge >= 15) {
      parts.add('Edge excepcional de ${edge.toStringAsFixed(1)}% '
          '(modelo ${modelProb.toStringAsFixed(1)}% vs mercado ${impliedProb.toStringAsFixed(1)}%)');
    } else if (edge >= 8) {
      parts.add('Edge alto de ${edge.toStringAsFixed(1)}% '
          '(vantagem de ${gap.toStringAsFixed(1)}pp sobre o mercado)');
    } else if (edge >= 4) {
      parts.add('Edge razoável de ${edge.toStringAsFixed(1)}% '
          '(modelo ${modelProb.toStringAsFixed(1)}% vs ${impliedProb.toStringAsFixed(1)}% do mercado)');
    } else {
      parts.add('Edge baixo de ${edge.toStringAsFixed(1)}% — risco elevado');
    }

    // 2. Forma recente vs linha
    if (playerAvg5 != null && line > 0) {
      final diff5 = playerAvg5 - line;
      final pct5 = (diff5.abs() / line * 100);
      final favors5 =
          (side == 'Over' && diff5 > 0) || (side == 'Under' && diff5 < 0);
      if (favors5) {
        parts.add('Méd. últimos 5 jogos (${playerAvg5.toStringAsFixed(1)}) '
            '${side == 'Over' ? 'acima' : 'abaixo'} da linha '
            '${line.toStringAsFixed(1)} em ${pct5.toStringAsFixed(0)}%');
      } else {
        parts.add('ATENÇÃO: méd. 5j (${playerAvg5.toStringAsFixed(1)}) '
            '${side == 'Over' ? 'abaixo' : 'acima'} da linha '
            '${line.toStringAsFixed(1)} em ${pct5.toStringAsFixed(0)}%');
      }
    }

    // 3. Tendência (avg5 vs avg10)
    if (playerAvg5 != null && playerAvg10 != null && playerAvg10 > 0) {
      final trendPct = (playerAvg5 - playerAvg10) / playerAvg10 * 100;
      if (trendPct >= 10) {
        parts.add('Jogador em alta: méd. últimos 5j '
            '(${playerAvg5.toStringAsFixed(1)}) é '
            '${trendPct.toStringAsFixed(0)}% acima da méd. 10j '
            '(${playerAvg10.toStringAsFixed(1)})');
      } else if (trendPct <= -10) {
        parts.add('Jogador em queda: méd. últimos 5j '
            '(${playerAvg5.toStringAsFixed(1)}) é '
            '${trendPct.abs().toStringAsFixed(0)}% abaixo da méd. 10j '
            '(${playerAvg10.toStringAsFixed(1)})');
      } else {
        parts.add('Forma estável: méd. 5j (${playerAvg5.toStringAsFixed(1)}) '
            'alinhada com méd. 10j (${playerAvg10.toStringAsFixed(1)})');
      }
    }

    // 4. Média geral vs linha
    if (playerAvg != null && line > 0) {
      final diffAvg = playerAvg - line;
      final pctAvg = (diffAvg.abs() / line * 100);
      final favorsAvg =
          (side == 'Over' && diffAvg > 0) || (side == 'Under' && diffAvg < 0);
      if (pctAvg >= 15) {
        parts.add('Média histórica (${playerAvg.toStringAsFixed(1)}) '
            '${favorsAvg ? 'consistentemente favorável' : 'contra a aposta'} '
            '— linha ${pctAvg.toStringAsFixed(0)}% '
            '${favorsAvg ? 'abaixo' : 'acima'} da média');
      }
    }

    // 5. Consistência
    if (playerStd != null && playerAvg != null && playerAvg > 0) {
      final cv = playerStd / playerAvg;
      if (cv < 0.2) {
        parts.add('Jogador muito consistente '
            '(desvio padrão baixo: ${playerStd.toStringAsFixed(1)})');
      } else if (cv > 0.45) {
        parts.add('Jogador volátil — alto desvio padrão '
            '(${playerStd.toStringAsFixed(1)}), resultados imprevisíveis');
      }
    }

    // 6. Kelly e mercado
    if (inefficientMarket) {
      parts.add('Mercado ineficiente detectado — oportunidade de valor real');
    }
    if (kelly >= 8) {
      parts.add(
          'Kelly Criterion recomenda aposta de ${kelly.toStringAsFixed(1)}% '
          'da banca — sinal forte');
    } else if (kelly >= 3) {
      parts.add('Kelly sugere ${kelly.toStringAsFixed(1)}% da banca');
    }
    if (lowSample) {
      parts.add('Amostra reduzida de jogos — validar com contexto recente');
    }

    return parts.join('\n');
  }

  // ── Context (ESPN Injuries) ──────────────────────────────────────────────

  // Cache por sport: Map<playerNameLower, {status, detail, team}>
  static final Map<String, Map<String, Map<String, String>>> _injuryCache = {};
  static final Map<String, DateTime> _injuryCacheTime = {};
  static const _cacheTtl = Duration(minutes: 30);

  static String _injurySportPath(String sport) {
    final s = sport.toLowerCase();
    if (s.contains('mlb') || s.contains('beisebol')) return 'baseball/mlb';
    if (s.contains('nhl') || s.contains('hockey')) return 'hockey/nhl';
    if (s.contains('nfl') || s.contains('americano')) return 'football/nfl';
    return 'basketball/nba';
  }

  static Future<Map<String, Map<String, String>>> _fetchInjuries(
      String sport) async {
    final now = DateTime.now();
    if (_injuryCache.containsKey(sport) &&
        now.difference(_injuryCacheTime[sport]!) < _cacheTtl) {
      return _injuryCache[sport]!;
    }
    final path = _injurySportPath(sport);
    try {
      final res = await http
          .get(Uri.parse(
              'https://site.api.espn.com/apis/site/v2/sports/$path/injuries'))
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return {};
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final teams = body['teams'] as List? ?? [];
      final result = <String, Map<String, String>>{};
      for (final t in teams) {
        final teamName =
            (t['team']?['displayName'] as String? ?? '').toLowerCase();
        final injuries = t['injuries'] as List? ?? [];
        for (final inj in injuries) {
          final name =
              (inj['athlete']?['displayName'] as String? ?? '').toLowerCase();
          if (name.isEmpty) continue;
          final status = inj['status'] as String? ??
              inj['type']?['abbreviation'] as String? ??
              '';
          final detail = inj['details']?['type'] as String? ?? '';
          result[name] = {'status': status, 'detail': detail, 'team': teamName};
        }
      }
      _injuryCache[sport] = result;
      _injuryCacheTime[sport] = now;
      return result;
    } catch (_) {
      return {};
    }
  }

  static int _injuryStatusScore(String status) {
    final s = status.toUpperCase();
    if (s == 'OUT' || s == 'O') return -3;
    if (s == 'DOUBTFUL' || s == 'D') return -2;
    if (s == 'QUESTIONABLE' || s == 'Q' || s == 'DTD') return -1;
    if (s == 'PROBABLE' || s == 'P') return 0;
    return 0;
  }

  /// Enriquece cada prop com _contextScore, _contextLabel, _contextReason.
  /// Se a API falhar, todas as props ficam com contextScore=0 (neutro).
  static Future<List<Map<String, dynamic>>> enrichWithContext(
      List<Map<String, dynamic>> props, String sport) async {
    final injuries = await _fetchInjuries(sport);
    if (injuries.isEmpty) {
      return props.map((p) {
        final cl = _contradictionLevel(p);
        final prob = calibratedProb(p);
        return {
          ...p,
          '_contextScore': 0,
          '_contextLabel': '0',
          '_contextReason': 'sem dados externos disponíveis',
          '_probFinal': prob,
          '_probCalibrada': prob,
          '_contextStatus': 'unknown',
          '_contextConfirmed': false,
          '_contradictionLevel': cl,
        };
      }).toList();
    }

    // Mapa time → contagem de OUT/DOUBTFUL (score <= -2)
    final teamSevere = <String, int>{};
    for (final e in injuries.entries) {
      final score = _injuryStatusScore(e.value['status'] ?? '');
      if (score <= -2) {
        final team = e.value['team'] ?? '';
        teamSevere[team] = (teamSevere[team] ?? 0) + 1;
      }
    }

    return props.map((p) {
      final playerKey = (p['player'] as String? ?? '').toLowerCase();
      final playerTeam = (p['playerTeam'] as String? ?? '').toLowerCase();
      final injury = injuries[playerKey];

      int contextScore;
      String reason;

      if (injury != null) {
        contextScore = _injuryStatusScore(injury['status'] ?? '');
        final detail = injury['detail'] ?? '';
        if (contextScore <= -3) {
          reason =
              'Jogador confirmado fora${detail.isNotEmpty ? " ($detail)" : ""}';
        } else if (contextScore == -2) {
          reason = 'Jogador duvidoso${detail.isNotEmpty ? " ($detail)" : ""}';
        } else if (contextScore == -1) {
          reason =
              'Jogador questionável${detail.isNotEmpty ? " ($detail)" : ""}';
        } else {
          reason = 'Jogador provável';
        }
      } else {
        final severeCount = teamSevere[playerTeam] ?? 0;
        if (severeCount >= 3) {
          contextScore = 3;
          reason = '$severeCount ausências no time — aumento forte de minutos';
        } else if (severeCount >= 2) {
          contextScore = 2;
          reason = '$severeCount jogadores ausentes — aumento de uso esperado';
        } else if (severeCount == 1) {
          contextScore = 1;
          reason = 'Titular do time ausente — possível aumento de uso';
        } else {
          contextScore = 0;
          reason = 'Sem lesões relevantes no time';
        }
      }

      final probCal = calibratedProb(p);
      final probFinal = (probCal + contextScore * 0.04).clamp(0.0, 1.0);
      final scoreStr = contextScore > 0 ? '+$contextScore' : '$contextScore';
      final contextConfirmed =
          injury != null || (teamSevere[playerTeam] ?? 0) > 0;
      final contextStatus = contextScore >= 1
          ? 'positive'
          : contextScore <= -1
              ? 'negative'
              : contextConfirmed
                  ? 'neutral'
                  : 'unknown';
      if (!contextConfirmed) reason = 'sem contexto externo confirmado';

      final cl = _contradictionLevel(p);

      return {
        ...p,
        '_contextScore': contextScore,
        '_contextLabel': scoreStr,
        '_contextReason': reason,
        '_probFinal': probFinal,
        '_probCalibrada': probCal,
        '_contextStatus': contextStatus,
        '_contextConfirmed': contextConfirmed,
        '_contradictionLevel': cl,
      };
    }).toList();
  }

  /// Versão multi-esporte para o Mix screen.
  static Future<List<Map<String, dynamic>>> enrichAllWithContext(
      List<Map<String, dynamic>> props) async {
    final bySport = <String, List<Map<String, dynamic>>>{};
    for (final p in props) {
      final sport = p['sport'] as String? ?? 'nba';
      bySport.putIfAbsent(sport, () => []).add(p);
    }
    final results = await Future.wait(
      bySport.entries.map((e) => enrichWithContext(e.value, e.key)),
    );
    return results.expand((l) => l).toList();
  }

  // ── ESPN News ────────────────────────────────────────────────────────────

  static Future<String> _fetchEspnNews(String sport) async {
    final sl = sport.toLowerCase();
    final String sportPath;
    if (sl.contains('beisebol') || sl.contains('mlb')) {
      sportPath = 'baseball/mlb';
    } else if (sl.contains('nhl') || sl.contains('hockey')) {
      sportPath = 'hockey/nhl';
    } else if (sl.contains('nfl') || sl.contains('americano')) {
      sportPath = 'football/nfl';
    } else if (sl.contains('tênis') || sl.contains('tennis')) {
      sportPath = 'tennis/atp';
    } else {
      sportPath = 'basketball/nba';
    }
    try {
      final url =
          'https://site.api.espn.com/apis/site/v2/sports/$sportPath/news?limit=30';
      final res =
          await http.get(Uri.parse(url)).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return '';
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final articles = body['articles'] as List? ?? [];
      final headlines = articles
          .take(25)
          .map((a) {
            final headline = a['headline'] as String? ?? '';
            final desc = a['description'] as String? ?? '';
            return desc.isNotEmpty ? '$headline — $desc' : headline;
          })
          .where((h) => h.isNotEmpty)
          .join('\n');
      return headlines;
    } catch (_) {
      return '';
    }
  }

  // ── Gemini API ────────────────────────────────────────────────────────────

  static Future<List<Map<String, dynamic>>> rankWithGemini(
    List<Map<String, dynamic>> props,
    String apiKey,
    String sport,
  ) async {
    if (apiKey.isEmpty) {
      throw Exception(
          'Chave Gemini não configurada. Acesse Configurações para adicionar.');
    }

    final top = rankLocal(props).take(20).toList();

    // Busca notícias ESPN em paralelo com a montagem do prompt
    final espnNews = await _fetchEspnNews(sport);

    final propsData = top.map((p) {
      final avg5 = (p['playerAvg5'] as num?)?.toDouble();
      final avg10 = (p['playerAvg10'] as num?)?.toDouble();
      String? tendencia;
      if (avg5 != null && avg10 != null && avg10 > 0) {
        final t = (avg5 - avg10) / avg10 * 100;
        if (t >= 8) {
          tendencia =
              'Em alta (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        } else if (t <= -8) {
          tendencia =
              'Em queda (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        } else {
          tendencia =
              'Estável (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        }
      }
      return {
        'id': '${p['player']}_${p['prop']}_${p['side']}',
        'jogador': p['player'],
        'tipo': p['prop'],
        'linha': p['line'],
        'lado': p['side'],
        'edge': '${((p['edge'] as num).toDouble()).toStringAsFixed(1)}%',
        'probModelo':
            '${(p['modelProb'] as num).toDouble().toStringAsFixed(1)}%',
        'probMercado':
            '${(p['impliedProb'] as num).toDouble().toStringAsFixed(1)}%',
        'mediaGeral': p['playerAvg'],
        'media5j': avg5,
        'media10j': avg10,
        'tendencia': tendencia,
        'kelly': p['kelly'],
        'jogo': p['game'],
        'poucosJogos': p['lowSample'] ?? false,
        'mercadoIneficiente': p['inefficientMarket'] ?? false,
      };
    }).toList();

    final newsSection = espnNews.isNotEmpty
        ? 'NOTÍCIAS ESPN RECENTES ($sport):\n$espnNews\n\n'
        : '';

    final playerNames =
        top.map((p) => p['player'] as String).toSet().join(', ');

    final prompt = '''Você é um especialista em apostas esportivas de $sport.

${newsSection}PROPS PARA ANÁLISE:
${jsonEncode(propsData)}

REGRAS OBRIGATÓRIAS:
1. Use Google Search agora para cada jogador: $playerNames
   Verifique: titular/reserva? lesionado? mudança de rotação? minutos nas últimas partidas? matchup relevante?

2. fato_externo DEVE ser um fato verificado real. Exemplos válidos:
   "titular X fora por lesão, aumento de minutos esperado"
   "adversário tem defesa top-5 contra esse tipo de prop"
   "jogador voltou de lesão, em restrição de minutos"
   Se não encontrar nenhum fato externo real → fato_externo="sem validação de contexto", confirmado=false

3. PROIBIDO usar como justificativa:
   — "média recente é outlier"
   — "média histórica favorece"
   — qualquer frase que não cite fato externo concreto

4. Se avg5 contradiz a aposta (ex: aposta Over mas média recent abaixo da linha):
   Só confirme se houver fato externo real que explique a inversão.

Retorne SOMENTE JSON:
[{"id":"...","rank":1,"aiProbability":75.5,"justificativa":"análise citando fato externo (max 200 chars)","contextStatus":"positive","contextConfirmed":true,"contextReason":"motivo curto","externalFact":"fato verificado ou 'sem validação de contexto'"},...]''';

    final url =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=$apiKey';

    final res = await http.post(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'contents': [
          {
            'parts': [
              {'text': prompt}
            ]
          }
        ],
        'tools': [
          {'google_search': {}}
        ],
        'generationConfig': {
          'temperature': 0.2,
          'maxOutputTokens': 4096,
        },
      }),
    );

    if (res.statusCode != 200) {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      final msg =
          (err['error'] as Map?)?['message'] ?? 'Erro ${res.statusCode}';
      throw Exception('Erro Gemini: $msg');
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final candidates = body['candidates'] as List?;
    final firstCandidate = candidates?.isNotEmpty == true
        ? candidates!.first as Map<String, dynamic>
        : <String, dynamic>{};

    final rawText = ((firstCandidate['content'] as Map?)?['parts'] as List?)
            ?.first is Map
        ? ((firstCandidate['content'] as Map)['parts'][0]['text'] as String? ??
            '')
        : '';

    final grounding =
        firstCandidate['groundingMetadata'] as Map<String, dynamic>?;
    final groundingChunks = grounding?['groundingChunks'] as List? ?? [];
    final webQueries = grounding?['webSearchQueries'] as List? ?? [];
    final hasGrounding = groundingChunks.isNotEmpty || webQueries.isNotEmpty;

    final rankings = _parseJsonList(rawText);
    if (rankings == null) {
      final preview =
          rawText.length > 200 ? rawText.substring(0, 200) : rawText;
      throw Exception('Resposta Gemini inválida. Prévia: $preview');
    }

    final result = <Map<String, dynamic>>[];

    for (final r in rankings) {
      final id = r['id'] as String? ?? '';
      final prop = top.firstWhere(
        (p) => '${p['player']}_${p['prop']}_${p['side']}' == id,
        orElse: () => <String, dynamic>{},
      );

      if (prop.isEmpty) continue;

      final fact = ((r['externalFact'] as String?) ?? '').trim();
      final just = ((r['justificativa'] as String?) ?? '').trim();
      final confirmed = (r['contextConfirmed'] as bool?) ?? false;
      final factLower = fact.toLowerCase();
      final justLower = just.toLowerCase();

      final invalidTerms = [
        'média',
        'modelo',
        'prob',
        'tendência',
        'edge',
        'linha baixa',
        'linha alta',
        'sem validação',
      ];

      final usesOnlyInternalData = invalidTerms.any(
        (term) => factLower.contains(term) || justLower.contains(term),
      );

      final isValidFact =
          hasGrounding && confirmed && fact.isNotEmpty && !usesOnlyInternalData;

      if (!isValidFact) continue;

      result.add({
        ...prop,
        '_aiRank': (r['rank'] as num?)?.toInt() ?? 999,
        '_aiProb': (r['aiProbability'] as num?)?.toDouble() ?? 0,
        '_aiJust': just,
        '_aiFato': fact,
        '_aiConfirmado': true,
        '_aiContextStatus': r['contextStatus'] as String? ?? 'unknown',
        '_aiContextReason': r['contextReason'] as String? ?? '',
      });
    }

    if (result.isEmpty) {
      return top
          .map((p) => {
                ...p,
                '_aiRank': 999,
                '_aiProb': 0,
                '_aiJust': 'Sem validação externa disponível',
                '_aiFato': 'Sem fonte externa',
                '_aiConfirmado': false,
                '_aiContextStatus': 'unknown',
                '_aiContextReason': 'Gemini não encontrou informação relevante',
              })
          .toList();
    }

    // ORDENAÇÃO FINAL CORRETA

    double _get(Map m, String k) => (m[k] as num?)?.toDouble() ?? 0;

    result.sort((a, b) {
      final aNeg = a['_aiContextStatus'] == 'negative';
      final bNeg = b['_aiContextStatus'] == 'negative';

      // negative sempre por último
      if (aNeg != bNeg) return aNeg ? 1 : -1;

      final aEv = _get(a, 'edge') * _get(a, '_probCalibrada');
      final bEv = _get(b, 'edge') * _get(b, '_probCalibrada');

      if (aEv != bEv) return bEv.compareTo(aEv);

      final aScore = _get(a, '_scoreFinal');
      final bScore = _get(b, '_scoreFinal');

      if (aScore != bScore) return bScore.compareTo(aScore);

      final aKelly = _get(a, 'kelly');
      final bKelly = _get(b, 'kelly');

      return bKelly.compareTo(aKelly);
    });

// LIMITE FINAL
    return result.take(20).toList();
  }

  // ── JSON parsing robusto ─────────────────────────────────────────────────

  static List? _parseJsonList(String text) {
    if (text.trim().isEmpty) return null;

    // 1. Tenta diretamente (responseMimeType garante JSON puro)
    try {
      final decoded = jsonDecode(text.trim());
      if (decoded is List) return decoded;
    } catch (_) {}

    // 2. Remove marcadores de citação do grounding: [1], [2], etc.
    final cleaned = text.replaceAll(RegExp(r'\[\d+\]'), '').trim();

    // 3. Extrai de bloco markdown ```json ... ``` ou ``` ... ```
    final codeBlock =
        RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```').firstMatch(cleaned);
    if (codeBlock != null) {
      try {
        final decoded = jsonDecode(codeBlock.group(1)!.trim());
        if (decoded is List) return decoded;
      } catch (_) {}
    }

    // 4. Extrai primeiro array JSON do texto
    final arrayMatch = RegExp(r'\[[\s\S]*\]').firstMatch(cleaned);
    if (arrayMatch != null) {
      try {
        final decoded = jsonDecode(arrayMatch.group(0)!);
        if (decoded is List) return decoded;
      } catch (_) {}
    }

    // 5. Tenta de [ até o último ]
    final first = cleaned.indexOf('[');
    final last = cleaned.lastIndexOf(']');
    if (first != -1 && last > first) {
      try {
        final decoded = jsonDecode(cleaned.substring(first, last + 1));
        if (decoded is List) return decoded;
      } catch (_) {}
    }

    return null;
  }

  // ── Export TXT ────────────────────────────────────────────────────────────

  static String buildExportText({
    required String sport,
    required List<Map<String, dynamic>> localRanked,
    required List<Map<String, dynamic>>? geminiRanked,
  }) {
    final now = DateTime.now();
    final dateStr =
        '${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year} '
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';

    final buf = StringBuffer();
    buf.writeln('EDGE FINDER — AVALIAÇÃO DE EDGES');
    buf.writeln('Esporte: $sport');
    buf.writeln('Gerado em: $dateStr');
    buf.writeln('=' * 60);

    buf.writeln();
    buf.writeln('ALGORITMO LOCAL');
    buf.writeln('=' * 60);

    for (int i = 0; i < localRanked.length; i++) {
      final p = localRanked[i];
      final rank = i + 1;
      final score = (p['_localScore'] as double).toStringAsFixed(0);
      final edge = (p['edge'] as num).toDouble().toStringAsFixed(1);
      final modelProb = (p['modelProb'] as num).toDouble().toStringAsFixed(1);
      final impliedProb =
          (p['impliedProb'] as num).toDouble().toStringAsFixed(1);
      final line = (p['line'] as num).toDouble().toStringAsFixed(1);
      final side = p['side'] as String;
      final avg5 = (p['playerAvg5'] as num?)?.toDouble().toStringAsFixed(1);
      final avg10 = (p['playerAvg10'] as num?)?.toDouble().toStringAsFixed(1);
      final avg = (p['playerAvg'] as num?)?.toDouble().toStringAsFixed(1);
      final kelly = (p['kelly'] as num?)?.toDouble().toStringAsFixed(1);
      final just = generateLocalJustification(p);

      buf.writeln();
      buf.writeln('#$rank — Score: $score/100');
      buf.writeln('Jogador: ${p['player']}');
      buf.writeln(
          'Aposta: ${_propLabel(p['prop'] as String)} ${side == 'Over' ? 'Over' : 'Under'} $line');
      buf.writeln('Jogo: ${p['game']}');
      buf.writeln(
          'Edge: $edge% | Modelo: $modelProb% | Mercado: $impliedProb%');
      if (avg != null) buf.writeln('Média geral: $avg');
      if (avg5 != null || avg10 != null) {
        buf.writeln(
            'Forma: ${avg5 != null ? 'Méd.5j=$avg5' : ''} ${avg10 != null ? 'Méd.10j=$avg10' : ''}'
                .trim());
      }
      if (kelly != null) buf.writeln('Kelly: $kelly%');
      if (p['inefficientMarket'] == true) buf.writeln('★ Mercado ineficiente');
      if (p['lowSample'] == true) buf.writeln('⚠ Amostra reduzida');
      buf.writeln('Análise:');
      for (final line2 in just.split('\n')) {
        buf.writeln('  • $line2');
      }
      buf.writeln('-' * 40);
    }

    if (geminiRanked != null && geminiRanked.isNotEmpty) {
      buf.writeln();
      buf.writeln();
      buf.writeln('GEMINI AI (gemini-2.5-flash-lite + Google Search)');
      buf.writeln('=' * 60);

      for (int i = 0; i < geminiRanked.length; i++) {
        final p = geminiRanked[i];
        final rank = i + 1;
        final aiProb = (p['_aiProb'] as num).toDouble().toStringAsFixed(0);
        final just = p['_aiJust'] as String? ?? '';
        final edge = (p['edge'] as num).toDouble().toStringAsFixed(1);
        final line = (p['line'] as num).toDouble().toStringAsFixed(1);
        final side = p['side'] as String;

        buf.writeln();
        buf.writeln('#$rank — Prob. IA: $aiProb%');
        buf.writeln('Jogador: ${p['player']}');
        buf.writeln(
            'Aposta: ${_propLabel(p['prop'] as String)} ${side == 'Over' ? 'Over' : 'Under'} $line');
        buf.writeln('Jogo: ${p['game']}');
        buf.writeln('Edge: $edge%');
        if (just.isNotEmpty) {
          buf.writeln('Análise IA: $just');
        }
        buf.writeln('-' * 40);
      }
    }

    return buf.toString();
  }

  static String _propLabel(String prop) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': '3 Pontos',
      'fouls': 'Faltas',
      'hits': 'Hits',
      'homeRuns': 'Home Runs',
      'strikeouts': 'Strikeouts',
      'hitsAllowed': 'Hits Permitidos',
      'goals': 'Gols',
      'shots': 'Chutes a Gol',
      'blocked': 'Bloqueios',
      'passYards': 'Jardas de Passe',
      'passTDs': 'TDs de Passe',
      'rushYards': 'Jardas Corridas',
      'receptions': 'Recepções',
      'receptionYards': 'Jardas Recebidas',
      'fantasyPoints': 'Fantasy Points',
      'sets': 'Sets',
      'games': 'Games',
    };
    return labels[prop] ?? prop;
  }
}
