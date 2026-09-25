import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import '../services/prefs_service.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _controller = TextEditingController();
  final _geminiController = TextEditingController();
  final _rootPathController = TextEditingController();
  double _banca = 0;
  bool _saved = false;
  bool _geminiSaved = false;
  bool _geminiObscure = true;
  bool _hasGeminiKey = false;
  bool _rootPathSaved = false;
  bool _syncRunning = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final value = PrefsService.getBanca();
    final rootPath = PrefsService.getProjectRootPath();
    setState(() {
      _banca = value;
      _controller.text = value > 0 ? value.toStringAsFixed(2) : '';
      // Campo da chave Gemini começa sempre vazio — nunca pré-preenche nem
      // exibe a chave já salva, só indica se existe uma (ver _hasGeminiKey).
      _hasGeminiKey = PrefsService.hasGeminiKey();
      _rootPathController.text = rootPath;
    });
  }

  void _save() {
    final value = double.tryParse(_controller.text.replaceAll(',', '.'));
    if (value == null || value <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Informe um valor válido.'),
            backgroundColor: Colors.red),
      );
      return;
    }
    PrefsService.setBanca(value);
    setState(() {
      _banca = value;
      _saved = true;
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _saved = false);
    });
  }

  void _saveGeminiKey() {
    final value = _geminiController.text.trim();
    PrefsService.setGeminiKey(value);
    setState(() {
      _geminiSaved = true;
      _hasGeminiKey = value.isNotEmpty;
      _geminiController.clear();
    });
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _geminiSaved = false);
    });
  }

  void _saveRootPath() {
    PrefsService.setProjectRootPath(_rootPathController.text.trim());
    setState(() => _rootPathSaved = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _rootPathSaved = false);
    });
  }

  Future<void> _runSync() async {
    if (kIsWeb) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Pipeline disponível apenas na versão desktop/mobile.'),
            backgroundColor: Colors.orange),
      );
      return;
    }
    final rootPath = PrefsService.getProjectRootPath();
    if (rootPath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content:
                Text('Configure o caminho do projeto antes de sincronizar.'),
            backgroundColor: Colors.red),
      );
      return;
    }
    setState(() => _syncRunning = true);

    final controller = StreamController<String>();
    int? exitCode;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SyncOutputDialog(
          stream: controller.stream, doneNotifier: () => exitCode),
    ).then((_) {
      controller.close();
    });

    try {
      final process = await Process.start(
        'node',
        ['sync_odds_br.js'],
        workingDirectory: rootPath,
        runInShell: true,
      );

      process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
        (line) {
          if (!controller.isClosed) controller.add(line);
        },
      );
      process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
        (line) {
          if (!controller.isClosed) controller.add('ERR: $line');
        },
      );

      exitCode = await process.exitCode;
      if (!controller.isClosed) controller.add('__DONE__:$exitCode');

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(exitCode == 0
                ? 'Odds BR sincronizadas com sucesso.'
                : 'Erro ao sincronizar (exit code $exitCode).'),
            backgroundColor:
                exitCode == 0 ? const Color(0xFF00C853) : Colors.red,
          ),
        );
      }
    } catch (e) {
      if (!controller.isClosed) {
        controller.add('ERR: $e');
        controller.add('__DONE__:1');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Falha ao iniciar o processo: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _syncRunning = false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _geminiController.dispose();
    _rootPathController.dispose();
    super.dispose();
  }

  Widget _sectionLabel(String text) => Text(
        text,
        style: const TextStyle(
            color: Color(0xFFAAAAAA),
            fontSize: 13,
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5),
      );

  Widget _inputBox({required Widget child}) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFF1E1E2E),
          borderRadius: BorderRadius.all(Radius.circular(12)),
          border: Border.fromBorderSide(BorderSide(color: Color(0xFF333355))),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: child,
      );

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
        title: const Text('Configurações',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          // ── Banca ──────────────────────────────────────────────────────
          _sectionLabel('BANCA'),
          const SizedBox(height: 8),
          const Text(
            'Valor total disponível para apostas (R\$)',
            style: TextStyle(color: Color(0xFF666666), fontSize: 12),
          ),
          const SizedBox(height: 16),
          _inputBox(
            child: TextField(
              controller: _controller,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              style: const TextStyle(color: Colors.white, fontSize: 18),
              decoration: const InputDecoration(
                border: InputBorder.none,
                prefixText: 'R\$ ',
                prefixStyle: TextStyle(color: Color(0xFF888888), fontSize: 18),
                hintText: '0,00',
                hintStyle: TextStyle(color: Color(0xFF444455)),
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _save,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7C4DFF),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(
                _saved ? '✓ Salvo' : 'Salvar',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
          ),
          if (_banca > 0) ...[
            const SizedBox(height: 24),
            _sectionLabel('BANCA ATUAL'),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E2E),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: const Color(0xFF7C4DFF).withValues(alpha: 0.3)),
              ),
              child: Text(
                'R\$ ${_banca.toStringAsFixed(2)}',
                style: const TextStyle(
                    color: Color(0xFF7C4DFF),
                    fontSize: 28,
                    fontWeight: FontWeight.bold),
              ),
            ),
          ],

          // ── Gemini AI ──────────────────────────────────────────────────
          const SizedBox(height: 40),
          _sectionLabel('GEMINI AI'),
          const SizedBox(height: 8),
          const Text(
            'Chave gratuita em aistudio.google.com › Get API key',
            style: TextStyle(color: Color(0xFF666666), fontSize: 12),
          ),
          const SizedBox(height: 16),
          _inputBox(
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _geminiController,
                    obscureText: _geminiObscure,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: 'AIzaSy...',
                      hintStyle: TextStyle(color: Color(0xFF444455)),
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(
                    _geminiObscure
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    color: const Color(0xFF555577),
                    size: 20,
                  ),
                  onPressed: () =>
                      setState(() => _geminiObscure = !_geminiObscure),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            _hasGeminiKey
                ? '✓ Chave salva. Deixe em branco e salve pra remover.'
                : 'Nenhuma chave salva — avaliação por IA fica indisponível.',
            style: TextStyle(
              color: _hasGeminiKey
                  ? const Color(0xFF4CAF50)
                  : const Color(0xFF666666),
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _saveGeminiKey,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7C4DFF),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(
                _geminiSaved ? '✓ Salvo' : 'Salvar chave Gemini',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
          ),

          // ── Caminho do projeto ─────────────────────────────────────────
          const SizedBox(height: 40),
          _sectionLabel('CAMINHO DO PROJETO'),
          const SizedBox(height: 8),
          const Text(
            'Diretório raiz local do projeto (onde fica sync_odds_br.js)',
            style: TextStyle(color: Color(0xFF666666), fontSize: 12),
          ),
          const SizedBox(height: 16),
          _inputBox(
            child: TextField(
              controller: _rootPathController,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(
                border: InputBorder.none,
                hintText: 'C:\\caminho\\para\\odds_app',
                hintStyle: TextStyle(color: Color(0xFF444455)),
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _saveRootPath,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7C4DFF),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(
                _rootPathSaved ? '✓ Salvo' : 'Salvar caminho',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
          ),

          // ── Pipeline local ─────────────────────────────────────────────
          const SizedBox(height: 40),
          _sectionLabel('PIPELINE LOCAL'),
          const SizedBox(height: 8),
          const Text(
            'Executa sync_odds_br.js na raiz do projeto e exibe o progresso em tempo real.',
            style: TextStyle(color: Color(0xFF666666), fontSize: 12),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _syncRunning ? null : _runSync,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00C853),
                disabledBackgroundColor: const Color(0xFF1E3A2A),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              icon: _syncRunning
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white70),
                    )
                  : const Icon(Icons.sync, color: Colors.white),
              label: Text(
                _syncRunning ? 'Sincronizando...' : 'Sincronizar Odds BR',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16),
              ),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SyncOutputDialog extends StatefulWidget {
  final Stream<String> stream;
  final int? Function() doneNotifier;

  const _SyncOutputDialog({required this.stream, required this.doneNotifier});

  @override
  State<_SyncOutputDialog> createState() => _SyncOutputDialogState();
}

