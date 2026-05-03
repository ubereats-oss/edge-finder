import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/edge_evaluator_service.dart';
import '../widgets/prop_card.dart';
import '../widgets/props_filter_bar.dart';
import '../widgets/last_updated_bar.dart';
import '../widgets/status_bar.dart';
import '../widgets/edge_evaluation_sheet.dart';

class HockeyScreen extends StatefulWidget {
  const HockeyScreen({super.key});

  @override
  State<HockeyScreen> createState() => _HockeyScreenState();
}

class _HockeyScreenState extends State<HockeyScreen> {
  List<Map<String, dynamic>> _propsResults = [];
  DateTime? _propsUpdated;
  bool _loading = false;
  String _status = '';
  double _minEdge = 0;
  String? _selectedProp;
  String? _selectedTeam;
  bool _hideWarnings = false;

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
    setState(() => _loading = true);
    try {
      final props = await ApiService.fetchNhlProps();
      final enriched = await EdgeEvaluatorService.enrichWithContext(props.data, 'nhl');
      final filtered = EdgeEvaluatorService.adaptiveFilter(enriched);
      setState(() {
        _propsResults = filtered;
        _propsUpdated = props.lastUpdated;
      });
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _runUpdate() async {
    setState(() {
      _loading = true;
      _status = 'Acionando workflow NHL...';
    });
    try {
      await ApiService.triggerUpdate('nhl');
      setState(() => _status = 'Aguardando conclusão...');
      for (int i = 0; i < 36; i++) {
        await Future.delayed(const Duration(seconds: 5));
        try {
          final s = await ApiService.getWorkflowStatus();
          if (s == 'completed') break;
        } catch (_) {}
      }
      setState(() => _status = 'Carregando...');
      await _load();
      setState(() => _status = 'Concluído.');
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  void _showEvaluation() {
    final valid = _propsResults.where(_jogoValido).toList();
    if (valid.isEmpty) { _showError('Sem props disponíveis.'); return; }
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => EdgeEvaluationSheet(props: valid, sport: 'Hockey NHL'),
    );
  }

  List<String> get _availableProps =>
      _propsResults.where(_jogoValido).map((p) => p['prop'] as String).toSet().toList()..sort();

  List<String> get _availableTeams =>
      _propsResults.where(_jogoValido).map((p) => (p['playerTeam'] as String?) ?? '').where((t) => t.isNotEmpty).toSet().toList()..sort();

  List<Map<String, dynamic>> get _filtered {
    return _propsResults.where((p) {
      if (!_jogoValido(p)) return false;
      final edge = (p['edge'] as num).toDouble();
      if (edge < _minEdge) return false;
      if (_selectedProp != null && p['prop'] != _selectedProp) return false;
      if (_selectedTeam != null && p['playerTeam'] != _selectedTeam) return false;
      if (_hideWarnings && p['lowSample'] == true) return false;
      return true;
    }).toList();
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
            Text('🏒', style: TextStyle(fontSize: 20)),
            SizedBox(width: 8),
            Text('Hockey NHL',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.auto_awesome, color: Color(0xFF00B0FF)),
            tooltip: 'Avaliar Edges',
            onPressed: _loading || _propsResults.isEmpty ? null : _showEvaluation,
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
              color: Color(0xFF00B0FF),
            ),
          LastUpdatedBar(lastUpdated: _propsUpdated),
          PropsFilterBar(
            minEdge: _minEdge,
            selectedProp: _selectedProp,
            selectedTeam: _selectedTeam,
            hideWarnings: _hideWarnings,
            availableProps: _availableProps,
            availableTeams: _availableTeams,
            onEdgeChanged: (v) => setState(() => _minEdge = v),
            onPropChanged: (v) => setState(() => _selectedProp = v),
            onTeamChanged: (v) => setState(() => _selectedTeam = v),
            onHideWarningsChanged: (v) => setState(() => _hideWarnings = v),
          ),
          Expanded(
            child: _filtered.isEmpty && !_loading
                ? const _EmptyState(msg: 'Sem props NHL.\nAtualize para buscar.')
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    itemCount: _filtered.length,
                    itemBuilder: (_, i) => PropCard(prop: _filtered[i]),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _runUpdate,
        backgroundColor: const Color(0xFF00B0FF),
        icon: const Icon(Icons.play_arrow, color: Colors.white),
        label: const Text('Atualizar',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
