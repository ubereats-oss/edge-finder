import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/prefs_service.dart';
import 'add_late_bet_screen.dart';

class BetsScreen extends StatefulWidget {
  const BetsScreen({super.key});

  @override
  State<BetsScreen> createState() => _BetsScreenState();
}

class _BetsScreenState extends State<BetsScreen> {
  List<Map<String, dynamic>> _bets = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final bets = await ApiService.fetchBets();
      setState(() => _bets = bets.reversed.toList());
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _resolve(String id) async {
    final bet = _bets.firstWhere((b) => b['id'] == id);
    final isProp = bet['type'] != 'h2h';
    if (isProp) {
      setState(() => _loading = true);
      try {
        final live = await ApiService.fetchLiveStatAndTime(bet);
        setState(() => _loading = false);
        if (!mounted) return;
        if (live['completed'] == true) {
          await ApiService.resolveBet(id);
          await _load();
          return;
        }
        final state = live['state'] as String;
        final timeInfo = live['timeInfo'] as String;
        final realValue = live['realValue'];
        final minutesPlayed = live['minutesPlayed'] as int? ?? 0;
        final propLabel = _propLabel(bet['prop'] as String? ?? '');
        final line = (bet['line'] as num).toDouble();
        final side = bet['side'] as String? ?? 'Over';
        final isWinning = realValue != null &&
            (side == 'Over' ? realValue > line : realValue < line);
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Container(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              decoration: BoxDecoration(
                  color: const Color(0xFFFF6D00),
                  borderRadius: BorderRadius.circular(8)),
              child: const Text('🔴  EM ANDAMENTO',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                      letterSpacing: 1)),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(timeInfo,
                    style: const TextStyle(
                        color: Color(0xFFAAAAAA), fontSize: 14)),
                const SizedBox(height: 16),
                Text(bet['player'] as String? ?? '',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16)),
                const SizedBox(height: 4),
                Text('$side $line $propLabel',
                    style: const TextStyle(
                        color: Color(0xFF888888), fontSize: 13)),
                const SizedBox(height: 16),
                if (realValue != null) ...[
                  Text('Valor atual',
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 12)),
                  const SizedBox(height: 4),
                  Text(realValue.toStringAsFixed(0),
                      style: TextStyle(
                          color: isWinning
                              ? const Color(0xFF00C853)
                              : const Color(0xFFFF1744),
                          fontWeight: FontWeight.bold,
                          fontSize: 40)),
                  const SizedBox(height: 8),
                  Text(isWinning ? '✅ Ganhando' : '❌ Perdendo',
                      style: TextStyle(
                          color: isWinning
                              ? const Color(0xFF00C853)
                              : const Color(0xFFFF1744),
                          fontWeight: FontWeight.bold,
                          fontSize: 15)),
                  const SizedBox(height: 12),
                  Text('⏱ Tempo em quadra: ${minutesPlayed}min',
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 13)),
                ] else
                  const Text('Stat não disponível ainda',
                      style: TextStyle(color: Color(0xFF888888))),
              ],
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar',
                      style: TextStyle(color: Color(0xFF888888)))),
              if (state == 'post')
                ElevatedButton(
                  onPressed: () async {
                    Navigator.pop(ctx);
                    setState(() => _loading = true);
                    await ApiService.resolveBet(id);
                    await _load();
                  },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF00C853)),
                  child: const Text('Resolver',
                      style: TextStyle(
                          color: Colors.white, fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        );
      } catch (e) {
        setState(() => _loading = false);
        final msg = e.toString();
        final isNotFound =
            msg.contains('não encontrado') || msg.contains('not found');
        if (!mounted) return;
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: const Text('⏳ Jogo não iniciado',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18)),
            content: Text(
              isNotFound
                  ? 'O jogo não foi encontrado na ESPN.\n\nProvavelmente ainda não começou ou os dados ainda não estão disponíveis.'
                  : msg,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 14),
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar',
                      style: TextStyle(color: Color(0xFF888888)))),
            ],
          ),
        );
      }
      return;
    }
    setState(() => _loading = true);
    try {
      await ApiService.resolveBet(id);
      await _load();
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _delete(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title:
            const Text('Remover aposta', style: TextStyle(color: Colors.white)),
        content: const Text('Tem certeza que deseja remover esta aposta?',
            style: TextStyle(color: Color(0xFFAAAAAA))),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar',
                style: TextStyle(color: Color(0xFF888888))),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF1744)),
            child: const Text('Remover', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirm == true) {
      await ApiService.deleteBet(id);
      await _load();
    }
  }

  Future<void> _edit(Map<String, dynamic> bet) async {
    final isProp = bet['type'] != 'h2h';
    final stakeController = TextEditingController(
      text: (bet['stake'] as num).toStringAsFixed(2),
    );
    final oddsController = TextEditingController(
      text: (bet['odds'] as num).toStringAsFixed(2),
    );
    final modelProbController = TextEditingController(
      text: (bet['modelProb'] as num?) != null && (bet['modelProb'] as num) > 0
          ? (bet['modelProb'] as num).toStringAsFixed(1)
          : '',
    );
    String selectedSide = (bet['side'] as String?) ?? 'Over';

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2E),
          title: const Text('Editar aposta',
              style: TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isProp) ...[
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text('Lado',
                        style:
                            TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: ['Over', 'Under'].map((side) {
                      final isSelected = selectedSide == side;
                      return Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => selectedSide = side),
                          child: Container(
                            margin:
                                EdgeInsets.only(right: side == 'Over' ? 6 : 0),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? const Color(0xFF00C853)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: isSelected
                                    ? const Color(0xFF00C853)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Center(
                              child: Text(side,
                                  style: TextStyle(
                                      color: isSelected
                                          ? const Color(0xFF00C853)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                ],
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Probabilidade do modelo (%)',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: modelProbController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                    hintText: '0.0',
                    hintStyle: const TextStyle(color: Color(0xFF555566)),
                    suffixText: '%',
                    suffixStyle: const TextStyle(color: Color(0xFF888888)),
                  ),
                ),
                const SizedBox(height: 12),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Odd',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: oddsController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Valor apostado (R\$)',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: stakeController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                    prefixText: 'R\$ ',
                    prefixStyle: const TextStyle(color: Color(0xFF888888)),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar',
                  style: TextStyle(color: Color(0xFF888888))),
            ),
            ElevatedButton(
              onPressed: () async {
                final stake =
                    double.tryParse(stakeController.text.replaceAll(',', '.'));
                final odds =
                    double.tryParse(oddsController.text.replaceAll(',', '.'));
                if (stake == null || odds == null) return;
                final modelProb = double.tryParse(
                    modelProbController.text.replaceAll(',', '.'));
                Navigator.pop(ctx);
                await ApiService.updateBet(bet['id'] as String, {
                  'stake': stake,
                  'odds': odds,
                  if (isProp) 'side': selectedSide,
                  if (modelProb != null) 'modelProb': modelProb,
                });
                await _load();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7C4DFF),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('Salvar',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  String _propLabel(String p) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': 'Cestas de 3',
    };
    return labels[p] ?? p;
  }

  String _formatDate(String? raw) {
    if (raw == null) return '';
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  List<Map<String, dynamic>> get _pending =>
      _bets.where((b) => b['status'] == 'pending').toList();
  List<Map<String, dynamic>> get _resolved =>
      _bets.where((b) => b['status'] == 'resolved').toList();

  double get _totalProfit =>
      _resolved.fold(0.0, (s, b) => s + (b['profit'] as num).toDouble());
  int get _wins => _resolved.where((b) => b['won'] == true).length;

  @override
  Widget build(BuildContext context) {
    final banca = PrefsService.getBanca();

    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Minhas Apostas',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.history, color: Color(0xFF00C853)),
            tooltip: 'Aposta atrasada',
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AddLateBetScreen()),
              );
              _load();
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF00C853)))
          : _bets.isEmpty
              ? const Center(
                  child: Text('Nenhuma aposta registrada.',
                      style: TextStyle(color: Color(0xFF666666), fontSize: 15)))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_resolved.isNotEmpty) ...[
                      _SummaryCard(
                        total: _resolved.length,
                        wins: _wins,
                        profit: _totalProfit,
                        banca: banca,
                      ),
                      const SizedBox(height: 16),
                    ],
                    if (_pending.isNotEmpty) ...[
                      const _SectionLabel(text: 'PENDENTES'),
                      const SizedBox(height: 8),
                      ..._pending.map((b) => _BetCard(
                            bet: b,
                            propLabel: _propLabel,
                            formatDate: _formatDate,
                            onResolve: () => _resolve(b['id'] as String),
                            onEdit: () => _edit(b),
                            onDelete: () => _delete(b['id'] as String),
                          )),
                      const SizedBox(height: 16),
                    ],
                    if (_resolved.isNotEmpty) ...[
                      const _SectionLabel(text: 'RESOLVIDAS'),
                      const SizedBox(height: 8),
                      ..._resolved.map((b) => _BetCard(
                            bet: b,
                            propLabel: _propLabel,
                            formatDate: _formatDate,
                            onResolve: null,
                            onEdit: () => _edit(b),
                            onDelete: () => _delete(b['id'] as String),
                          )),
                    ],
                  ],
                ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel({required this.text});

  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: const TextStyle(
            color: Color(0xFF888888),
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1));
  }
}

