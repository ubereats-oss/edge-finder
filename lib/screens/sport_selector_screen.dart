import 'package:flutter/material.dart';
import 'tennis_screen.dart';
import 'basketball_mode_screen.dart';
import 'baseball_screen.dart';
import 'settings_screen.dart';
import 'bets_screen.dart';

class SportSelectorScreen extends StatelessWidget {
  const SportSelectorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF12121F),
      body: SafeArea(
        child: Padding(
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
              const SizedBox(height: 8),
              const Text(
                'Escolha o esporte',
                style: TextStyle(color: Color(0xFF888888), fontSize: 16),
              ),
              const SizedBox(height: 48),
              _SportCard(
                emoji: '🎾',
                title: 'Tênis',
                subtitle: 'ATP Singles · Odds + Modelo ELO',
                color: const Color(0xFF7C4DFF),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const TennisScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _SportCard(
                emoji: '🏀',
                title: 'Basquete',
                subtitle: 'NBA · H2H e Props por jogador',
                color: const Color(0xFFFF6D00),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                      builder: (_) => const BasketballModeScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _SportCard(
                emoji: '⚾',
                title: 'Beisebol',
                subtitle: 'MLB · H2H e Props por jogador',
                color: const Color(0xFF00C853),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const BaseballScreen()),
                ),
              ),
              const SizedBox(height: 32),
              GestureDetector(
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const BetsScreen()),
                ),
                child: Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1E1E2E),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                        color: const Color(0xFF7C4DFF).withValues(alpha: 0.4)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.bar_chart, color: Color(0xFF7C4DFF), size: 22),
                      SizedBox(width: 10),
                      Text('Minhas Apostas',
                          style: TextStyle(
                              color: Color(0xFF7C4DFF),
                              fontWeight: FontWeight.bold,
                              fontSize: 16)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SportCard extends StatelessWidget {
  final String emoji;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _SportCard({
    required this.emoji,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: const Color(0xFF1E1E2E),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
        ),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Center(
                child: Text(emoji, style: const TextStyle(fontSize: 28)),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style:
                        const TextStyle(color: Color(0xFF888888), fontSize: 13),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: color, size: 28),
          ],
        ),
      ),
    );
  }
}
