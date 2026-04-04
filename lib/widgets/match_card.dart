import 'package:flutter/material.dart';
import '../services/prefs_service.dart';

class MatchCard extends StatelessWidget {
  final Map<String, dynamic> match;

  const MatchCard({super.key, required this.match});

  Color _edgeColor(double edge) {
    if (edge >= 5) return const Color(0xFF00C853);
    if (edge >= 2) return const Color(0xFFFFD600);
    return const Color(0xFFFF1744);
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
    final parts = (match['match'] as String).split(' x ');
    final p1 = parts[0];
    final p2 = parts.length > 1 ? parts[1] : '';
    final e1 = (match['edge1'] as num).toDouble();
    final e2 = (match['edge2'] as num).toDouble();
    final bestEdge = e1 >= e2 ? e1 : e2;
    final bestPlayer = e1 >= e2 ? p1 : p2;
    final kelly = (match['kelly'] as num?)?.toDouble() ?? 0;
    final banca = PrefsService.getBanca();
    final valorKelly = banca > 0 ? banca * kelly / 100 : 0.0;
    final commenceTime = _formatCommenceTime(match['commence_time'] as String?);

    return Card(
      color: const Color(0xFF1E1E2E),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    match['match'] as String,
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                if (commenceTime.isNotEmpty)
                  Text(
                    commenceTime,
                    style: const TextStyle(
                        color: Color(0xFF888888), fontSize: 11),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                _probCol(p1, (match['modelProb1'] as num).toDouble(),
                    (match['impliedProb1'] as num).toDouble()),
                const SizedBox(width: 12),
                _probCol(p2, (match['modelProb2'] as num).toDouble(),
                    (match['impliedProb2'] as num).toDouble()),
              ],
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: _edgeColor(bestEdge).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: _edgeColor(bestEdge), width: 1),
              ),
              child: Text(
                'Edge: $bestPlayer ${bestEdge.toStringAsFixed(2)}%',
                style: TextStyle(
                    color: _edgeColor(bestEdge), fontWeight: FontWeight.bold),
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

  Widget _probCol(String player, double model, double implied) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(player,
              style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
          const SizedBox(height: 4),
          Text('Modelo: ${model.toStringAsFixed(1)}%',
              style: const TextStyle(color: Colors.white, fontSize: 13)),
          Text('Mercado: ${implied.toStringAsFixed(1)}%',
              style: const TextStyle(color: Color(0xFF888888), fontSize: 12)),
        ],
      ),
    );
  }
}
