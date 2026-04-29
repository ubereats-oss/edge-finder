import 'dart:convert';
import 'package:http/http.dart' as http;

class EdgeEvaluatorService {
  // ── Algoritmo Local ───────────────────────────────────────────────────────

  static List<Map<String, dynamic>> rankLocal(
      List<Map<String, dynamic>> props) {
    final scored = props
        .map((p) => {...p, '_localScore': _computeLocalScore(p)})
        .toList();
    scored.sort((a, b) =>
        (b['_localScore'] as double).compareTo(a['_localScore'] as double));
    return scored;
  }

  static double _computeLocalScore(Map<String, dynamic> p) {
    final edge = (p['edge'] as num?)?.toDouble() ?? 0;
    final modelProb = (p['modelProb'] as num?)?.toDouble() ?? 50;
    final kelly = (p['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample = p['lowSample'] == true;
    final inefficientMarket = p['inefficientMarket'] == true;
    final playerAvg5 = (p['playerAvg5'] as num?)?.toDouble();
    final playerAvg10 = (p['playerAvg10'] as num?)?.toDouble();
    final line = (p['line'] as num?)?.toDouble() ?? 0;
    final side = p['side'] as String? ?? 'Over';

    double score = modelProb;
    score += edge * 2.0;
    score += kelly.clamp(0, 20) * 0.4;
    if (inefficientMarket) score += 6;
    if (lowSample) score -= 12;

    if (playerAvg5 != null && line > 0) {
      final favors = (side == 'Over' && playerAvg5 > line) ||
          (side == 'Under' && playerAvg5 < line);
      score += favors ? 5 : -5;
    }
    if (playerAvg10 != null && line > 0) {
      final favors = (side == 'Over' && playerAvg10 > line) ||
          (side == 'Under' && playerAvg10 < line);
      score += favors ? 2 : -2;
    }

    return score.clamp(0, 100);
  }

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
      final favors5 = (side == 'Over' && diff5 > 0) ||
          (side == 'Under' && diff5 < 0);
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
      final favorsAvg = (side == 'Over' && diffAvg > 0) ||
          (side == 'Under' && diffAvg < 0);
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
      parts.add('Kelly Criterion recomenda aposta de ${kelly.toStringAsFixed(1)}% '
          'da banca — sinal forte');
    } else if (kelly >= 3) {
      parts.add('Kelly sugere ${kelly.toStringAsFixed(1)}% da banca');
    }
    if (lowSample) {
      parts.add('Amostra reduzida de jogos — validar com contexto recente');
    }

    return parts.join('\n');
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

    final top = ([...props]
          ..sort((a, b) => (b['edge'] as num).compareTo(a['edge'] as num)))
        .take(20)
        .toList();

    // Busca notícias ESPN em paralelo com a montagem do prompt
    final espnNews = await _fetchEspnNews(sport);

    final propsData = top.map((p) {
      final avg5 = (p['playerAvg5'] as num?)?.toDouble();
      final avg10 = (p['playerAvg10'] as num?)?.toDouble();
      String? tendencia;
      if (avg5 != null && avg10 != null && avg10 > 0) {
        final t = (avg5 - avg10) / avg10 * 100;
        if (t >= 8) {
          tendencia = 'Em alta (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        } else if (t <= -8) {
          tendencia = 'Em queda (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        } else {
          tendencia = 'Estável (5j ${avg5.toStringAsFixed(1)} vs 10j ${avg10.toStringAsFixed(1)})';
        }
      }
      return {
        'id': '${p['player']}_${p['prop']}_${p['side']}',
        'jogador': p['player'],
        'tipo': p['prop'],
        'linha': p['line'],
        'lado': p['side'],
        'edge': '${((p['edge'] as num).toDouble()).toStringAsFixed(1)}%',
        'probModelo': '${(p['modelProb'] as num).toDouble().toStringAsFixed(1)}%',
        'probMercado': '${(p['impliedProb'] as num).toDouble().toStringAsFixed(1)}%',
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

INSTRUÇÃO:
Analise cada prop acima considerando TODOS os fatores disponíveis:
1. Dados estatísticos (edge, probabilidades do modelo vs mercado, tendência 5j vs 10j)
2. Notícias ESPN acima sobre lesões, mudanças de rotação, minutos jogados, posição
3. Use Google Search para buscar informações atuais sobre estes jogadores: $playerNames
   — verifique: está titular ou reserva? mudou de posição? lesionado? em alta ou baixa forma?
4. Contexto do confronto (time adversário, histórico)

Para cada prop retorne uma ANÁLISE DETALHADA em português que mencione:
- Status atual do jogador (titular/reserva/lesionado se souber)
- Por que a linha está boa ou ruim
- Tendência recente de performance
- Qualquer notícia relevante encontrada

Retorne SOMENTE JSON, sem texto extra:
[{"id":"...","rank":1,"aiProb":75.5,"justificativa":"análise completa em pt-br (max 200 chars)"},...]''';

    final url =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=$apiKey';

    final res = await http.post(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'contents': [
          {
            'parts': [{'text': prompt}]
          }
        ],
        'generationConfig': {
          'temperature': 0.3,
          'maxOutputTokens': 4096,
          'responseMimeType': 'application/json',
          'responseSchema': {
            'type': 'array',
            'items': {
              'type': 'object',
              'properties': {
                'id': {'type': 'string'},
                'rank': {'type': 'integer'},
                'aiProb': {'type': 'number'},
                'justificativa': {'type': 'string'},
              },
              'required': ['id', 'rank', 'aiProb', 'justificativa'],
            },
          },
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
    final rawText =
        (((candidates?.first as Map?)?['content'] as Map?)?['parts'] as List?)
            ?.first?['text'] as String? ??
        '';

    final rankings = _parseJsonList(rawText);
    if (rankings == null) {
      final preview = rawText.length > 200 ? rawText.substring(0, 200) : rawText;
      throw Exception('Resposta Gemini inválida. Prévia: $preview');
    }
    final result = <Map<String, dynamic>>[];

    for (final r in rankings) {
      final id = r['id'] as String? ?? '';
      final prop = top.firstWhere(
        (p) => '${p['player']}_${p['prop']}_${p['side']}' == id,
        orElse: () => <String, dynamic>{},
      );
      if (prop.isNotEmpty) {
        result.add({
          ...prop,
          '_aiRank': (r['rank'] as num).toInt(),
          '_aiProb': (r['aiProb'] as num).toDouble(),
          '_aiJust': r['justificativa'] as String? ?? '',
        });
      }
    }

    result
        .sort((a, b) => (a['_aiRank'] as int).compareTo(b['_aiRank'] as int));
    return result;
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

    for (final p in localRanked) {
      final rank = localRanked.indexOf(p) + 1;
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
            'Forma: ${avg5 != null ? 'Méd.5j=$avg5' : ''} ${avg10 != null ? 'Méd.10j=$avg10' : ''}'.trim());
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

      for (final p in geminiRanked) {
        final rank = p['_aiRank'] as int;
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
