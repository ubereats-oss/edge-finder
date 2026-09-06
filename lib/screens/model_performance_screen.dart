import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/last_updated_bar.dart';

/// Tela de desempenho do modelo — mostra o relatório periódico (histórico
/// central de indicações) sincronizado do Firestore: taxa de acerto real x
/// prevista, ROI, CLV e estado de calibração por esporte/mercado/faixa de
/// edge.
class ModelPerformanceScreen extends StatefulWidget {
  const ModelPerformanceScreen({super.key});

  @override
  State<ModelPerformanceScreen> createState() =>
      _ModelPerformanceScreenState();
}

class _ModelPerformanceScreenState extends State<ModelPerformanceScreen> {
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _rows = [];
  DateTime? _generatedAt;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ApiService.fetchModelReport();
      setState(() {
        _rows = result.rows;
        _generatedAt = result.generatedAt;
      });
    } catch (e) {
      setState(() => _error = 'Falha ao carregar o relatório. Verifique sua conexão e tente novamente.');
    } finally {
      setState(() => _loading = false);
    }
  }

  Map<String, List<Map<String, dynamic>>> get _bySport {
    final map = <String, List<Map<String, dynamic>>>{};
    for (final r in _rows) {
      final esporte = (r['esporte'] as String?) ?? 'desconhecido';
      map.putIfAbsent(esporte, () => []).add(r);
    }
    for (final list in map.values) {
      list.sort((a, b) {
        final m = ((a['market'] as String?) ?? '').compareTo((b['market'] as String?) ?? '');
        if (m != 0) return m;
        return ((a['edgeBucket'] as String?) ?? '').compareTo((b['edgeBucket'] as String?) ?? '');
      });
    }
    return map;
  }

  static const _sportLabels = {
    'basketball/nba': '🏀 NBA',
    'baseball/mlb': '⚾ MLB',
    'hockey/nhl': '🏒 NHL',
    'americanfootball/nfl': '🏈 NFL',
  };

  @override
  Widget build(BuildContext context) {
    final bySport = _bySport;
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Row(
          children: [
            Icon(Icons.insights, color: Color(0xFF7C4DFF), size: 20),
            SizedBox(width: 8),
            Text('Desempenho do Modelo',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            tooltip: 'Recarregar',
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_loading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E1E2E),
              color: Color(0xFF7C4DFF),
            ),
          LastUpdatedBar(lastUpdated: _generatedAt),
          Expanded(child: _buildBody(bySport)),
        ],
      ),
    );
  }

  Widget _buildBody(Map<String, List<Map<String, dynamic>>> bySport) {
    if (_error != null) {
      return _MessageState(
        icon: Icons.cloud_off,
        message: _error!,
        actionLabel: 'Tentar novamente',
        onAction: _load,
      );
    }
    if (_rows.isEmpty && !_loading) {
      return const _MessageState(
        icon: Icons.hourglass_empty,
        message:
            'Ainda não há relatório disponível.\nO histórico de indicações do modelo ainda está sendo formado — volte em breve.',
      );
    }
    if (_rows.isEmpty) {
      return const SizedBox.shrink();
    }

    final sports = bySport.keys.toList()..sort();
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: sports.length,
      itemBuilder: (_, i) {
        final esporte = sports[i];
        final rows = bySport[esporte]!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (i > 0) const SizedBox(height: 20),
            Text(
              _sportLabels[esporte] ?? esporte,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            ...rows.map((r) => _ReportRowCard(row: r)),
          ],
        );
      },
    );
  }
}

class _MessageState extends StatelessWidget {
  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  const _MessageState({
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: const Color(0xFF555555), size: 48),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF888888), fontSize: 15),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: onAction,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF7C4DFF),
                  side: const BorderSide(color: Color(0xFF7C4DFF)),
                ),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ReportRowCard extends StatelessWidget {
  final Map<String, dynamic> row;
  const _ReportRowCard({required this.row});

  double? _num(String key) => (row[key] as num?)?.toDouble();
  String _fmtPct(String key, {int decimals = 1}) {
    final v = _num(key);
    return v == null ? '—' : '${v.toStringAsFixed(decimals)}%';
  }

  @override
  Widget build(BuildContext context) {
    final market = (row['market'] as String?) ?? '?';
    final edgeBucket = (row['edgeBucket'] as String?) ?? '';
    final segmentState = (row['segmentState'] as String?) ?? 'em_amostra';
    final emAmostra = segmentState == 'em_amostra';
    final nResolvidas = (row['nResolvidasValidas'] as num?)?.toInt() ?? 0;
    final nBinarias = (row['nBinarias'] as num?)?.toInt() ?? 0;
    final clv = _num('clvMedio');
    final clvComOdd = (row['clvComOdd'] as num?)?.toInt() ?? 0;
    final faltam = (row['faltamParaCalibrar'] as num?)?.toInt() ?? 0;

    final clvColor = clv == null
        ? const Color(0xFF888888)
        : (clv >= 0 ? const Color(0xFF00C853) : const Color(0xFFFF5252));

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: emAmostra
              ? const Color(0xFFFFA000).withValues(alpha: 0.6)
              : const Color(0xFF333344),
          width: emAmostra ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '$market · edge $edgeBucket',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              _SegmentBadge(emAmostra: emAmostra, faltam: faltam),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            nResolvidas == 0
                ? 'Sem apostas resolvidas ainda neste segmento'
                : '$nResolvidas apostas resolvidas e válidas ($nBinarias decididas)',
            style: const TextStyle(color: Color(0xFF888888), fontSize: 12),
          ),
          if (nResolvidas > 0) ...[
            const SizedBox(height: 14),
            // CLV em destaque — é o indicador principal.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              decoration: BoxDecoration(
                color: clvColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(Icons.trending_up, color: clvColor, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'CLV médio: ${clv == null ? 'indisponível (sem odd de fechamento)' : '${clv >= 0 ? '+' : ''}${clv.toStringAsFixed(2)}%'}',
                    style: TextStyle(
                      color: clvColor,
                      fontSize: 15,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (clv != null) ...[
                    const Spacer(),
                    Text(
                      '$clvComOdd/$nResolvidas com odd de fechamento',
                      style: const TextStyle(color: Color(0xFF888888), fontSize: 11),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _Stat(label: 'Acerto real', value: _fmtPct('winRateReal'))),
                Expanded(child: _Stat(label: 'Previsto pelo modelo', value: _fmtPct('winRateModelo'))),
                Expanded(child: _Stat(label: 'ROI', value: _fmtPct('roi'))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value,
            style: const TextStyle(
                color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Color(0xFF888888), fontSize: 11)),
      ],
    );
  }
}

class _SegmentBadge extends StatelessWidget {
  final bool emAmostra;
  final int faltam;
  const _SegmentBadge({required this.emAmostra, required this.faltam});

  @override
  Widget build(BuildContext context) {
    final color = emAmostra ? const Color(0xFFFFA000) : const Color(0xFF00C853);
    final label = emAmostra ? 'Em amostra' : 'Calibrado';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(emAmostra ? Icons.science : Icons.verified, color: color, size: 13),
          const SizedBox(width: 4),
          Text(
            emAmostra ? '$label · faltam $faltam' : label,
            style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}
