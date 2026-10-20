import 'package:flutter/material.dart';
import 'settings_screen.dart';
import 'bets_screen.dart';
import 'model_performance_screen.dart';
import 'conferir_odds_screen.dart';
import 'placard_opportunities_screen.dart';

class SportSelectorScreen extends StatelessWidget {
  const SportSelectorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 32),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Edge Finder',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const BetsScreen()),
                    ),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E1E2E),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: const Color(0xFF7C4DFF)
                                .withValues(alpha: 0.5)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.bar_chart,
                              color: Color(0xFF7C4DFF), size: 18),
                          SizedBox(width: 6),
                          Text('Minhas Apostas',
                              style: TextStyle(
                                  color: Color(0xFF7C4DFF),
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.insights,
                        color: Color(0xFF888888), size: 26),
                    tooltip: 'Desempenho do Modelo',
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const ModelPerformanceScreen()),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.fact_check,
                        color: Color(0xFF888888), size: 26),
                    tooltip: 'Conferir odds',
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const ConferirOddsScreen()),
                    ),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    icon: const Icon(Icons.settings,
                        color: Color(0xFF888888), size: 26),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const SettingsScreen()),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 48),
              FilledButton.icon(
                onPressed: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const PlacardOpportunitiesScreen())),
                icon: const Icon(Icons.compare_arrows),
                label: const Text('Placard × Pinnacle'),
              ),
              const SizedBox(height: 24),
              const Icon(Icons.fact_check_outlined,
                  color: Color(0xFF444466), size: 40),
              const SizedBox(height: 16),
              const Text(
                'Modelos próprios encerrados',
                style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'O app não gera mais indicações por esporte. Use "Conferir odds" '
                'pra comparar as casas portuguesas contra a referência da Pinnacle, '
                'ou "Minhas Apostas" pro seu histórico.',
                style: TextStyle(color: Color(0xFF888888), fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
