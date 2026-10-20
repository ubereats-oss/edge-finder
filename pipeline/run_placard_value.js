const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');
const { database } = require('./odds_api_monthly_budget');
const { createBrowser, scrapeCompetition } = require('./get_placard_odds');
const { compare, references, matchingEvents, isNearValue, nearValueSelections, report, namesEqual, normalize,
  comparedSelectionCount } = require('./placard_value');
const competitions = require('./placard_config');
const fs = require('fs');
const crypto = require('crypto');

async function allEntries(db) {
  const rows = [];
  let cursor;
  for (;;) {
    let query = db.collection('_placard_opportunities').orderBy('__name__').limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    rows.push(...snap.docs.map(d => ({ ...d.data(), id: d.id })));
    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return rows;
}

async function saveOpportunity(db, row) {
  const ref = db.collection('_placard_opportunities').doc(row.id);
  await db.runTransaction(async tx => {
    const previous = await tx.get(ref);
    if (!previous.exists) tx.create(ref, { ...row, closingStatus: 'pendente' });
    else tx.update(ref, { lastObservedAt: row.placardObservedAt, lastPlacardOdds: row.placardOdds });
  });
}

async function exactTotals(api, sport, event, lines, attempted, closing = false) {
  const available = references(event, Date.now(), closing).filter(r => r.market === 'totals').map(r => r.line);
  const missing = lines.filter(line => Number.isFinite(line) && Number.isInteger(line * 2) && !available.includes(line));
  if (!missing.length || attempted.has(event.id)) return;
  attempted.add(event.id);
  // Nunca converte, por exemplo, Pinnacle 3,25 em Placard 3,5. Busca a linha
  // exata entre os totais alternativos quando o fornecedor a disponibiliza.
  const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`, {
    timeout: 15000, params: { bookmakers: 'pinnacle', markets: 'alternate_totals', oddsFormat: 'decimal' },
  });
  const alternate = data?.bookmakers?.find(b => b.key === 'pinnacle')?.markets?.find(m => m.key === 'alternate_totals');
  if (!alternate || data.id !== event.id || Math.abs(Date.parse(data.commence_time) - Date.parse(event.commence_time)) > 60000) return;
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  if (bm) bm.markets.push(alternate);
  else {
    event.bookmakers ||= [];
    event.bookmakers.push({ key: 'pinnacle', markets: [alternate] });
  }
}

async function exactSpreads(api, sport, event, lines, attempted, closing = false) {
  const available = references(event, Date.now(), closing).filter(r => r.market === 'spreads').map(r => `${r.selection}|${r.line}`);
  const missing = lines.filter(row => Number.isFinite(row.line) && Number.isInteger(row.line * 2)
    && !available.includes(`${row.selection}|${row.line}`));
  if (!missing.length || attempted.has(`spreads:${event.id}`)) return;
  attempted.add(`spreads:${event.id}`);
  const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds`, {
    timeout: 15000, params: { bookmakers: 'pinnacle', markets: 'alternate_spreads', oddsFormat: 'decimal' },
  });
  const alternate = data?.bookmakers?.find(b => b.key === 'pinnacle')?.markets?.find(m => m.key === 'alternate_spreads');
  if (!alternate || data.id !== event.id || Math.abs(Date.parse(data.commence_time) - Date.parse(event.commence_time)) > 60000) return;
  const bm = event.bookmakers?.find(b => b.key === 'pinnacle');
  if (bm) bm.markets.push(alternate);
  else { event.bookmakers ||= []; event.bookmakers.push({ key: 'pinnacle', markets: [alternate] }); }
}

