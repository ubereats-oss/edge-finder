import 'package:flutter/material.dart';
import '../services/api_service.dart';

class AddLateBetScreen extends StatefulWidget {
  const AddLateBetScreen({super.key});

  @override
  State<AddLateBetScreen> createState() => _AddLateBetScreenState();
}

class _AddLateBetScreenState extends State<AddLateBetScreen> {
  bool _isProp = true;
  String _side = 'Over';
  DateTime _selectedDate = DateTime.now();
  bool _loading = false;
  bool _isVirtual = false;

  final _gameCtrl = TextEditingController();
  final _playerCtrl = TextEditingController();
  final _lineCtrl = TextEditingController();
  final _oddsCtrl = TextEditingController();
  final _stakeCtrl = TextEditingController();
  final _teamCtrl = TextEditingController();
  final _bookmakerCtrl = TextEditingController();
  final _modelProbCtrl = TextEditingController();

  String _prop = 'points';

  static const _propOptions = [
    ('points', 'Pontos'),
    ('rebounds', 'Rebotes'),
    ('assists', 'Assistências'),
    ('steals', 'Roubos'),
    ('threes', 'Cestas de 3'),
    ('hitsAllowed', 'Hits Permitidos'),
  ];

  @override
  void dispose() {
    _gameCtrl.dispose();
    _playerCtrl.dispose();
    _lineCtrl.dispose();
    _oddsCtrl.dispose();
    _stakeCtrl.dispose();
    _teamCtrl.dispose();
    _bookmakerCtrl.dispose();
    _modelProbCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 7)),
      builder: (ctx, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(primary: Color(0xFF00C853)),
        ),
        child: child!,
      ),
    );
    if (date == null) return;
    if (!mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_selectedDate),
      builder: (ctx, child) => Theme(
        data: ThemeData.dark().copyWith(
          colorScheme: const ColorScheme.dark(primary: Color(0xFF00C853)),
        ),
        child: child!,
      ),
    );
    setState(() {
      _selectedDate = DateTime(
        date.year, date.month, date.day,
        time?.hour ?? _selectedDate.hour,
        time?.minute ?? _selectedDate.minute,
      );
    });
  }

  Future<void> _submit() async {
    final game = _gameCtrl.text.trim();
    final odds = double.tryParse(_oddsCtrl.text.replaceAll(',', '.'));
    final stake = double.tryParse(_stakeCtrl.text.replaceAll(',', '.'));

    if (game.isEmpty || odds == null || stake == null) {
      _showError('Preencha jogo, odds e valor.');
      return;
    }

    if (_isProp) {
      final player = _playerCtrl.text.trim();
      final line = double.tryParse(_lineCtrl.text.replaceAll(',', '.'));
      if (player.isEmpty || line == null) {
        _showError('Preencha jogador e linha.');
        return;
      }
    } else {
      if (_teamCtrl.text.trim().isEmpty) {
        _showError('Preencha o time apostado.');
        return;
      }
    }

    setState(() => _loading = true);
    try {
      final modelProb =
          double.tryParse(_modelProbCtrl.text.replaceAll(',', '.')) ?? 0.0;
      final impliedProb = odds > 0 ? (1 / odds * 100) : 0.0;
      final edge = modelProb > 0 ? modelProb - impliedProb : 0.0;

      final Map<String, dynamic> data = {
        'type': _isProp ? 'prop' : 'h2h',
        'game': game,
        'commence_time': _selectedDate.toIso8601String(),
        'odds': odds,
        'stake': stake,
        'modelProb': modelProb,
        'impliedProb': impliedProb,
        'edge': edge,
        'kelly': 0.0,
        'virtual': _isVirtual,
        if (_bookmakerCtrl.text.trim().isNotEmpty)
          'bookmaker': _bookmakerCtrl.text.trim(),
        if (_isProp) ...{
          'player': _playerCtrl.text.trim(),
          'prop': _prop,
          'line': double.parse(
              _lineCtrl.text.replaceAll(',', '.')),
          'side': _side,
        } else ...{
          'team': _teamCtrl.text.trim(),
        },
      };

      await ApiService.createBet(data);
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      _showError(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  String get _dateLabel {
    final d = _selectedDate;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}  ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
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
        title: const Text('Registrar aposta',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF00C853)))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Tipo
                  _label('Tipo'),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _TypeChip(
                        label: 'Props',
                        selected: _isProp,
                        color: const Color(0xFF00C853),
                        onTap: () => setState(() => _isProp = true),
                      ),
                      const SizedBox(width: 10),
                      _TypeChip(
                        label: 'H2H',
                        selected: !_isProp,
                        color: const Color(0xFF7C4DFF),
                        onTap: () => setState(() => _isProp = false),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Data e hora
                  _label('Data e hora'),
                  const SizedBox(height: 6),
                  GestureDetector(
                    onTap: _pickDate,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 13),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A2A3E),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.calendar_today,
                              color: Color(0xFF888888), size: 16),
                          const SizedBox(width: 10),
                          Text(_dateLabel,
                              style: const TextStyle(
                                  color: Colors.white, fontSize: 14)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Jogo
                  _label('Jogo'),
                  const SizedBox(height: 6),
                  _Field(
                    controller: _gameCtrl,
                    hint: 'Ex: Portland Trail Blazers x San Antonio Spurs',
                  ),
                  const SizedBox(height: 16),

                  // H2H: time apostado
                  if (!_isProp) ...[
                    _label('Time apostado'),
                    const SizedBox(height: 6),
                    _Field(
                      controller: _teamCtrl,
                      hint: 'Ex: San Antonio Spurs',
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Props: jogador, prop, linha, lado
                  if (_isProp) ...[
                    _label('Jogador'),
                    const SizedBox(height: 6),
                    _Field(
                      controller: _playerCtrl,
                      hint: 'Ex: Jerami Grant',
                    ),
                    const SizedBox(height: 16),

                    _label('Prop'),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2A2A3E),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _prop,
                          isExpanded: true,
                          dropdownColor: const Color(0xFF2A2A3E),
                          style: const TextStyle(
                              color: Colors.white, fontSize: 14),
                          items: _propOptions
                              .map((p) => DropdownMenuItem(
                                    value: p.$1,
                                    child: Text(p.$2),
                                  ))
                              .toList(),
                          onChanged: (v) =>
                              setState(() => _prop = v ?? _prop),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _label('Linha'),
                              const SizedBox(height: 6),
                              _Field(
                                controller: _lineCtrl,
                                hint: '9.5',
                                numeric: true,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _label('Lado'),
                              const SizedBox(height: 6),
                              Row(
                                children: ['Over', 'Under'].map((s) {
                                  final sel = _side == s;
                                  return Expanded(
                                    child: GestureDetector(
                                      onTap: () =>
                                          setState(() => _side = s),
                                      child: Container(
                                        margin: EdgeInsets.only(
                                            right: s == 'Over' ? 6 : 0),
                                        padding: const EdgeInsets.symmetric(
                                            vertical: 13),
                                        decoration: BoxDecoration(
                                          color: sel
                                              ? const Color(0xFF00C853)
                                                  .withValues(alpha: 0.15)
                                              : const Color(0xFF2A2A3E),
                                          borderRadius:
                                              BorderRadius.circular(10),
                                          border: Border.all(
                                            color: sel
                                                ? const Color(0xFF00C853)
                                                : Colors.transparent,
                                          ),
                                        ),
                                        child: Center(
                                          child: Text(s,
                                              style: TextStyle(
                                                  color: sel
                                                      ? const Color(
                                                          0xFF00C853)
                                                      : const Color(
                                                          0xFF888888),
                                                  fontWeight:
                                                      FontWeight.bold,
                                                  fontSize: 13)),
                                        ),
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Odds e Stake
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('Odds (decimal)'),
                            const SizedBox(height: 6),
                            _Field(
                              controller: _oddsCtrl,
                              hint: '1.98',
                              numeric: true,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('Valor (R\$)'),
                            const SizedBox(height: 6),
                            _Field(
                              controller: _stakeCtrl,
                              hint: '50.00',
                              numeric: true,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Casa de apostas
                  _label('Casa de apostas (opcional)'),
                  const SizedBox(height: 6),
                  _Field(
                    controller: _bookmakerCtrl,
                    hint: 'Ex: Pinnacle',
                  ),
                  const SizedBox(height: 16),

                  // Prob. modelo
                  _label('Prob. do modelo % (opcional)'),
                  const SizedBox(height: 6),
                  _Field(
                    controller: _modelProbCtrl,
                    hint: '55.0',
                    numeric: true,
                  ),
                  const SizedBox(height: 16),

                  // Virtual
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                    decoration: BoxDecoration(
                      color: _isVirtual
                          ? const Color(0xFF00B0FF).withValues(alpha: 0.1)
                          : const Color(0xFF2A2A3E),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: _isVirtual
                            ? const Color(0xFF00B0FF).withValues(alpha: 0.5)
                            : Colors.transparent,
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Aposta virtual',
                                style: TextStyle(
                                    color: _isVirtual
                                        ? const Color(0xFF00B0FF)
                                        : Colors.white,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14)),
                            const Text('Contabilidade separada',
                                style: TextStyle(
                                    color: Color(0xFF888888), fontSize: 11)),
                          ],
                        ),
                        Switch(
                          value: _isVirtual,
                          onChanged: (v) => setState(() => _isVirtual = v),
                          activeThumbColor: const Color(0xFF00B0FF),
                          activeTrackColor: const Color(0xFF00B0FF).withValues(alpha: 0.4),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),

                  // Botão
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF00C853),
                        padding:
                            const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('Registrar aposta',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _label(String text) => Text(
        text,
        style: const TextStyle(color: Color(0xFF888888), fontSize: 12),
      );
}

class _TypeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;

  const _TypeChip({
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding:
            const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.15) : const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
              color: selected ? color : Colors.transparent),
        ),
        child: Text(label,
            style: TextStyle(
                color: selected ? color : const Color(0xFF888888),
                fontWeight: FontWeight.bold,
                fontSize: 14)),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final bool numeric;

  const _Field({
    required this.controller,
    required this.hint,
    this.numeric = false,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      style: const TextStyle(color: Colors.white, fontSize: 14),
      decoration: InputDecoration(
        filled: true,
        fillColor: const Color(0xFF2A2A3E),
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFF555566), fontSize: 13),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide.none,
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      ),
    );
  }
}
