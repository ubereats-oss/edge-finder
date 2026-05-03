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
  double _banca = 0;
  bool _saved = false;
  bool _geminiSaved = false;
  bool _geminiObscure = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final value = PrefsService.getBanca();
    final geminiKey = PrefsService.getGeminiKey();
    setState(() {
      _banca = value;
      _controller.text = value > 0 ? value.toStringAsFixed(2) : '';
      _geminiController.text = geminiKey;
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
    PrefsService.setGeminiKey(_geminiController.text.trim());
    setState(() => _geminiSaved = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _geminiSaved = false);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _geminiController.dispose();
    super.dispose();
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
        title: const Text('Configurações',
            style: TextStyle(
                color: Colors.white, fontWeight: FontWeight.bold)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'BANCA',
              style: TextStyle(
                  color: Color(0xFFAAAAAA),
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5),
            ),
            const SizedBox(height: 8),
            const Text(
              'Valor total disponível para apostas (R\$)',
              style: TextStyle(color: Color(0xFF666666), fontSize: 12),
            ),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E2E),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF333355)),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _controller,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(color: Colors.white, fontSize: 18),
                decoration: const InputDecoration(
                  border: InputBorder.none,
                  prefixText: 'R\$ ',
                  prefixStyle:
                      TextStyle(color: Color(0xFF888888), fontSize: 18),
                  hintText: '0,00',
                  hintStyle: TextStyle(color: Color(0xFF444455)),
                ),
              ),
            ),
            const SizedBox(height: 24),
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
            // ── Gemini AI Key ─────────────────────────────────────────────
            const SizedBox(height: 40),
            const Text(
              'GEMINI AI',
              style: TextStyle(
                  color: Color(0xFFAAAAAA),
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5),
            ),
            const SizedBox(height: 8),
            const Text(
              'Chave gratuita em aistudio.google.com › Get API key',
              style: TextStyle(color: Color(0xFF666666), fontSize: 12),
            ),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E2E),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF333355)),
              ),
              padding:
                  const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _geminiController,
                      obscureText: _geminiObscure,
                      style: const TextStyle(
                          color: Colors.white, fontSize: 14),
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

            if (_banca > 0) ...[
              const SizedBox(height: 32),
              const Text(
                'BANCA ATUAL',
                style: TextStyle(
                    color: Color(0xFFAAAAAA),
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5),
              ),
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
          ],
        ),
      ),
    );
  }
}
