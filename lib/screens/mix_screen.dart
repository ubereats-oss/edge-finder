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
  DateTime? _lastUpdated;
  bool _loading = false;
  String _status = '';
  double _minEdge = 0;
  String _selectedSport = 'Todos';
  bool _hideWarnings = false;
  DateTime? _selectedDate;

  static const _sports = ['Todos', 'NBA', 'MLB', 'NHL', 'NFL', 'Tênis'];
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
      setState(() {
        _allProps = ranked;
        _lastUpdated = result.lastUpdated;
        _status = '';
      });
    } catch (e) {
      setState(() => _status = '');
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
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
      if (stats == null) return p;
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
                dt.day != _selectedDate!.day) return false;
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
                ? const _EmptyState(
                    msg:
                        'Sem props disponíveis.\nAjuste os filtros ou atualize.')
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _load,
        backgroundColor: const Color(0xFFFFD600),
        icon: const Icon(Icons.shuffle, color: Colors.black),
        label: const Text('Atualizar',
            style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
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
  const _EmptyState({required this.msg});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(msg,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xFF666666), fontSize: 15)),
    );
  }
}
