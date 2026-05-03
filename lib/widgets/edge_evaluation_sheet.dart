import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../screens/bet_planner_screen.dart';
import '../services/edge_evaluator_service.dart';
import '../services/prefs_service.dart';
import '../utils/file_saver.dart';

class EdgeEvaluationSheet extends StatefulWidget {
  final List<Map<String, dynamic>> props;
  final String sport;

  const EdgeEvaluationSheet({
    super.key,
    required this.props,
    required this.sport,
  });

  @override
  State<EdgeEvaluationSheet> createState() => _EdgeEvaluationSheetState();
}

class _EdgeEvaluationSheetState extends State<EdgeEvaluationSheet>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late List<Map<String, dynamic>> _localRanked;
  List<Map<String, dynamic>>? _geminiRanked;
  bool _geminiLoading = false;
  String? _geminiError;
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _localRanked = EdgeEvaluatorService.rankLocal(widget.props);
    _loadGemini();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadGemini() async {
    final key = PrefsService.getGeminiKey();
    if (key.isEmpty) {
      setState(() => _geminiError =
          'Chave Gemini não configurada.\nAcesse Configurações para adicionar.');
      return;
    }
    setState(() {
      _geminiLoading = true;
      _geminiError = null;
    });
    try {
      final ranked = await EdgeEvaluatorService.rankWithGemini(
          widget.props, key, widget.sport);
      setState(() => _geminiRanked = ranked);
    } catch (e) {
      setState(() =>
          _geminiError = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      setState(() => _geminiLoading = false);
    }
  }

  void _showExportOptions() {
    final text = EdgeEvaluatorService.buildExportText(
      sport: widget.sport,
      localRanked: _localRanked,
      geminiRanked: _geminiRanked,
    );
    final sport = widget.sport;
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
              const Text(
                'Exportar como',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              _ExportOption(
                icon: Icons.share,
                color: const Color(0xFF25D366),
                title: 'Compartilhar',
                subtitle: 'WhatsApp, Telegram e outros apps',
                onTap: () {
                  Navigator.pop(sheetCtx);
                  Share.share(text, subject: 'Edge Finder — $sport');
                },
              ),
              const SizedBox(height: 10),
              _ExportOption(
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
              _ExportOption(
                icon: Icons.save_alt,
                color: const Color(0xFF00B0FF),
                title: 'Salvar como TXT',
                subtitle: 'Baixar arquivo edge_finder.txt',
                onTap: () {
                  Navigator.pop(sheetCtx);
                  saveAndShareFile(
                    utf8.encode(text),
                    'edge_finder.txt',
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.92,
      maxChildSize: 0.96,
      minChildSize: 0.5,
      builder: (ctx, scrollCtrl) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFF12121F),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            // Drag handle
            Container(
              margin: const EdgeInsets.only(top: 10),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFF444455),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close, color: Color(0xFF888888), size: 22),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.auto_awesome,
                      color: Color(0xFF7C4DFF), size: 20),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Avaliação de Edges',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF7C4DFF).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${widget.props.length} props',
                      style: const TextStyle(
                          color: Color(0xFF7C4DFF), fontSize: 12),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    onPressed: _showExportOptions,
                    tooltip: 'Exportar TXT',
                    icon: const Icon(Icons.ios_share,
                        color: Color(0xFF7C4DFF), size: 20),
                  ),
                  IconButton(
                    tooltip: 'Planejar Aposta',
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => BetPlannerScreen(props: _localRanked),
                      ),
                    ),
                    icon: const Icon(Icons.calculate,
                        color: Color(0xFF00C853), size: 20),
                  ),
                ],
              ),
            ),
            // TabBar
            Container(
              decoration: const BoxDecoration(
                border: Border(
                    bottom: BorderSide(color: Color(0xFF2A2A3E), width: 1)),
              ),
              child: TabBar(
                controller: _tabController,
                indicatorColor: const Color(0xFF7C4DFF),
                labelColor: Colors.white,
                unselectedLabelColor: const Color(0xFF666666),
                labelStyle: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.bold),
                tabs: const [
                  Tab(
                    icon: Icon(Icons.calculate_outlined, size: 16),
                    text: 'Algoritmo Local',
                  ),
                  Tab(
                    icon: Icon(Icons.smart_toy_outlined, size: 16),
                    text: 'Gemini AI',
                  ),
                ],
              ),
            ),
            // Content
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  _LocalTab(
                      ranked: _localRanked,
                      scrollController: scrollCtrl),
                  _GeminiTab(
                    ranked: _geminiRanked,
                    loading: _geminiLoading,
                    error: _geminiError,
                    onRetry: _loadGemini,
                    scrollController: scrollCtrl,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Local Tab ────────────────────────────────────────────────────────────────

class _LocalTab extends StatelessWidget {
  final List<Map<String, dynamic>> ranked;
  final ScrollController scrollController;

  const _LocalTab(
      {required this.ranked, required this.scrollController});

  @override
  Widget build(BuildContext context) {
    final total = EdgeEvaluatorService.lastQualifiedCount;
    final shown = ranked.length;
    return Column(
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          color: const Color(0xFF0D0D1A),
          child: Text(
            'Total qualificadas: $total  |  alvo mínimo: 15  |  máximo: 20  |  exibindo: $shown',
            style: TextStyle(
              color: total >= 15
                  ? const Color(0xFF00C853)
                  : const Color(0xFFFF9800),
              fontSize: 11,
            ),
          ),
        ),
        Expanded(
          child: ListView.builder(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            itemCount: ranked.length,
            itemBuilder: (_, i) {
              final p = ranked[i];
              return _LocalPropCard(
                  prop: p, rank: i + 1, score: p['_localScore'] as double);
            },
          ),
        ),
      ],
    );
  }
}

