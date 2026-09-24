const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function fail(message) {
  console.error(`mirror check failed: ${message}`);
  process.exitCode = 1;
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

function sameJson(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function dartConst(name, text) {
  const re = new RegExp(`static const (?:double|int|String) ${name} = ([^;]+);`);
  const m = text.match(re);
  if (!m) throw new Error(`constante Dart ausente: ${name}`);
  const raw = m[1].trim();
  if (raw.startsWith("'") || raw.startsWith('"')) return raw.slice(1, -1);
  return Number(raw);
}

function dartStringList(name, text) {
  const re = new RegExp(`static const List<String> ${name} = \\[([\\s\\S]*?)\\];`);
  const m = text.match(re);
  if (!m) throw new Error(`lista Dart ausente: ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

function riskSnapshotJs(config) {
  return {
    KELLY_FRACTION: config.KELLY_FRACTION,
    MIN_SAMPLE_TO_CALIBRATE: config.MIN_SAMPLE_TO_CALIBRATE,
    MIN_SHRINK_TO_RAW: config.MIN_SHRINK_TO_RAW,
    MIN_STAKE_FRACTION: config.MIN_STAKE_FRACTION,
    EDGE_CAP_PCT: config.EDGE_CAP_PCT,
    MIN_EDGE_PCT: config.MIN_EDGE_PCT,
    MAX_BETS_PER_GAME: config.MAX_BETS_PER_GAME,
    MAX_BETS_PER_PLAYER_PER_GAME: config.MAX_BETS_PER_PLAYER_PER_GAME,
    NHL_ODDS_FIX_CUTOFF: config.NHL_ODDS_FIX_CUTOFF,
    DISABLED_SEGMENT_KEYS: config.DISABLED_SEGMENTS.map(s => `${s.esporte}|${s.market}`),
  };
}

function riskSnapshotDart() {
  const text = read('lib/services/risk_config.dart');
  return {
    KELLY_FRACTION: dartConst('kellyFraction', text),
    MIN_SAMPLE_TO_CALIBRATE: dartConst('minSampleToCalibrate', text),
    MIN_SHRINK_TO_RAW: dartConst('minShrinkToRaw', text),
    MIN_STAKE_FRACTION: dartConst('minStakeFraction', text),
    EDGE_CAP_PCT: dartConst('edgeCapPct', text),
    MIN_EDGE_PCT: dartConst('minEdgePct', text),
    MAX_BETS_PER_GAME: dartConst('maxBetsPerGame', text),
    MAX_BETS_PER_PLAYER_PER_GAME: dartConst('maxBetsPerPlayerPerGame', text),
    NHL_ODDS_FIX_CUTOFF: dartConst('nhlOddsFixCutoff', text),
    DISABLED_SEGMENT_KEYS: dartStringList('disabledSegmentKeys', text),
  };
}

function verifyClosingOddsRules() {
  const pipelineRules = read('pipeline/closing_odds_rules.js');
  const functionsRules = read('functions/closing_odds_rules.js');
  if (pipelineRules !== functionsRules) {
    fail('pipeline/closing_odds_rules.js e functions/closing_odds_rules.js divergiram');
  }
}

function verifyRiskConfig() {
  const pipelineRisk = riskSnapshotJs(require('../pipeline/risk_config'));
  const functionsRisk = riskSnapshotJs(require('../functions/risk_config'));
  const appRisk = riskSnapshotDart();

  if (!sameJson(pipelineRisk, functionsRisk)) {
    fail('pipeline/risk_config.js e functions/risk_config.js divergiram');
  }
  if (!sameJson(pipelineRisk, appRisk)) {
    fail('pipeline/risk_config.js e lib/services/risk_config.dart divergiram');
  }
}

verifyClosingOddsRules();
verifyRiskConfig();

if (!process.exitCode) {
  console.log('mirror check ok: closing odds rules e risk_config estão sincronizados');
}