function tennisCompetitionAlias(key) {
  const slug = key.replace(/^tennis_(?:atp|wta)_/, '').replace(/_singles$/, '');
  const special = { aus_open: 'Melbourne', french_open: 'Paris', us_open: 'New York',
    queens_club_champ: 'London', monte_carlo_masters: 'Monte-Carlo', indian_wells: 'Indian Wells',
    canadian_open: 'Toronto', china_open: 'Beijing', italian_open: 'Roma', japan_open: 'Tokyo',
    wimbledon: 'London', paris_masters: 'Paris', shanghai_masters: 'Shanghai',
    barcelona_open: 'Barcelona', hamburg_open: 'Hamburg', halle_open: 'Halle', munich: 'Munich',
    cincinnati_open: 'Cincinnati', washington_open: 'Washington', dubai: 'Dubai',
    singapore_open: 'Singapore', ningbo_open: 'Ningbo', osaka: 'Osaka', guadalajara_open: 'Guadalajara',
    wuhan_open: 'Wuhan', monterrey_open: 'Monterrey', strasbourg: 'Strasbourg', stuttgart_open: 'Stuttgart' };
  const name = special[slug] || slug.split('_').filter(part => !['open', 'championship', 'champ', 'masters', 'singles', 'wta', 'atp'].includes(part)).join(' ');
  return `${name.replace(/\b\w/g, c => c.toUpperCase())} - Individual`;
}

function competitionUrl(found, cfg) {
  const normalizeText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = [cfg.label, ...(cfg.aliases || [])].map(normalizeText);
  const urls = rows => [...new Set(rows.map(l => l.href.replace(/\/matches$/, '')))];
  const exact = urls(found.filter(l => labels.includes(normalizeText(l.text))));
  if (exact.length === 1) return `${exact[0]}/matches`;
  if (exact.length > 1) return null;
  if (cfg.sport !== 'tennis') return null;
  const aliases = [tennisCompetitionAlias(cfg.key).replace(/ - Individual$/i, '')];
  if (cfg.key.endsWith('_canadian_open')) aliases.push('Montreal');
  if (cfg.key.endsWith('_aus_open_singles')) aliases.push('Australian Open');
  if (cfg.key.endsWith('_french_open')) aliases.push('Roland Garros');
  const fuzzy = urls(found.filter(l => aliases.some(alias => normalizeText(alias).length > 2
    && normalizeText(l.text).includes(normalizeText(alias)))));
  return fuzzy.length === 1 ? `${fuzzy[0]}/matches` : null;
}

async function readCompetitionLinks(page) {
  const found = new Map();
  for (let i = 0; i < 40; i++) {
    const links = await page.locator('a.ta-SportGroupsListButton').evaluateAll(es => es.map(e => ({
      text: e.textContent.trim().replace(/^soccer icon/, ''), href: e.href,
    })));
    for (const link of links) if (link.href) found.set(link.href, link);
    const moved = await page.evaluate(() => {
      const first = document.querySelector('a.ta-SportGroupsListButton');
      let scroller = first?.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 10
        && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      scroller ||= document.scrollingElement;
      const old = scroller.scrollTop;
      scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 500);
      return scroller.scrollTop !== old;
    });
    if (!moved) break;
    await page.waitForTimeout(150);
  }
  return [...found.values()];
}

const placardSportPaths = {
  americanfootball: ['american-football', 'americanfootball', 'football'],
  icehockey: ['ice-hockey', 'icehockey', 'hockey'],
  mma: ['mma', 'mixed-martial-arts', 'ufc'],
};

