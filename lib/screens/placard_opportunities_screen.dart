import 'dart:async';
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/prefs_service.dart';

class PlacardOpportunitiesScreen extends StatefulWidget {
  const PlacardOpportunitiesScreen({super.key});
  @override
  State<PlacardOpportunitiesScreen> createState() =>
      _PlacardOpportunitiesScreenState();
}

class _PlacardOpportunitiesScreenState
    extends State<PlacardOpportunitiesScreen> {
  Map<String, dynamic> _data = {};
  bool _loading = false;
  String? _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ApiService.fetchPlacardOpportunities();
      if (mounted) setState(() => _data = result);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _number(dynamic value, [int decimals = 2]) =>
      value is num ? value.toStringAsFixed(decimals) : '—';

  Widget _text(String text, {Color color = Colors.white}) =>
      Text(text, style: TextStyle(color: color));

  Widget _opportunity(Map<String, dynamic> row) {
    final now = DateTime.now();
    final observed =
        DateTime.tryParse(row['placardObservedAt'] as String? ?? '');
    final age = observed == null ? null : now.difference(observed).inSeconds;
    final stale = age == null || age < 0 || age > 120;
    final ageText = age == null
        ? 'desconhecida'
        : age < 60
            ? '${age}s'
            : age < 3600
                ? '${age ~/ 60}min'
                : '${age ~/ 3600}h ${(age % 3600) ~/ 60}min';
    final side = row['selection'] == 'Over'
        ? 'Mais'
        : row['selection'] == 'Under'
            ? 'Menos'
            : row['selection'] == 'Draw'
                ? 'Empate'
                : row['selection'];
    final market = row['market'] == 'h2h'
        ? 'Vencedor: $side'
        : row['market'] == 'spreads'
            ? 'Handicap: $side ${row['line']}'
            : 'Total: $side ${row['line']}';
    final stake = (row['kellyPct'] as num? ?? 0).toDouble();
    final amount = PrefsService.getBanca() * stake / 100;
    return Card(
      color: const Color(0xFF1E1E2E),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _text(row['game'] as String? ?? ''),
          const SizedBox(height: 6),
          _text('${row['competition']} · $market',
              color: const Color(0xFFBBBBCC)),
          const SizedBox(height: 8),
          _text(
              'Placard ${_number(row['placardOdds'])} · Mínima ${_number(row['minValueOdds'], 3)}'),
          _text(
              'Vantagem ${_number(row['edgePct'])}% · Kelly 25%: ${_number(stake)}% da banca (€ ${amount.toStringAsFixed(2)})'),
          if (row['probabilityBasis'] == 'condicional_sem_devolucao')
            _text('Linha inteira: vantagem condicional a não haver devolução.',
                color: const Color(0xFFBBBBCC)),
          const SizedBox(height: 8),
          _text(
              'Idade da leitura: $ageText${stale ? ' · Preço antigo: reconfirme' : ''}',
              color: stale ? const Color(0xFFFFB74D) : const Color(0xFF81C784)),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final rows = (_data['rows'] as List? ?? [])
        .cast<Map<String, dynamic>>()
        .where((r) =>
            DateTime.tryParse(r['commenceTime'] as String? ?? '')
                ?.isAfter(now) ??
            false)
        .toList()
      ..sort((a, b) =>
          (a['commenceTime'] as String).compareTo(b['commenceTime'] as String));
    final report = _data['report'] as Map<String, dynamic>? ?? {};
    final budget = _data['budget'] as Map<String, dynamic>? ?? {};
    final errors = _data['errors'] as List? ?? [];
    final captured = report['captured'] as num? ?? 0;
    final missing = report['missing'] as num? ?? 0;
    final captureRate = report['captureRate'] as num?;
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        foregroundColor: Colors.white,
        title: const Text('Placard × Pinnacle'),
        actions: [
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh))
        ],
      ),
      body: Column(children: [
        if (_loading) const LinearProgressIndicator(),
        Expanded(
            child: RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_error != null)
                      _text(_error!, color: const Color(0xFFFFB74D)),
                    _text(
                        'CLV acumulado · ${report['verdict'] ?? 'não confirmado'}'),
                    const SizedBox(height: 6),
                    _text(
                        'n = ${report['n'] ?? 0} · ${report['nEvents'] ?? 0} jogos · CLV médio ${_number(report['mean'])}%'),
                    _text(
                        'IC95%: ${_number(report['lower'])}% a ${_number(report['upper'])}%'),
                    _text(
                        'Fechamentos capturados: $captured/${captured + missing} · taxa ${captureRate == null ? '—' : '${(captureRate * 100).toStringAsFixed(1)}%'} · pendentes: ${report['pending'] ?? 0}',
                        color: const Color(0xFFBBBBCC)),
                    const SizedBox(height: 8),
                    _text(
                        'Confirmado quando n ≥ 100 e limite inferior do IC95% > 0. O IC considera a correlação entre mercados do mesmo jogo.',
                        color: const Color(0xFFBBBBCC)),
                    _text(
                        'Fechamento: última cotação pré-jogo capturada nos 5 minutos finais, sem margem e na mesma linha.',
                        color: const Color(0xFFBBBBCC)),
                    const SizedBox(height: 12),
                    _text(
                        'Placard a cada 30min · Pinnacle por gatilho · próximas 12h · créditos reservados: ${budget['reserved'] ?? 0}/${budget['limit'] ?? 4000}'),
                    if (errors.isNotEmpty)
                      _text(
                          'Coleta incompleta em ${errors.length} competição(ões).',
                          color: const Color(0xFFFFB74D)),
                    const SizedBox(height: 16),
                    _text('Oportunidades na última leitura (${rows.length})'),
                    const SizedBox(height: 8),
                    if (rows.isEmpty && !_loading)
                      _text('Sem oportunidades disponíveis na última leitura.',
                          color: const Color(0xFFBBBBCC)),
                    ...rows.map(_opportunity),
                  ],
                ))),
      ]),
    );
  }
}
