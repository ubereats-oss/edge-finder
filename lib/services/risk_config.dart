class RiskConfig {
  static const double kellyFraction = 0.25;
  static const int minSampleToCalibrate = 30;
  static const double minShrinkToRaw = 0.2;
  static const double minStakeFraction = 0.25;
  static const double edgeCapPct = 40;
  static const double minEdgePct = 15;
  static const int maxBetsPerGame = 3;
  static const int maxBetsPerPlayerPerGame = 1;
  static const String nhlOddsFixCutoff = '2026-09-06T00:00:00Z';
  static const List<String> disabledSegmentKeys = [
    'baseball/mlb|strikeouts',
    'baseball/mlb|hitsAllowed',
  ];
}