async function scan(db) {
  const rows = [], errors = [], diagnostics = [];
  const api = createOddsApiClient({ label: 'placard-scan' });
  const attemptedAlternates = new Set();
  const browser = await createBrowser();
  try {
    const page = await browser.newPage({ locale: 'pt-PT', timezoneId: 'UTC' });
    // Redescobre IDs, que podem mudar a cada temporada. Nunca usa URL de
    // outra liga como fallback quando o nome deixa de existir.
    const catalogResponse = await api.get('https://api.the-odds-api.com/v4/sports', { timeout: 15000, params: { all: 'true' } });
    const activeKeys = new Set(catalogResponse.data.filter(s => s.active).map(s => s.key));
    const activeCompetitions = competitions.filter(c => activeKeys.has(c.key));
    for (const sport of catalogResponse.data.filter(s => s.active && /^tennis_(?:atp|wta)_/.test(s.key))) {
      if (!activeCompetitions.some(c => c.key === sport.key)) activeCompetitions.push({
        key: sport.key, label: sport.title || tennisCompetitionAlias(sport.key), sport: 'tennis', markets: ['h2h', 'spreads', 'totals'],
      });
    }
    const links = new Map();
    const sportCatalogs = new Map();
    for (const sport of new Set(activeCompetitions.map(c => c.sport))) {
      try {
        let found = [];
        for (const path of placardSportPaths[sport] || [sport]) {
          try {
            await page.goto(`https://www.placard.pt/apostas/sports/${path}/competitions`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.locator('a.ta-SportGroupsListButton').first().waitFor({ state: 'attached', timeout: 8000 });
            found = await readCompetitionLinks(page);
            if (found.length) break;
          } catch (_) { /* tenta o próximo slug observado/canônico */ }
        }
        if (!found.length) throw new Error(`Nenhum slug Placard respondeu para ${sport}.`);
        sportCatalogs.set(sport, found.map(l => l.text));
        for (const cfg of activeCompetitions.filter(c => c.sport === sport)) {
          const url = competitionUrl(found, cfg);
          if (url) links.set(cfg.key, url);
        }
      } catch (error) {
        for (const cfg of activeCompetitions.filter(c => c.sport === sport)) {
          diagnostics.push({ competition: cfg.label, reason: 'catalogo_placard_indisponivel', detail: error.message });
        }
      }
    }
    for (const cfg of activeCompetitions) {
      try {
        const url = links.get(cfg.key);
        if (!url) { diagnostics.push({ competition: cfg.label, reason: 'competicao_nao_confirmada_no_catalogo_placard',
          availableCompetitions: (sportCatalogs.get(cfg.sport) || []).slice(0, 80) }); continue; }
        const games = (await scrapeCompetition(page, cfg, url)).filter(g => {
          const delta = Date.parse(g.commenceTime) - Date.now();
          return delta > 0 && delta <= 12 * 3600000;
        });
        if (!games.length) { diagnostics.push({ competition: cfg.label, reason: 'sem_jogos_12h' }); continue; }
        const cacheRef = db.collection('_placard_pinnacle_latest').doc(cfg.key);
        const cacheSnap = await cacheRef.get();
        let events = cacheSnap.data()?.events || [];
        const notFoundProbes = cacheSnap.data()?.notFoundProbes || {};
        for (const [key, value] of Object.entries(notFoundProbes)) {
          if (!Number.isFinite(Date.parse(value)) || Date.now() - Date.parse(value) > 24 * 3600000) delete notFoundProbes[key];
        }
        events = events.map(e => ({ ...e, sport_key: cfg.key }));
        const dueEvents = new Map();
        const triggerSignatures = new Map();
        for (const game of games) {
          const matches = matchingEvents(game, events);
          const event = matches.length === 1 ? matches[0] : null;
          const delta = Date.parse(game.commenceTime) - Date.now();
          const near = event && isNearValue(game, event);
          const signature = near ? JSON.stringify(nearValueSelections(game, event)) : null;
          if (near && event) {
            const stateRef = db.collection('_placard_refresh_state').doc(`${cfg.key}_${event.id}`);
            const state = (await stateRef.get()).data() || {};
            if (state.nearSignature !== signature) triggerSignatures.set(event.id, { ref: stateRef, signature });
          }
          const bookmaker = event?.bookmakers?.find(b => b.key === 'pinnacle');
          const marketUpdates = (bookmaker?.markets || [])
            .map(m => Date.parse(m.last_update || bookmaker.last_update)).filter(Number.isFinite);
          const stale = !event || !marketUpdates.length || marketUpdates.some(t => Date.now() - t > 2 * 3600000);
          const gameKey = crypto.createHash('sha256').update(JSON.stringify([cfg.key, game.teams.map(normalize).sort(), game.commenceTime])).digest('hex');
          const lastProbe = Date.parse(notFoundProbes[gameKey] || '');
          const probeDue = !event && (!Number.isFinite(lastProbe) || Date.now() - lastProbe >= 2 * 3600000);
          if (probeDue || (event && triggerSignatures.has(event.id)) || (event && delta <= 3 * 3600000 && stale)) {
            if (event) dueEvents.set(event.id, event);
            else dueEvents.set(`new:${gameKey}`, null);
          }
        }
        let refreshedEvents = [];
        if (dueEvents.size) {
          const knownIds = [...dueEvents.keys()].filter(id => !id.startsWith('new:'));
          const markets = cfg.markets || ['h2h', 'totals', 'spreads'];
          const params = { bookmakers: 'pinnacle', markets: markets.join(','), oddsFormat: 'decimal' };
          if (knownIds.length === dueEvents.size) params.eventIds = knownIds.join(',');
          else {
            params.commenceTimeFrom = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
            params.commenceTimeTo = new Date(Date.now() + 12 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
          }
          const response = await api.get(`https://api.the-odds-api.com/v4/sports/${cfg.key}/odds`, { timeout: 20000, params });
          refreshedEvents = response.data.map(e => ({ ...e, sport_key: cfg.key }));
          for (const key of dueEvents.keys()) {
            if (key.startsWith('new:')) notFoundProbes[key.slice(4)] = new Date().toISOString();
          }
          const merged = new Map(events.map(e => [e.id, e]));
          for (const e of refreshedEvents) merged.set(e.id, e);
          const expiresAt = Date.now() + 12 * 3600000;
          events = [...merged.values()].filter(e => {
            const start = Date.parse(e.commence_time);
            return Number.isFinite(start) && start > Date.now() && start <= expiresAt;
          });
          await cacheRef.set({ events, notFoundProbes, updatedAt: new Date().toISOString() });
          for (const [eventId, state] of triggerSignatures) {
            if (refreshedEvents.some(e => e.id === eventId)) {
              await state.ref.set({ nearSignature: state.signature, updatedAt: new Date().toISOString() }, { merge: true });
            }
          }
          for (const game of games) {
            const match = matchingEvents(game, refreshedEvents);
            if (match.length !== 1 || !isNearValue(game, match[0])) continue;
            const eventId = match[0].id;
            const stateRef = db.collection('_placard_refresh_state').doc(`${cfg.key}_${eventId}`);
            const signature = JSON.stringify(nearValueSelections(game, match[0]));
            await stateRef.set({ nearSignature: signature, updatedAt: new Date().toISOString() }, { merge: true });
          }
        }
        for (const game of games) {
          const matches = matchingEvents(game, refreshedEvents);
          let alternateError = null;
          if (matches.length === 1) {
            const totalLines = game.markets.filter(m => ['TPOT', 'HCTG'].includes(m.type))
              .flatMap(m => m.selections.filter(s => !s.unavailable && s.line !== null).map(s => Number(s.line)));
            const spreadLines = game.markets.filter(m => /handicap|spread|hcap|hcp|sprd|hdc|hnd|^ah/i.test(`${m.type || ''} ${m.title || ''}`))
              .flatMap(m => m.selections.filter(s => !s.unavailable && s.line !== null).map((s, i) => ({
                selection: [matches[0].home_team, matches[0].away_team].find(name => namesEqual(game.teams[i], name)),
                line: Number(s.line),
              })));
            try {
              if (totalLines.length) await exactTotals(api, cfg.key, matches[0], totalLines, attemptedAlternates);
              if (spreadLines.length) await exactSpreads(api, cfg.key, matches[0], spreadLines, attemptedAlternates);
            }
            catch (e) { alternateError = e.message; }
          }
          const result = compare(game, refreshedEvents);
          const known = matchingEvents(game, events);
          const comparedSelections = known.length === 1 ? comparedSelectionCount(game, known[0]) : 0;
          const reason = result.reason === 'evento_sem_correspondencia' && known.length === 1
            ? 'preco_conhecido_aguardando_gatilho' : result.reason;
          diagnostics.push({ competition: cfg.label, teams: game.teams, reason,
            comparedSelections, confirmedSelections: result.comparedSelections ?? 0, alternateError });
          for (const row of result.rows) { await saveOpportunity(db, row); rows.push(row); }
        }
        if (refreshedEvents.length) await cacheRef.set({ events, notFoundProbes, updatedAt: new Date().toISOString() });
        await db.collection('_placard_reads').add({ observedAt: new Date().toISOString(), apiSport: cfg.key,
          games, pinnacle: JSON.stringify(events), refreshedEventIds: refreshedEvents.map(e => e.id) });
      } catch (e) { errors.push({ competition: cfg.label, error: e.message }); }
    }
  } finally { await browser.close(); }
  return { rows, errors, diagnostics };
}

async function captureClosing(db, entries) {
  const now = Date.now();
  const pending = entries.filter(e => e.closingStatus === 'pendente');
  const due = new Map();
  for (const e of pending) {
    const start = Date.parse(e.commenceTime);
    const ref = db.collection('_placard_opportunities').doc(e.id);
    if (now >= start) {
      const candidate = e.closingCandidate;
      // Só aceita preço realmente observado ANTES do início, fresco na
      // janela final de cinco minutos. Nunca usa preço ao vivo pós-início.
      if (candidate && Date.parse(candidate.capturedAt) < start && Date.parse(candidate.updatedAt) >= start - 300000 && Date.parse(candidate.updatedAt) < start) {
        await ref.update({ closingStatus: 'capturada', closingFairOdds: 1 / candidate.probability,
          closingUpdatedAt: candidate.updatedAt, closingCapturedAt: candidate.capturedAt,
          closingLeadSeconds: (start - Date.parse(candidate.updatedAt)) / 1000,
          clvPct: (e.placardOdds * candidate.probability - 1) * 100 });
      } else {
        await ref.update({ closingStatus: 'indisponivel', closingReason: 'sem_preco_pregame_na_mesma_linha_nos_ultimos_5min' });
      }
    } else if (start - now <= 5 * 60000) {
      if (!due.has(e.apiSport)) due.set(e.apiSport, []);
      due.get(e.apiSport).push(e);
    }
  }
  if (!due.size) return;
  const api = createOddsApiClient({ label: 'placard-closing' });
  const attemptedAlternates = new Set();
  for (const [sport, group] of due) {
    try {
      const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
        timeout: 15000, params: { bookmakers: 'pinnacle', markets: [...new Set(group.map(e => e.market))].join(','), oddsFormat: 'decimal',
          eventIds: [...new Set(group.map(e => e.eventId))].join(',') },
      });
      for (const e of group) {
        if (Date.now() >= Date.parse(e.commenceTime)) continue;
        const event = data.find(ev => ev.id === e.eventId);
        if (!event || Math.abs(Date.parse(event.commence_time) - Date.parse(e.commenceTime)) > 60000) continue;
        if (e.market === 'totals') {
          try { await exactTotals(api, sport, event, [e.line], attemptedAlternates, true); }
          catch (error) { console.error(`Linha de fechamento ${e.eventId}: ${error.message}`); }
        }
        if (e.market === 'spreads') {
          try { await exactSpreads(api, sport, event, [{ selection: e.selection, line: e.line }], attemptedAlternates, true); }
          catch (error) { console.error(`Handicap de fechamento ${e.eventId}: ${error.message}`); }
        }
        const capturedAt = new Date().toISOString();
        if (Date.parse(capturedAt) >= Date.parse(e.commenceTime)) continue;
        const candidate = references({ ...event, sport_key: sport }, Date.parse(capturedAt), true)
          .find(r => r.market === e.market && r.line === e.line && r.selection === e.selection);
        if (candidate && Date.parse(candidate.pinnacleUpdatedAt) >= Date.parse(e.commenceTime) - 300000) {
          await db.collection('_placard_opportunities').doc(e.id).update({ closingCandidate: {
            probability: candidate.probability, updatedAt: candidate.pinnacleUpdatedAt, capturedAt,
          } });
        }
      }
    } catch (e) { console.error(`Fechamento ${sport}: ${e.message}`); }
  }
}

