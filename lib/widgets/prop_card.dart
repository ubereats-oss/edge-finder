import 'package:flutter/material.dart';
import '../services/prefs_service.dart';
import '../screens/player_detail_screen.dart';

class PropCard extends StatefulWidget {
  final Map<String, dynamic> prop;
  final String? sportBadge;
  const PropCard({super.key, required this.prop, this.sportBadge});

  @override
  State<PropCard> createState() => _PropCardState();
}

class _PropCardState extends State<PropCard> {
  double _banca = 0;

  @override
  void initState() {
    super.initState();
    _banca = PrefsService.getBanca();
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

  String _propLabel(String prop) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': 'Cestas de 3',
      'fouls': 'Faltas',
      'hits': 'Hits',
      'homeRuns': 'Home Runs',
      'strikeouts': 'Strikeouts',
      'hitsAllowed': 'Hits Permitidos',
      'goals': 'Gols',
      'shots': 'Chutes a Gol',
      'blocked': 'Bloqueios',
      'passYards': 'Jardas Passe',
      'passTDs': 'TDs Passe',
      'rushYards': 'Jardas Corridas',
      'receptions': 'Recepções',
      'receptionYards': 'Jardas Recebidas',
      'fantasyPoints': 'Fantasy Pts',
      'sets': 'Sets',
      'games': 'Games',
    };
    return labels[prop] ?? prop;
  }

  Color _propColor(String prop) {
    const colors = {
      'points': Color(0xFFFFD600),
      'rebounds': Color(0xFF00B0FF),
      'assists': Color(0xFF00E5FF),
      'steals': Color(0xFFFF6D00),
      'threes': Color(0xFFE040FB),
      'fouls': Color(0xFFFF1744),
      'hits': Color(0xFF00C853),
      'homeRuns': Color(0xFFFF6D00),
      'strikeouts': Color(0xFF7C4DFF),
      'hitsAllowed': Color(0xFFFF1744),
      'goals': Color(0xFF00B0FF),
      'shots': Color(0xFF00E5FF),
      'blocked': Color(0xFFAAAAAA),
      'passYards': Color(0xFFFFD600),
      'passTDs': Color(0xFFFF6D00),
      'rushYards': Color(0xFF00C853),
      'receptions': Color(0xFF00B0FF),
      'receptionYards': Color(0xFF00E5FF),
      'fantasyPoints': Color(0xFF7C4DFF),
      'sets': Color(0xFFFFD600),
      'games': Color(0xFF00C853),
    };
    return colors[prop] ?? const Color(0xFFAAAAAA);
  }

  Color _sportBadgeColor(String sport) {
    if (sport.contains('NBA')) return const Color(0xFF7C4DFF);
    if (sport.contains('MLB')) return const Color(0xFF00C853);
    if (sport.contains('NHL')) return const Color(0xFF00B0FF);
    if (sport.contains('NFL')) return const Color(0xFFFF6D00);
    if (sport.contains('Tênis')) return const Color(0xFFFFD600);
    return const Color(0xFFAAAAAA);
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
    final edge = (widget.prop['edge'] as num).toDouble();
    final avg = (widget.prop['playerAvg'] as num).toDouble();
    final std = (widget.prop['playerStd'] as num).toDouble();
    final avg5 = (widget.prop['playerAvg5'] as num?)?.toDouble();
    final avg10 = (widget.prop['playerAvg10'] as num?)?.toDouble();
    final playerTeam = widget.prop['playerTeam'] as String?;
    final line = (widget.prop['line'] as num).toDouble();
    final modelProb = (widget.prop['modelProb'] as num).toDouble();
    final impliedProb = (widget.prop['impliedProb'] as num).toDouble();
    final side = widget.prop['side'] as String;
    final odds = (widget.prop['odds'] as num).toDouble();
    final kelly = (widget.prop['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample = widget.prop['lowSample'] == true;
    final inefficientMarket = widget.prop['inefficientMarket'] == true;
    final lowMarginRatio = widget.prop['lowMarginRatio'] == true;
    final contextGames = widget.prop['contextGames'] as int? ?? 0;
    final valorKelly = _banca > 0 ? _banca * kelly / 100 : 0.0;
    final commenceTime =
        _formatCommenceTime(widget.prop['commence_time'] as String?);
    final propKey = widget.prop['prop'] as String;
    final propColor = _propColor(propKey);

    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PlayerDetailScreen(prop: widget.prop),
        ),
      ),
      child: Card(
        color: inefficientMarket
            ? const Color(0xFF1A2A1A)
            : const Color(0xFF1E1E2E),
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: inefficientMarket
              ? const BorderSide(color: Color(0xFF00C853), width: 1)
              : BorderSide.none,
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              widget.prop['player'] as String,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold),
                            ),
                            if (playerTeam != null) ...[
                              const SizedBox(width: 6),
                              Text(
                                '· $playerTeam',
                                style: const TextStyle(
                                    color: Color(0xFF7C4DFF), fontSize: 11),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          widget.prop['game'] as String,
                          style: const TextStyle(
                              color: Color(0xFF888888), fontSize: 12),
                        ),
                        if (commenceTime.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            '🕐 $commenceTime',
                            style: const TextStyle(
                                color: Color(0xFF666688), fontSize: 11),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      if (widget.sportBadge != null) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: _sportBadgeColor(widget.sportBadge!).withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: _sportBadgeColor(widget.sportBadge!).withValues(alpha: 0.6)),
                          ),
                          child: Text(
                            widget.sportBadge!,
                            style: TextStyle(
                                color: _sportBadgeColor(widget.sportBadge!),
                                fontSize: 10,
                                fontWeight: FontWeight.bold),
                          ),
                        ),
                        const SizedBox(height: 4),
                      ],
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: propColor.withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                              color: propColor.withValues(alpha: 0.6),
                              width: 1.5),
                        ),
                        child: Text(
                          _propLabel(propKey),
                          style: TextStyle(
                              color: propColor,
                              fontSize: 13,
                              fontWeight: FontWeight.bold),
                        ),
                      ),
                      if (inefficientMarket) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color:
                                const Color(0xFF00C853).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: const Color(0xFF00C853)
                                    .withValues(alpha: 0.5)),
                          ),
                          child: const Text(
                            '🎯 Mercado ineficiente',
                            style: TextStyle(
                                color: Color(0xFF00C853), fontSize: 10),
                          ),
                        ),
                      ],
                      if (lowSample) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color:
                                const Color(0xFFFF6D00).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: const Color(0xFFFF6D00)
                                    .withValues(alpha: 0.5)),
                          ),
                          child: Text(
                            '⚠️ Poucos jogos ($contextGames)',
                            style: const TextStyle(
                                color: Color(0xFFFF6D00), fontSize: 10),
                          ),
                        ),
                      ],
                      if (lowMarginRatio) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color:
                                const Color(0xFFFF4081).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(
                                color: const Color(0xFFFF4081)
                                    .withValues(alpha: 0.5)),
                          ),
                          child: const Text(
                            '📐 MARGIN RATIO BAIXA',
                            style: TextStyle(
                                color: Color(0xFFFF4081), fontSize: 10),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _statBox('Linha', line.toString()),
                  const SizedBox(width: 4),
                  _statBox('Média',
                      '${avg.toStringAsFixed(1)}±${std.toStringAsFixed(1)}'),
                  const SizedBox(width: 4),
                  _statBox('Modelo', '${modelProb.toStringAsFixed(1)}%'),
                  const SizedBox(width: 4),
                  _statBox('Mercado', '${impliedProb.toStringAsFixed(1)}%'),
                  const SizedBox(width: 4),
                  _statBox('Últ. 10',
                      avg10 != null ? avg10.toStringAsFixed(1) : '-'),
                  const SizedBox(width: 4),
                  _statBox(
                      'Últ. 5', avg5 != null ? avg5.toStringAsFixed(1) : '-'),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: _edgeColor(edge).withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: _edgeColor(edge), width: 1),
                      ),
                      child: Row(
                        children: [
                          Text(
                            '$side $line · Edge: ${edge.toStringAsFixed(2)}%',
                            style: TextStyle(
                                color: _edgeColor(edge),
                                fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '@${odds.toStringAsFixed(2)}',
                            style: TextStyle(
                                color: _edgeColor(edge).withValues(alpha: 0.8),
                                fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: const Color(0xFF2A2A3E),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.chevron_right,
                        color: Color(0xFFAAAAAA), size: 22),
                  ),
                ],
              ),
              if (kelly > 0) ...[
                const SizedBox(height: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7C4DFF).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                        color: const Color(0xFF7C4DFF).withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    children: [
                      Text(
                        'Kelly: ${kelly.toStringAsFixed(2)}%',
                        style: const TextStyle(
                            color: Color(0xFF7C4DFF),
                            fontWeight: FontWeight.bold,
                            fontSize: 13),
                      ),
                      if (_banca > 0) ...[
                        const SizedBox(width: 8),
                        Text(
                          '· R\$ ${valorKelly.toStringAsFixed(2)}',
                          style: const TextStyle(
                              color: Color(0xFF9E7DFF), fontSize: 13),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _statBox(String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: const BoxDecoration(
          color: Color(0xFF2A2A3E),
          borderRadius: BorderRadius.all(Radius.circular(8)),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(color: Color(0xFF888888), fontSize: 10)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
