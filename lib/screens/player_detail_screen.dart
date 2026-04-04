import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class PlayerDetailScreen extends StatefulWidget {
  final Map<String, dynamic> prop;

  const PlayerDetailScreen({super.key, required this.prop});

  @override
  State<PlayerDetailScreen> createState() => _PlayerDetailScreenState();
}

class _PlayerDetailScreenState extends State<PlayerDetailScreen> {
  Map<String, dynamic>? _playerStats;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _fetchStats();
  }

  Future<void> _fetchStats() async {
    final player = Uri.encodeComponent(widget.prop['player'] as String);
    try {
      final res = await http.get(
        Uri.parse('http://localhost:3001/api/nba/player-stats/$player'),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() => _playerStats = data as Map<String, dynamic>?);
      }
    } catch (_) {}
    setState(() => _loading = false);
  }

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

  double _avg(List values) {
    if (values.isEmpty) return 0;
    return values.fold(0.0, (s, v) => s + (v as num).toDouble()) /
        values.length;
  }

  @override
  Widget build(BuildContext context) {
    final statKey = widget.prop['prop'] as String;
    final player = widget.prop['player'] as String;

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
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF7C4DFF)))
          : _playerStats == null
              ? const Center(
                  child: Text('Dados não disponíveis.',
                      style: TextStyle(color: Color(0xFF666666))))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _SectionHeader(
                        title: 'Prop: ${_propLabel(statKey)}'),
                    const SizedBox(height: 8),
                    _PropSummaryCard(prop: widget.prop),
                    const SizedBox(height: 24),
                    const _SectionHeader(title: 'Por temporada'),
                    const SizedBox(height: 8),
                    ..._buildSeasonCards(statKey),
                    const SizedBox(height: 24),
                    const _SectionHeader(title: 'Casa vs Fora'),
                    const SizedBox(height: 8),
                    _buildHomeAwayCard(statKey),
                    const SizedBox(height: 24),
                    const _SectionHeader(title: 'Regular vs Playoffs'),
                    const SizedBox(height: 8),
                    _buildGameTypeCard(statKey),
                  ],
                ),
    );
  }

  List<Widget> _buildSeasonCards(String statKey) {
    final seasons = _playerStats!.keys.toList()
      ..sort((a, b) => int.parse(b).compareTo(int.parse(a)));

    return seasons.map((seasonStr) {
      final season = int.parse(seasonStr);
      final seasonData = _playerStats![seasonStr] as Map<String, dynamic>;
      final allValues = <double>[];

      for (final gameType in ['regular', 'playoffs']) {
        for (final loc in ['home', 'away']) {
          final ctx = (seasonData[gameType] as Map?)?[loc] as Map?;
          final vals = ctx?[statKey];
          if (vals is List) {
            allValues.addAll(vals.map((v) => (v as num).toDouble()));
          }
        }
      }

      if (allValues.isEmpty) return const SizedBox.shrink();

      final label = season == 2026
          ? '2025-26'
          : season == 2025
              ? '2024-25'
              : '2023-24';

      return _StatRow(
        label: label,
        value: _avg(allValues).toStringAsFixed(2),
        subLabel: '${allValues.length} jogos',
        highlight: season == 2026,
      );
    }).toList();
  }

  Widget _buildHomeAwayCard(String statKey) {
    final homeVals = <double>[];
    final awayVals = <double>[];

    for (final seasonData in _playerStats!.values) {
      for (final gameType in ['regular', 'playoffs']) {
        final home =
            ((seasonData as Map)[gameType] as Map?)?['home'] as Map?;
        final away =
            (seasonData[gameType] as Map?)?['away'] as Map?;
        if (home?[statKey] is List) {
          homeVals.addAll(
              (home![statKey] as List).map((v) => (v as num).toDouble()));
        }
        if (away?[statKey] is List) {
          awayVals.addAll(
              (away![statKey] as List).map((v) => (v as num).toDouble()));
        }
      }
    }

    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: '🏠 Casa',
            value: homeVals.isEmpty
                ? '-'
                : _avg(homeVals).toStringAsFixed(2),
            subLabel: '${homeVals.length} jogos',
            color: const Color(0xFF7C4DFF),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            label: '✈️ Fora',
            value: awayVals.isEmpty
                ? '-'
                : _avg(awayVals).toStringAsFixed(2),
            subLabel: '${awayVals.length} jogos',
            color: const Color(0xFFFF6D00),
          ),
        ),
      ],
    );
  }

  Widget _buildGameTypeCard(String statKey) {
    final regularVals = <double>[];
    final playoffVals = <double>[];

    for (final seasonData in _playerStats!.values) {
      for (final loc in ['home', 'away']) {
        final reg =
            ((seasonData as Map)['regular'] as Map?)?[loc] as Map?;
        final pla =
            (seasonData['playoffs'] as Map?)?[loc] as Map?;
        if (reg?[statKey] is List) {
          regularVals.addAll(
              (reg![statKey] as List).map((v) => (v as num).toDouble()));
        }
        if (pla?[statKey] is List) {
          playoffVals.addAll(
              (pla![statKey] as List).map((v) => (v as num).toDouble()));
        }
      }
    }

    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: '📅 Regular',
            value: regularVals.isEmpty
                ? '-'
                : _avg(regularVals).toStringAsFixed(2),
            subLabel: '${regularVals.length} jogos',
            color: const Color(0xFF00C853),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            label: '🏆 Playoffs',
            value: playoffVals.isEmpty
                ? '-'
                : _avg(playoffVals).toStringAsFixed(2),
            subLabel: '${playoffVals.length} jogos',
            color: const Color(0xFFFFD600),
          ),
        ),
      ],
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
            color: Color(0xFFAAAAAA),
            fontSize: 13,
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5));
  }
}

