import 'package:flutter/material.dart';

class LastUpdatedBar extends StatelessWidget {
  final DateTime? lastUpdated;

  const LastUpdatedBar({super.key, this.lastUpdated});

  String _formatAge() {
    if (lastUpdated == null) return 'Nunca atualizado';
    final diff = DateTime.now().difference(lastUpdated!);
    if (diff.inMinutes < 1) return 'Atualizado agora';
    if (diff.inMinutes < 60) return 'Atualizado há ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'Atualizado há ${diff.inHours}h';
    return 'Atualizado há ${diff.inDays} dia(s)';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF12121F),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          Icon(
            Icons.access_time,
            size: 12,
            color: lastUpdated == null
                ? const Color(0xFF555555)
                : const Color(0xFF888888),
          ),
          const SizedBox(width: 4),
          Text(
            _formatAge(),
            style: TextStyle(
              color: lastUpdated == null
                  ? const Color(0xFF555555)
                  : const Color(0xFF888888),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}