class _LocalPropCard extends StatelessWidget {
  final Map<String, dynamic> prop;
  final int rank;
  final double score;

  const _LocalPropCard(
      {required this.prop, required this.rank, required this.score});

  @override
  Widget build(BuildContext context) {
    final edge = (prop['edge'] as num).toDouble();
    final modelProb = (prop['modelProb'] as num).toDouble();
    final impliedProb = (prop['impliedProb'] as num).toDouble();
    final playerAvg5 = (prop['playerAvg5'] as num?)?.toDouble();
    final playerAvg10 = (prop['playerAvg10'] as num?)?.toDouble();
    final line = (prop['line'] as num).toDouble();
    final side = prop['side'] as String;
    final lowSample = prop['lowSample'] == true;
    final inefficient = prop['inefficientMarket'] == true;
    final justification =
        EdgeEvaluatorService.generateLocalJustification(prop);
    final oddsStr = _fmtOdds(prop['odds'] as num?);
    final playerTeam = prop['playerTeam'] as String?;
    final contextLabel = prop['_contextLabel'] as String?;
    final contextReason = prop['_contextReason'] as String?;
    final contextScore = (prop['_contextScore'] as int?) ?? 0;
    final contextConfirmed = (prop['_contextConfirmed'] as bool?) ?? false;
    final contradictionLevel = (prop['_contradictionLevel'] as int?) ?? 0;
    final probCal = (prop['_probCalibrada'] as double?) ?? (prop['_probFinal'] as double?) ?? 0.0;
    final evScore = (prop['_evScore'] as double?) ?? 0.0;
    final scoreFinal = (prop['_scoreFinal'] as double?) ?? score;

    final scoreColor = score >= 70
        ? const Color(0xFF00C853)
        : score >= 55
            ? const Color(0xFFFFD600)
            : const Color(0xFFFF6D00);

    final avg5Favors = playerAvg5 != null &&
        ((side == 'Over' && playerAvg5 > line) ||
            (side == 'Under' && playerAvg5 < line));

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border:
            Border.all(color: scoreColor.withValues(alpha: 0.25), width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Linha 1: rank + nome + badges
            Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: scoreColor.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text('$rank',
                      style: TextStyle(
                          color: scoreColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          prop['player'] as String? ?? '',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (playerTeam != null && playerTeam.isNotEmpty) ...[
                        const Text('  ',
                            style: TextStyle(fontSize: 14)),
                        Text(playerTeam,
                            style: const TextStyle(
                                color: Color(0xFF00B0FF),
                                fontSize: 12)),
                      ],
                    ],
                  ),
                ),
                if (inefficient)
                  _Badge('Ineficiente', const Color(0xFF00C853)),
                if (lowSample)
                  _Badge('Poucos jogos', const Color(0xFFFF6D00)),
              ],
            ),
            const SizedBox(height: 4),
            RichText(
              text: TextSpan(
                style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 12),
                children: [
                  TextSpan(text: '${_propLabel(prop['prop'] as String)} ${side == 'Over' ? '↑ Over' : '↓ Under'} ${_fmtN(line, 1)}'),
                  if (oddsStr.isNotEmpty)
                    TextSpan(text: ' · $oddsStr', style: const TextStyle(color: Color(0xFFFFD600), fontWeight: FontWeight.bold)),
                ],
              ),
            ),
            Text(
              prop['game'] as String? ?? '',
              style: const TextStyle(color: Color(0xFF666666), fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (contextLabel != null) ...[
              const SizedBox(height: 5),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: (contextScore >= 1
                          ? const Color(0xFF00C853)
                          : contextScore <= -1
                              ? const Color(0xFFFF5252)
                              : const Color(0xFF555577))
                      .withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Text(
                  'Contexto: $contextLabel${contextReason != null && contextReason.isNotEmpty ? ' ($contextReason)' : ''}',
                  style: TextStyle(
                      fontSize: 10,
                      color: contextScore >= 1
                          ? const Color(0xFF00C853)
                          : contextScore <= -1
                              ? const Color(0xFFFF5252)
                              : const Color(0xFF888888),
                      fontWeight: FontWeight.bold),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
            if (!contextConfirmed) ...[
              const SizedBox(height: 4),
              const Text('⚠ Contexto externo não confirmado',
                  style: TextStyle(color: Color(0xFFFF9800), fontSize: 10)),
            ],
            if (contradictionLevel > 0) ...[
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: (contradictionLevel == 2
                          ? const Color(0xFFFF5252)
                          : const Color(0xFFFF9800))
                      .withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Text(
                  contradictionLevel == 2
                      ? '⛔ Contradição forte (avg5 vs linha)'
                      : '⚠ Contradição leve (avg5 vs linha)',
                  style: TextStyle(
                    color: contradictionLevel == 2
                        ? const Color(0xFFFF5252)
                        : const Color(0xFFFF9800),
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            // Chips de stats
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                _StatChip(
                    label: 'Edge',
                    value: '${_fmtN(edge, 1)}%',
                    color: edge >= 5
                        ? const Color(0xFF00C853)
                        : const Color(0xFFFFD600)),
                _StatChip(
                    label: 'EV',
                    value: _fmtN(evScore, 1),
                    color: const Color(0xFFFFD600)),
                _StatChip(
                    label: 'Score',
                    value: _fmtN(scoreFinal, 0),
                    color: scoreColor),
                _StatChip(
                    label: 'ProbCal',
                    value: '${_fmtN(probCal * 100, 1)}%',
                    color: const Color(0xFF00B0FF)),
                _StatChip(
                    label: 'Modelo',
                    value: '${_fmtN(modelProb, 1)}%',
                    color: const Color(0xFF7C4DFF)),
                _StatChip(
                    label: 'Mercado',
                    value: '${_fmtN(impliedProb, 1)}%',
                    color: const Color(0xFF555577)),
                if (playerAvg5 != null)
                  _StatChip(
                      label: 'Méd.5j',
                      value: _fmtN(playerAvg5, 1),
                      color: avg5Favors
                          ? const Color(0xFF00C853)
                          : const Color(0xFFFF6D00)),
                if (playerAvg10 != null)
                  _StatChip(
                      label: 'Méd.10j',
                      value: _fmtN(playerAvg10, 1),
                      color: const Color(0xFF445566)),
              ],
            ),
            // Justificativa com bullets
            if (justification.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF0D0D1A),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: const Color(0xFF2A2A44), width: 1),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.analytics_outlined,
                            color: Color(0xFF7C4DFF), size: 12),
                        const SizedBox(width: 5),
                        const Text('Análise estatística',
                            style: TextStyle(
                                color: Color(0xFF7C4DFF),
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.3)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ...justification.split('\n').map((line2) => Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('• ',
                                  style: TextStyle(
                                      color: Color(0xFF7C4DFF),
                                      fontSize: 12,
                                      height: 1.5)),
                              Expanded(
                                child: Text(
                                  line2,
                                  style: const TextStyle(
                                      color: Color(0xFFCCCCCC),
                                      fontSize: 12,
                                      height: 1.5),
                                ),
                              ),
                            ],
                          ),
                        )),
                  ],
                ),
              ),
            ],
            // Score bar
            const SizedBox(height: 10),
            Row(
              children: [
                const Text('Score ',
                    style: TextStyle(
                        color: Color(0xFF666666), fontSize: 10)),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: score / 100,
                      minHeight: 5,
                      backgroundColor: const Color(0xFF2A2A3E),
                      valueColor:
                          AlwaysStoppedAnimation<Color>(scoreColor),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _fmtN(score, 0),
                  style: TextStyle(
                      color: scoreColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 13),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Gemini Tab ───────────────────────────────────────────────────────────────

class _GeminiTab extends StatelessWidget {
  final List<Map<String, dynamic>>? ranked;
  final bool loading;
  final String? error;
  final VoidCallback onRetry;
  final ScrollController scrollController;

  const _GeminiTab({
    required this.ranked,
    required this.loading,
    required this.error,
    required this.onRetry,
    required this.scrollController,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Color(0xFF7C4DFF)),
            SizedBox(height: 16),
            Text('Consultando Gemini AI...',
                style:
                    TextStyle(color: Color(0xFF888888), fontSize: 14)),
            SizedBox(height: 6),
            Text('Buscando notícias ESPN + Google Search',
                style:
                    TextStyle(color: Color(0xFF555577), fontSize: 12)),
          ],
        ),
      );
    }

    if (error != null) {
      final isNoKey = error!.contains('não configurada');
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isNoKey
                    ? Icons.vpn_key_outlined
                    : Icons.error_outline,
                color: const Color(0xFF7C4DFF),
                size: 48,
              ),
              const SizedBox(height: 16),
              Text(
                error!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: Color(0xFFAAAAAA), fontSize: 14),
              ),
              const SizedBox(height: 24),
              if (!isNoKey)
                TextButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh,
                      color: Color(0xFF7C4DFF), size: 18),
                  label: const Text('Tentar novamente',
                      style: TextStyle(color: Color(0xFF7C4DFF))),
                ),
              if (isNoKey)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color:
                        const Color(0xFF7C4DFF).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                        color: const Color(0xFF7C4DFF)
                            .withValues(alpha: 0.3)),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Como obter a chave gratuita:',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 13)),
                      SizedBox(height: 8),
                      Text(
                        '1. Acesse aistudio.google.com\n'
                        '2. Clique em "Get API key"\n'
                        '3. Crie um novo projeto\n'
                        '4. Copie a chave e cole em Configurações',
                        style: TextStyle(
                            color: Color(0xFFAAAAAA),
                            fontSize: 12,
                            height: 1.6),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    }

    if (ranked == null || ranked!.isEmpty) {
      return const Center(
        child: Text('Sem resultados.',
            style: TextStyle(color: Color(0xFF666666))),
      );
    }

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Row(
            children: [
              const Icon(Icons.travel_explore,
                  color: Color(0xFF555577), size: 13),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Top ${ranked!.length} props · Gemini 2.5 Flash Lite + notícias ESPN',
                  style: const TextStyle(
                      color: Color(0xFF555577), fontSize: 11),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            itemCount: ranked!.length,
            itemBuilder: (_, i) {
              final p = ranked![i];
              return _GeminiPropCard(
                prop: p,
                rank: p['_aiRank'] as int,
                aiProb: (p['_aiProb'] as num).toDouble(),
                justification: p['_aiJust'] as String? ?? '',
                fato: p['_aiFato'] as String? ?? 'não confirmado',
                confirmado: (p['_aiConfirmado'] as bool?) ?? false,
              );
            },
          ),
        ),
      ],
    );
  }
}

