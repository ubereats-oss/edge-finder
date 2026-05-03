import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/edge_evaluator_service.dart';

String _fmtN(num value, int decimals) =>
    value.toStringAsFixed(decimals).replaceAll('.', ',');

String _fmtBRL(double value) =>
    'R\$ ${_fmtN(value, 2)}';

class BetPlannerScreen extends StatefulWidget {
  final List<Map<String, dynamic>> props;
  const BetPlannerScreen({super.key, required this.props});

  @override
  State<BetPlannerScreen> createState() => _BetPlannerScreenState();
}

class _BetPlannerScreenState extends State<BetPlannerScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tab;
  final _stakeCtrl = TextEditingController();
  final _profitCtrl = TextEditingController();
  final _guaranteedProfitCtrl = TextEditingController();
  int _maxLosses = 1;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    _stakeCtrl.dispose();
    _profitCtrl.dispose();
    _guaranteedProfitCtrl.dispose();
    super.dispose();
  }

  // Kelly normalizado; fallback para peso igual
  List<double> get _weights {
    final kellys = widget.props
        .map((p) => ((p['kelly'] as num?)?.toDouble() ?? 0).clamp(0.0, 100.0))
        .toList();
    final total = kellys.fold(0.0, (a, b) => a + b);
    if (total <= 0) {
      final eq = 1.0 / widget.props.length;
      return List.filled(widget.props.length, eq);
    }
    return kellys.map((k) => k / total).toList();
  }

  // ev = stake × (prob × odds - 1)
  double _expectedProfit(List<double> bets) {
    double total = 0;
    for (int i = 0; i < bets.length; i++) {
      final odds = (widget.props[i]['odds'] as num?)?.toDouble() ?? 1.91;
      total += bets[i] * (EdgeEvaluatorService.calibratedProb(widget.props[i]) * odds - 1);
    }
    return total;
  }

  // Solução LP exata: stake[i] = C / odds[i]  (Dutch book é o ótimo do LP).
  // Prova: complementary slackness mostra que para todo |S|=K,
  //   profit(S) = C * [(n-K) - Σ(1/odds[i])]  = targetProfit (constante).
  // Portanto qualquer subconjunto com |S|≤K satisfaz profit(S)≥targetProfit.
  List<double> _computeGuaranteedStakesLP({
    required double targetProfit,
    required int maxLosses,
  }) {
    final props = widget.props;
    final n = props.length;

    if (n == 0) throw Exception('Nenhuma aposta disponível.');
    if (maxLosses >= n) throw Exception('Perdas toleradas ($maxLosses) deve ser menor que o nº de apostas ($n).');
    if (targetProfit <= 0) throw Exception('Lucro alvo deve ser positivo.');

    // Sanitiza odds: mínimo 1.01
    final odds = props
        .map((p) => ((p['odds'] as num?)?.toDouble() ?? 1.91).clamp(1.01, 100.0))
        .toList();

    // Denominador = (n - K) - Σ(1/odds[i])
    final sumInv = odds.fold(0.0, (s, o) => s + 1.0 / o);
    final denom = (n - maxLosses) - sumInv;

    if (denom <= 1e-9) {
      throw Exception(
        'Problema infeasível: com $maxLosses perdas e estas odds não é possível garantir lucro positivo.');
    }

    // Solução fechada
    final C = targetProfit / denom;
    final stakes = odds.map((o) => C / o).toList();

    // Validação combinatória completa de TODOS os subconjuntos |S| ≤ maxLosses
    final violations = <String>[];
    _enumSubsets(n, maxLosses, (loseSet) {
      double profit = 0;
      for (int i = 0; i < n; i++) {
        profit += loseSet.contains(i) ? -stakes[i] : stakes[i] * (odds[i] - 1);
      }
      if (profit < targetProfit - 1e-6) {
        violations.add('S=$loseSet → lucro=${profit.toStringAsFixed(4)}');
      }
    });

    if (violations.isNotEmpty) {
      throw Exception('Validação falhou:\n${violations.join('\n')}');
    }

    return stakes;
  }

  // Enumera todos subconjuntos de tamanho 0..k de {0..n-1}
  static void _enumSubsets(int n, int k, void Function(List<int>) callback) {
    void gen(int start, int remaining, List<int> current) {
      callback(List.unmodifiable(current));
      if (remaining == 0) return;
      for (int i = start; i < n; i++) {
        current.add(i);
        gen(i + 1, remaining - 1, current);
        current.removeLast();
      }
    }
    gen(0, k, []);
  }

  List<double> _distributeStake(double total) {
    final w = _weights;
    return w.map((f) => f * total).toList();
  }

  // P = Total × Σ[ w_i × (prob_i × odds_i - 1) ]  →  Total = P / rate
  double _totalForProfit(double targetProfit) {
    final w = _weights;
    double rate = 0;
    for (int i = 0; i < widget.props.length; i++) {
      final odds = (widget.props[i]['odds'] as num?)?.toDouble() ?? 1.91;
      rate += w[i] * (EdgeEvaluatorService.calibratedProb(widget.props[i]) * odds - 1);
    }
    if (rate <= 0) return 0;
    return targetProfit / rate;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF12121F),
        foregroundColor: Colors.white,
        title: const Text('Planejar Aposta',
            style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tab,
          indicatorColor: const Color(0xFF00C853),
          labelColor: Colors.white,
          unselectedLabelColor: const Color(0xFF666666),
          tabs: const [
            Tab(icon: Icon(Icons.attach_money, size: 16), text: 'Valor a apostar'),
            Tab(icon: Icon(Icons.emoji_events_outlined, size: 16), text: 'Valor a ganhar'),
            Tab(icon: Icon(Icons.security, size: 16), text: 'Lucro garantido'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [
          _PlannerTab(
            label: 'Quanto quer apostar no total?',
            hint: 'Ex: 100,00',
            controller: _stakeCtrl,
            props: widget.props,
            weights: _weights,
            computeBets: (val) => _distributeStake(val),
            expectedProfit: _expectedProfit,
          ),
          _PlannerTab(
            label: 'Quanto quer ganhar de lucro?',
            hint: 'Ex: 50,00',
            controller: _profitCtrl,
            props: widget.props,
            weights: _weights,
            computeBets: (val) {
              final total = _totalForProfit(val);
              return _distributeStake(total);
            },
            expectedProfit: _expectedProfit,
          ),
          _GuaranteedTab(
            props: widget.props,
            controller: _guaranteedProfitCtrl,
            maxLosses: _maxLosses,
            onMaxLossesChanged: (v) => setState(() => _maxLosses = v),
            computeStakes: (profit, losses) => _computeGuaranteedStakesLP(
              targetProfit: profit,
              maxLosses: losses,
            ),
          ),
        ],
      ),
    );
  }
}

