import 'dart:convert';
import 'package:excel/excel.dart' as xl;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import '../services/api_service.dart';
import '../services/prefs_service.dart';
import '../utils/file_saver.dart';
import 'add_late_bet_screen.dart';

class BetsScreen extends StatefulWidget {
  const BetsScreen({super.key});

  @override
  State<BetsScreen> createState() => _BetsScreenState();
}

class _BetsScreenState extends State<BetsScreen> {
  List<Map<String, dynamic>> _bets = [];
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final bets = await ApiService.fetchBets();
      setState(() => _bets = bets.reversed.toList());
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _resolve(String id) async {
    final bet = _bets.firstWhere((b) => b['id'] == id);
    final isProp = bet['type'] != 'h2h';
    if (isProp) {
      setState(() => _loading = true);
      try {
        final live = await ApiService.fetchLiveStatAndTime(bet);
        setState(() => _loading = false);
        if (!mounted) return;
        if (live['completed'] == true) {
          await ApiService.resolveBet(id);
          await _load();
          return;
        }
        final state = live['state'] as String;
        final timeInfo = live['timeInfo'] as String;
        final realValue = live['realValue'];
        final minutesPlayed = live['minutesPlayed'] as int? ?? 0;
        final propLabel = _propLabel(bet['prop'] as String? ?? '');
        final line = (bet['line'] as num).toDouble();
        final side = bet['side'] as String? ?? 'Over';
        final isWinning = realValue != null &&
            (side == 'Over' ? realValue > line : realValue < line);
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: Container(
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              decoration: BoxDecoration(
                  color: const Color(0xFFFF6D00),
                  borderRadius: BorderRadius.circular(8)),
              child: const Text('🔴  EM ANDAMENTO',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 18,
                      letterSpacing: 1)),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(timeInfo,
                    style: const TextStyle(
                        color: Color(0xFFAAAAAA), fontSize: 14)),
                const SizedBox(height: 16),
                Text(bet['player'] as String? ?? '',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16)),
                const SizedBox(height: 4),
                Text('$side $line $propLabel',
                    style: const TextStyle(
                        color: Color(0xFF888888), fontSize: 13)),
                const SizedBox(height: 16),
                if (realValue != null) ...[
                  Text('Valor atual',
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 12)),
                  const SizedBox(height: 4),
                  Text(realValue.toStringAsFixed(0),
                      style: TextStyle(
                          color: isWinning
                              ? const Color(0xFF00C853)
                              : const Color(0xFFFF1744),
                          fontWeight: FontWeight.bold,
                          fontSize: 40)),
                  const SizedBox(height: 8),
                  Text(isWinning ? '✅ Ganhando' : '❌ Perdendo',
                      style: TextStyle(
                          color: isWinning
                              ? const Color(0xFF00C853)
                              : const Color(0xFFFF1744),
                          fontWeight: FontWeight.bold,
                          fontSize: 15)),
                  const SizedBox(height: 12),
                  Text('⏱ Tempo em quadra: ${minutesPlayed}min',
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 13)),
                ] else
                  const Text('Stat não disponível ainda',
                      style: TextStyle(color: Color(0xFF888888))),
              ],
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar',
                      style: TextStyle(color: Color(0xFF888888)))),
              if (state == 'post')
                ElevatedButton(
                  onPressed: () async {
                    Navigator.pop(ctx);
                    setState(() => _loading = true);
                    await ApiService.resolveBet(id);
                    await _load();
                  },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF00C853)),
                  child: const Text('Resolver',
                      style: TextStyle(
                          color: Colors.white, fontWeight: FontWeight.bold)),
                ),
            ],
          ),
        );
      } catch (e) {
        setState(() => _loading = false);
        final msg = e.toString();
        final isNotFound =
            msg.contains('não encontrado') || msg.contains('not found');
        if (!mounted) return;
        await showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: const Color(0xFF1A1A2E),
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
            title: const Text('⏳ Jogo não iniciado',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 18)),
            content: Text(
              isNotFound
                  ? 'O jogo não foi encontrado na ESPN.\n\nProvavelmente ainda não começou ou os dados ainda não estão disponíveis.'
                  : msg,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 14),
            ),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('Fechar',
                      style: TextStyle(color: Color(0xFF888888)))),
            ],
          ),
        );
      }
      return;
    }
    setState(() => _loading = true);
    try {
      await ApiService.resolveBet(id);
      await _load();
    } catch (e) {
      _showError(e.toString());
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _delete(String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E1E2E),
        title:
            const Text('Remover aposta', style: TextStyle(color: Colors.white)),
        content: const Text('Tem certeza que deseja remover esta aposta?',
            style: TextStyle(color: Color(0xFFAAAAAA))),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar',
                style: TextStyle(color: Color(0xFF888888))),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFFF1744)),
            child: const Text('Remover', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirm == true) {
      await ApiService.deleteBet(id);
      await _load();
    }
  }

  Future<void> _edit(Map<String, dynamic> bet) async {
    final isProp = bet['type'] != 'h2h';
    final isResolved = bet['status'] == 'resolved';
    final stakeController = TextEditingController(
      text: (bet['stake'] as num).toStringAsFixed(2),
    );
    final oddsController = TextEditingController(
      text: (bet['odds'] as num).toStringAsFixed(2),
    );
    final modelProbController = TextEditingController(
      text: (bet['modelProb'] as num?) != null && (bet['modelProb'] as num) > 0
          ? (bet['modelProb'] as num).toStringAsFixed(1)
          : '',
    );
    String selectedSide = (bet['side'] as String?) ?? 'Over';
    bool wonOverride = bet['won'] as bool? ?? false;
    bool? manualResult; // null = manter pendente, true/false = encerrar

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          backgroundColor: const Color(0xFF1E1E2E),
          title: const Text('Editar aposta',
              style: TextStyle(color: Colors.white, fontSize: 16)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isProp) ...[
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text('Lado',
                        style:
                            TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: ['Over', 'Under'].map((side) {
                      final isSelected = selectedSide == side;
                      return Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => selectedSide = side),
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
                            child: Center(
                              child: Text(side,
                                  style: TextStyle(
                                      color: isSelected
                                          ? const Color(0xFF00C853)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 12),
                ],
                if (!isResolved) ...[
                  const Divider(color: Color(0xFF333355)),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text('Encerrar aposta',
                        style:
                            TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => manualResult =
                              manualResult == true ? null : true),
                          child: Container(
                            margin: const EdgeInsets.only(right: 6),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: manualResult == true
                                  ? const Color(0xFF00C853)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: manualResult == true
                                    ? const Color(0xFF00C853)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Center(
                              child: Text('✅ Ganhou',
                                  style: TextStyle(
                                      color: manualResult == true
                                          ? const Color(0xFF00C853)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => manualResult =
                              manualResult == false ? null : false),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: manualResult == false
                                  ? const Color(0xFFFF1744)
                                      .withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: manualResult == false
                                    ? const Color(0xFFFF1744)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Center(
                              child: Text('❌ Perdeu',
                                  style: TextStyle(
                                      color: manualResult == false
                                          ? const Color(0xFFFF1744)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                ],
                if (isResolved) ...[
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text('Resultado real',
                        style:
                            TextStyle(color: Color(0xFF888888), fontSize: 12)),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => wonOverride = true),
                          child: Container(
                            margin: const EdgeInsets.only(right: 6),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: wonOverride
                                  ? const Color(0xFF00C853).withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: wonOverride
                                    ? const Color(0xFF00C853)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Center(
                              child: Text('✅ Ganhou',
                                  style: TextStyle(
                                      color: wonOverride
                                          ? const Color(0xFF00C853)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => setState(() => wonOverride = false),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: !wonOverride
                                  ? const Color(0xFFFF1744).withValues(alpha: 0.15)
                                  : const Color(0xFF2A2A3E),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: !wonOverride
                                    ? const Color(0xFFFF1744)
                                    : Colors.transparent,
                              ),
                            ),
                            child: Center(
                              child: Text('❌ Perdeu',
                                  style: TextStyle(
                                      color: !wonOverride
                                          ? const Color(0xFFFF1744)
                                          : const Color(0xFF888888),
                                      fontWeight: FontWeight.bold,
                                      fontSize: 13)),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                ],
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Probabilidade do modelo (%)',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: modelProbController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                    hintText: '0.0',
                    hintStyle: const TextStyle(color: Color(0xFF555566)),
                    suffixText: '%',
                    suffixStyle: const TextStyle(color: Color(0xFF888888)),
                  ),
                ),
                const SizedBox(height: 12),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Odd',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: oddsController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: const Color(0xFF2A2A3E),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Valor apostado (R\$)',
                      style: TextStyle(color: Color(0xFF888888), fontSize: 12)),
                ),
                const SizedBox(height: 6),
                TextField(
                  controller: stakeController,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Colors.white),
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
                final odds =
                    double.tryParse(oddsController.text.replaceAll(',', '.'));
                if (stake == null || odds == null) return;
                final modelProb = double.tryParse(
                    modelProbController.text.replaceAll(',', '.'));
                Navigator.pop(ctx);
                final resolvedWon =
                    isResolved ? wonOverride : manualResult;
                final profit = resolvedWon != null
                    ? (resolvedWon
                        ? double.parse(
                            ((odds - 1) * stake).toStringAsFixed(2))
                        : double.parse((-stake).toStringAsFixed(2)))
                    : null;
                await ApiService.updateBet(bet['id'] as String, {
                  'stake': stake,
                  'odds': odds,
                  if (isProp) 'side': selectedSide,
                  if (modelProb != null) 'modelProb': modelProb,
                  if (resolvedWon != null) 'won': resolvedWon,
                  if (profit != null) 'profit': profit,
                  if (!isResolved && manualResult != null) ...{
                    'status': 'resolved',
                    'resolvedAt': DateTime.now().toIso8601String(),
                    'realValue': manualResult! ? 'Manual' : 'Manual',
                  },
                });
                await _load();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7C4DFF),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8)),
              ),
              child: const Text('Salvar',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  static const _statFullName = {
    'points': 'Total Points',
    'rebounds': 'Total Rebounds',
    'assists': 'Total Assists',
    'steals': 'Total Steals',
    'threes': 'Three Point Field Goals Made',
    'hitsAllowed': 'Hits Allowed',
  };

  String _sportForBet(Map<String, dynamic> b) {
    final prop = b['prop'] as String? ?? '';
    if (prop == 'hitsAllowed') return 'Beisebol';
    return 'Basquete';
  }

  String _dateExcel(String? raw) {
    if (raw == null) return '';
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
  }

  String _betDescExcel(Map<String, dynamic> b) {
    if (b['type'] == 'h2h') {
      return b['team'] as String? ?? b['game'] as String? ?? '';
    }
    final player = b['player'] as String? ?? '';
    final prop = b['prop'] as String? ?? '';
    final statName = _statFullName[prop] ?? prop;
    final side = b['side'] as String? ?? 'Over';
    final sidePt = side == 'Over' ? 'Mais de' : 'Menos de';
    final line = b['line'];
    final propPt = _propLabel(prop);
    return '$player - $statName\n$sidePt +$line $propPt';
  }

  Future<void> _exportExcel() async {
    final ex = xl.Excel.createExcel();
    final sheetName = 'Apostas';
    final sheet = ex[sheetName];
    ex.delete('Sheet1');

    const headers = [
      'Esporte', 'Data', 'Jogo', 'Props', 'Aposta',
      'Probabilidades', 'Aposta (BRL)', 'Saldo / Déficit', 'Status',
    ];
    for (int i = 0; i < headers.length; i++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: i, rowIndex: 0))
          .value = xl.TextCellValue(headers[i]);
    }

    double totalStake = 0;
    double totalProfit = 0;

    for (int i = 0; i < _bets.length; i++) {
      final b = _bets[i];
      final row = i + 1;
      final isPending = b['status'] != 'resolved';
      final profit = (b['profit'] as num?)?.toDouble();
      final stake = (b['stake'] as num).toDouble();
      final odds = (b['odds'] as num).toDouble();
      final isH2h = b['type'] == 'h2h';

      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 0, rowIndex: row)).value =
          xl.TextCellValue(_sportForBet(b));
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 1, rowIndex: row)).value =
          xl.TextCellValue(_dateExcel(b['commence_time'] as String?));
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 2, rowIndex: row)).value =
          xl.TextCellValue((b['game'] as String? ?? '').replaceAll(' x ', '\nx\n'));
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 3, rowIndex: row)).value =
          xl.TextCellValue(isH2h ? '' : _propLabel(b['prop'] as String? ?? ''));
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 4, rowIndex: row)).value =
          xl.TextCellValue(_betDescExcel(b));
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 5, rowIndex: row)).value =
          xl.DoubleCellValue(odds);
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 6, rowIndex: row)).value =
          xl.DoubleCellValue(stake);
      if (profit != null) {
        sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 7, rowIndex: row)).value =
            xl.DoubleCellValue(profit);
      }
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 8, rowIndex: row)).value =
          xl.TextCellValue(isPending ? 'Pendente' : (b['won'] == true ? 'Ganhou' : 'Perdeu'));

      totalStake += stake;
      totalProfit += profit ?? 0;
    }

    final totalRow = _bets.length + 1;
    sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 1, rowIndex: totalRow)).value =
        xl.TextCellValue('Total');
    sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 6, rowIndex: totalRow)).value =
        xl.DoubleCellValue(totalStake);
    sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: 7, rowIndex: totalRow)).value =
        xl.DoubleCellValue(totalProfit);

    final bytes = ex.encode()!;
    await saveAndShareFile(
        bytes, 'apostas_${DateTime.now().millisecondsSinceEpoch}.xlsx');
  }

  Future<void> _exportPdf() async {
    final doc = pw.Document();
    final resolved = _resolved;
    final pending = _pending;
    final totalProfit = resolved.isEmpty
        ? 0.0
        : resolved.fold(0.0, (s, b) => s + (b['profit'] as num).toDouble());
    final wins = resolved.where((b) => b['won'] == true).length;

    pw.Widget cell(String text,
        {pw.TextStyle? style, pw.Alignment align = pw.Alignment.centerLeft}) {
      return pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 3),
        child: pw.Align(
          alignment: align,
          child: pw.Text(text,
              style: style ?? const pw.TextStyle(fontSize: 7)),
        ),
      );
    }

    pw.TableRow betRow(Map<String, dynamic> b, {required bool isResolved}) {
      final isProp = b['type'] != 'h2h';
      final desc = isProp
          ? '${b['player']}  ${b['side']} ${b['line']}  ${_propLabel(b['prop'] as String? ?? '')}'
          : (b['team'] as String? ?? b['game'] as String? ?? '');
      final game = b['game'] as String? ?? '';
      final date = _formatDate(b['commence_time'] as String?);
      final odds =
          '@${(b['odds'] as num).toStringAsFixed(2)}  R\$ ${(b['stake'] as num).toStringAsFixed(2)}';
      final result = isResolved
          ? '${b['won'] == true ? 'GANHOU' : 'PERDEU'}  ${b['profit'] != null ? '${(b['profit'] as num) >= 0 ? '+' : ''}R\$ ${(b['profit'] as num).toStringAsFixed(2)}' : ''}'
          : 'Pendente';
      final resultStyle = pw.TextStyle(
        fontSize: 7,
        fontWeight: pw.FontWeight.bold,
        color: isResolved
            ? (b['won'] == true ? PdfColors.green700 : PdfColors.red700)
            : PdfColors.amber700,
      );
      return pw.TableRow(children: [
        cell('$date\n$game', style: const pw.TextStyle(fontSize: 6.5)),
        cell(desc),
        cell(odds, align: pw.Alignment.center),
        cell(result, style: resultStyle, align: pw.Alignment.center),
      ]);
    }

    doc.addPage(pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (ctx) => [
        pw.Text('Minhas Apostas — Edge Finder',
            style: pw.TextStyle(
                fontSize: 14, fontWeight: pw.FontWeight.bold)),
        pw.Text(
            'Exportado em ${_formatDate(DateTime.now().toIso8601String())}',
            style: const pw.TextStyle(fontSize: 8, color: PdfColors.grey600)),
        pw.SizedBox(height: 10),
        if (resolved.isNotEmpty) ...[
          pw.Container(
            padding: const pw.EdgeInsets.all(8),
            decoration: pw.BoxDecoration(
              border: pw.Border.all(color: PdfColors.grey300),
              borderRadius: pw.BorderRadius.circular(6),
            ),
            child: pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceAround,
                children: [
                  pw.Column(children: [
                    pw.Text('Apostas',
                        style: const pw.TextStyle(
                            fontSize: 8, color: PdfColors.grey600)),
                    pw.Text('${resolved.length}',
                        style: pw.TextStyle(
                            fontSize: 11, fontWeight: pw.FontWeight.bold)),
                  ]),
                  pw.Column(children: [
                    pw.Text('Acertos',
                        style: const pw.TextStyle(
                            fontSize: 8, color: PdfColors.grey600)),
                    pw.Text(
                        '${(wins / resolved.length * 100).toStringAsFixed(1)}%',
                        style: pw.TextStyle(
                            fontSize: 11, fontWeight: pw.FontWeight.bold)),
                  ]),
                  pw.Column(children: [
                    pw.Text('Lucro',
                        style: const pw.TextStyle(
                            fontSize: 8, color: PdfColors.grey600)),
                    pw.Text(
                        '${totalProfit >= 0 ? '+' : ''}R\$ ${totalProfit.toStringAsFixed(2)}',
                        style: pw.TextStyle(
                            fontSize: 11,
                            fontWeight: pw.FontWeight.bold,
                            color: totalProfit >= 0
                                ? PdfColors.green700
                                : PdfColors.red700)),
                  ]),
                ]),
          ),
          pw.SizedBox(height: 12),
          pw.Text('RESOLVIDAS',
              style: pw.TextStyle(
                  fontSize: 9,
                  fontWeight: pw.FontWeight.bold,
                  color: PdfColors.grey600)),
          pw.SizedBox(height: 4),
          pw.Table(
            columnWidths: {
              0: const pw.FlexColumnWidth(2),
              1: const pw.FlexColumnWidth(3),
              2: const pw.FlexColumnWidth(2),
              3: const pw.FlexColumnWidth(2),
            },
            border: pw.TableBorder.all(color: PdfColors.grey300, width: 0.5),
            children: [
              pw.TableRow(
                decoration:
                    const pw.BoxDecoration(color: PdfColors.grey200),
                children: [
                  cell('Data / Jogo',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold)),
                  cell('Aposta',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold)),
                  cell('Odds / Stake',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold),
                      align: pw.Alignment.center),
                  cell('Resultado',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold),
                      align: pw.Alignment.center),
                ],
              ),
              ...resolved.map((b) => betRow(b, isResolved: true)),
            ],
          ),
        ],
        if (pending.isNotEmpty) ...[
          pw.SizedBox(height: 12),
          pw.Text('PENDENTES',
              style: pw.TextStyle(
                  fontSize: 9,
                  fontWeight: pw.FontWeight.bold,
                  color: PdfColors.grey600)),
          pw.SizedBox(height: 4),
          pw.Table(
            columnWidths: {
              0: const pw.FlexColumnWidth(2),
              1: const pw.FlexColumnWidth(3),
              2: const pw.FlexColumnWidth(2),
              3: const pw.FlexColumnWidth(2),
            },
            border: pw.TableBorder.all(color: PdfColors.grey300, width: 0.5),
            children: [
              pw.TableRow(
                decoration:
                    const pw.BoxDecoration(color: PdfColors.grey200),
                children: [
                  cell('Data / Jogo',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold)),
                  cell('Aposta',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold)),
                  cell('Odds / Stake',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold),
                      align: pw.Alignment.center),
                  cell('Status',
                      style: pw.TextStyle(
                          fontSize: 7, fontWeight: pw.FontWeight.bold),
                      align: pw.Alignment.center),
                ],
              ),
              ...pending.map((b) => betRow(b, isResolved: false)),
            ],
          ),
        ],
      ],
    ));

    await Printing.sharePdf(
      bytes: await doc.save(),
      filename: 'apostas_${DateTime.now().millisecondsSinceEpoch}.pdf',
    );
  }

  String _buildExportText() {
    final now = DateTime.now();
    final dateStr =
        '${now.day.toString().padLeft(2, '0')}/${now.month.toString().padLeft(2, '0')}/${now.year}';
    final buf = StringBuffer();
    buf.writeln('MINHAS APOSTAS — EDGE FINDER');
    buf.writeln('Exportado em $dateStr');
    buf.writeln('=' * 40);
    if (_resolved.isNotEmpty) {
      final winRate = _wins / _resolved.length * 100;
      buf.writeln('');
      buf.writeln('RESUMO');
      buf.writeln('Apostas resolvidas: ${_resolved.length}');
      buf.writeln('Acertos: $_wins (${winRate.toStringAsFixed(1)}%)');
      buf.writeln(
          'Lucro total: ${_totalProfit >= 0 ? '+' : ''}R\$ ${_totalProfit.toStringAsFixed(2)}');
      buf.writeln('-' * 40);
    }
    if (_pending.isNotEmpty) {
      buf.writeln('');
      buf.writeln('PENDENTES (${_pending.length})');
      buf.writeln('-' * 40);
      for (final b in _pending) {
        _appendBet(buf, b);
      }
    }
    if (_resolved.isNotEmpty) {
      buf.writeln('');
      buf.writeln('RESOLVIDAS (${_resolved.length})');
      buf.writeln('-' * 40);
      for (final b in _resolved) {
        _appendBet(buf, b);
      }
    }
    return buf.toString();
  }

  void _appendBet(StringBuffer buf, Map<String, dynamic> b) {
    final isH2h = b['type'] == 'h2h';
    final isPending = b['status'] == 'pending';
    final title = isH2h
        ? (b['team'] as String? ?? b['game'] as String? ?? '')
        : (b['player'] as String? ?? '');
    final desc = isH2h
        ? 'Vitória · ${b['game'] as String? ?? ''}'
        : '${b['side']} ${b['line']} ${_propLabel(b['prop'] as String? ?? '')}';
    final date = _formatDate(b['commence_time'] as String?);
    final odds = (b['odds'] as num).toStringAsFixed(2);
    final stake = (b['stake'] as num).toStringAsFixed(2);
    final profit = (b['profit'] as num?)?.toDouble();
    final won = b['won'] as bool?;
    final bookmaker = b['bookmaker'] as String?;

    buf.writeln('• $title');
    buf.writeln('  $desc');
    if (date.isNotEmpty) buf.writeln('  $date');
    if (bookmaker != null && bookmaker.isNotEmpty) buf.writeln('  Casa: $bookmaker');
    buf.write('  @$odds  R\$ $stake');
    if (!isPending && profit != null) {
      buf.write(
          '  →  ${won == true ? '✅' : '❌'} ${profit >= 0 ? '+' : ''}R\$ ${profit.toStringAsFixed(2)}');
    } else {
      buf.write('  ⏳ Pendente');
    }
    buf.writeln();
    buf.writeln();
  }

  void _showExportOptionsTxt() {
    final text = _buildExportText();
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E1E2E),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetCtx) {
        final messenger = ScaffoldMessenger.of(context);
        return Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Exportar como',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 16),
              _BetsExportOption(
                icon: Icons.share,
                color: const Color(0xFF25D366),
                title: 'Compartilhar',
                subtitle: 'WhatsApp, Telegram e outros apps',
                onTap: () {
                  Navigator.pop(sheetCtx);
                  Share.share(text, subject: 'Minhas Apostas — Edge Finder');
                },
              ),
              const SizedBox(height: 10),
              _BetsExportOption(
                icon: Icons.copy,
                color: const Color(0xFF7C4DFF),
                title: 'Copiar para área de transferência',
                subtitle: 'Cole onde quiser',
                onTap: () async {
                  Navigator.pop(sheetCtx);
                  await Clipboard.setData(ClipboardData(text: text));
                  messenger.showSnackBar(
                    const SnackBar(
                      content: Text('Copiado para a área de transferência!'),
                      duration: Duration(seconds: 2),
                    ),
                  );
                },
              ),
              const SizedBox(height: 10),
              _BetsExportOption(
                icon: Icons.save_alt,
                color: const Color(0xFF00B0FF),
                title: 'Salvar como TXT',
                subtitle: 'Baixar arquivo apostas.txt',
                onTap: () {
                  Navigator.pop(sheetCtx);
                  saveAndShareFile(
                    utf8.encode(text),
                    'apostas_${DateTime.now().millisecondsSinceEpoch}.txt',
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  String _propLabel(String p) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': 'Cestas de 3',
    };
    return labels[p] ?? p;
  }

  String _formatDate(String? raw) {
    if (raw == null) return '';
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  List<Map<String, dynamic>> get _pending =>
      _bets.where((b) => b['status'] == 'pending').toList();
  List<Map<String, dynamic>> get _resolved =>
      _bets.where((b) => b['status'] == 'resolved').toList();

  double get _totalProfit =>
      _resolved.fold(0.0, (s, b) => s + (b['profit'] as num).toDouble());
  int get _wins => _resolved.where((b) => b['won'] == true).length;

  @override
  Widget build(BuildContext context) {
    final banca = PrefsService.getBanca();

    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Minhas Apostas',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.table_view, color: Color(0xFF00B0FF)),
            tooltip: 'Exportar Excel',
            onPressed: _loading || _bets.isEmpty ? null : _exportExcel,
          ),
          IconButton(
            icon: const Icon(Icons.picture_as_pdf, color: Color(0xFFFF6D00)),
            tooltip: 'Exportar PDF',
            onPressed: _loading || _bets.isEmpty ? null : _exportPdf,
          ),
          IconButton(
            icon: const Icon(Icons.ios_share, color: Color(0xFF25D366)),
            tooltip: 'Exportar TXT',
            onPressed: _loading || _bets.isEmpty ? null : _showExportOptionsTxt,
          ),
          IconButton(
            icon: const Icon(Icons.history, color: Color(0xFF00C853)),
            tooltip: 'Aposta atrasada',
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AddLateBetScreen()),
              );
              _load();
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: Color(0xFF00C853)))
          : _bets.isEmpty
              ? const Center(
                  child: Text('Nenhuma aposta registrada.',
                      style: TextStyle(color: Color(0xFF666666), fontSize: 15)))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    if (_resolved.isNotEmpty) ...[
                      _SummaryCard(
                        total: _resolved.length,
                        wins: _wins,
                        profit: _totalProfit,
                        banca: banca,
                      ),
                      const SizedBox(height: 16),
                    ],
                    if (_pending.isNotEmpty) ...[
                      const _SectionLabel(text: 'PENDENTES'),
                      const SizedBox(height: 8),
                      ..._pending.map((b) => _BetCard(
                            bet: b,
                            propLabel: _propLabel,
                            formatDate: _formatDate,
                            onResolve: () => _resolve(b['id'] as String),
                            onEdit: () => _edit(b),
                            onDelete: () => _delete(b['id'] as String),
                          )),
                      const SizedBox(height: 16),
                    ],
                    if (_resolved.isNotEmpty) ...[
                      const _SectionLabel(text: 'RESOLVIDAS'),
                      const SizedBox(height: 8),
                      ..._resolved.map((b) => _BetCard(
                            bet: b,
                            propLabel: _propLabel,
                            formatDate: _formatDate,
                            onResolve: null,
                            onEdit: () => _edit(b),
                            onDelete: () => _delete(b['id'] as String),
                          )),
                    ],
                  ],
                ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel({required this.text});

  @override
  Widget build(BuildContext context) {
    return Text(text,
        style: const TextStyle(
            color: Color(0xFF888888),
            fontSize: 11,
            fontWeight: FontWeight.bold,
            letterSpacing: 1));
  }
}

