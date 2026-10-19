import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/last_updated_bar.dart';

/// Tela "Valor real nas casas que posso usar" — por casa portuguesa, esporte
/// e mercado: % de conferências com odd igual ou acima da mínima de valor,
/// CLV médio contra o fechamento da Pinnacle (só conferências marcadas como
/// aposta feita e já apuradas), IC95% e nº de amostras. Gerado por
/// pipeline/generate_pt_value_report.js a partir de todas as conferências da
/// tela "Conferir odds".
class PtValueReportScreen extends StatefulWidget {
  const PtValueReportScreen({super.key});

  @override
  State<PtValueReportScreen> createState() => _PtValueReportScreenState();
}

class _PtValueReportScreenState extends State<PtValueReportScreen> {
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
      final result = await ApiService.fetchPtValueReport();
      if (!mounted) return;
      setState(() {
        _rows = (result['rows'] as List).cast<Map<String, dynamic>>();
        _generatedAt = result['generatedAt'] as DateTime?;
      });
    } catch (e) {
      if (!mounted) return;
      final message = e.toString().replaceFirst('Exception: ', '');
      setState(() => _error = 'Falha ao carregar relatório: $message');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, List<Map<String, dynamic>>> get _byBookmaker {
    final map = <String, List<Map<String, dynamic>>>{};
    for (final r in _rows) {
      final bm = (r['bookmaker'] as String?) ?? 'desconhecida';
      map.putIfAbsent(bm, () => []).add(r);
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    final byBookmaker = _byBookmaker;
    final bookmakers = byBookmaker.keys.toList()..sort();
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Valor real nas casas',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_loading)
            const LinearProgressIndicator(
                backgroundColor: Color(0xFF1E1E2E), color: Color(0xFF7C4DFF)),
          LastUpdatedBar(lastUpdated: _generatedAt),
          Expanded(
            child: _error != null
                ? Center(
                    child: Text(_error!,
                        style: const TextStyle(color: Color(0xFF888888))))
                : bookmakers.isEmpty && !_loading
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Text(
                            'Ainda não há conferências registradas.\nUse a tela "Conferir odds" pra começar a registrar.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Color(0xFF888888), fontSize: 15),
                          ),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: bookmakers.length,
                        itemBuilder: (_, i) {
                          final bm = bookmakers[i];
                          final rows = byBookmaker[bm]!
                            ..sort((a, b) =>
                                (a['esporte'] as String? ?? '').compareTo(b['esporte'] as String? ?? ''));
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (i > 0) const SizedBox(height: 20),
                              Text(bm,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold)),
                              const SizedBox(height: 10),
                              ...rows.map((r) => _ValueRowCard(row: r)),
                            ],
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

class _ValueRowCard extends StatelessWidget {
  final Map<String, dynamic> row;
  const _ValueRowCard({required this.row});

  @override
  Widget build(BuildContext context) {
    final esporte = row['esporte'] as String? ?? '';
    final market = row['market'] as String? ?? '';
    final nConferencias = (row['nConferencias'] as num?)?.toInt() ?? 0;
    final pctAcimaMinimo = (row['pctAcimaMinimo'] as num?)?.toDouble();
    final clvMedio = (row['clvMedio'] as num?)?.toDouble();
    final icLower = (row['clvIc95Lower'] as num?)?.toDouble();
    final icUpper = (row['clvIc95Upper'] as num?)?.toDouble();
    final nAmostrasClv = (row['nAmostrasClv'] as num?)?.toInt() ?? 0;

    final clvColor = clvMedio == null
        ? const Color(0xFF888888)
        : (clvMedio >= 0 ? const Color(0xFF00C853) : const Color(0xFFFF5252));

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF333344)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$esporte · $market',
              style: const TextStyle(
                  color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          Text(
            '$nConferencias conferência(s) · ${pctAcimaMinimo == null ? '—' : '${pctAcimaMinimo.toStringAsFixed(1)}%'} ≥ odd mínima',
            style: const TextStyle(color: Color(0xFF888888), fontSize: 12),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(Icons.trending_up, color: clvColor, size: 16),
              const SizedBox(width: 6),
              Text(
                clvMedio == null
                    ? 'CLV indisponível (sem apostas apuradas)'
                    : 'CLV médio: ${clvMedio >= 0 ? '+' : ''}${clvMedio.toStringAsFixed(2)}%'
                        '${icLower == null ? '' : ' (IC95% ${icLower.toStringAsFixed(2)}% a ${icUpper!.toStringAsFixed(2)}%)'}'
                        ' · n=$nAmostrasClv',
                style: TextStyle(color: clvColor, fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
