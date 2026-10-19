import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/prefs_service.dart';
import '../services/risk_config.dart';
import '../widgets/last_updated_bar.dart';
import 'pt_value_report_screen.dart';

/// Tela "Conferir odds" — pra cada evento nas próximas 24h com odds da
/// Pinnacle (H2H e props de jogador, os dois lados), mostra a probabilidade
/// justa (método de potência, margem removida) e a odd mínima de valor
/// (justa + 1% de folga). O usuário digita a odd que vê numa casa
/// portuguesa licenciada e a tela calcula a vantagem e o stake sugerido por
/// Kelly 25% (RiskConfig.kellyFraction — não recalculado nem alterado
/// aqui). Nenhuma casa é consultada automaticamente — é sempre o usuário
/// quem olha o site da casa e digita o que vê.
class ConferirOddsScreen extends StatefulWidget {
  const ConferirOddsScreen({super.key});

  @override
  State<ConferirOddsScreen> createState() => _ConferirOddsScreenState();
}

const List<String> ptBookmakers = [
  'Betano',
  'Betclic',
  'Bwin',
  'Solverde',
  'Placard',
  'ESC Online',
  'Casino Portugal',
  'LeBull',
  'GoldenPark',
  'Retabet',
];

const Map<String, String> _sportLabels = {
  'basketball/nba': '🏀 NBA',
  'baseball/mlb': '⚾ MLB',
  'hockey/nhl': '🏒 NHL',
  'americanfootball/nfl': '🏈 NFL',
};

class _RowState {
  String? bookmaker;
  String? savedCheckId;
  bool feita = false;
  bool saving = false;
}

class _ConferirOddsScreenState extends State<ConferirOddsScreen> {
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _rows = [];
  DateTime? _generatedAt;
  double _banca = 0;

  String? _sportFilter;
  String? _marketFilter;
  String _search = '';

  final Map<String, _RowState> _rowStates = {};
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    _banca = PrefsService.getBanca();
    _load();
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _keyOf(Map<String, dynamic> row) =>
      '${row['eventId']}|${row['market']}|${row['line']}|${row['side']}';

  _RowState _stateFor(String key) => _rowStates.putIfAbsent(key, () => _RowState());

