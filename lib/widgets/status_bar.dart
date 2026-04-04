import 'package:flutter/material.dart';

class StatusBar extends StatelessWidget {
  final String message;

  const StatusBar({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF1E1E2E),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Text(
        message,
        style: const TextStyle(color: Color(0xFFAAAAAA), fontSize: 13),
      ),
    );
  }
}