async function publish(db, result, entries) {
  const generatedAt = new Date().toISOString();
  const runId = `r${generatedAt.replace(/[^0-9]/g, '')}`;
  const ref = db.collection('results').doc('placard_current');
  const run = ref.collection('runs').doc(runId);
  const pageCount = Math.ceil(result.rows.length / 100);
  for (let i = 0; i < pageCount; i++) await run.collection('pages').doc(String(i)).set({ rows: result.rows.slice(i * 100, (i + 1) * 100) });
  const budget = (await db.collection('_odds_api_budget').doc(generatedAt.slice(0, 7)).get()).data() || {};
  const payload = { generatedAt, runId, pageCount, report: report(entries), errors: result.errors,
    budget: { reserved: budget.reserved ?? 0, limit: 4000, baselineCredits: budget.baselineCredits ?? 0,
      readingAllowance: budget.nonClosingLimit ?? 0, startedAt: budget.startedAt ?? null },
    cadenceMinutes: 30, priceMaxAgeSeconds: 120, closingWindowMinutes: 5 };
  await run.set({ ...payload, diagnostics: result.diagnostics });
  await ref.set(payload);
}

async function main() {
  loadEnvFileIfPresent();
  process.env.ODDS_API_ENFORCE_MONTHLY_BUDGET = '1';
  const db = database();
  const control = db.collection('_placard_control').doc('scan');
  if (process.argv.includes('--plan')) {
    const state = (await control.get()).data() || {};
    const needsScan = process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 30 * 60000;
    const pending = await db.collection('_placard_opportunities').where('closingStatus', '==', 'pendente').get();
    const needsClosing = process.env.PLACARD_CLOSING_ONLY === '1' || pending.docs.some(d => Date.parse(d.data().commenceTime) - Date.now() <= 5 * 60000);
    const output = `needs_scan=${needsScan}\nneeds_work=${needsScan || needsClosing}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
    else console.log(output);
    return;
  }
  let entries = await allEntries(db);
  const existingIds = new Set(entries.map(e => e.id));
  // Fechamento tem prioridade sobre nova coleta.
  await captureClosing(db, entries);
  if (process.env.PLACARD_CLOSING_ONLY === '1') {
    entries = await allEntries(db);
    const state = (await control.get()).data() || {};
    const result = state.result || { rows: [], errors: [], diagnostics: [] };
    await publish(db, result, entries);
    fs.writeFileSync('placard_run_summary.json', JSON.stringify(report(entries), null, 2));
    return;
  }
  const state = (await control.get()).data() || {};
  const due = process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 30 * 60000;
  let result;
  if (due) {
    await control.set({ lastAttemptAt: new Date().toISOString() }, { merge: true });
    try { result = await scan(db); }
    catch (e) { result = { rows: [], errors: [{ error: e.message }], diagnostics: [] }; }
    await control.set({ result }, { merge: true });
  } else result = state.result || { rows: [], errors: [], diagnostics: [] };
  entries = await allEntries(db);
  if (due) {
    // Oportunidade descoberta já nos minutos finais também precisa de
    // fechamento nesta execução, sem esperar o próximo cron.
    await captureClosing(db, entries.filter(e => !existingIds.has(e.id) || Date.parse(e.commenceTime) <= Date.now()));
    entries = await allEntries(db);
  }
  result.rows = entries.filter(e => e.closingStatus === 'pendente' && Date.parse(e.commenceTime) > Date.now());
  await publish(db, result, entries);
  fs.writeFileSync('placard_run_summary.json', JSON.stringify({ ...report(entries), scan: due,
    opportunities: result.rows.length, errors: result.errors }, null, 2));
  if (due && result.errors.length) throw new Error(`Coleta incompleta: ${result.errors.map(e => e.competition || e.error).join(', ')}`);
}
module.exports = { scan, captureClosing, allEntries, publish, exactTotals, exactSpreads, competitionUrl };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