  TextEditingController _controllerFor(String key) =>
      _controllers.putIfAbsent(key, () => TextEditingController());

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await ApiService.fetchPinnacleReference();
      if (!mounted) return;
      setState(() {
        _rows = result.rows;
        _generatedAt = result.generatedAt;
      });
    } catch (e) {
      if (!mounted) return;
      final message = e.toString().replaceFirst('Exception: ', '');
      setState(() => _error = 'Falha ao carregar referência da Pinnacle: $message');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final q = _search.trim().toLowerCase();
    return _rows.where((r) {
      if (_sportFilter != null && r['esporte'] != _sportFilter) return false;
      if (_marketFilter != null && r['market'] != _marketFilter) return false;
      if (q.isEmpty) return true;
      final game = (r['game'] as String? ?? '').toLowerCase();
      final player = (r['player'] as String? ?? '').toLowerCase();
      return game.contains(q) || player.contains(q);
    }).toList()
      ..sort((a, b) => (a['commenceTime'] as String? ?? '')
          .compareTo(b['commenceTime'] as String? ?? ''));
  }

  List<String> get _availableSports {
    final set = _rows.map((r) => r['esporte'] as String? ?? '').toSet()
      ..remove('');
    final list = set.toList()..sort();
    return list;
  }

  List<String> get _availableMarkets {
    final set = _rows
        .where((r) => _sportFilter == null || r['esporte'] == _sportFilter)
        .map((r) => r['market'] as String? ?? '')
        .toSet()
      ..remove('');
    final list = set.toList()..sort();
    return list;
  }

  Future<void> _editBanca() async {
    final controller = TextEditingController(text: _banca.toStringAsFixed(2));
    final value = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title: const Text('Banca', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(prefixText: '€ '),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancelar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(
                ctx, double.tryParse(controller.text.replaceAll(',', '.'))),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    if (value != null && value >= 0) {
      PrefsService.setBanca(value);
      setState(() => _banca = value);
    }
  }

  Future<void> _salvarConferencia(Map<String, dynamic> row, _RowState st,
      double oddDigitada, double edgePct, double kellyPct) async {
    setState(() => st.saving = true);
    try {
      final saved = await ApiService.createOddsCheck({
        'esporte': row['esporte'],
        'eventId': row['eventId'],
        'game': row['game'],
        'commenceTime': row['commenceTime'],
        'market': row['market'],
        'line': row['line'],
        'side': row['side'],
        'player': row['player'],
        'bookmaker': st.bookmaker,
        'oddDigitada': oddDigitada,
        'fairProbPct': row['fairProbPct'],
        'pinnacleOdds': row['pinnacleOdds'],
        'minValueOdds': row['minValueOdds'],
        'edgePct': double.parse(edgePct.toStringAsFixed(2)),
        'kellyPct': double.parse(kellyPct.toStringAsFixed(2)),
      });
      if (!mounted) return;
      setState(() => st.savedCheckId = saved['id'] as String);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Conferência salva.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao salvar: ${e.toString().replaceFirst('Exception: ', '')}')),
      );
    } finally {
      if (mounted) setState(() => st.saving = false);
    }
  }

  Future<void> _marcarFeita(_RowState st) async {
    if (st.savedCheckId == null) return;
    setState(() => st.saving = true);
    try {
      await ApiService.markOddsCheckAsFeita(st.savedCheckId!);
      if (!mounted) return;
      setState(() => st.feita = true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao marcar aposta: ${e.toString().replaceFirst('Exception: ', '')}')),
      );
    } finally {
      if (mounted) setState(() => st.saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
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
            Icon(Icons.fact_check, color: Color(0xFF7C4DFF), size: 20),
            SizedBox(width: 8),
            Text('Conferir odds',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.bar_chart, color: Colors.white),
            tooltip: 'Valor real nas casas',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const PtValueReportScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.account_balance_wallet, color: Colors.white),
            tooltip: 'Banca: € ${_banca.toStringAsFixed(2)}',
            onPressed: _editBanca,
          ),
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
          _buildFilters(),
          Expanded(child: _buildBody(rows)),
        ],
      ),
    );
  }

  Widget _buildFilters() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _FilterDropdown(
                  label: 'Esporte',
                  value: _sportFilter,
                  options: _availableSports,
                  labelOf: (v) => _sportLabels[v] ?? v,
                  onChanged: (v) => setState(() {
                    _sportFilter = v;
                    _marketFilter = null;
                  }),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _FilterDropdown(
                  label: 'Mercado',
                  value: _marketFilter,
                  options: _availableMarkets,
                  labelOf: (v) => v,
                  onChanged: (v) => setState(() => _marketFilter = v),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'Buscar jogo ou jogador',
              hintStyle: const TextStyle(color: Color(0xFF888888)),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF888888)),
              filled: true,
              fillColor: const Color(0xFF1E1E2E),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(vertical: 0),
            ),
            onChanged: (v) => setState(() => _search = v),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(List<Map<String, dynamic>> rows) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, color: Color(0xFF555555), size: 48),
              const SizedBox(height: 16),
              Text(_error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF888888), fontSize: 15)),
              const SizedBox(height: 20),
              OutlinedButton(
                onPressed: _load,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF7C4DFF),
                  side: const BorderSide(color: Color(0xFF7C4DFF)),
                ),
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }
    if (rows.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Nenhum evento com odds da Pinnacle nas próximas 24h pros filtros escolhidos.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF888888), fontSize: 15),
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: rows.length,
      itemBuilder: (_, i) {
        final key = _keyOf(rows[i]);
        return _OddsCheckCard(
          key: ValueKey(key),
          row: rows[i],
          state: _stateFor(key),
          controller: _controllerFor(key),
          banca: _banca,
          onChanged: () => setState(() {}),
          onSalvar: _salvarConferencia,
          onMarcarFeita: _marcarFeita,
        );
      },
    );
  }
}

class _FilterDropdown extends StatelessWidget {
  final String label;
  final String? value;
  final List<String> options;
  final String Function(String) labelOf;
  final ValueChanged<String?> onChanged;

  const _FilterDropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.labelOf,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(10),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String?>(
          isExpanded: true,
          value: value,
          hint: Text(label, style: const TextStyle(color: Color(0xFF888888))),
          dropdownColor: const Color(0xFF1E1E2E),
          style: const TextStyle(color: Colors.white),
          items: [
            DropdownMenuItem<String?>(value: null, child: Text('Todos ($label)')),
            ...options.map((o) => DropdownMenuItem<String?>(value: o, child: Text(labelOf(o)))),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }
}

class _OddsCheckCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final _RowState state;
  final TextEditingController controller;
  final double banca;
  final VoidCallback onChanged;
  final Future<void> Function(Map<String, dynamic> row, _RowState st,
      double oddDigitada, double edgePct, double kellyPct) onSalvar;
  final Future<void> Function(_RowState st) onMarcarFeita;