class _SummaryCard extends StatelessWidget {
  final int total;
  final int wins;
  final double profit;
  final double banca;

  const _SummaryCard({
    required this.total,
    required this.wins,
    required this.profit,
    required this.banca,
  });

  @override
  Widget build(BuildContext context) {
    final winRate = total > 0 ? (wins / total * 100) : 0.0;
    final profitColor =
        profit >= 0 ? const Color(0xFF00C853) : const Color(0xFFFF1744);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF333355)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('RESUMO',
              style: TextStyle(
                  color: Color(0xFF888888),
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1)),
          const SizedBox(height: 12),
          Row(
            children: [
              _MiniStat(label: 'Apostas', value: total.toString()),
              _MiniStat(
                  label: 'Acertos', value: '${winRate.toStringAsFixed(1)}%'),
              _MiniStat(
                label: 'Lucro',
                value:
                    '${profit >= 0 ? '+' : ''}R\$ ${profit.toStringAsFixed(2)}',
                color: profitColor,
              ),
              if (banca > 0)
                _MiniStat(
                  label: 'ROI',
                  value: '${(profit / banca * 100).toStringAsFixed(1)}%',
                  color: profitColor,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _MiniStat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(label,
              style: const TextStyle(color: Color(0xFF888888), fontSize: 10)),
          const SizedBox(height: 4),
          Text(value,
              style: TextStyle(
                  color: color ?? Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _BetCard extends StatefulWidget {
  final Map<String, dynamic> bet;
  final String Function(String) propLabel;
  final String Function(String?) formatDate;
  final VoidCallback? onResolve;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _BetCard({
    required this.bet,
    required this.propLabel,
    required this.formatDate,
    required this.onResolve,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<_BetCard> createState() => _BetCardState();
}

class _BetCardState extends State<_BetCard> {
  bool _showAnalysis = false;

  Map<String, dynamic> _analyze() {
    final bet = widget.bet;
    final modelProb = (bet['modelProb'] as num?)?.toDouble() ?? 0;
    final odds = (bet['odds'] as num).toDouble();
    final stake = (bet['stake'] as num).toDouble();
    final won = bet['won'] as bool;
    final profit = (bet['profit'] as num).toDouble();

    final impliedProb =
        modelProb > 0 && ((bet['impliedProb'] as num?)?.toDouble() ?? 0) == 0
            ? (1 / odds * 100)
            : (bet['impliedProb'] as num?)?.toDouble() ?? 0;
    final edge = modelProb > 0 && ((bet['edge'] as num?)?.toDouble() ?? 0) == 0
        ? modelProb - (1 / odds * 100)
        : (bet['edge'] as num?)?.toDouble() ?? 0;

    final ev = modelProb > 0
        ? (modelProb / 100) * (odds - 1) * stake - (1 - modelProb / 100) * stake
        : null;
    final evRealizado = profit;

    String veredito;
    String descricao;
    Color cor;

    if (modelProb == 0) {
      veredito = 'Sem dados do modelo';
      descricao = 'Informe a probabilidade do modelo para análise completa.';
      cor = const Color(0xFF888888);
    } else if (won && edge > 0) {
      veredito = '✅ Acerto esperado';
      descricao =
          'O modelo identificou edge real e a aposta ganhou. Resultado dentro do esperado.';
      cor = const Color(0xFF00C853);
    } else if (won && edge <= 0) {
      veredito = '🍀 Acerto por sorte';
      descricao =
          'A aposta ganhou mas o modelo não identificava vantagem. Pode ser variância favorável.';
      cor = const Color(0xFFFFD600);
    } else if (!won && edge > 0) {
      veredito = '📉 Perda com edge positivo';
      descricao =
          'O modelo identificava vantagem mas a aposta perdeu. Variância desfavorável — o processo estava correto.';
      cor = const Color(0xFFFF6D00);
    } else {
      veredito = '❌ Perda esperada';
      descricao =
          'O modelo não identificava vantagem e a aposta perdeu. Resultado consistente com a predição.';
      cor = const Color(0xFFFF1744);
    }

    return {
      'veredito': veredito,
      'descricao': descricao,
      'cor': cor,
      'ev': ev,
      'evRealizado': evRealizado,
      'modelProb': modelProb,
      'impliedProb': impliedProb,
      'edge': edge,
    };
  }

  @override
  Widget build(BuildContext context) {
    final bet = widget.bet;
    final isPending = bet['status'] == 'pending';
    final won = bet['won'] as bool?;
    final profit = (bet['profit'] as num?)?.toDouble();
    final realValue = bet['realValue'];
    final edge = (bet['edge'] as num).toDouble();
    final isH2h = bet['type'] == 'h2h';
    final edgeColor = edge >= 5
        ? const Color(0xFF00C853)
        : edge >= 2
            ? const Color(0xFFFFD600)
            : const Color(0xFFFF1744);

    Color borderColor = const Color(0xFF333355);
    if (!isPending) {
      borderColor =
          won == true ? const Color(0xFF00C853) : const Color(0xFFFF1744);
    }

    final title = isH2h
        ? (bet['team'] as String? ?? bet['game'] as String)
        : (bet['player'] as String? ?? '');

    final subtitle = isH2h
        ? 'Vitória · ${bet['game']}'
        : '${bet['side']} ${bet['line']} ${widget.propLabel(bet['prop'] as String? ?? '')}';

    final analysis = !isPending ? _analyze() : null;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 15,
                            fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: const TextStyle(
                            color: Color(0xFF888888), fontSize: 12)),
                    if (bet['game'] != null)
                      Text(bet['game'] as String,
                          style: const TextStyle(
                              color: Color(0xFF555577), fontSize: 11)),
                    Text(widget.formatDate(bet['commence_time'] as String?),
                        style: const TextStyle(
                            color: Color(0xFF666688), fontSize: 11)),
                    if (bet['bookmaker'] != null)
                      Text(bet['bookmaker'] as String,
                          style: const TextStyle(
                              color: Color(0xFF7C4DFF), fontSize: 11)),
                  ],
                ),
              ),
              if (!isPending)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: (won == true
                            ? const Color(0xFF00C853)
                            : const Color(0xFFFF1744))
                        .withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    won == true ? '✅ GANHOU' : '❌ PERDEU',
                    style: TextStyle(
                        color: won == true
                            ? const Color(0xFF00C853)
                            : const Color(0xFFFF1744),
                        fontWeight: FontWeight.bold,
                        fontSize: 12),
                  ),
                )
              else
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFD600).withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text('⏳ Pendente',
                      style: TextStyle(
                          color: Color(0xFFFFD600),
                          fontSize: 12,
                          fontWeight: FontWeight.bold)),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                  '@${(bet['odds'] as num).toStringAsFixed(2)}  ·  R\$ ${(bet['stake'] as num).toStringAsFixed(2)}',
                  style:
                      const TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
              if (edge != 0) ...[
                const SizedBox(width: 8),
                Text('Edge: ${edge.toStringAsFixed(1)}%',
                    style: TextStyle(color: edgeColor, fontSize: 11)),
              ],
            ],
          ),
          if (!isPending) ...[
            const SizedBox(height: 6),
            Text(
              'Real: $realValue  ·  ${profit != null && profit >= 0 ? '+' : ''}R\$ ${profit?.toStringAsFixed(2) ?? '-'}',
              style: TextStyle(
                  color: won == true
                      ? const Color(0xFF00C853)
                      : const Color(0xFFFF1744),
                  fontWeight: FontWeight.bold,
                  fontSize: 13),
            ),
          ],
          if (!isPending && analysis != null) ...[
            const SizedBox(height: 8),
            GestureDetector(
              onTap: () => setState(() => _showAnalysis = !_showAnalysis),
              child: Row(
                children: [
                  Icon(
                    _showAnalysis ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFF888888),
                    size: 16,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _showAnalysis ? 'Ocultar análise' : 'Ver análise',
                    style:
                        const TextStyle(color: Color(0xFF888888), fontSize: 12),
                  ),
                ],
              ),
            ),
            if (_showAnalysis) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: (analysis['cor'] as Color).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: (analysis['cor'] as Color).withValues(alpha: 0.3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(analysis['veredito'] as String,
                        style: TextStyle(
                            color: analysis['cor'] as Color,
                            fontWeight: FontWeight.bold,
                            fontSize: 13)),
                    const SizedBox(height: 6),
                    Text(analysis['descricao'] as String,
                        style: const TextStyle(
                            color: Color(0xFFAAAAAA), fontSize: 12)),
                    if ((analysis['modelProb'] as double) > 0) ...[
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          _AnalysisStat(
                            label: 'Prob. modelo',
                            value:
                                '${(analysis['modelProb'] as double).toStringAsFixed(1)}%',
                          ),
                          _AnalysisStat(
                            label: 'Prob. mercado',
                            value:
                                '${(analysis['impliedProb'] as double).toStringAsFixed(1)}%',
                          ),
                          _AnalysisStat(
                            label: 'EV esperado',
                            value: analysis['ev'] != null
                                ? '${(analysis['ev'] as double) >= 0 ? '+' : ''}R\$ ${(analysis['ev'] as double).toStringAsFixed(2)}'
                                : '-',
                          ),
                          _AnalysisStat(
                            label: 'EV realizado',
                            value:
                                '${(analysis['evRealizado'] as double) >= 0 ? '+' : ''}R\$ ${(analysis['evRealizado'] as double).toStringAsFixed(2)}',
                            color: (analysis['evRealizado'] as double) >= 0
                                ? const Color(0xFF00C853)
                                : const Color(0xFFFF1744),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (isPending && widget.onResolve != null)
                TextButton.icon(
                  onPressed: widget.onResolve,
                  icon: const Icon(Icons.sports_score,
                      color: Color(0xFF00C853), size: 16),
                  label: const Text('Buscar resultado',
                      style: TextStyle(color: Color(0xFF00C853), fontSize: 12)),
                ),
              TextButton.icon(
                onPressed: widget.onEdit,
                icon: const Icon(Icons.edit_outlined,
                    color: Color(0xFF7C4DFF), size: 16),
                label: const Text('Editar',
                    style: TextStyle(color: Color(0xFF7C4DFF), fontSize: 12)),
              ),
              TextButton.icon(
                onPressed: widget.onDelete,
                icon: const Icon(Icons.delete_outline,
                    color: Color(0xFF555555), size: 16),
                label: const Text('Remover',
                    style: TextStyle(color: Color(0xFF555555), fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BetsExportOption extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _BetsExportOption({
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
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 26),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: const TextStyle(
                          color: Color(0xFF888888), fontSize: 11)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnalysisStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _AnalysisStat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(label,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF888888), fontSize: 9)),
          const SizedBox(height: 2),
          Text(value,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: color ?? Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
