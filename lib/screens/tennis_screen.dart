import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/match_card.dart';
import '../widgets/status_bar.dart';
import '../widgets/last_updated_bar.dart';

class TennisScreen extends StatefulWidget {
  const TennisScreen({super.key});

  @override
  State<TennisScreen> createState() => _TennisScreenState();
}

class _TennisScreenState extends State<TennisScreen> {
  List<Map<String, dynamic>> _results = [];
  DateTime? _lastUpdated;
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
      final result = await ApiService.fetchTennisResults();
      setState(() {
        _results = result.data;
        _lastUpdated = result.lastUpdated;
      });
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _runPipeline() async {
    setState(() { _loading = true; _status = 'Atualizando ranking...'; });
    try {
      await ApiService.post('tennis/update-ranking');
      setState(() => _status = 'Buscando odds...');
      await ApiService.post('tennis/update-odds');
      setState(() => _status = 'Rodando modelo...');
      await ApiService.post('tennis/run-model');
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
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Row(
          children: [
            Text('🎾', style: TextStyle(fontSize: 20)),
            SizedBox(width: 8),
            Text('Tênis',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _loadResults,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_status.isNotEmpty) StatusBar(message: _status),
          if (_loading)
            const LinearProgressIndicator(
              backgroundColor: Color(0xFF1E1E2E),
              color: Color(0xFF7C4DFF),
            ),
          LastUpdatedBar(lastUpdated: _lastUpdated),
          Expanded(
            child: _results.isEmpty && !_loading
                ? const Center(
                    child: Text(
                      'Sem partidas disponíveis.\nRode o pipeline para atualizar.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Color(0xFF666666), fontSize: 15),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    itemCount: _results.length,
                    itemBuilder: (_, i) => MatchCard(match: _results[i]),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading ? null : _runPipeline,
        backgroundColor: const Color(0xFF7C4DFF),
        icon: const Icon(Icons.play_arrow, color: Colors.white),
        label: const Text('Atualizar',
            style: TextStyle(
                color: Colors.white, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