class _PlannerTab extends StatefulWidget {
  final String label;
  final String hint;
  final TextEditingController controller;
  final List<Map<String, dynamic>> props;
  final List<double> weights;
  final List<double> Function(double) computeBets;
  final double Function(List<double>) expectedProfit;

  const _PlannerTab({
    required this.label,
    required this.hint,
    required this.controller,
    required this.props,
    required this.weights,
    required this.computeBets,
    required this.expectedProfit,
  });

  @override
  State<_PlannerTab> createState() => _PlannerTabState();
}

class _PlannerTabState extends State<_PlannerTab> {
  List<double>? _bets;
  double _totalBet = 0;
  double _expectedProfitVal = 0;

  void _calculate() {
    final raw = widget.controller.text.replaceAll(',', '.').replaceAll('R\$', '').trim();
    final val = double.tryParse(raw);
    if (val == null || val <= 0) return;
    final bets = widget.computeBets(val);
    setState(() {
      _bets = bets;
      _totalBet = bets.fold(0.0, (a, b) => a + b);
      _expectedProfitVal = widget.expectedProfit(bets);
    });
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.label,
              style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 14)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))
                  ],
                  style: const TextStyle(color: Colors.white, fontSize: 18),
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    hintStyle: const TextStyle(color: Color(0xFF444466)),
                    prefixText: 'R\$ ',
                    prefixStyle: const TextStyle(
                        color: Color(0xFF00C853), fontWeight: FontWeight.bold),
                    filled: true,
                    fillColor: const Color(0xFF1E1E2E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(
                          color: Color(0xFF00C853), width: 1.5),
                    ),
                  ),
                  onSubmitted: (_) => _calculate(),
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: _calculate,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00C853),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(
                      horizontal: 20, vertical: 18),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Calcular',
                    style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          if (_bets != null) ...[
            const SizedBox(height: 24),
            // Resumo
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF0D1A0D),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: const Color(0xFF00C853).withValues(alpha: 0.4)),
              ),
              child: Column(
                children: [
                  _SummaryRow('Total apostado', _fmtBRL(_totalBet),
                      const Color(0xFFFFFFFF)),
                  const SizedBox(height: 8),
                  _SummaryRow(
                    'Lucro esperado (75% de acertos)',
                    (_expectedProfitVal >= 0 ? '+' : '') +
                        _fmtBRL(_expectedProfitVal),
                    _expectedProfitVal >= 0
                        ? const Color(0xFF00C853)
                        : const Color(0xFFFF6D00),
                  ),
                  const SizedBox(height: 8),
                  _SummaryRow(
                    'Retorno total esperado',
                    _fmtBRL(_totalBet + _expectedProfitVal),
                    const Color(0xFFFFD600),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.only(left: 4, bottom: 8),
              child: Text(
                '* EV usa probabilidade calibrada: mercado + confiança × (modelo − mercado)',
                style: TextStyle(color: Color(0xFF555577), fontSize: 11),
              ),
            ),
            // Lista de props
            ...List.generate(widget.props.length, (i) {
              final p = widget.props[i];
              final bet = _bets![i];
              final odds =
                  (p['odds'] as num?)?.toDouble() ?? 1.91;
              final potentialWin = bet * (odds - 1);
              final line = (p['line'] as num).toDouble();
              final side = p['side'] as String;
              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFF1A1A2E),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                      color: const Color(0xFF2A2A44), width: 1),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(
                        color: const Color(0xFF00C853).withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: Text('${i + 1}',
                          style: const TextStyle(
                              color: Color(0xFF00C853),
                              fontWeight: FontWeight.bold,
                              fontSize: 12)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            p['player'] as String? ?? '',
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 13),
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '${p['prop'] ?? ''} ${side == 'Over' ? '↑' : '↓'} ${_fmtN(line, 1)} · odd ${_fmtN(odds, 3)}',
                            style: const TextStyle(
                                color: Color(0xFF888888), fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(_fmtBRL(bet),
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 14)),
                        Text('→ ${_fmtBRL(potentialWin)}',
                            style: const TextStyle(
                                color: Color(0xFF00C853), fontSize: 11)),
                      ],
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}

class _GuaranteedTab extends StatefulWidget {
  final List<Map<String, dynamic>> props;
  final TextEditingController controller;
  final int maxLosses;
  final ValueChanged<int> onMaxLossesChanged;
  final List<double> Function(double, int) computeStakes;

  const _GuaranteedTab({
    required this.props,
    required this.controller,
    required this.maxLosses,
    required this.onMaxLossesChanged,
    required this.computeStakes,
  });

  @override
  State<_GuaranteedTab> createState() => _GuaranteedTabState();
}

class _GuaranteedTabState extends State<_GuaranteedTab> {
  List<double>? _stakes;
  double _totalStake = 0;
  String? _error;

  void _calculate() {
    final raw = widget.controller.text.replaceAll(',', '.').replaceAll('R\$', '').trim();
    final profit = double.tryParse(raw);
    if (profit == null || profit <= 0) return;
    try {
      final stakes = widget.computeStakes(profit, widget.maxLosses);
      setState(() {
        _stakes = stakes;
        _totalStake = stakes.fold(0.0, (a, b) => a + b);
        _error = null;
      });
    } catch (e) {
      setState(() {
        _stakes = null;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.props.length;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Lucro mínimo garantido (R\$)',
              style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 14)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
                  style: const TextStyle(color: Colors.white, fontSize: 18),
                  decoration: InputDecoration(
                    hintText: 'Ex: 50,00',
                    hintStyle: const TextStyle(color: Color(0xFF444466)),
                    prefixText: 'R\$ ',
                    prefixStyle: const TextStyle(color: Color(0xFF00C853), fontWeight: FontWeight.bold),
                    filled: true,
                    fillColor: const Color(0xFF1E1E2E),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF00C853), width: 1.5)),
                  ),
                  onSubmitted: (_) => _calculate(),
                ),
              ),
              const SizedBox(width: 12),
              ElevatedButton(
                onPressed: _calculate,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00C853),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('Calcular', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 20),
          // Slider de máximo de perdas
          Row(
            children: [
              const Text('Perdas toleradas:', style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 13)),
              const SizedBox(width: 12),
              Expanded(
                child: Slider(
                  value: widget.maxLosses.toDouble(),
                  min: 1,
                  max: (n - 1).toDouble().clamp(1, 10),
                  divisions: (n - 2).clamp(1, 9),
                  activeColor: const Color(0xFF00C853),
                  inactiveColor: const Color(0xFF2A2A44),
                  onChanged: (v) => widget.onMaxLossesChanged(v.round()),
                ),
              ),
              Container(
                width: 32,
                alignment: Alignment.center,
                child: Text('${widget.maxLosses}',
                    style: const TextStyle(color: Color(0xFF00C853), fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.only(left: 4, bottom: 16),
            child: Text('O lucro é garantido mesmo que até K apostas percam',
                style: TextStyle(color: Color(0xFF555577), fontSize: 11)),
          ),
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(14),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: const Color(0xFF2A0000),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: const Color(0xFFFF6D00).withValues(alpha: 0.5)),
              ),
              child: Text(_error!,
                  style: const TextStyle(color: Color(0xFFFF6D00), fontSize: 13)),
            ),
          if (_stakes != null) ...[
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF0D1A0D),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF00C853).withValues(alpha: 0.4)),
              ),
              child: Column(
                children: [
                  _SummaryRow('Total apostado', _fmtBRL(_totalStake), Colors.white),
                  const SizedBox(height: 8),
                  _SummaryRow('Lucro garantido (mín.)', _fmtBRL(double.tryParse(widget.controller.text.replaceAll(',', '.')) ?? 0), const Color(0xFF00C853)),
                  const SizedBox(height: 8),
                  _SummaryRow('Perdas toleradas', '${widget.maxLosses} de ${widget.props.length}', const Color(0xFFFFD600)),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const Padding(
              padding: EdgeInsets.only(left: 4, bottom: 12),
              child: Text('* Stakes calculados pelo método Dutch book iterativo (1/odds)',
                  style: TextStyle(color: Color(0xFF555577), fontSize: 11)),
            ),
            ...List.generate(widget.props.length, (i) {
              final p = widget.props[i];
              final stake = _stakes![i];
              final odds = (p['odds'] as num?)?.toDouble() ?? 1.91;
              final potentialWin = stake * (odds - 1);
              final line = (p['line'] as num).toDouble();
              final side = p['side'] as String;
              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFF1A1A2E),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF2A2A44)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 26, height: 26,
                      decoration: BoxDecoration(color: const Color(0xFF00C853).withValues(alpha: 0.15), shape: BoxShape.circle),
                      alignment: Alignment.center,
                      child: Text('${i + 1}', style: const TextStyle(color: Color(0xFF00C853), fontWeight: FontWeight.bold, fontSize: 12)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p['player'] as String? ?? '', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13), overflow: TextOverflow.ellipsis),
                          Text('${p['prop'] ?? ''} ${side == 'Over' ? '↑' : '↓'} ${_fmtN(line, 1)} · odd ${_fmtN(odds, 3)}',
                              style: const TextStyle(color: Color(0xFF888888), fontSize: 11)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(_fmtBRL(stake), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                        Text('→ ${_fmtBRL(potentialWin)}', style: const TextStyle(color: Color(0xFF00C853), fontSize: 11)),
                      ],
                    ),
                  ],
                ),
              );
            }),
          ],
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  const _SummaryRow(this.label, this.value, this.valueColor);

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style:
                const TextStyle(color: Color(0xFF888888), fontSize: 13)),
        Text(value,
            style: TextStyle(
                color: valueColor,
                fontWeight: FontWeight.bold,
                fontSize: 14)),
      ],
    );
  }
}
