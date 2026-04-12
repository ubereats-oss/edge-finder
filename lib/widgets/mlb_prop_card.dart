import 'package:flutter/material.dart';
import '../services/prefs_service.dart';
import '../screens/player_detail_screen.dart';

class MlbPropCard extends StatefulWidget {
  final Map<String, dynamic> prop;
  const MlbPropCard({super.key, required this.prop});

  @override
  State<MlbPropCard> createState() => _MlbPropCardState();
}

class _MlbPropCardState extends State<MlbPropCard> {
  double _banca = 0;

  @override
  void initState() {
    super.initState();
    _banca = PrefsService.getBanca();
  }

  Color _edgeColor(double edge) {
    if (edge >= 5) return const Color(0xFF00C853);
    if (edge >= 2) return const Color(0xFFFFD600);
    return const Color(0xFFFF1744);
  }

  String _propLabel(String p) {
    const labels = {
      'hits': 'Hits',
      'homeRuns': 'Home Runs',
      'strikeouts': 'Strikeouts',
      'hitsAllowed': 'Hits Allowed',
    };
    return labels[p] ?? p;
  }

  Color _propColor(String p) {
    const colors = {
      'hits': Color(0xFFFFD600),
      'homeRuns': Color(0xFFFF6D00),
      'strikeouts': Color(0xFF7C4DFF),
      'hitsAllowed': Color(0xFF00B0FF),
    };
    return colors[p] ?? const Color(0xFFAAAAAA);
  }

  String _formatCommenceTime(String? raw) {
    if (raw == null) return '';
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    final d = '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}';
    final h = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    return '$d às $h';
  }

  @override
  Widget build(BuildContext context) {
    final edge         = (widget.prop['edge'] as num).toDouble();
    final avg          = (widget.prop['playerAvg'] as num).toDouble();
    final std          = (widget.prop['playerStd'] as num).toDouble();
    final avg5         = (widget.prop['playerAvg5'] as num?)?.toDouble();
    final avg10        = (widget.prop['playerAvg10'] as num?)?.toDouble();
    final playerTeam   = widget.prop['playerTeam'] as String?;
    final line         = (widget.prop['line'] as num).toDouble();
    final modelProb    = (widget.prop['modelProb'] as num).toDouble();
    final impliedProb  = (widget.prop['impliedProb'] as num).toDouble();
    final side         = widget.prop['side'] as String;
    final odds         = (widget.prop['odds'] as num).toDouble();
    final isPitcher    = widget.prop['isPitcher'] == true;
    final kelly        = (widget.prop['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample    = widget.prop['lowSample'] == true;
    final inefficientMarket = widget.prop['inefficientMarket'] == true;
    final contextGames = widget.prop['contextGames'] as int? ?? 0;
    final valorKelly   = _banca > 0 ? _banca * kelly / 100 : 0.0;
    final commenceTime = _formatCommenceTime(widget.prop['commence_time'] as String?);
    final propKey      = widget.prop['prop'] as String;
    final propColor    = _propColor(propKey);

    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PlayerDetailScreen(prop: widget.prop),
        ),
      ),
      child: Card(
        color: inefficientMarket ? const Color(0xFF1A2A1A) : const Color(0xFF1E1E2E),
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
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: isPitcher
                                    ? const Color(0xFF7C4DFF).withValues(alpha: 0.2)
                                    : const Color(0xFF00C853).withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                isPitcher ? 'P' : 'B',
                                style: TextStyle(
                                  color: isPitcher
                                      ? const Color(0xFF7C4DFF)
                                      : const Color(0xFF00C853),
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
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
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: propColor.withValues(alpha: 0.18),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: propColor.withValues(alpha: 0.6), width: 1.5),
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
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFF00C853).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFF00C853).withValues(alpha: 0.5)),
                          ),
                          child: const Text(
                            '🎯 Mercado ineficiente',
                            style: TextStyle(color: Color(0xFF00C853), fontSize: 10),
                          ),
                        ),
                      ],
                      if (lowSample) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFF6D00).withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: const Color(0xFFFF6D00).withValues(alpha: 0.5)),
                          ),
                          child: Text(
                            '⚠️ Poucos jogos ($contextGames)',
                            style: const TextStyle(color: Color(0xFFFF6D00), fontSize: 10),
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
                  _statBox('Média', '${avg.toStringAsFixed(2)}±${std.toStringAsFixed(2)}'),
                  const SizedBox(width: 4),
                  _statBox('Modelo', '${modelProb.toStringAsFixed(1)}%'),
                  const SizedBox(width: 4),
                  _statBox('Mercado', '${impliedProb.toStringAsFixed(1)}%'),
                  const SizedBox(width: 4),
                  _statBox('Últ. 10', avg10 != null ? avg10.toStringAsFixed(2) : '-'),
                  const SizedBox(width: 4),
                  _statBox('Últ. 5', avg5 != null ? avg5.toStringAsFixed(2) : '-'),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
                    decoration: const BoxDecoration(
                      color: Color(0xFF2A2A3E),
                      borderRadius: BorderRadius.all(Radius.circular(8)),
                    ),
                    child: const Icon(Icons.chevron_right,
                        color: Color(0xFFAAAAAA), size: 22),
                  ),
                ],
              ),
              if (kelly > 0) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7C4DFF).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF7C4DFF).withValues(alpha: 0.4)),
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
                          style: const TextStyle(color: Color(0xFF9E7DFF), fontSize: 13),
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
