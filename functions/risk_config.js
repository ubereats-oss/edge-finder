// Espelho de pipeline/risk_config.js para o runtime isolado de Firebase Functions.

module.exports = {
  KELLY_FRACTION: 0.25,
  MIN_SAMPLE_TO_CALIBRATE: 30,
  MIN_SHRINK_TO_RAW: 0.2,
  MIN_STAKE_FRACTION: 0.25,
  EDGE_CAP_PCT: 40,
  MIN_EDGE_PCT: 15,
  MAX_BETS_PER_GAME: 3,
  MAX_BETS_PER_PLAYER_PER_GAME: 1,
  DISABLED_SEGMENTS: [
    { esporte: 'baseball/mlb', market: 'strikeouts' },
    { esporte: 'baseball/mlb', market: 'hitsAllowed' },
  ],
  NHL_ODDS_FIX_CUTOFF: '2026-09-06T00:00:00Z',

  get UNCALIBRATED_SHRINK_TO_RAW() {
    return this.MIN_SHRINK_TO_RAW;
  },

  get UNCALIBRATED_STAKE_FRACTION() {
    return this.MIN_STAKE_FRACTION;
  },

  isSegmentDisabled(esporte, market) {
    return this.DISABLED_SEGMENTS.some(s => s.esporte === esporte && s.market === market);
  },
};
