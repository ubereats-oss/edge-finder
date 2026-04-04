import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/match_card.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  String _status = '';

  @override
  void initState() {
    super.initState();
    _loadResults();
  }

  Future<void> _loadResults() async {
    setState(() => _loading = true);
    try {
      final data = await ApiService.fetchResults();
      setState(() => _results = data);
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _runPipeline() async {
    setState(() {
      _loading = true;
      _status = 'Atualizando ranking...';
    });
    try {
      await ApiService.updateRanking();
      setState(() => _status = 'Buscando odds...');
      await ApiService.updateOdds();
      setState(() => _status = 'Rodando modelo...');
      await ApiService.runModel();
      setState(() => _status = 'Carregando resultados...');
      await _loadResults();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        title: const Text(
          'Tennis Edge',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _loadResults,
            tooltip: 'Recarregar resultados',
          ),
        ],
      ),
      body: Column(
        children: [
          if (_status.isNotEmpty)
            Container(
              width: double.infinity,
              color: const Color(0xFF1E1E2E),
              padding:
                  const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              child: Text(_status,
                  style: const TextStyle(
                      color: Color(0xFFAAAAAA), fontSize: 13)),
            ),
          if (_loading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E1E2E),
              color: Color(0xFF7C4DFF),
            ),
          Expanded(
            child: _results.isEmpty && !_loading
                ? const Center(
                    child: Text(
                      'Sem partidas disponíveis.\nRode o pipeline para atualizar.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Color(0xFF666666), fontSize: 15),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    itemCount: _results.length,
                    itemBuilder: (_, i) =>
                        MatchCard(match: _results[i]),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _runPipeline,
        backgroundColor: const Color(0xFF7C4DFF),
        icon: const Icon(Icons.play_arrow, color: Colors.white),
        label: const Text('Rodar Pipeline',
            style: TextStyle(
                color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
