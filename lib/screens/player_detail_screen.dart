import 'dart:html' as html; // ignore: avoid_web_libraries_in_flutter
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../widgets/bet_dialog.dart';
import '../services/prefs_service.dart';

class PlayerDetailScreen extends StatelessWidget {
  final Map<String, dynamic> prop;
  const PlayerDetailScreen({super.key, required this.prop});

  String _propLabel(String p) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': 'Cestas de 3',
      'fouls': 'Faltas',
    };
    return labels[p] ?? p;
  }

  Color _edgeColor(double edge) {
    if (edge >= 5) {
      return const Color(0xFF00C853);
    }
    if (edge >= 2) {
      return const Color(0xFFFFD600);
    }
    return const Color(0xFFFF1744);
  }

  Future<void> _openPinnacle(Map<String, dynamic> prop) async {
    final id = prop['pinnacleId'];
    final slug = prop['pinnacleSlug'] as String?;
    if (id == null || slug == null) return;

    final sportRaw = (prop['sport'] as String? ?? '').toLowerCase();
    String sportPath;
    if (sportRaw.contains('basket') || sportRaw.contains('nba')) {
      sportPath = 'basketball/nba';
    } else if (sportRaw.contains('base') || sportRaw.contains('mlb')) {
      sportPath = 'baseball/mlb';
    } else if (sportRaw.contains('hock') || sportRaw.contains('nhl')) {
      sportPath = 'hockey/nhl';
    } else if (sportRaw.contains('tennis') || sportRaw.contains('tênis')) {
      sportPath = 'tennis';
    } else {
      sportPath = 'basketball/nba';
    }

    final uri = Uri.parse(
      'https://pinnacle.bet.br/sportsbook/standard/$sportPath/$slug/$id',
    );
    if (kIsWeb) {
      // No Flutter Web, externalApplication abre na mesma aba — forçar nova aba
      html.window.open(uri.toString(), '_blank');
    } else {
      if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Color _propColor(String p) {
    const colors = {
      'points': Color(0xFFFFD600),
      'rebounds': Color(0xFF00B0FF),
      'assists': Color(0xFF00E5FF),
      'steals': Color(0xFFFF6D00),
      'threes': Color(0xFFE040FB),
      'fouls': Color(0xFFFF1744),
    };
    return colors[p] ?? const Color(0xFFAAAAAA);
  }

  String _formatCommenceTime(String? raw) {
    if (raw == null) {
      return '';
    }
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) {
      return '';
    }
    final d =
        '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}';
    final h =
        '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    return '$d às $h';
  }

  @override
  Widget build(BuildContext context) {
    final player = prop['player'] as String;
    final game = prop['game'] as String;
    final propKey = prop['prop'] as String;
    final edge = (prop['edge'] as num).toDouble();
    final avg = (prop['playerAvg'] as num).toDouble();
    final std = (prop['playerStd'] as num).toDouble();
    final line = (prop['line'] as num).toDouble();
    final modelProb = (prop['modelProb'] as num).toDouble();
    final impliedProb = (prop['impliedProb'] as num).toDouble();
    final side = prop['side'] as String;
    final odds = (prop['odds'] as num).toDouble();
    final kelly = (prop['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample = prop['lowSample'] == true;
    final inefficientMarket = prop['inefficientMarket'] == true;
    final contextGames = prop['contextGames'] as int? ?? 0;
    final totalGames = prop['totalGames'] as int? ?? 0;
    final location = prop['location'] as String? ?? 'unknown';
    final absentFilter = prop['absentFilter'] == true ? 'Ativo' : '';
    final rawAbsent = prop['absentToday'];
    final absentToday = rawAbsent is List
        ? rawAbsent.map((e) {
            if (e is Map<String, dynamic>) {
              return e;
            }
            return <String, dynamic>{
              'name': e.toString(),
              'position': null,
              'group': 'unknown',
              'impact': 'unknown',
            };
          }).toList()
        : null;
    final playerPosition = prop['playerPosition'] as String?;
    final commenceTime = _formatCommenceTime(prop['commence_time'] as String?);
    final propColor = _propColor(propKey);
    final edgeColor = _edgeColor(edge);
    final banca = PrefsService.getBanca();
    final valorKelly = banca > 0 ? banca * kelly / 100 : 0.0;

    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(player,
            style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ── Jogo e prop ──────────────────────────────────────────────────
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E2E),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: propColor.withValues(alpha: 0.4)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(game,
                          style: const TextStyle(
                              color: Color(0xFF888888), fontSize: 12)),
                      if (commenceTime.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text('🕐 $commenceTime',
                            style: const TextStyle(
                                color: Color(0xFF666688), fontSize: 11)),
                      ],
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: propColor.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                              color: propColor.withValues(alpha: 0.5)),
                        ),
                        child: Text(
                          _propLabel(propKey),
                          style: TextStyle(
                              color: propColor,
                              fontWeight: FontWeight.bold,
                              fontSize: 14),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  location == 'home'
                      ? '🏠 Casa'
                      : location == 'away'
                          ? '✈️ Fora'
                          : '📍 -',
                  style:
                      const TextStyle(color: Color(0xFFAAAAAA), fontSize: 13),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── Edge e odds ───────────────────────────────────────────────────
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: edgeColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: edgeColor, width: 1.5),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '$side $line · Edge: ${edge.toStringAsFixed(2)}%',
                        style: TextStyle(
                            color: edgeColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 16),
                      ),
                      const SizedBox(height: 4),
                      Text('@${odds.toStringAsFixed(2)}',
                          style: TextStyle(
                              color: edgeColor.withValues(alpha: 0.8),
                              fontSize: 14)),
                    ],
                  ),
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (prop['pinnacleId'] != null) ...[
                      GestureDetector(
                        onTap: () => _openPinnacle(prop),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: const Color(0xFF1A237E).withValues(alpha: 0.3),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: const Color(0xFF3949AB)),
                          ),
                          child: const Text('Pinnacle',
                              style: TextStyle(
                                  color: Color(0xFF7986CB),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 12)),
                        ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    GestureDetector(
                      onTap: () => showBetDialog(
                        context: context,
                        betData: prop,
                        title: player,
                        subtitle: '$side $line ${_propLabel(propKey)}',
                        kellyPct: kelly > 0 ? kelly : null,
                        oddsOver: (prop['oddsOver'] as num?)?.toDouble(),
                        oddsUnder: (prop['oddsUnder'] as num?)?.toDouble(),
                        odds: odds,
                        modelProb: modelProb,
                        originalLine: line,
                        playerAvg: avg,
                        playerStd: std,
                      ),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: edgeColor.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text('Registrar aposta',
                            style: TextStyle(
                                color: edgeColor,
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── Estatísticas do modelo ────────────────────────────────────────
          const _SectionHeader(title: 'MODELO'),
          const SizedBox(height: 8),
          Row(
            children: [
              _StatCard(
                label: 'Média',
                value: avg.toStringAsFixed(2),
                sub: '±${std.toStringAsFixed(2)}',
                color: const Color(0xFF7C4DFF),
              ),
              const SizedBox(width: 10),
              _StatCard(
                label: 'Linha',
                value: line.toString(),
                sub: '',
                color: const Color(0xFFAAAAAA),
              ),
              const SizedBox(width: 10),
              _StatCard(
                label: 'Modelo',
                value: '${modelProb.toStringAsFixed(1)}%',
                sub: '',
                color: const Color(0xFF00C853),
              ),
              const SizedBox(width: 10),
              _StatCard(
                label: 'Mercado',
                value: '${impliedProb.toStringAsFixed(1)}%',
                sub: '',
                color: const Color(0xFF00B0FF),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // ── Kelly ─────────────────────────────────────────────────────────
          if (kelly > 0) ...[
            const _SectionHeader(title: 'KELLY'),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF7C4DFF).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: const Color(0xFF7C4DFF).withValues(alpha: 0.4)),
              ),
              child: Row(
                children: [
                  Text('${kelly.toStringAsFixed(2)}% da banca',
                      style: const TextStyle(
                          color: Color(0xFF7C4DFF),
                          fontWeight: FontWeight.bold,
                          fontSize: 16)),
                  if (banca > 0) ...[
                    const Spacer(),
                    Text('R\$ ${valorKelly.toStringAsFixed(2)}',
                        style: const TextStyle(
                            color: Color(0xFF9E7DFF),
                            fontWeight: FontWeight.bold,
                            fontSize: 18)),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // ── Contexto ──────────────────────────────────────────────────────
          const _SectionHeader(title: 'CONTEXTO'),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E2E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                _ContextRow(
                  label: 'Jogos no contexto',
                  value: '$contextGames',
                ),
                const SizedBox(height: 8),
                _ContextRow(
                  label: 'Total de jogos',
                  value: '$totalGames',
                ),
                if (absentFilter.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _ContextRow(
                    label: 'Filtro de ausentes',
                    value: absentFilter,
                  ),
                ],
                if (playerPosition != null) ...[
                  const SizedBox(height: 8),
                  _ContextRow(label: 'Posição', value: playerPosition),
                ],
                if (absentToday != null && absentToday.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  const Divider(color: Color(0xFF2A2A3E)),
                  const SizedBox(height: 8),
                  const Text('Ausentes hoje',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  const SizedBox(height: 8),
                  ...absentToday.map((a) {
                    final isDireto = a['impact'] == 'direto';
                    final pos = a['position'] as String? ?? '?';
                    final name = a['name'] as String? ?? '';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(
                              color: isDireto
                                  ? const Color(0xFFFF1744)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF444466)
                                      .withValues(alpha: 0.3),
                              borderRadius: BorderRadius.circular(5),
                              border: Border.all(
                                color: isDireto
                                    ? const Color(0xFFFF1744)
                                        .withValues(alpha: 0.5)
                                    : const Color(0xFF444466),
                              ),
                            ),
                            child: Text(pos,
                                style: TextStyle(
                                    color: isDireto
                                        ? const Color(0xFFFF1744)
                                        : const Color(0xFF888888),
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold)),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(name,
                                style: TextStyle(
                                    color: isDireto
                                        ? Colors.white
                                        : const Color(0xFF888888),
                                    fontSize: 13,
                                    fontWeight: isDireto
                                        ? FontWeight.bold
                                        : FontWeight.normal)),
                          ),
                          Text(
                            isDireto ? '⚠️ impacto direto' : 'indireto',
                            style: TextStyle(
                                color: isDireto
                                    ? const Color(0xFFFF6D00)
                                    : const Color(0xFF555566),
                                fontSize: 11),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ],
            ),
          ),

          const SizedBox(height: 16),

          // ── Alertas ───────────────────────────────────────────────────────
          if (lowSample || inefficientMarket) ...[
            const _SectionHeader(title: 'ALERTAS'),
            const SizedBox(height: 8),
            if (inefficientMarket)
              _AlertBadge(
                icon: '🎯',
                label: 'Mercado ineficiente',
                sub: 'Edge > 20% com amostra confiável',
                color: const Color(0xFF00C853),
              ),
            if (lowSample) ...[
              if (inefficientMarket) const SizedBox(height: 8),
              _AlertBadge(
                icon: '⚠️',
                label: 'Poucos jogos no contexto ($contextGames)',
                sub: 'Resultado menos confiável',
                color: const Color(0xFFFF6D00),
              ),
            ],
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(title,
        style: const TextStyle(
            color: Color(0xFF666688),
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1.2));
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String sub;
  final Color color;
  const _StatCard({
    required this.label,
    required this.value,
    required this.sub,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(color: Color(0xFF888888), fontSize: 10)),
            const SizedBox(height: 4),
            Text(value,
                style: TextStyle(
                    color: color, fontSize: 16, fontWeight: FontWeight.bold)),
            if (sub.isNotEmpty)
              Text(sub,
                  style:
                      const TextStyle(color: Color(0xFF888888), fontSize: 10)),
          ],
        ),
      ),
    );
  }
}

class _ContextRow extends StatelessWidget {
  final String label;
  final String value;
  final bool highlight;
  const _ContextRow({
    required this.label,
    required this.value,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: const TextStyle(color: Color(0xFF888888), fontSize: 13)),
        Text(value,
            style: TextStyle(
                color: highlight ? const Color(0xFFFF6D00) : Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 13)),
      ],
    );
  }
}

class _AlertBadge extends StatelessWidget {
  final String icon;
  final String label;
  final String sub;
  final Color color;
  const _AlertBadge({
    required this.icon,
    required this.label,
    required this.sub,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Text(icon, style: const TextStyle(fontSize: 20)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
                Text(sub,
                    style: const TextStyle(
                        color: Color(0xFF888888), fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
