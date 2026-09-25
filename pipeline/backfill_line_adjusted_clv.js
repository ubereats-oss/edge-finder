const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const lineAdjustedClv = require('./line_adjusted_clv');

const ROOT = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT, 'odds_history');
const C32DFE6_COMMIT_AT = '2026-09-25T02:15:56.000Z';

function readJson(file, fallback = []) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function modelHistoryIndex() {
  const index = new Map();
  for (const file of fs.readdirSync(HISTORY_DIR).filter(f => /^football_nfl_model_\d{4}-\d{2}\.json$/.test(f))) {
    for (const row of readJson(path.join(HISTORY_DIR, file))) {
      const key = [
        row.savedDate,
        row.game,
        row.player,
        row.prop,
        row.line,
        row.side,
      ].join('|');
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row);
    }
  }
  return index;
}

function modelKey(entry) {
  return [
    String(entry.runId ?? '').slice(0, 10),
    entry.game,
    entry.player,
    entry.market,
    entry.line,
    entry.side,
  ].join('|');
}

function fillModelContext(entry, index) {
  if (!entry.published) return 'not_published';
  if (new Date(entry.runId ?? entry.firstEvaluatedAt ?? entry.evaluatedAt ?? 0) >= new Date(C32DFE6_COMMIT_AT)) {
    return 'after_cutoff';
  }
  if (entry.playerAvg != null && entry.playerStd != null) return 'already_filled';

  const matches = index.get(modelKey(entry)) ?? [];
  if (matches.length !== 1) {
    entry.lineAdjustedClvStatus = 'model_context_not_reproducible';
    entry.lineAdjustedClvMissingReason = `model_history_matches_${matches.length}`;
    return 'not_reproducible';
  }

  const match = matches[0];
  entry.playerAvg = match.playerAvg ?? null;
  entry.playerStd = match.playerStd ?? null;
  entry.playerAvg5 = match.playerAvg5 ?? null;
  entry.playerAvg10 = match.playerAvg10 ?? null;
  entry.lineAdjustedClvContextSource = `odds_history/${path.basename('football_nfl_model_' + match.savedDate.slice(0, 7) + '.json')}`;
  return 'filled';
}

function fillAdjustedClv(entry) {
  if (typeof entry.lineAdjustedClv === 'number') return 'already_filled';
  if (!(entry.adjustedClosingLine != null && entry.adjustedClosingOverOdds && entry.adjustedClosingUnderOdds)) return 'no_adjusted_line';

  const closing = {
    line: entry.adjustedClosingLine,
    overOdds: entry.adjustedClosingOverOdds,
    underOdds: entry.adjustedClosingUnderOdds,
  };
  const value = lineAdjustedClv.adjustedClv(entry, closing);
  if (value === null) {
    entry.lineAdjustedClvStatus = 'adjustment_not_reproducible';
    return 'not_reproducible';
  }
  entry.closingLineMovement = lineAdjustedClv.movementDirection(entry.side, entry.line, entry.adjustedClosingLine);
  entry.lineAdjustedClv = value;
  entry.lineAdjustedClvSource = entry.lineAdjustedClvSource ?? 'stored_adjusted_closing_line';
  entry.lineAdjustedClvStatus = 'ok';
  return 'filled';
}

function main() {
  const index = modelHistoryIndex();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => /^model_ledger_nfl_\d{4}-\d{2}\.json$/.test(f));
  const stats = {
    contextFilled: 0,
    contextNotReproducible: 0,
    adjustedFilled: 0,
    adjustedNotReproducible: 0,
    filesChanged: 0,
  };

  for (const file of files) {
    const full = path.join(HISTORY_DIR, file);
    const entries = readJson(full);
    const before = JSON.stringify(entries);

    for (const entry of entries) {
      const contextResult = fillModelContext(entry, index);
      if (contextResult === 'filled') stats.contextFilled++;
      if (contextResult === 'not_reproducible') stats.contextNotReproducible++;

      const adjustedResult = fillAdjustedClv(entry);
      if (adjustedResult === 'filled') stats.adjustedFilled++;
      if (adjustedResult === 'not_reproducible') stats.adjustedNotReproducible++;
    }

    if (JSON.stringify(entries) !== before) {
      writeJson(full, entries);
      stats.filesChanged++;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
}

if (require.main === module) main();

module.exports = {
  fillModelContext,
  fillAdjustedClv,
  modelKey,
};
