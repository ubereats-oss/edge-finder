import 'package:flutter/material.dart';
import '../services/prefs_service.dart';

class MlbPropCard extends StatelessWidget {
  final Map<String, dynamic> prop;

  const MlbPropCard({super.key, required this.prop});

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

  @override
  Widget build(BuildContext context) {
    final edge = (prop['edge'] as num).toDouble();
    final avg = (prop['playerAvg'] as num).toDouble();
    final std = (prop['playerStd'] as num).toDouble();
    final line = (prop['line'] as num).toDouble();
    final modelProb = (prop['modelProb'] as num).toDouble();
    final impliedProb = (prop['impliedProb'] as num).toDouble();
    final side = prop['side'] as String;
    final odds = (prop['odds'] as num).toDouble();
    final isPitcher = prop['isPitcher'] == true;
    final kelly = (prop['kelly'] as num?)?.toDouble() ?? 0;
    final lowSample = prop['lowSample'] == true;
    final inefficientMarket = prop['inefficientMarket'] == true;
    final banca = PrefsService.getBanca();
    final valorKelly = banca > 0 ? banca * kelly / 100 : 0.0;

    return Card(
      color:
          inefficientMarket ? const Color(0xFF1A2A1A) : const Color(0xFF1E1E2E),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: inefficientMarket
            ? const BorderSide(color: Color(0xFF00C853), width: 1)
            : BorderSide.none,
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
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
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    prop['player'] as String,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A2A3E),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        _propLabel(prop['prop'] as String),
                        style: const TextStyle(
                            color: Color(0xFFAAAAAA), fontSize: 11),
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
                          style:
                              TextStyle(color: Color(0xFF00C853), fontSize: 10),
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
                        child: const Text(
                          '⚠️ Poucos jogos',
                          style:
                              TextStyle(color: Color(0xFFFF6D00), fontSize: 10),
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
                const SizedBox(width: 6),
                _statBox('Média',
                    '${avg.toStringAsFixed(2)}±${std.toStringAsFixed(2)}'),
                const SizedBox(width: 6),
                _statBox('Modelo', '${modelProb.toStringAsFixed(1)}%'),
                const SizedBox(width: 6),
                _statBox('Mercado', '${impliedProb.toStringAsFixed(1)}%'),
              ],
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: _edgeColor(edge).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: _edgeColor(edge), width: 1),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '$side $line · Edge: ${edge.toStringAsFixed(2)}%',
                    style: TextStyle(
                        color: _edgeColor(edge),
                        fontWeight: FontWeight.bold,
                        fontSize: 13),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '@${odds.toStringAsFixed(2)}',
                    style: TextStyle(
                        color: _edgeColor(edge).withValues(alpha: 0.8),
                        fontSize: 12),
                  ),
                ],
              ),
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
                    if (banca > 0) ...[
                      const SizedBox(width: 8),
                      Text(
                        '→ R\$ ${valorKelly.toStringAsFixed(2)}',
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
    );
  }

  Widget _statBox(String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(color: Color(0xFF888888), fontSize: 9)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
