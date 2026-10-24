const fs = require('node:fs');
const crypto = require('node:crypto');

function exactTeams(source, target) {
  return source?.length === 2 && target?.length === 2 &&
    ((source[0] === target[0] && source[1] === target[1]) ||
      (source[0] === target[1] && source[1] === target[0]));
}
function calibrate(data, confirmedInvalidSources = []) {
  const events = new Map(data.pinnacleEvents.map(event => [event.id, event]));
  const samples = { 2: [], 3: [] };
  const excluded = { missingIdentity: 0, nonLiteralNames: 0, confirmedWrongGame: 0, incompleteMarket: 0 };
  const seen = new Set();
  for (const read of data.reads) {
    const groups = new Map();
    for (const row of read.validations || []) {
      const event = events.get(row.pinnacleEventId);
      if (!event) { excluded.missingIdentity++; continue; }
      if (!exactTeams(row.teams, [event.home_team, event.away_team])) { excluded.nonLiteralNames++; continue; }
      if (confirmedInvalidSources.some(bad => bad.bookmaker === read.bookmaker &&
        bad.sourceEventId === row.sourceEventId && exactTeams(bad.teams, row.teams))) {
        excluded.confirmedWrongGame++; continue;
      }
      const key = JSON.stringify([read.id, row.sourceEventId, row.pinnacleEventId, row.market,
        row.market === 'spreads' ? Math.abs(row.line) : row.line, row.sourceMarketIndex, row.pinnacleUpdatedAt]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const [key, rows] of groups) {
      if (![2, 3].includes(rows.length) || new Set(rows.map(row => row.selection)).size !== rows.length ||
        rows.some(row => !(row.placardOdds > 1 && row.probability > 0 && row.probability < 1)) ||
        Math.abs(rows.reduce((sum, row) => sum + row.probability, 0) - 1) > 1e-8) {
        excluded.incompleteMarket++; continue;
      }
      for (const row of rows) {
        const id = `${key}|${row.selection}|${row.observedAt}`;
        if (seen.has(id)) continue;
        seen.add(id);
        samples[rows.length].push(Math.abs(row.placardOdds * row.probability - 1) * 100);
      }
    }
  }
  const types = {};
  for (const type of [2, 3]) {
    const own = samples[type].slice().sort((a, b) => a - b);
    types[type] = { sampleSize: own.length,
      ownPercentilePct: own.length ? own[Math.ceil(0.995 * own.length) - 1] : null };
  }
  for (const type of [2, 3]) {
    const donor = types[type].sampleSize >= 200 ? type : type === 2 ? 3 : 2;
    if (types[donor].sampleSize < 200) throw new Error('Nenhum tipo tem 200 pares para calibrar; não há limite comprovado.');
    types[type].limitPct = types[donor].ownPercentilePct;
    types[type].calibratedFrom = donor;
    types[type].fallback = donor !== type;
  }
  return { version: '2026-10-24-p995-v1', percentile: 99.5, method: 'nearest-rank',
    difference: '100 * abs(odd_casa * probabilidade_justa_pinnacle - 1)',
    names: 'igualdade literal dos dois times, sem apelidos; ordem reversa permitida',
    inputSha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    types, excluded, confirmedInvalidSources };
}
module.exports = { calibrate, exactTeams };
if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const invalid = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const result = calibrate(data, invalid);
  fs.writeFileSync(process.argv[4], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
