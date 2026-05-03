import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/prefs_service.dart';

const _defaultBookmakers = [
  'Pinnacle',
  'bet365',
  'Betano',
  'Sportingbet',
  'KTO',
  'Vai de Bet',
  'Outras',
];

Future<void> showBetDialog({
  required BuildContext context,
  required Map<String, dynamic> betData,
  required String title,
  required String subtitle,
  double? kellyPct,
  double? odds,
  double? oddsOver,
  double? oddsUnder,
  double? modelProb,
  double? originalLine,
  double? playerAvg,
  double? playerStd,
}) async {
  final banca = PrefsService.getBanca();
  final hasSides = oddsOver != null && oddsUnder != null;
  String selectedSide = (betData['side'] as String?) ?? 'Over';
  double currentOdds =
      hasSides ? (selectedSide == 'Over' ? oddsOver : oddsUnder) : (odds ?? 0);
  final sugerido =
      (kellyPct != null && banca > 0) ? banca * kellyPct / 100 : 0.0;
  final stakeController = TextEditingController(
    text: sugerido > 0 ? sugerido.toStringAsFixed(2) : '',
  );
  final oddsController = TextEditingController(
    text: currentOdds > 0 ? currentOdds.toStringAsFixed(2) : '',
  );
  final novaController = TextEditingController();
  final customBookmakers = PrefsService.getCustomBookmakers();
  final allBookmakers = [..._defaultBookmakers, ...customBookmakers];
  String? selectedBookmaker = PrefsService.getLastBookmaker();
  if (selectedBookmaker != null && !allBookmakers.contains(selectedBookmaker)) {
    selectedBookmaker = null;
  }
  final lineController = TextEditingController(
    text: originalLine != null ? originalLine.toStringAsFixed(1) : '',
  );

  double? _recalcEdge;
  double? _recalcKelly;

  void _recalculate([StateSetter? setState]) {
    final oddsVal = double.tryParse(oddsController.text.replaceAll(',', '.'));
    final lineVal = double.tryParse(lineController.text.replaceAll(',', '.'));
    void update(VoidCallback fn) => setState != null ? setState(fn) : fn();
    if (oddsVal == null || oddsVal <= 1) {
      update(() { _recalcEdge = null; _recalcKelly = null; });
      return;
    }
    double? prob;
    if (playerAvg != null && playerStd != null && playerStd > 0 && lineVal != null) {
      final z = (lineVal - playerAvg) / (playerStd * 1.4142135623730951);
      final t = 1 / (1 + 0.3275911 * z.abs());
      final erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-z * z);
      final cdf = 0.5 * (1 + (z >= 0 ? erf : -erf));
      prob = 1 - cdf;
    } else if (modelProb != null) {
      prob = modelProb! / 100;
    }
    if (prob == null) {
      update(() { _recalcEdge = null; _recalcKelly = null; });
      return;
    }
    final implied = 1 / oddsVal;
    final edge = (prob - implied) * 100;
    final b = oddsVal - 1;
    final kelly = edge > 0 ? ((prob * b - (1 - prob)) / b * 0.25 * 100) : 0.0;
    update(() { _recalcEdge = edge; _recalcKelly = kelly.clamp(0.0, 100.0); });
  }

  _recalculate();

  await showDialog(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) {
        final oddsVal =
            double.tryParse(oddsController.text.replaceAll(',', '.'));
        final stakeVal =
            double.tryParse(stakeController.text.replaceAll(',', '.'));
        final retorno =
            (oddsVal != null && stakeVal != null && oddsVal > 0 && stakeVal > 0)
                ? oddsVal * stakeVal
                : null;
        final edgeSnap = _recalcEdge;
        final kellySnap = _recalcKelly;
        return AlertDialog(
          backgroundColor: const Color(0xFF1E1E2E),
          title: Text(title,
              style: const TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(subtitle,
                    style: const TextStyle(
                        color: Color(0xFFAAAAAA), fontSize: 13)),
                const SizedBox(height: 16),
                if (hasSides) ...[
                  const Text('Lado',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  const SizedBox(height: 6),
                  Row(
                    children: ['Over', 'Under'].map((side) {
                      final isSelected = selectedSide == side;
                      final sideOdds = side == 'Over' ? oddsOver : oddsUnder;
                      return Expanded(
                        child: GestureDetector(
                          onTap: () {
                            setState(() {
                              selectedSide = side;
                              oddsController.text = sideOdds.toStringAsFixed(2);
                            });
                          },
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
                            child: Column(
                              children: [
                                Text(side,
                                    style: TextStyle(
                                        color: isSelected
                                            ? const Color(0xFF00C853)
                                            : const Color(0xFF888888),
                                        fontWeight: FontWeight.bold,
                                        fontSize: 13)),
                                Text('@${sideOdds.toStringAsFixed(2)}',
                                    style: TextStyle(
                                        color: isSelected
                                            ? const Color(0xFF00C853)
                                            : const Color(0xFF555566),
                                        fontSize: 11)),
                              ],
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                ],
                const Text('Odd',
                    style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: oddsController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  onChanged: (_) => _recalculate(setState),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                    hintText: '1.00',
                    hintStyle: const TextStyle(color: Color(0xFF555566)),
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Linha (ajustar se diferente)',
                    style:
                        TextStyle(color: Color(0xFF888888), fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: lineController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  onChanged: (_) => _recalculate(setState),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                    hintText: originalLine?.toStringAsFixed(1) ?? '-',
                    hintStyle:
                        const TextStyle(color: Color(0xFF555566)),
                  ),
                ),
                if (edgeSnap != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: (edgeSnap >= 5
                              ? const Color(0xFF00C853)
                              : edgeSnap >= 0
                                  ? const Color(0xFFFFD600)
                                  : const Color(0xFFFF1744))
                          .withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: edgeSnap >= 5
                            ? const Color(0xFF00C853)
                            : edgeSnap >= 0
                                ? const Color(0xFFFFD600)
                                : const Color(0xFFFF1744),
                      ),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Edge recalculado: ${edgeSnap.toStringAsFixed(2)}%',
                          style: TextStyle(
                            color: edgeSnap >= 5
                                ? const Color(0xFF00C853)
                                : edgeSnap >= 0
                                    ? const Color(0xFFFFD600)
                                    : const Color(0xFFFF1744),
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                        if (kellySnap != null && kellySnap > 0)
                          Text(
                            'Kelly: ${kellySnap.toStringAsFixed(1)}%',
                            style: const TextStyle(
                                color: Color(0xFF7C4DFF), fontSize: 12),
                          ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                const Text('Valor apostado (R\$)',
                    style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                const SizedBox(height: 6),
                TextField(
                  controller: stakeController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  onChanged: (_) => setState(() {}),
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
                if (sugerido > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Kelly sugere: R\$ ${sugerido.toStringAsFixed(2)} (${kellyPct!.toStringAsFixed(2)}%)',
                    style:
                        const TextStyle(color: Color(0xFF7C4DFF), fontSize: 11),
                  ),
                ],
                if (retorno != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: const Color(0xFF00C853).withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color:
                              const Color(0xFF00C853).withValues(alpha: 0.3)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Retorno potencial',
                            style: TextStyle(
                                color: Color(0xFF888888), fontSize: 12)),
                        Text('R\$ ${retorno.toStringAsFixed(2)}',
                            style: const TextStyle(
                                color: Color(0xFF00C853),
                                fontWeight: FontWeight.bold,
                                fontSize: 14)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                const Text('Casa de aposta',
                    style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2A2A3E),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<String?>(
                      value: selectedBookmaker,
                      isExpanded: true,
                      dropdownColor: const Color(0xFF2A2A3E),
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      hint: const Text('Não informar',
                          style: TextStyle(color: Color(0xFF555566))),
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('Não informar',
                              style: TextStyle(color: Color(0xFF888888))),
                        ),
                        ...[
                          ..._defaultBookmakers,
                          ...PrefsService.getCustomBookmakers()
                        ].map((b) => DropdownMenuItem<String?>(
                              value: b,
                              child: Text(b),
                            )),
                        const DropdownMenuItem<String?>(
                          value: '__nova__',
                          child: Text('+ Adicionar nova casa',
                              style: TextStyle(color: Color(0xFF7C4DFF))),
                        ),
                      ],
                      onChanged: (val) async {
                        if (val == '__nova__') {
                          final nova = await _showAddBookmakerDialog(
                              ctx, novaController);
                          if (nova != null && nova.isNotEmpty) {
                            PrefsService.addCustomBookmaker(nova);
                            setState(() => selectedBookmaker = nova);
                          }
                        } else {
                          setState(() => selectedBookmaker = val);
                        }
                      },
                    ),
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
                final oddsVal2 =
                    double.tryParse(oddsController.text.replaceAll(',', '.'));
                if (stake == null || stake <= 0) return;
                Navigator.pop(ctx);
                if (selectedBookmaker != null) {
                  PrefsService.setLastBookmaker(selectedBookmaker!);
                }
                try {
                  await ApiService.createBet({
                    ...betData,
                    'stake': stake,
                    'odds': oddsVal2 ?? betData['odds'],
                    'side': hasSides ? selectedSide : betData['side'],
                    'bookmaker': selectedBookmaker ?? '',
                  });
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('✓ Aposta registrada!'),
                        backgroundColor: Color(0xFF00C853),
                      ),
                    );
                  }
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                          content: Text(e.toString()),
                          backgroundColor: Colors.red),
                    );
                  }
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00C853),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('Registrar aposta',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    ),
  );
}

Future<String?> _showAddBookmakerDialog(
    BuildContext context, TextEditingController controller) async {
  controller.clear();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFF1E1E2E),
      title: const Text('Nova casa de aposta',
          style: TextStyle(color: Colors.white, fontSize: 16)),
      content: TextField(
        controller: controller,
        autofocus: true,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          filled: true,
          fillColor: const Color(0xFF2A2A3E),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide.none,
          ),
          hintText: 'Nome da casa',
          hintStyle: const TextStyle(color: Color(0xFF555566)),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancelar',
              style: TextStyle(color: Color(0xFF888888))),
        ),
        ElevatedButton(
          onPressed: () => Navigator.pop(ctx, controller.text.trim()),
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF7C4DFF),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          child: const Text('Adicionar', style: TextStyle(color: Colors.white)),
        ),
      ],
    ),
  );
}