class _GeminiPropCard extends StatelessWidget {
  final Map<String, dynamic> prop;
  final int rank;
  final double aiProb;
  final String justification;
  final String fato;
  final bool confirmado;

  const _GeminiPropCard({
    required this.prop,
    required this.rank,
    required this.aiProb,
    required this.justification,
    required this.fato,
    required this.confirmado,
  });

  @override
  Widget build(BuildContext context) {
    final line = (prop['line'] as num).toDouble();
    final side = prop['side'] as String;
    final edge = (prop['edge'] as num).toDouble();
    final modelProb = (prop['modelProb'] as num).toDouble();
    final avg5 = (prop['playerAvg5'] as num?)?.toDouble();
    final avg10 = (prop['playerAvg10'] as num?)?.toDouble();
    final lowSample = prop['lowSample'] == true;
    final inefficient = prop['inefficientMarket'] == true;
    final oddsStr = _fmtOdds(prop['odds'] as num?);
    final playerTeam = prop['playerTeam'] as String?;
    final contextLabel = prop['_contextLabel'] as String?;
    final contextReason = prop['_contextReason'] as String?;
    final contextScore = (prop['_contextScore'] as int?) ?? 0;
    final contradictionLevel = (prop['_contradictionLevel'] as int?) ?? 0;
    final contextConfirmedLocal = (prop['_contextConfirmed'] as bool?) ?? false;

    final probColor = aiProb >= 65
        ? const Color(0xFF00C853)
        : aiProb >= 55
            ? const Color(0xFFFFD600)
            : const Color(0xFFFF6D00);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A2E),
        borderRadius: BorderRadius.circular(12),
        border:
            Border.all(color: probColor.withValues(alpha: 0.25), width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Linha 1: rank + nome + prob circle + badges
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: probColor.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text('$rank',
                      style: TextStyle(
                          color: probColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 13)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    prop['player'] as String? ?? '',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (playerTeam != null && playerTeam.isNotEmpty) ...[
                                  const Text('  ', style: TextStyle(fontSize: 14)),
                                  Text(playerTeam,
                                      style: const TextStyle(
                                          color: Color(0xFF00B0FF),
                                          fontSize: 12)),
                                ],
                              ],
                            ),
                          ),
                          if (inefficient)
                            _Badge('Ineficiente', const Color(0xFF00C853)),
                          if (lowSample)
                            _Badge('Poucos jogos', const Color(0xFFFF6D00)),
                        ],
                      ),
                      RichText(
                        text: TextSpan(
                          style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 12),
                          children: [
                            TextSpan(text: '${_propLabel(prop['prop'] as String)} ${side == 'Over' ? '↑ Over' : '↓ Under'} ${_fmtN(line, 1)}'),
                            if (oddsStr.isNotEmpty)
                              TextSpan(text: ' · $oddsStr', style: const TextStyle(color: Color(0xFFFFD600), fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ),
                      Text(
                        prop['game'] as String? ?? '',
                        style: const TextStyle(
                            color: Color(0xFF666666), fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (contextLabel != null) ...[
                        const SizedBox(height: 5),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: (contextScore > 0
                                    ? const Color(0xFF00C853)
                                    : contextScore < 0
                                        ? const Color(0xFFFF5252)
                                        : const Color(0xFF888888))
                                .withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'Contexto: $contextLabel${contextReason != null && contextReason.isNotEmpty ? ' ($contextReason)' : ''}',
                            style: TextStyle(
                              color: contextScore > 0
                                  ? const Color(0xFF00C853)
                                  : contextScore < 0
                                      ? const Color(0xFFFF5252)
                                      : const Color(0xFF888888),
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                      if (!contextConfirmedLocal) ...[
                        const SizedBox(height: 4),
                        const Text('⚠ Contexto externo não confirmado',
                            style: TextStyle(color: Color(0xFFFF9800), fontSize: 10)),
                      ],
                      if (contradictionLevel > 0) ...[
                        const SizedBox(height: 4),
                        Text(
                          contradictionLevel == 2
                              ? '⛔ Contradição forte (avg5 vs linha)'
                              : '⚠ Contradição leve (avg5 vs linha)',
                          style: TextStyle(
                            color: contradictionLevel == 2
                                ? const Color(0xFFFF5252)
                                : const Color(0xFFFF9800),
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                // Probability circle
                Column(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: probColor, width: 2),
                        color: probColor.withValues(alpha: 0.08),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        '${_fmtN(aiProb, 0)}%',
                        style: TextStyle(
                            color: probColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 13),
                      ),
                    ),
                    const SizedBox(height: 3),
                    const Text('AI prob',
                        style: TextStyle(
                            color: Color(0xFF555577), fontSize: 9)),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Stats chips
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                _StatChip(
                    label: 'Edge',
                    value: '${_fmtN(edge, 1)}%',
                    color: edge >= 5
                        ? const Color(0xFF00C853)
                        : const Color(0xFFFFD600)),
                _StatChip(
                    label: 'Modelo',
                    value: '${_fmtN(modelProb, 1)}%',
                    color: const Color(0xFF7C4DFF)),
                if (avg5 != null)
                  _StatChip(
                      label: 'Méd.5j',
                      value: _fmtN(avg5, 1),
                      color: const Color(0xFF445566)),
                if (avg10 != null)
                  _StatChip(
                      label: 'Méd.10j',
                      value: _fmtN(avg10, 1),
                      color: const Color(0xFF334455)),
              ],
            ),
            // AI justification
            if (justification.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF0D0D1A),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: const Color(0xFF2A2A44), width: 1),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.travel_explore,
                            color: Color(0xFF7C4DFF), size: 12),
                        const SizedBox(width: 5),
                        const Text('Análise Gemini + ESPN',
                            style: TextStyle(
                                color: Color(0xFF7C4DFF),
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.3)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      justification,
                      style: const TextStyle(
                          color: Color(0xFFCCCCCC),
                          fontSize: 12,
                          fontStyle: FontStyle.italic,
                          height: 1.5),
                    ),
                    if (fato.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Icon(
                            confirmado
                                ? Icons.check_circle_outline
                                : Icons.help_outline,
                            color: confirmado
                                ? const Color(0xFF00C853)
                                : const Color(0xFFFF9800),
                            size: 12,
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              fato,
                              style: TextStyle(
                                color: confirmado
                                    ? const Color(0xFF00C853)
                                    : const Color(0xFFFF9800),
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

String _fmtN(num value, int decimals) =>
    value.toStringAsFixed(decimals).replaceAll('.', ',');

String _fmtOdds(num? decimal) {
  if (decimal == null || decimal <= 1) return '';
  return _fmtN(decimal, 3);
}

String _propLabel(String prop) {
  const labels = {
    'points': 'Pontos',
    'rebounds': 'Rebotes',
    'assists': 'Assistências',
    'steals': 'Roubos',
    'threes': '3 Pontos',
    'fouls': 'Faltas',
    'hits': 'Hits',
    'homeRuns': 'HRs',
    'strikeouts': 'Strikes',
    'hitsAllowed': 'H Allow.',
  };
  return labels[prop] ?? prop;
}

class _Badge extends StatelessWidget {
  final String label;
  final Color color;
  const _Badge(this.label, this.color);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 9, fontWeight: FontWeight.bold)),
    );
  }
}

class _ExportOption extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ExportOption({
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

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatChip(
      {required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: RichText(
        text: TextSpan(
          children: [
            TextSpan(
                text: '$label ',
                style: const TextStyle(
                    color: Color(0xFF888888), fontSize: 10)),
            TextSpan(
                text: value,
                style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