class _SyncOutputDialogState extends State<_SyncOutputDialog> {
  final _lines = <String>[];
  final _scroll = ScrollController();
  StreamSubscription<String>? _sub;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _sub = widget.stream.listen((line) {
      if (line.startsWith('__DONE__:')) {
        if (mounted) setState(() => _done = true);
        return;
      }
      if (mounted) {
        setState(() => _lines.add(line));
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          if (_scroll.hasClients) {
            _scroll.animateTo(
              _scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 150),
              curve: Curves.easeOut,
            );
          }
        });
      }
    }, onDone: () {
      if (mounted) setState(() => _done = true);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      title: const Text('Sincronizar Odds BR',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
      content: SizedBox(
        width: double.maxFinite,
        height: 340,
        child: Container(
          decoration: const BoxDecoration(
            color: Color(0xFF0D0D1A),
            borderRadius: BorderRadius.all(Radius.circular(8)),
          ),
          padding: const EdgeInsets.all(10),
          child: _lines.isEmpty
              ? const Center(
                  child: CircularProgressIndicator(color: Color(0xFF00C853)))
              : ListView.builder(
                  controller: _scroll,
                  itemCount: _lines.length,
                  itemBuilder: (_, i) {
                    final line = _lines[i];
                    final isErr = line.startsWith('ERR:');
                    return Text(
                      line,
                      style: TextStyle(
                        color: isErr
                            ? const Color(0xFFFF5252)
                            : const Color(0xFFB0BEC5),
                        fontSize: 11,
                        fontFamily: 'monospace',
                      ),
                    );
                  },
                ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _done ? () => Navigator.pop(context) : null,
          child: Text(
            'Fechar',
            style: TextStyle(
                color:
                    _done ? const Color(0xFF00C853) : const Color(0xFF444455),
                fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}