class _SummaryCard extends StatelessWidget {
  final int total;
  final int wins;
  final double profit;
  final double banca;

  const _SummaryCard({
    required this.total,
    required this.wins,
    required this.profit,
    required this.banca,
  });

  @override
  Widget build(BuildContext context) {
    final winRate = total > 0 ? (wins / total * 100) : 0.0;
    final profitColor =
        profit >= 0 ? const Color(0xFF00C853) : const Color(0xFFFF1744);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF333355)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('RESUMO',
              style: TextStyle(
                  color: Color(0xFF888888),
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1)),
          const SizedBox(height: 12),
          Row(
            children: [
              _MiniStat(label: 'Apostas', value: total.toString()),
              _MiniStat(
                  label: 'Acertos', value: '${winRate.toStringAsFixed(1)}%'),
              _MiniStat(
                label: 'Lucro',
                value:
                    '${profit >= 0 ? '+' : ''}R\$ ${profit.toStringAsFixed(2)}',
                color: profitColor,
              ),
              if (banca > 0)
                _MiniStat(
                  label: 'ROI',
                  value: '${(profit / banca * 100).toStringAsFixed(1)}%',
                  color: profitColor,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _MiniStat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(label,
              style: const TextStyle(color: Color(0xFF888888), fontSize: 10)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                  color: color ?? Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _BetCard extends StatefulWidget {
  final Map<String, dynamic> bet;
  final String Function(String) propLabel;
  final String Function(String?) formatDate;
  final VoidCallback? onResolve;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _BetCard({
    required this.bet,
    required this.propLabel,
    required this.formatDate,
    required this.onResolve,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<_BetCard> createState() => _BetCardState();
}

class _BetCardState extends State<_BetCard> {
  bool _showAnalysis = false;

  Map<String, dynamic> _analyze() {
    final bet = widget.bet;
    final modelProb = (bet['modelProb'] as num?)?.toDouble() ?? 0;
    final odds = (bet['odds'] as num).toDouble();
    final stake = (bet['stake'] as num).toDouble();
    final won = bet['won'] as bool;
    final profit = (bet['profit'] as num).toDouble();

    final impliedProb =
        modelProb > 0 && ((bet['impliedProb'] as num?)?.toDouble() ?? 0) == 0
            ? (1 / odds * 100)
            : (bet['impliedProb'] as num?)?.toDouble() ?? 0;
    final edge = modelProb > 0 && ((bet['edge'] as num?)?.toDouble() ?? 0) == 0
        ? modelProb - (1 / odds * 100)
        : (bet['edge'] as num?)?.toDouble() ?? 0;

    final ev = modelProb > 0
        ? (modelProb / 100) * (odds - 1) * stake - (1 - modelProb / 100) * stake
        : null;
    final evRealizado = profit;

    String veredito;
    String descricao;
    Color cor;

    if (modelProb == 0) {
      veredito = 'Sem dados do modelo';
      descricao = 'Informe a probabilidade do modelo para análise completa.';
      cor = const Color(0xFF888888);
    } else if (won && edge > 0) {
      veredito = '✅ Acerto esperado';
      descricao =
          'O modelo identificou edge real e a aposta ganhou. Resultado dentro do esperado.';
      cor = const Color(0xFF00C853);
    } else if (won && edge <= 0) {
      veredito = '🍀 Acerto por sorte';
      descricao =
          'A aposta ganhou mas o modelo não identificava vantagem. Pode ser variância favorável.';
      cor = const Color(0xFFFFD600);
    } else if (!won && edge > 0) {
      veredito = '📉 Perda com edge positivo';
      descricao =
          'O modelo identificava vantagem mas a aposta perdeu. Variância desfavorável — o processo estava correto.';
      cor = const Color(0xFFFF6D00);
    } else {
      veredito = '❌ Perda esperada';
      descricao =
          'O modelo não identificava vantagem e a aposta perdeu. Resultado consistente com a predição.';
      cor = const Color(0xFFFF1744);
    }

    return {
      'veredito': veredito,
      'descricao': descricao,
      'cor': cor,
      'ev': ev,
      'evRealizado': evRealizado,
      'modelProb': modelProb,
      'impliedProb': impliedProb,
      'edge': edge,
    };
  }

  @override
  Widget build(BuildContext context) {
    final bet = widget.bet;
    final isPending = bet['status'] == 'pending';
    final won = bet['won'] as bool?;
    final profit = (bet['profit'] as num?)?.toDouble();
    final realValue = bet['realValue'];
    final edge = (bet['edge'] as num).toDouble();
    final isH2h = bet['type'] == 'h2h';
    final edgeColor = edge >= 5
        ? const Color(0xFF00C853)
        : edge >= 2
            ? const Color(0xFFFFD600)
            : const Color(0xFFFF1744);

    Color borderColor = const Color(0xFF333355);
    if (!isPending) {
      borderColor =
          won == true ? const Color(0xFF00C853) : const Color(0xFFFF1744);
    }

    final title = isH2h
        ? (bet['team'] as String? ?? bet['game'] as String)
        : (bet['player'] as String? ?? '');

    final subtitle = isH2h
        ? 'Vitória · ${bet['game']}'
        : '${bet['side']} ${bet['line']} ${widget.propLabel(bet['prop'] as String? ?? '')}';

    final analysis = !isPending ? _analyze() : null;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: const TextStyle(
                            color: Color(0xFF888888), fontSize: 12)),
                    if (bet['game'] != null)
                      Text(bet['game'] as String,
                          style: const TextStyle(
                              color: Color(0xFF555577), fontSize: 11)),
                    Text(widget.formatDate(bet['commence_time'] as String?),
                        style: const TextStyle(
                            color: Color(0xFF666688), fontSize: 11)),
                    if (bet['bookmaker'] != null)
                      Text(bet['bookmaker'] as String,
                          style: const TextStyle(
                              color: Color(0xFF7C4DFF), fontSize: 11)),
                  ],
                ),
              ),
              if (!isPending)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: (won == true
                            ? const Color(0xFF00C853)
                            : const Color(0xFFFF1744))
                        .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    won == true ? '✅ GANHOU' : '❌ PERDEU',
                    style: TextStyle(
                        color: won == true
                            ? const Color(0xFF00C853)
                            : const Color(0xFFFF1744),
                        fontWeight: FontWeight.bold,
                        fontSize: 12),
                  ),
                )
              else
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFD600).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('⏳ Pendente',
                      style: TextStyle(
                          color: Color(0xFFFFD600),
                          fontSize: 12,
                          fontWeight: FontWeight.bold)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                  '@${(bet['odds'] as num).toStringAsFixed(2)}  ·  R\$ ${(bet['stake'] as num).toStringAsFixed(2)}',
                  style:
                      const TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
              if (edge != 0) ...[
                const SizedBox(width: 8),
                Text('Edge: ${edge.toStringAsFixed(1)}%',
                    style: TextStyle(color: edgeColor, fontSize: 11)),
              ],
            ],
          ),
          if (!isPending) ...[
            const SizedBox(height: 6),
            Text(
              'Real: $realValue  ·  ${profit != null && profit >= 0 ? '+' : ''}R\$ ${profit?.toStringAsFixed(2) ?? '-'}',
              style: TextStyle(
                  color: won == true
                      ? const Color(0xFF00C853)
                      : const Color(0xFFFF1744),
                  fontWeight: FontWeight.bold,
                  fontSize: 13),
            ),
          ],
          if (!isPending && analysis != null) ...[
            const SizedBox(height: 8),
            GestureDetector(
              onTap: () => setState(() => _showAnalysis = !_showAnalysis),
              child: Row(
                children: [
                  Icon(
                    _showAnalysis ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFF888888),
                    size: 16,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _showAnalysis ? 'Ocultar análise' : 'Ver análise',
                    style:
                        const TextStyle(color: Color(0xFF888888), fontSize: 12),
                  ),
                ],
              ),
            ),
            if (_showAnalysis) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: (analysis['cor'] as Color).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: (analysis['cor'] as Color).withValues(alpha: 0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(analysis['veredito'] as String,
                        style: TextStyle(
                            color: analysis['cor'] as Color,
                            fontWeight: FontWeight.bold,
                            fontSize: 13)),
                    const SizedBox(height: 6),
                    Text(analysis['descricao'] as String,
                        style: const TextStyle(
                            color: Color(0xFFAAAAAA), fontSize: 12)),
                    if ((analysis['modelProb'] as double) > 0) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          _AnalysisStat(
                            label: 'Prob. modelo',
                            value:
                                '${(analysis['modelProb'] as double).toStringAsFixed(1)}%',
                          ),
                          _AnalysisStat(
                            label: 'Prob. mercado',
                            value:
                                '${(analysis['impliedProb'] as double).toStringAsFixed(1)}%',
                          ),
                          _AnalysisStat(
                            label: 'EV esperado',
                            value: analysis['ev'] != null
                                ? '${(analysis['ev'] as double) >= 0 ? '+' : ''}R\$ ${(analysis['ev'] as double).toStringAsFixed(2)}'
                                : '-',
                          ),
                          _AnalysisStat(
                            label: 'EV realizado',
                            value:
                                '${(analysis['evRealizado'] as double) >= 0 ? '+' : ''}R\$ ${(analysis['evRealizado'] as double).toStringAsFixed(2)}',
                            color: (analysis['evRealizado'] as double) >= 0
                                ? const Color(0xFF00C853)
                                : const Color(0xFFFF1744),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (isPending && widget.onResolve != null)
                TextButton.icon(
                  onPressed: widget.onResolve,
                  icon: const Icon(Icons.sports_score,
                      color: Color(0xFF00C853), size: 16),
                  label: const Text('Buscar resultado',
                      style: TextStyle(color: Color(0xFF00C853), fontSize: 12)),
                ),
              TextButton.icon(
                onPressed: widget.onEdit,
                icon: const Icon(Icons.edit_outlined,
                    color: Color(0xFF7C4DFF), size: 16),
                label: const Text('Editar',
                    style: TextStyle(color: Color(0xFF7C4DFF), fontSize: 12)),
              ),
              TextButton.icon(
                onPressed: widget.onDelete,
                icon: const Icon(Icons.delete_outline,
                    color: Color(0xFF555555), size: 16),
                label: const Text('Remover',
                    style: TextStyle(color: Color(0xFF555555), fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AnalysisStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _AnalysisStat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF888888), fontSize: 9)),
          const SizedBox(height: 2),
          Text(value,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: color ?? Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
