const fs = require('node:fs');
const crypto = require('node:crypto');
const { exactTeams } = require('./calibrate_market_integrity.cjs');

function calibratePositiveEdge(data, confirmedInvalidSources = []) {
  const events = new Map(data.pinnacleEvents.map(event => [event.id, event]));
  const seen = new Set(), positives = [];
  let eligiblePairs = 0;
  for (const read of data.reads) for (const row of read.validations || []) {
    const event = events.get(row.pinnacleEventId);
    if (!event || !exactTeams(row.teams, [event.home_team, event.away_team])) continue;
    if (confirmedInvalidSources.some(bad => bad.bookmaker === read.bookmaker &&
      bad.sourceEventId === row.sourceEventId && exactTeams(bad.teams, row.teams))) continue;
    if (!(row.placardOdds > 1 && row.probability > 0 && row.probability < 1)) continue;
    const key = JSON.stringify([read.id, row.sourceEventId, row.pinnacleEventId, row.market,
      row.line, row.sourceMarketIndex, row.pinnacleUpdatedAt, row.selection, row.observedAt]);
    if (seen.has(key)) continue;
    seen.add(key);
    eligiblePairs++;
    const edgePct = 100 * (row.placardOdds * row.probability - 1);
    if (edgePct > 0) positives.push({ bookmaker: read.bookmaker, teams: row.teams,
      selection: row.selection, market: row.market, line: row.line ?? null,
      houseOdds: row.placardOdds, fairOdds: 1 / row.probability, edgePct });
  }
  positives.sort((a, b) => a.edgePct - b.edgePct);
  const maximumPct = positives.at(-1)?.edgePct ?? null;
  const percentilePct = positives.length ? positives[Math.ceil(0.995 * positives.length) - 1].edgePct : null;
  const fallback = positives.length < 50;
  const ceilingPct = maximumPct === null ? null : fallback ? maximumPct + 2 : percentilePct;
  const lincoln = (data.opportunities || []).find(row => row.game === 'Lincoln City x Burnley' && row.selection === 'Under');
  const lincolnEdgePct = lincoln ? 100 * (lincoln.placardOdds * lincoln.probability - 1) : null;
  return { version: '2026-10-24-positive-edge-v1', inputCapturedAt: data.capturedAt,
    inputSha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    formula: '100 * (odd_casa / preco_justo_pinnacle - 1)',
    eligiblePairs, sampleSize: positives.length, percentile: 99.5, method: 'nearest-rank',
    percentilePct, maximumPct, fallback, fallbackRule: fallback ? 'maximo observado + 2 pontos percentuais' : null,
    ceilingPct, lincolnEdgePct, enabled: Number.isFinite(ceilingPct) && Number.isFinite(lincolnEdgePct) && lincolnEdgePct > ceilingPct,
    positives };
}
module.exports = { calibratePositiveEdge };
if (require.main === module) {
  const result = calibratePositiveEdge(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
    JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
  fs.writeFileSync(process.argv[4], JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
