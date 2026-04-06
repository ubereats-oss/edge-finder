import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/match_card.dart';
import '../widgets/prop_card.dart';
import '../widgets/props_filter_bar.dart';
import '../widgets/last_updated_bar.dart';
import '../widgets/status_bar.dart';

class BasketballBrScreen extends StatefulWidget {
  const BasketballBrScreen({super.key});

  @override
  State<BasketballBrScreen> createState() => _BasketballBrScreenState();
}

class _BasketballBrScreenState extends State<BasketballBrScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _h2hResults = [];
  List<Map<String, dynamic>> _propsResults = [];
  DateTime? _h2hUpdated;
  DateTime? _propsUpdated;
  bool _loading = false;
  String _status = '';
  double _minEdge = 0;
  String? _selectedProp;
  bool _hideWarnings = false;

  static const _min15 = Duration(minutes: 15);

  bool _jogoValido(Map<String, dynamic> item) {
    final raw = item['commence_time'] as String?;
    if (raw == null) {
      return true;
    }
    final dt = DateTime.tryParse(raw);
    if (dt == null) {
      return true;
    }
    return dt.difference(DateTime.now().toUtc()) >= _min15;
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() => _loading = true);
    try {
      final h2h = await ApiService.fetchNbaResults();
      final props = await ApiService.fetchNbaBrProps();
      setState(() {
        _h2hResults = h2h.data;
        _propsResults = props.data;
        _h2hUpdated = h2h.lastUpdated;
        _propsUpdated = props.lastUpdated;
      });
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _waitForWorkflow() async {
    // Polling até workflow concluir (máx 3 minutos)
    for (int i = 0; i < 36; i++) {
      await Future.delayed(const Duration(seconds: 5));
      try {
        final status = await ApiService.getWorkflowStatus();
        if (status == 'completed') {
          return;
        }
      } catch (_) {}
    }
  }

  Future<void> _runQuick() async {
    setState(() {
      _loading = true;
      _status = 'Acionando workflow...';
    });
    try {
      await ApiService.triggerUpdate('nba_br');
      setState(() => _status = 'Aguardando conclusão...');
      await _waitForWorkflow();
      setState(() => _status = 'Carregando...');
      await _loadAll();
      setState(() => _status = 'Concluído.');
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _runFull() async {
    setState(() {
      _loading = true;
      _status = 'Acionando atualização completa...';
    });
    try {
      await ApiService.triggerUpdate('nba');
      setState(() => _status = 'Aguardando conclusão (~20 min)...');
      await _waitForWorkflow();
      setState(() => _status = 'Carregando...');
      await _loadAll();
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

  void _showUpdateMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E1E2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Atualizar dados',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 24),
            _UpdateOption(
              icon: Icons.bolt,
              color: const Color(0xFFFFD600),
              title: 'Atualização rápida',
              subtitle: 'Odds e props do dia · ~30 segundos',
              onTap: () {
                Navigator.pop(context);
                _runQuick();
              },
            ),
            const SizedBox(height: 12),
            _UpdateOption(
              icon: Icons.sync,
              color: const Color(0xFF00C853),
              title: 'Atualização completa',
              subtitle: 'Scores + stats de jogadores · ~20 minutos',
              onTap: () {
                Navigator.pop(context);
                _runFull();
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  List<String> get _availableProps {
    return _propsResults
        .where(_jogoValido)
        .map((p) => p['prop'] as String)
        .toSet()
        .toList()
      ..sort();
  }

  List<Map<String, dynamic>> get _filteredH2h {
    return _h2hResults.where(_jogoValido).toList();
  }

  List<Map<String, dynamic>> get _filteredProps {
    return _propsResults.where((p) {
      if (!_jogoValido(p)) {
        return false;
      }
      final edge = (p['edge'] as num).toDouble();
      if (edge < _minEdge) {
        return false;
      }
      if (_selectedProp != null && p['prop'] != _selectedProp) {
        return false;
      }
      if (_hideWarnings && p['lowSample'] == true) {
        return false;
      }
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
            Text('🇧🇷', style: TextStyle(fontSize: 20)),
            SizedBox(width: 8),
            Text('Odds Brasil',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _loadAll,
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: const Color(0xFF00C853),
          labelColor: Colors.white,
          unselectedLabelColor: const Color(0xFF888888),
          tabs: const [Tab(text: 'H2H'), Tab(text: 'Props')],
        ),
      ),
      body: Column(
        children: [
          if (_status.isNotEmpty) StatusBar(message: _status),
          if (_loading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E1E2E),
              color: Color(0xFF00C853),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                // H2H
                Column(
                  children: [
                    LastUpdatedBar(lastUpdated: _h2hUpdated),
                    Expanded(
                      child: _filteredH2h.isEmpty && !_loading
                          ? const _EmptyState(
                              msg:
                                  'Sem jogos disponíveis.\nAtualize para buscar.')
                          : ListView.builder(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              itemCount: _filteredH2h.length,
                              itemBuilder: (_, i) =>
                                  MatchCard(match: _filteredH2h[i]),
                            ),
                    ),
                  ],
                ),
                // Props
                Column(
                  children: [
                    LastUpdatedBar(lastUpdated: _propsUpdated),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      color: const Color(0xFF00C853).withValues(alpha: 0.08),
                      child: const Row(
                        children: [
                          Icon(Icons.filter_alt,
                              color: Color(0xFF00C853), size: 14),
                          SizedBox(width: 6),
                          Text(
                            'Odds Pinnacle · Executável na Pinnacle e bet365',
                            style: TextStyle(
                                color: Color(0xFF00C853), fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                    PropsFilterBar(
                      minEdge: _minEdge,
                      selectedProp: _selectedProp,
                      hideWarnings: _hideWarnings,
                      availableProps: _availableProps,
                      onEdgeChanged: (v) => setState(() => _minEdge = v),
                      onPropChanged: (v) => setState(() => _selectedProp = v),
                      onHideWarningsChanged: (v) =>
                          setState(() => _hideWarnings = v),
                    ),
                    Expanded(
                      child: _filteredProps.isEmpty && !_loading
                          ? const _EmptyState(
                              msg:
                                  'Sem props disponíveis.\nAtualize ou aguarde a abertura dos mercados.')
                          : ListView.builder(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              itemCount: _filteredProps.length,
                              itemBuilder: (_, i) =>
                                  PropCard(prop: _filteredProps[i]),
                            ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _showUpdateMenu,
        backgroundColor: const Color(0xFF00C853),
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

class _UpdateOption extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _UpdateOption({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 12)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