class _PropSummaryCard extends StatelessWidget {
  final Map<String, dynamic> prop;
  const _PropSummaryCard({required this.prop});

  Color _edgeColor(double edge) {
    if (edge >= 5) return const Color(0xFF00C853);
    if (edge >= 2) return const Color(0xFFFFD600);
    return const Color(0xFFFF1744);
  }

  @override
  Widget build(BuildContext context) {
    final edge = (prop['edge'] as num).toDouble();
    final side = prop['side'] as String;
    final line = (prop['line'] as num).toDouble();
    final odds = (prop['odds'] as num).toDouble();
    final avg = (prop['playerAvg'] as num).toDouble();
    final std = (prop['playerStd'] as num).toDouble();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _edgeColor(edge).withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(prop['game'] as String,
                    style: const TextStyle(
                        color: Color(0xFF888888), fontSize: 12)),
                const SizedBox(height: 6),
                Text('Média: ${avg.toStringAsFixed(2)} ± ${std.toStringAsFixed(2)}',
                    style: const TextStyle(color: Colors.white, fontSize: 14)),
                Text('Linha: $line',
                    style: const TextStyle(
                        color: Color(0xFFAAAAAA), fontSize: 13)),
              ],
            ),
          ),
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: _edgeColor(edge).withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _edgeColor(edge)),
            ),
            child: Column(
              children: [
                Text('$side $line',
                    style: TextStyle(
                        color: _edgeColor(edge),
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
                Text('Edge: ${edge.toStringAsFixed(2)}%',
                    style:
                        TextStyle(color: _edgeColor(edge), fontSize: 12)),
                Text('@${odds.toStringAsFixed(2)}',
                    style: TextStyle(
                        color: _edgeColor(edge).withValues(alpha: 0.8),
                        fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  final String label;
  final String value;
  final String subLabel;
  final bool highlight;

  const _StatRow({
    required this.label,
    required this.value,
    required this.subLabel,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: highlight
            ? const Color(0xFF7C4DFF).withValues(alpha: 0.1)
            : const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(10),
        border: highlight
            ? Border.all(
                color: const Color(0xFF7C4DFF).withValues(alpha: 0.4))
            : null,
      ),
      child: Row(
        children: [
          Text(label,
              style: TextStyle(
                  color:
                      highlight ? const Color(0xFF7C4DFF) : Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
          if (highlight)
            const Padding(
              padding: EdgeInsets.only(left: 6),
              child: Text('(atual)',
                  style: TextStyle(
                      color: Color(0xFF7C4DFF), fontSize: 11)),
            ),
          const Spacer(),
          Text(subLabel,
              style: const TextStyle(
                  color: Color(0xFF888888), fontSize: 12)),
          const SizedBox(width: 12),
          Text(value,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String subLabel;
  final Color color;

  const _StatCard({
    required this.label,
    required this.value,
    required this.subLabel,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Text(label,
              style: const TextStyle(
                  color: Color(0xFFAAAAAA), fontSize: 13)),
          const SizedBox(height: 8),
          Text(value,
              style: TextStyle(
                  color: color,
                  fontSize: 28,
                  fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(subLabel,
              style: const TextStyle(
                  color: Color(0xFF888888), fontSize: 11)),
        ],
      ),
    );
  }
}
