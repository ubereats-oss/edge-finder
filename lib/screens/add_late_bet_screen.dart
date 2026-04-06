import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../widgets/bet_dialog.dart';

class AddLateBetScreen extends StatefulWidget {
  const AddLateBetScreen({super.key});

  @override
  State<AddLateBetScreen> createState() => _AddLateBetScreenState();
}

class _AddLateBetScreenState extends State<AddLateBetScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  DateTime _selectedDate = DateTime.now().subtract(const Duration(days: 1));
  List<Map<String, dynamic>> _items = [];
  bool _loading = false;
  String? _selectedGame;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _fetch();
      }
    });
    _fetch();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  String get _dateStr {
    final d = _selectedDate;
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  String get _type => _tabController.index == 0 ? 'h2h' : 'props';

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _items = [];
      _selectedGame = null;
    });
    try {
      final data = await ApiService.fetchNbaHistory(_dateStr, _type);
      setState(() => _items = data);
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2026, 1, 1),
      lastDate: DateTime.now().subtract(const Duration(days: 1)),
      builder: (ctx, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(primary: Color(0xFF00C853)),
        ),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() => _selectedDate = picked);
      _fetch();
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  List<String> get _games {
    return _items
        .map((i) => '${i['away_team']} x ${i['home_team']}')
        .toSet()
        .toList()
      ..sort();
  }

  List<Map<String, dynamic>> get _filtered {
    if (_selectedGame == null) {
      return _items;
    }
    return _items.where((i) {
      final game = '${i['away_team']} x ${i['home_team']}';
      return game == _selectedGame;
    }).toList();
  }

  String _propLabel(String p) {
    const labels = {
      'player_points': 'Pontos',
      'player_rebounds': 'Rebotes',
      'player_assists': 'Assistências',
      'player_steals': 'Roubos',
      'player_threes': 'Cestas de 3',
    };
    return labels[p] ?? p;
  }

  void _openH2H(Map<String, dynamic> item) {
    final game = '${item['away_team']} x ${item['home_team']}';
    showBetDialog(
      context: context,
      title: game,
      subtitle: 'H2H · $_dateStr',
      odds: item['odds_away'] as double?,
      betData: {
        'type': 'h2h',
        'game': game,
        'commence_time': item['commence_time'],
        'edge': 0,
        'kelly': 0,
        'modelProb': 0,
        'impliedProb': 0,
      },
    );
  }

  void _openProp(Map<String, dynamic> item) {
    final game = '${item['away_team']} x ${item['home_team']}';
    final prop = ((item['prop'] as String?) ?? '').replaceAll('player_', '');
    showBetDialog(
      context: context,
      title: item['player'] as String,
      subtitle:
          '${item['line']} ${_propLabel((item['prop'] as String?) ?? '')}',
      oddsOver: (item['oddsOver'] as num?)?.toDouble(),
      oddsUnder: (item['oddsUnder'] as num?)?.toDouble(),
      betData: {
        'type': 'prop',
        'sport': 'nba',
        'player': item['player'],
        'prop': prop,
        'line': item['line'],
        'game': game,
        'commence_time': item['commence_time'],
        'edge': 0,
        'kelly': 0,
        'modelProb': 0,
        'impliedProb': 0,
      },
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
        title: const Text('Aposta atrasada',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
          Container(
            color: const Color(0xFF1A1A2E),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                const Text('Data:',
                    style: TextStyle(color: Color(0xFF888888), fontSize: 13)),
                const SizedBox(width: 10),
                GestureDetector(
                  onTap: _pickDate,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFF2A2A3E),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Text(_dateStr,
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold)),
                        const SizedBox(width: 6),
                        const Icon(Icons.calendar_today,
                            color: Color(0xFF888888), size: 14),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                if (_games.isNotEmpty)
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A2A3E),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String?>(
                          value: _selectedGame,
                          isExpanded: true,
                          dropdownColor: const Color(0xFF2A2A3E),
                          style: const TextStyle(
                              color: Colors.white, fontSize: 12),
                          hint: const Text('Todos os jogos',
                              style: TextStyle(
                                  color: Color(0xFF888888), fontSize: 12)),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('Todos os jogos',
                                  style: TextStyle(color: Color(0xFF888888))),
                            ),
                            ..._games.map((g) => DropdownMenuItem<String?>(
                                  value: g,
                                  child:
                                      Text(g, overflow: TextOverflow.ellipsis),
                                )),
                          ],
                          onChanged: (v) => setState(() => _selectedGame = v),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
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
                _filtered.isEmpty && !_loading
                    ? const Center(
                        child: Text('Sem dados para esta data.',
                            style: TextStyle(color: Color(0xFF666666))))
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _filtered.length,
                        itemBuilder: (_, i) {
                          final item = _filtered[i];
                          final game =
                              '${item['away_team']} x ${item['home_team']}';
                          return _HistoryCard(
                            title: game,
                            subtitle:
                                'Casa: @${item['odds_home']?.toStringAsFixed(2)}  ·  Fora: @${item['odds_away']?.toStringAsFixed(2)}',
                            onTap: () => _openH2H(item),
                          );
                        },
                      ),
                // Props
                _filtered.isEmpty && !_loading
                    ? const Center(
                        child: Text('Sem dados para esta data.',
                            style: TextStyle(color: Color(0xFF666666))))
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: _filtered.length,
                        itemBuilder: (_, i) {
                          final item = _filtered[i];
                          return _HistoryCard(
                            title: (item['player'] as String?) ?? '',
                            subtitle:
                                '${_propLabel((item['prop'] as String?) ?? '')} · Linha ${item['line']} · Over @${(item['oddsOver'] as num?)?.toStringAsFixed(2)} / Under @${(item['oddsUnder'] as num?)?.toStringAsFixed(2)}',
                            onTap: () => _openProp(item),
                          );
                        },
                      ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _HistoryCard({
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFF333355)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14)),
            const SizedBox(height: 4),
            Text(subtitle,
                style: const TextStyle(color: Color(0xFF888888), fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
