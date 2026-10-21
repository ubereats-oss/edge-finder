const crypto = require('crypto');
const aliases = require('./placard_aliases.json');
const { KELLY_FRACTION } = require('./risk_config');
const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedAliases = new Map(Object.entries(aliases).map(([name, values]) => [normalize(name), values]));
function namesEqual(placard, canonical) {
  const left = normalize(placard), right = normalize(canonical);
  if (left === right || (normalizedAliases.get(left) || []).some(n => normalize(n) === right)) return true;
  return [...normalizedAliases.entries()].some(([name, values]) => normalize(name) === right
    && values.some(value => normalize(value) === left));
}
function fairProbabilities(prices) {
  if (prices.length < 2 || prices.some(p => !Number.isFinite(p) || p <= 1)) return null;
  let lo = 0, hi = 64;
  for (let i = 0; i < 100; i++) {
    const k = (lo + hi) / 2;
    if (prices.reduce((s, p) => s + (1 / p) ** k, 0) > 1) lo = k; else hi = k;
  }
  const p = prices.map(o => (1 / o) ** ((lo + hi) / 2));
  const sum = p.reduce((s, v) => s + v, 0);
  return p.map(v => v / sum);
}
function references(event, now = Date.now(), historical = false, maxAgeOverride = null) {
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  const rows = [];
  for (const market of bm?.markets || []) {
    const update = market.last_update || bm.last_update;
    const age = now - Date.parse(update);
    const maxAge = maxAgeOverride ?? (historical ? 300000 : 120000);
    if (!Number.isFinite(age) || age < 0 || age > maxAge) continue;
    if (market.key === 'h2h') {
      const names = [event.home_team, ...(event.sport_key?.startsWith('soccer_') ? ['Draw'] : []), event.away_team];
      const outcomes = names.map(name => market.outcomes?.find(o => o.name === name));
      if (outcomes.some(o => !o) || market.outcomes.length !== names.length) continue;
      const probs = fairProbabilities(outcomes.map(o => o.price));
      if (probs) outcomes.forEach((o, i) => rows.push({ market: 'h2h', line: null, selection: o.name, probability: probs[i], pinnacleOdds: o.price, pinnacleUpdatedAt: update }));
    }
    if (market.key === 'totals' || market.key === 'alternate_totals') {
      for (const line of new Set(market.outcomes?.map(o => o.point))) {
        // Em linhas inteiras, as probabilidades são condicionais a não haver
        // devolução. O Kelly ótimo é o mesmo: a parcela push soma log(1)=0.
        // Linhas de quarto têm meia vitória/derrota e exigem outro contrato.
        if (!Number.isFinite(line) || line < 0 || !Number.isInteger(line * 2)) continue;
        const outcomes = ['Over', 'Under'].map(name => market.outcomes.find(o => o.name === name && o.point === line));
        if (outcomes.some(o => !o)) continue;
        const probs = fairProbabilities(outcomes.map(o => o.price));
        if (probs) outcomes.forEach((o, i) => rows.push({ market: 'totals', line, selection: o.name, probability: probs[i], probabilityBasis: Number.isInteger(line) ? 'condicional_sem_devolucao' : 'binaria', pinnacleOdds: o.price, pinnacleUpdatedAt: update }));
      }
    }
    if (market.key === 'spreads' || market.key === 'alternate_spreads') {
      const names = [event.home_team, event.away_team];
      const homeLines = new Set(market.outcomes?.filter(o => o.name === names[0]).map(o => o.point));
      for (const line of homeLines) {
        // Linhas inteiras têm devolução e meias linhas são binárias. Linhas
        // asiáticas .25/.75 são excluídas por exigirem liquidação fracionada.
        if (!Number.isFinite(line) || !Number.isInteger(line * 2)) continue;
        const outcomes = [market.outcomes.find(o => o.name === names[0] && o.point === line),
          market.outcomes.find(o => o.name === names[1] && o.point === -line)];
        if (outcomes.some(o => !o)) continue;
        const probs = fairProbabilities(outcomes.map(o => o.price));
        if (probs) outcomes.forEach((o, i) => rows.push({ market: 'spreads', line: i === 0 ? line : -line, selection: o.name,
          probability: probs[i], probabilityBasis: Number.isInteger(line) ? 'condicional_sem_devolucao' : 'binaria',
          pinnacleOdds: o.price, pinnacleUpdatedAt: update }));
      }
    }
  }
  return rows;
}
function placardSelections(game, event) {
  const teamNames = game.teams.map(t => [event.home_team, event.away_team].filter(n => namesEqual(t, n)));
  if (teamNames.some(a => a.length !== 1) || teamNames[0][0] === teamNames[1][0]) return [];
  const rows = [];
  for (const m of game.markets) {
    let selections;
    if (m.type === 'MRES') selections = [teamNames[0][0], 'Draw', teamNames[1][0]];
    else if (['H2HT', 'HTOH'].includes(m.type)) selections = [teamNames[0][0], teamNames[1][0]];
    else if (m.type === 'TPOT' || m.type === 'HCTG') selections = ['Over', 'Under'];
    else if (['HCOT', 'TGHC'].includes(m.type) || /handicap|spread|hcap|hcp|sprd|hdc|hnd|^ah/i.test(`${m.type || ''} ${m.title || ''}`)) selections = [teamNames[0][0], teamNames[1][0]];
    else continue;
    if (m.selections.length !== selections.length) continue;
    for (let i = 0; i < selections.length; i++) {
      const s = m.selections[i];
      const price = Number(s.price), line = s.line === null ? null : Number(s.line);
      if (s.unavailable || !Number.isFinite(price) || price <= 1) continue;
      const market = ['TPOT', 'HCTG'].includes(m.type) ? 'totals'
        : ['HCOT', 'TGHC'].includes(m.type) || /handicap|spread|hcap|hcp|sprd|hdc|hnd|^ah/i.test(`${m.type || ''} ${m.title || ''}`) ? 'spreads' : 'h2h';
      rows.push({ market,
        selection: selections[i], line, placardOdds: price });
    }
  }
  return rows;
}
function matchingEvents(game, events) {
  const tolerance = game.apiSport?.startsWith('tennis_') ? 3 * 60 * 60 * 1000 : 60000;
  return events.filter(e => Math.abs(Date.parse(e.commence_time) - Date.parse(game.commenceTime)) <= tolerance
    && game.teams.every(t => namesEqual(t, e.home_team) || namesEqual(t, e.away_team)));
}
function nearValueSelections(game, event, now = Date.now()) {
  const refs = references(event, now, false, 24 * 60 * 60 * 1000);
  return placardSelections(game, event).flatMap(s => {
    const ref = refs.find(r => r.market === s.market && r.line === s.line && r.selection === s.selection);
    return ref && s.placardOdds >= (1.01 / ref.probability) * 0.97
      ? [{ market: s.market, line: s.line, selection: s.selection, placardOdds: s.placardOdds }] : [];
  });
}
function comparedSelectionCount(game, event, now = Date.now()) {
  const refs = references(event, now, false, 24 * 60 * 60 * 1000);
  return placardSelections(game, event).filter(s => refs.some(r => r.market === s.market
    && r.line === s.line && r.selection === s.selection)).length;
}
function isNearValue(game, event, now = Date.now()) { return nearValueSelections(game, event, now).length > 0; }
function compare(game, events, now = Date.now()) {
  if (!game.commenceTime || now >= Date.parse(game.commenceTime) || Date.parse(game.commenceTime) > now + 12 * 3600000) return { rows: [], reason: 'fora_janela_12h' };
  const age = now - Date.parse(game.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 120000) return { rows: [], reason: 'placard_antigo' };
  const matches = matchingEvents(game, events);
  if (matches.length !== 1) return { rows: [], reason: matches.length ? 'evento_ambiguo' : 'evento_sem_correspondencia' };
  const event = matches[0];
  const refs = references(event, now);
  const rows = [];
  let comparedSelections = 0;
  for (const s of placardSelections(game, event)) {
    const ref = refs.find(r => r.market === s.market && r.line === s.line && r.selection === s.selection);
    if (!ref) continue;
    comparedSelections++;
    if (s.placardOdds <= 1.01 / ref.probability) continue;
    const edgePct = (s.placardOdds * ref.probability - 1) * 100;
    const id = crypto.createHash('sha256').update(JSON.stringify([game.apiSport, event.id, s.market, s.line, s.selection])).digest('hex');
    rows.push({ ...s, ...ref, id, apiSport: game.apiSport, eventId: event.id,
      game: `${event.home_team} x ${event.away_team}`, competition: game.competition,
      commenceTime: game.commenceTime, apiCommenceTime: event.commence_time, placardObservedAt: game.observedAt,
      comparedAt: new Date(now).toISOString(), sourceUrl: game.sourceUrl,
      minValueOdds: 1.01 / ref.probability, edgePct,
      kellyPct: Math.max(0, edgePct / (s.placardOdds - 1) * KELLY_FRACTION) });
  }
  return { rows, comparedSelections, reason: rows.length ? null : comparedSelections ? 'sem_valor' : 'sem_linha_equivalente_ou_preco_recente' };
}
function compareBookmaker(bookmaker, game, events, now = Date.now(), { startToleranceMs = 0 } = {}) {
  if (!bookmaker || typeof bookmaker !== 'string') throw new TypeError('bookmaker obrigatório');
  if (!Number.isFinite(startToleranceMs) || startToleranceMs < 0 || startToleranceMs > 10 * 60000) {
    throw new RangeError('tolerância de início inválida (máximo de 10 minutos)');
  }
  let comparisonGame = game;
  let comparisonEvents = events;
  let scheduleDeltaMs = 0;
  if (startToleranceMs > 0) {
    const sourceStart = Date.parse(game.commenceTime || '');
    const sourceDate = Number.isFinite(sourceStart) ? new Date(sourceStart).toISOString().slice(0, 10) : null;
    const candidates = events.filter(event => {
      const eventStart = Date.parse(event.commence_time || '');
      if (!Number.isFinite(eventStart) || new Date(eventStart).toISOString().slice(0, 10) !== sourceDate
        || Math.abs(eventStart - sourceStart) > startToleranceMs) return false;
      const homeMatches = game.teams.filter(team => namesEqual(team, event.home_team)).length;
      const awayMatches = game.teams.filter(team => namesEqual(team, event.away_team)).length;
      return game.teams.length === 2 && homeMatches === 1 && awayMatches === 1;
    });
    if (candidates.length !== 1) return { rows: [], reason: candidates.length ? 'evento_ambiguo' : 'evento_sem_correspondencia' };
    const [event] = candidates;
    scheduleDeltaMs = Date.parse(event.commence_time) - sourceStart;
    comparisonGame = { ...game, commenceTime: event.commence_time };
    comparisonEvents = [event];
  }
  const result = compare(comparisonGame, comparisonEvents, now);
  if (!result.rows.length) return result;
  return { ...result, rows: result.rows.map(row => ({ ...row,
    id: crypto.createHash('sha256').update(JSON.stringify([bookmaker, row.id])).digest('hex'),
    bookmaker, sourceOdds: row.placardOdds,
    ...(startToleranceMs > 0 ? { commenceTime: game.commenceTime,
      apiCommenceTime: row.apiCommenceTime, sourceScheduleVerified: true, scheduleDeltaMs } : {}),
  })) };
}
function report(entries) {
  const closed = entries.filter(e => Number.isFinite(e.clvPct));
  const captured = entries.filter(e => e.closingStatus === 'capturada').length;
  const missing = entries.filter(e => e.closingStatus === 'indisponivel').length;
  const resolvedClosings = captured + missing;
  const groups = new Map();
  for (const e of closed) {
    const key = `${e.apiSport}|${e.eventId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.clvPct);
  }
  const mean = closed.length ? closed.reduce((s, e) => s + e.clvPct, 0) / closed.length : null;
  let lower = null, upper = null;
  // Bootstrap por evento preserva a correlação entre lados/mercados do jogo.
  if (groups.size >= 2) {
    let seed = 1729;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const clusters = [...groups.values()], means = [];
    for (let i = 0; i < 4000; i++) {
      let sum = 0, count = 0;
      for (let j = 0; j < clusters.length; j++) {
        const values = clusters[Math.floor(random() * clusters.length)];
        for (const v of values) { sum += v; count++; }
      }
      means.push(sum / count);
    }
    means.sort((a, b) => a - b);
    lower = means[100]; upper = means[3899];
  }
  return { n: closed.length, nEvents: groups.size, total: entries.length, captured,
    pending: entries.filter(e => !e.closingStatus || e.closingStatus === 'pendente').length,
    missing, captureRate: resolvedClosings ? captured / resolvedClosings : null,
    mean, lower, upper, verdict: closed.length >= 100 && lower !== null && lower > 0 ? 'confirmado' : 'não confirmado',
    ciMethod: 'bootstrap por evento, 4000 reamostragens; uma amostra por evento/mercado/linha/lado' };
}
module.exports = { namesEqual, normalize, fairProbabilities, references, matchingEvents, placardSelections, compare, compareBookmaker,
  comparedSelectionCount, isNearValue, nearValueSelections, report };
