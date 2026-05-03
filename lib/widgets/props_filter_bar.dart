import 'package:flutter/material.dart';

class PropsFilterBar extends StatelessWidget {
  final double minEdge;
  final String? selectedProp;
  final String? selectedTeam;
  final bool hideWarnings;
  final List<String> availableProps;
  final List<String> availableTeams;
  final ValueChanged<double> onEdgeChanged;
  final ValueChanged<String?> onPropChanged;
  final ValueChanged<String?> onTeamChanged;
  final ValueChanged<bool> onHideWarningsChanged;

  const PropsFilterBar({
    super.key,
    required this.minEdge,
    required this.selectedProp,
    required this.selectedTeam,
    required this.hideWarnings,
    required this.availableProps,
    required this.availableTeams,
    required this.onEdgeChanged,
    required this.onPropChanged,
    required this.onTeamChanged,
    required this.onHideWarningsChanged,
  });

  static const _edgeOptions = [0.0, 2.0, 5.0, 10.0];

  String _propLabel(String prop) {
    const labels = {
      'points': 'Pontos',
      'rebounds': 'Rebotes',
      'assists': 'Assistências',
      'steals': 'Roubos',
      'threes': 'Cestas de 3',
      'fouls': 'Faltas',
      'hits': 'Hits',
      'homeRuns': 'Home Runs',
      'strikeouts': 'Strikeouts',
      'hitsAllowed': 'Hits Permitidos',
    };
    return labels[prop] ?? prop;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF1A1A2E),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Edge mínimo
          Row(
            children: [
              const Text('Edge mín:',
                  style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
              const SizedBox(width: 8),
              ..._edgeOptions.map((e) => Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: GestureDetector(
                      onTap: () => onEdgeChanged(e),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: minEdge == e
                              ? const Color(0xFF7C4DFF)
                              : const Color(0xFF2A2A3E),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          e == 0 ? 'Todos' : '${e.toInt()}%+',
                          style: TextStyle(
                            color: minEdge == e
                                ? Colors.white
                                : const Color(0xFFAAAAAA),
                            fontSize: 12,
                            fontWeight: minEdge == e
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                      ),
                    ),
                  )),
            ],
          ),
          const SizedBox(height: 8),
          // Tipo de prop + ocultar warnings
          Row(
            children: [
              const Text('Tipo:',
                  style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
              const SizedBox(width: 8),
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _PropChip(
                        label: 'Todos',
                        selected: selectedProp == null,
                        onTap: () => onPropChanged(null),
                      ),
                      ...availableProps.map((p) => _PropChip(
                            label: _propLabel(p),
                            selected: selectedProp == p,
                            onTap: () => onPropChanged(p),
                          )),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              GestureDetector(
                onTap: () => onHideWarningsChanged(!hideWarnings),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: hideWarnings
                        ? const Color(0xFFFF6D00).withValues(alpha: 0.2)
                        : const Color(0xFF2A2A3E),
                    borderRadius: BorderRadius.circular(6),
                    border: hideWarnings
                        ? Border.all(
                            color:
                                const Color(0xFFFF6D00).withValues(alpha: 0.5))
                        : null,
                  ),
                  child: const Text('⚠️ Ocultar',
                      style: TextStyle(fontSize: 11, color: Color(0xFFAAAAAA))),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Text('Time:',
                  style: TextStyle(color: Color(0xFFAAAAAA), fontSize: 12)),
              const SizedBox(width: 8),
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _PropChip(
                        label: 'Todos',
                        selected: selectedTeam == null,
                        onTap: () => onTeamChanged(null),
                      ),
                      ...availableTeams.map((team) => _PropChip(
                            label: team,
                            selected: selectedTeam == team,
                            onTap: () => onTeamChanged(team),
                          )),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PropChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _PropChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF7C4DFF) : const Color(0xFF2A2A3E),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : const Color(0xFFAAAAAA),
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
