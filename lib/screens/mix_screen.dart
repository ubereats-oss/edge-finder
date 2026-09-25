import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/edge_evaluator_service.dart';
import '../services/prefs_service.dart';
import '../widgets/prop_card.dart';
import '../widgets/last_updated_bar.dart';
import '../widgets/status_bar.dart';
import '../widgets/edge_evaluation_sheet.dart';
import 'dart:math';

class MixScreen extends StatefulWidget {
  const MixScreen({super.key});

  @override
  State<MixScreen> createState() => _MixScreenState();
}

class _MixScreenState extends State<MixScreen> {
  List<Map<String, dynamic>> _allProps = [];
  // Props publicadas ANTES do filtro de qualidade (adaptiveFilter/rankLocal)
  // — guardado só pra diagnosticar a causa da lista vazia (ver _buildEmptyState).
  List<Map<String, dynamic>> _prePisoProps = [];
  DateTime? _lastUpdated;
  bool _loading = false;
  String _status = '';
  double _minEdge = 0;
  String _selectedSport = 'Todos';
  bool _hideWarnings = false;
  DateTime? _selectedDate;

  static const _sports = ['Todos', 'NBA', 'MLB', 'NHL', 'NFL'];
  static const _min15 = Duration(minutes: 15);

  bool _jogoValido(Map<String, dynamic> item) {
    final raw = item['commence_time'] as String?;
    if (raw == null) return true;
    final dt = DateTime.tryParse(raw)?.toUtc();
    if (dt == null) return true;
    return dt.difference(DateTime.now().toUtc()) >= _min15;
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _status = 'Carregando todos os esportes...';
    });
    try {
      final result = await ApiService.fetchAllProps();
      final valid = result.data.where(_jogoValido).toList();
      final enriched = await EdgeEvaluatorService.enrichAllWithContext(valid);
      final normalized = _normalizeProbBySport(enriched);
      final ranked = EdgeEvaluatorService.rankLocal(normalized);
      if (!mounted) return;
      setState(() {
        _allProps = ranked;
        _prePisoProps = normalized;
        _lastUpdated = result.lastUpdated;
        _status = '';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _status = '');
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Normaliza _probCalibrada por esporte via z-score para comparação cross-sport justa.
  List<Map<String, dynamic>> _normalizeProbBySport(
      List<Map<String, dynamic>> props) {
    // Agrupa probs calibradas por esporte
    final sportProbs = <String, List<double>>{};
    for (final p in props) {
      final sport = p['sport'] as String? ?? 'unknown';
      final prob = (p['_probCalibrada'] as double?) ??
          EdgeEvaluatorService.calibratedProb(p);
      sportProbs.putIfAbsent(sport, () => []).add(prob);
    }

    // Calcula média e desvio padrão por esporte
    final sportStats = <String, ({double mean, double std})>{};
    for (final entry in sportProbs.entries) {
      final vals = entry.value;
      if (vals.length < 2) continue;
      final mean = vals.reduce((a, b) => a + b) / vals.length;
      final variance =
          vals.map((v) => (v - mean) * (v - mean)).reduce((a, b) => a + b) /
              vals.length;
      final std = variance > 0 ? sqrt(variance) : 0.01;
      sportStats[entry.key] = (mean: mean, std: std);
    }

    // Aplica z-score e remapeia para [0.5, 1.0] mantendo ordenação relativa
    return props.map((p) {
      final sport = p['sport'] as String? ?? 'unknown';
      final stats = sportStats[sport];
      if (stats == null) return p;
      final prob = (p['_probCalibrada'] as double?) ??
          EdgeEvaluatorService.calibratedProb(p);
      final z = (prob - stats.mean) / stats.std;
      final normProb = (0.75 + z * 0.125).clamp(0.50, 0.99);
      return {
        ...p,
        '_probNormSport': normProb
      }; // não sobrescreve _probCalibrada
    }).toList();
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  void _showEvaluation() {
    final top = _filtered.take(20).toList();
    if (top.isEmpty) {
      _showError('Sem props disponíveis.');
      return;
    }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => EdgeEvaluationSheet(props: top, sport: 'Mix de Apostas'),
    );
  }

  Future<void> _registrarTodasApostas() async {
    final props = _filtered;
    if (props.isEmpty) {
      _showError('Sem props disponíveis para registrar.');
      return;
    }

    int step = 0;
    bool isVirtual = false;
    bool valoresIguais = true;
    final globalStakeController = TextEditingController();
    final stakeControllers =
        List.generate(props.length, (_) => TextEditingController());
    List<double>? confirmedStakes;

    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlg) {
          Widget buildContent() {
            if (step == 0) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${props.length} apostas serão registradas com os lados e odds recomendados.',
                    style:
                        const TextStyle(color: Color(0xFFAAAAAA), fontSize: 13),
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setDlg(() => isVirtual = false),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: !isVirtual
                                  ? const Color(0xFF00C853)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: !isVirtual
                                    ? const Color(0xFF00C853)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Column(
                              children: [
                                Icon(Icons.attach_money,
                                    color: !isVirtual
                                        ? const Color(0xFF00C853)
                                        : const Color(0xFF666666)),
                                const SizedBox(height: 4),
                                Text('Real',
                                    style: TextStyle(
                                        color: !isVirtual
                                            ? const Color(0xFF00C853)
                                            : const Color(0xFF888888),
                                        fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setDlg(() => isVirtual = true),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: isVirtual
                                  ? const Color(0xFF00B0FF)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: isVirtual
                                    ? const Color(0xFF00B0FF)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Column(
                              children: [
                                Icon(Icons.visibility,
                                    color: isVirtual
                                        ? const Color(0xFF00B0FF)
                                        : const Color(0xFF666666)),
                                const SizedBox(height: 4),
                                Text('Virtual',
                                    style: TextStyle(
                                        color: isVirtual
                                            ? const Color(0xFF00B0FF)
                                            : const Color(0xFF888888),
                                        fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              );
            } else if (step == 1) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'As apostas terão valores iguais ou diferentes?',
                    style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 13),
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setDlg(() => valoresIguais = true),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: valoresIguais
                                  ? const Color(0xFFFFD600)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: valoresIguais
                                    ? const Color(0xFFFFD600)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Column(
                              children: [
                                Icon(Icons.format_align_center,
                                    color: valoresIguais
                                        ? const Color(0xFFFFD600)
                                        : const Color(0xFF666666)),
                                const SizedBox(height: 4),
                                Text('Iguais',
                                    style: TextStyle(
                                        color: valoresIguais
                                            ? const Color(0xFFFFD600)
                                            : const Color(0xFF888888),
                                        fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setDlg(() => valoresIguais = false),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              color: !valoresIguais
                                  ? const Color(0xFF7C4DFF)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(
                                color: !valoresIguais
                                    ? const Color(0xFF7C4DFF)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Column(
                              children: [
                                Icon(Icons.tune,
                                    color: !valoresIguais
                                        ? const Color(0xFF7C4DFF)
                                        : const Color(0xFF666666)),
                                const SizedBox(height: 4),
                                Text('Diferentes',
                                    style: TextStyle(
                                        color: !valoresIguais
                                            ? const Color(0xFF7C4DFF)
                                            : const Color(0xFF888888),
                                        fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              );
            } else {
              if (valoresIguais) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Valor para cada uma das ${props.length} apostas:',
                      style: const TextStyle(
                          color: Color(0xFFAAAAAA), fontSize: 13),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: globalStakeController,
                      autofocus: true,
                      keyboardType:
                          const TextInputType.numberWithOptions(decimal: true),
                      style: const TextStyle(color: Colors.white, fontSize: 18),
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: const Color(0xFF2A2A3E),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: BorderSide.none,
                        ),
                        prefixText: 'R\$ ',
                        prefixStyle: const TextStyle(color: Color(0xFF888888)),
                        hintText: '0,00',
                        hintStyle: const TextStyle(color: Color(0xFF555566)),
                      ),
                    ),
                  ],
                );
              } else {
                return SizedBox(
                  width: double.maxFinite,
                  height: 360,
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Valor por aposta (deixe 0 para pular):',
                          style:
                              TextStyle(color: Color(0xFFAAAAAA), fontSize: 13),
                        ),
                        const SizedBox(height: 12),
                        ...List.generate(props.length, (i) {
                          final p = props[i];
                          final player = (p['player'] as String?) ??
                              (p['home_team'] as String?) ??
                              'Aposta ${i + 1}';
                          final propType = p['prop_type'] as String? ?? '';
                          final line = p['line'];
                          final side = (p['side'] as String?) ?? 'Over';
                          final edge = (p['edge'] as num?)?.toDouble() ?? 0;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        player,
                                        style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: edge >= 5
                                            ? const Color(0xFF00C853)
                                                .withValues(alpha: 0.2)
                                            : const Color(0xFFFFD600)
                                                .withValues(alpha: 0.2),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        '${edge.toStringAsFixed(1)}%',
                                        style: TextStyle(
                                          color: edge >= 5
                                              ? const Color(0xFF00C853)
                                              : const Color(0xFFFFD600),
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                Text(
                                  '$side $line $propType',
                                  style: const TextStyle(
                                      color: Color(0xFF888888), fontSize: 11),
                                ),
                                const SizedBox(height: 4),
                                TextField(
                                  controller: stakeControllers[i],
                                  keyboardType:
                                      const TextInputType.numberWithOptions(
                                          decimal: true),
                                  style: const TextStyle(color: Colors.white),
                                  decoration: InputDecoration(
                                    filled: true,
                                    fillColor: const Color(0xFF2A2A3E),
                                    border: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(8),
                                      borderSide: BorderSide.none,
                                    ),
                                    prefixText: 'R\$ ',
                                    prefixStyle: const TextStyle(
                                        color: Color(0xFF888888)),
                                    hintText: '0,00',
                                    hintStyle: const TextStyle(
                                        color: Color(0xFF555566)),
                                    isDense: true,
                                  ),
                                ),
                              ],
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
                );
              }
            }
          }

          final isLastStep = step == 2;
          return AlertDialog(
            backgroundColor: const Color(0xFF1E1E2E),
            title: Row(
              children: [
                const Icon(Icons.playlist_add_check,
                    color: Color(0xFFFFD600), size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    step == 0
                        ? 'Registrar ${props.length} Apostas'
                        : step == 1
                            ? 'Valores das Apostas'
                            : valoresIguais
                                ? 'Valor por Aposta'
                                : 'Valores Individuais',
                    style: const TextStyle(color: Colors.white, fontSize: 16),
                  ),
                ),
              ],
            ),
            content: buildContent(),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancelar',
                    style: TextStyle(color: Color(0xFF888888))),
              ),
              if (step > 0)
                TextButton(
                  onPressed: () => setDlg(() => step--),
                  child: const Text('Voltar',
                      style: TextStyle(color: Color(0xFF888888))),
                ),
              ElevatedButton(
                onPressed: () {
                  if (!isLastStep) {
                    setDlg(() => step++);
                    return;
                  }
                  List<double> stakes;
                  if (valoresIguais) {
                    final v = double.tryParse(
                        globalStakeController.text.replaceAll(',', '.'));
                    if (v == null || v <= 0) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('Informe um valor válido.'),
                            backgroundColor: Colors.red),
                      );
                      return;
                    }
                    stakes = List.filled(props.length, v);
                  } else {
                    stakes = stakeControllers
                        .map((c) =>
                            double.tryParse(c.text.replaceAll(',', '.')) ?? 0.0)
                        .toList();
                    if (stakes.every((s) => s <= 0)) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('Informe ao menos um valor.'),
                            backgroundColor: Colors.red),
                      );
                      return;
                    }
                  }
                  confirmedStakes = stakes;
                  Navigator.pop(ctx);
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: isLastStep
                      ? const Color(0xFF00C853)
                      : const Color(0xFF7C4DFF),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8)),
                ),
                child: Text(
                  isLastStep ? 'Registrar ${props.length} apostas' : 'Próximo',
                  style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          );
        },
      ),
    );

    if (confirmedStakes != null) {
      if (!mounted) return;
      await _submitAllBets(props, confirmedStakes!, isVirtual);
    }
  }

  Future<void> _submitAllBets(List<Map<String, dynamic>> props,
      List<double> stakes, bool isVirtual) async {
    int success = 0;
    int failed = 0;
    final fallbackBookmaker = PrefsService.getLastBookmaker() ?? '';

    for (var i = 0; i < props.length; i++) {
      final stake = stakes[i];
      if (stake <= 0) continue;
      final p = props[i];
      final side = (p['side'] as String?) ?? 'Over';
      final bookmaker =
          ((p['bookmaker'] as String?)?.trim().isNotEmpty ?? false)
              ? (p['bookmaker'] as String).trim()
              : fallbackBookmaker;
      if (bookmaker.isEmpty) {
        failed++;
        continue;
      }
      double? odds;
      if (side == 'Over' && p['oddsOver'] != null) {
        odds = (p['oddsOver'] as num).toDouble();
      } else if (side == 'Under' && p['oddsUnder'] != null) {
        odds = (p['oddsUnder'] as num).toDouble();
      } else if (p['odds'] != null) {
        odds = (p['odds'] as num).toDouble();
      }

      try {
        await ApiService.createBet({
          ...p,
          'stake': stake,
          'odds':
              odds ?? (p['odds'] is num ? (p['odds'] as num).toDouble() : null),
          'side': side,
          'bookmaker': bookmaker,
          'virtual': isVirtual,
        });
        success++;
      } catch (_) {
        failed++;
      }
    }

    if (mounted) {
      final msg = failed == 0
          ? '$success apostas registradas com sucesso!'
          : '$success registradas, $failed com erro.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor:
              failed == 0 ? const Color(0xFF00C853) : const Color(0xFFFF6D00),
          duration: const Duration(seconds: 4),
        ),
      );
    }
  }

  // Esporte + data (sem edge mínimo nem "ocultar ⚠️") — usado tanto pra
  // escopar o pool pré-piso do diagnóstico quanto pra saber se a lista só
  // está vazia por causa do filtro de edge/aviso do próprio usuário.
  bool _matchesSportAndDate(Map<String, dynamic> p) {
    if (_selectedSport != 'Todos') {
      final sport = (p['sport'] as String? ?? '');
      if (!sport.contains(_selectedSport)) return false;
    }
    if (_selectedDate != null) {
      final raw = p['commence_time'] as String?;
      if (raw == null) return false;
      final dt = DateTime.tryParse(raw)?.toLocal();
      if (dt == null) return false;
      if (dt.year != _selectedDate!.year ||
          dt.month != _selectedDate!.month ||
          dt.day != _selectedDate!.day) {
        return false;
      }
    }
    return true;
  }

  /// Mensagem de lista vazia: diferencia "controle de risco ainda em
  /// calibração inicial" (causa real, não é bug nem filtro) dos demais casos
  /// (sem dados, erro, ou o próprio usuário filtrou tudo).
  Widget _buildEmptyState() {
    // Já passou pelo piso de qualidade e sobrou algo pro esporte/data atual —
    // a lista só está vazia por causa do "Edge mín" ou "Ocultar ⚠️" do usuário.
    final scopeAfterFloor = _allProps.where(_matchesSportAndDate);
    if (scopeAfterFloor.isNotEmpty) {
      return const _EmptyState(
          msg: 'Sem props disponíveis.\nAjuste os filtros ou atualize.');
    }

    final pool = _prePisoProps.where(_matchesSportAndDate).toList();
    final diag = EdgeEvaluatorService.diagnoseEmptyPool(pool);
    if (diag.allDueToSampleKelly) {
      final escopo = _selectedSport == 'Todos' ? 'Os esportes' : _selectedSport;
      return _EmptyState(
        icon: Icons.hourglass_top,
        msg: '$escopo ainda em calibração inicial.\n'
            '${pool.length} indicação(ões) avaliada(s) hoje, mas o controle de '
            'risco reduz a aposta sugerida enquanto o segmento acumula amostra '
            '(${diag.maxSampleSize}/${diag.minSampleToCalibrate} resultados apurados). '
            'Nenhuma atingiu o piso mínimo de Kelly ainda.',
      );
    }

    return const _EmptyState(
        msg: 'Sem props disponíveis.\nAjuste os filtros ou atualize.');
  }

  List<Map<String, dynamic>> get _filtered {
    return _allProps
        .where((p) {
          final edge = (p['edge'] as num).toDouble();
          if (edge < _minEdge) return false;
          if (_selectedSport != 'Todos') {
            final sport = (p['sport'] as String? ?? '');
            if (!sport.contains(_selectedSport)) return false;
          }
          if (_hideWarnings && p['lowSample'] == true) return false;
          if (_selectedDate != null) {
            final raw = p['commence_time'] as String?;
            if (raw == null) return false;
            final dt = DateTime.tryParse(raw)?.toLocal();
            if (dt == null) return false;
            if (dt.year != _selectedDate!.year ||
                dt.month != _selectedDate!.month ||
                dt.day != _selectedDate!.day) {
              return false;
            }
          }
          return true;
        })
        .take(20)
        .toList();
  }

  List<DateTime> get _availableDates {
    final seen = <String>{};
    final dates = <DateTime>[];
    for (final p in _allProps) {
      final raw = p['commence_time'] as String?;
      if (raw == null) continue;
      final dt = DateTime.tryParse(raw)?.toLocal();
      if (dt == null) continue;
      final key = '${dt.year}-${dt.month}-${dt.day}';
      if (seen.add(key)) dates.add(DateTime(dt.year, dt.month, dt.day));
    }
    dates.sort();
    return dates;
  }

  Color _sportColor(String sport) {
    if (sport.contains('NBA')) return const Color(0xFF7C4DFF);
    if (sport.contains('MLB')) return const Color(0xFF00C853);
    if (sport.contains('NHL')) return const Color(0xFF00B0FF);
    if (sport.contains('NFL')) return const Color(0xFFFF6D00);
    if (sport.contains('Tênis')) return const Color(0xFFFFD600);
    return const Color(0xFFAAAAAA);
  }

  @override
  Widget build(BuildContext context) {
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
            Icon(Icons.auto_awesome, color: Color(0xFFFFD600), size: 22),
            SizedBox(width: 8),
            Text('Mix de Apostas',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.psychology, color: Color(0xFF7C4DFF)),
            tooltip: 'Avaliar com Gemini',
            onPressed: _loading || _allProps.isEmpty ? null : _showEvaluation,
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_status.isNotEmpty) StatusBar(message: _status),
          if (_loading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E1E2E),
              color: Color(0xFFFFD600),
            ),
          LastUpdatedBar(lastUpdated: _lastUpdated),
          _buildFilters(),
          Expanded(
            child: _filtered.isEmpty && !_loading
                ? _buildEmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    itemCount: _filtered.length,
                    itemBuilder: (_, i) {
                      final p = _filtered[i];
                      final sport = p['sport'] as String? ?? '';
                      return PropCard(
                          prop: p, sportBadge: sport.isNotEmpty ? sport : null);
                    },
                  ),
          ),
        ],
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.extended(
            heroTag: 'registrar_todas',
            onPressed:
                _loading || _filtered.isEmpty ? null : _registrarTodasApostas,
            backgroundColor: const Color(0xFF7C4DFF),
            icon: const Icon(Icons.playlist_add_check, color: Colors.white),
            label: const Text('Registrar todas',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 8),
          FloatingActionButton.extended(
            heroTag: 'atualizar',
            onPressed: _loading ? null : _load,
            backgroundColor: const Color(0xFFFFD600),
            icon: const Icon(Icons.shuffle, color: Colors.black),
            label: const Text('Atualizar',
                style: TextStyle(
                    color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _dateChip(DateTime? date, String label) {
    final selected = _selectedDate?.day == date?.day &&
        _selectedDate?.month == date?.month &&
        _selectedDate?.year == date?.year;
    const color = Color(0xFF00B0FF);
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: GestureDetector(
        onTap: () => setState(() => _selectedDate = date),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: selected ? color.withValues(alpha: 0.2) : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected ? color : const Color(0xFF444466),
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              color: selected ? color : const Color(0xFF888888),
              fontSize: 12,
              fontWeight: selected ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFilters() {
    return Container(
      color: const Color(0xFF1E1E2E),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _sports.map((sport) {
                final selected = _selectedSport == sport;
                final color = sport == 'Todos'
                    ? const Color(0xFFFFD600)
                    : _sportColor(sport);
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: GestureDetector(
                    onTap: () => setState(() => _selectedSport = sport),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: selected
                            ? color.withValues(alpha: 0.2)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: selected ? color : const Color(0xFF444466),
                        ),
                      ),
                      child: Text(
                        sport,
                        style: TextStyle(
                          color: selected ? color : const Color(0xFF888888),
                          fontSize: 12,
                          fontWeight:
                              selected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          if (_availableDates.length > 1) ...[
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _dateChip(null, 'Todos os dias'),
                  ..._availableDates.map((d) {
                    final label =
                        '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
                    return _dateChip(d, label);
                  }),
                ],
              ),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              const Text('Edge mín:',
                  style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
              const SizedBox(width: 8),
              ...[0.0, 5.0, 10.0, 15.0].map((v) {
                final selected = _minEdge == v;
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: GestureDetector(
                    onTap: () => setState(() => _minEdge = v),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: selected
                            ? const Color(0xFF00C853).withValues(alpha: 0.2)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: selected
                              ? const Color(0xFF00C853)
                              : const Color(0xFF444466),
                        ),
                      ),
                      child: Text(
                        v == 0 ? 'Todos' : '${v.toInt()}%',
                        style: TextStyle(
                          color: selected
                              ? const Color(0xFF00C853)
                              : const Color(0xFF888888),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ),
                );
              }),
              const Spacer(),
              GestureDetector(
                onTap: () => setState(() => _hideWarnings = !_hideWarnings),
                child: Row(
                  children: [
                    Icon(
                      _hideWarnings
                          ? Icons.warning_amber
                          : Icons.warning_amber_outlined,
                      color: _hideWarnings
                          ? const Color(0xFFFF6D00)
                          : const Color(0xFF666666),
                      size: 18,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Ocultar ⚠️',
                      style: TextStyle(
                        color: _hideWarnings
                            ? const Color(0xFFFF6D00)
                            : const Color(0xFF666666),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final String msg;
  final IconData? icon;
  const _EmptyState({required this.msg, this.icon});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, color: const Color(0xFF666666), size: 36),
              const SizedBox(height: 12),
            ],
            Text(msg,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF666666), fontSize: 15)),
          ],
        ),
      ),
    );
  }
}