  const _OddsCheckCard({
    super.key,
    required this.row,
    required this.state,
    required this.controller,
    required this.banca,
    required this.onChanged,
    required this.onSalvar,
    required this.onMarcarFeita,
  });

  @override
  Widget build(BuildContext context) {
    final fairProbPct = (row['fairProbPct'] as num?)?.toDouble();
    final pinnacleOdds = (row['pinnacleOdds'] as num?)?.toDouble();
    final minValueOdds = (row['minValueOdds'] as num?)?.toDouble();
    final line = row['line'];
    final side = row['side'] as String? ?? '';
    final market = row['market'] as String? ?? '';
    final player = row['player'] as String?;
    final game = row['game'] as String? ?? '';

    final oddDigitada = double.tryParse(controller.text.replaceAll(',', '.'));
    double? edgePct;
    double? kellyPct;
    double? stakeValue;
    if (oddDigitada != null && oddDigitada > 1 && fairProbPct != null) {
      final fairProb = fairProbPct / 100;
      edgePct = (oddDigitada * fairProb - 1) * 100;
      if (oddDigitada > 1 && edgePct > 0) {
        final kellyFull =
            ((fairProb * oddDigitada - 1) / (oddDigitada - 1) * 100).clamp(0.0, 100.0);
        kellyPct = kellyFull * RiskConfig.kellyFraction;
        stakeValue = banca * kellyPct / 100;
      }
    }
    final temValor = edgePct != null && edgePct > 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF333344)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(game,
              style: const TextStyle(
                  color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text(
            market == 'h2h'
                ? 'h2h · $side'
                : '$player · $market $line · $side',
            style: const TextStyle(color: Color(0xFF888888), fontSize: 12),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _Stat(
                    label: 'Prob. justa (Pinnacle)',
                    value: fairProbPct == null ? '—' : '${fairProbPct.toStringAsFixed(1)}%'),
              ),
              Expanded(
                child: _Stat(
                    label: 'Odd Pinnacle',
                    value: pinnacleOdds == null ? '—' : pinnacleOdds.toStringAsFixed(2)),
              ),
              Expanded(
                child: _Stat(
                    label: 'Odd mín. de valor',
                    value: minValueOdds == null ? '—' : minValueOdds.toStringAsFixed(2)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: controller,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Odd vista na casa',
                    labelStyle: TextStyle(color: Color(0xFF888888)),
                    isDense: true,
                  ),
                  onChanged: (_) => onChanged(),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 4,
                child: DropdownButtonFormField<String>(
                  initialValue: state.bookmaker,
                  decoration: const InputDecoration(
                    labelText: 'Casa',
                    labelStyle: TextStyle(color: Color(0xFF888888)),
                    isDense: true,
                  ),
                  dropdownColor: const Color(0xFF1E1E2E),
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  items: ptBookmakers
                      .map((b) => DropdownMenuItem(value: b, child: Text(b)))
                      .toList(),
                  onChanged: (v) {
                    state.bookmaker = v;
                    onChanged();
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (oddDigitada == null)
            const SizedBox.shrink()
          else if (!temValor)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF888888).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text('Sem valor',
                  style: TextStyle(color: Color(0xFF888888), fontWeight: FontWeight.bold)),
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF00C853).withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Text('Vantagem: +${edgePct!.toStringAsFixed(2)}%',
                      style: const TextStyle(
                          color: Color(0xFF00C853), fontWeight: FontWeight.bold)),
                  const Spacer(),
                  if (kellyPct != null)
                    Text(
                        'Kelly 25%: ${kellyPct.toStringAsFixed(1)}% (€${stakeValue?.toStringAsFixed(2) ?? '—'})',
                        style: const TextStyle(color: Color(0xFF00C853), fontSize: 12)),
                ],
              ),
            ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: (state.bookmaker == null ||
                          oddDigitada == null ||
                          state.saving ||
                          state.savedCheckId != null)
                      ? null
                      : () => onSalvar(row, state, oddDigitada, edgePct ?? 0, kellyPct ?? 0),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF7C4DFF),
                    side: const BorderSide(color: Color(0xFF7C4DFF)),
                  ),
                  child: Text(state.savedCheckId == null ? 'Salvar conferência' : 'Conferência salva'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ElevatedButton(
                  onPressed: (state.savedCheckId == null || state.feita || state.saving)
                      ? null
                      : () => onMarcarFeita(state),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF7C4DFF),
                    foregroundColor: Colors.white,
                  ),
                  child: Text(state.feita ? 'Aposta marcada' : 'Marcar aposta feita'),
                ),
              ),
            ],
          ),
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
                color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Color(0xFF888888), fontSize: 10)),
      ],
    );
  }
}
