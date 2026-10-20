const { createOddsApiClient, loadEnvFileIfPresent } = require('./odds_api_client');
const { database } = require('./odds_api_monthly_budget');
const { createBrowser, scrapeCompetition } = require('./get_placard_odds');
const { compare, references, report } = require('./placard_value');
const competitions = require('./placard_config');
const fs = require('fs');

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

async function scan(db) {
  const rows = [], errors = [], diagnostics = [];
  const api = createOddsApiClient({ label: 'placard-scan' });
  const browser = await createBrowser();
  try {
    const page = await browser.newPage({ locale: 'pt-PT', timezoneId: 'UTC' });
    // Redescobre IDs, que podem mudar a cada temporada. Nunca usa URL de
    // outra liga como fallback quando o nome deixa de existir.
    const links = new Map();
    for (const sport of ['soccer', 'basketball']) {
      await page.goto(`https://www.placard.pt/apostas/sports/${sport}/competitions`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.locator('a.ta-SportGroupsListButton').first().waitFor({ state: 'attached', timeout: 20000 });
      const found = await page.locator('a.ta-SportGroupsListButton').evaluateAll(es => es.map(e => ({ text: e.textContent.trim().replace(/^soccer icon/, ''), href: e.href })));
      for (const cfg of competitions.filter(c => c.sport === sport)) {
        const urls = [...new Set(found.filter(l => l.text === cfg.label).map(l => l.href.replace(/\/matches$/, '')))];
        if (urls.length === 1) links.set(cfg.key, `${urls[0]}/matches`);
      }
    }
    for (const cfg of competitions) {
      try {
        const url = links.get(cfg.key);
        if (!url) throw new Error('Competição não identificada de forma única no catálogo do Placard.');
        const games = (await scrapeCompetition(page, cfg, url)).filter(g => {
          const delta = Date.parse(g.commenceTime) - Date.now();
          return delta > 0 && delta <= 12 * 3600000;
        });
        if (!games.length) { diagnostics.push({ competition: cfg.label, reason: 'sem_jogos_12h' }); continue; }
        // Uma chamada para TODOS os jogos da competição, não uma por jogo.
        const from = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const to = new Date(Date.now() + 12 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        const response = await api.get(`https://api.the-odds-api.com/v4/sports/${cfg.key}/odds`, {
          timeout: 20000, params: { bookmakers: 'pinnacle', markets: 'h2h,totals', oddsFormat: 'decimal', commenceTimeFrom: from, commenceTimeTo: to },
        });
        const events = response.data.map(e => ({ ...e, sport_key: cfg.key }));
        for (const game of games) {
          const result = compare(game, events);
          diagnostics.push({ competition: cfg.label, teams: game.teams, reason: result.reason, comparedSelections: result.comparedSelections ?? 0 });
          for (const row of result.rows) { await saveOpportunity(db, row); rows.push(row); }
        }
        // Guarda a leitura integral, inclusive odds sem valor e nomes não casados.
        await db.collection('_placard_reads').add({ observedAt: new Date().toISOString(), apiSport: cfg.key, games, pinnacle: JSON.stringify(events) });
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
  for (const [sport, group] of due) {
    try {
      const { data } = await api.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
        timeout: 15000, params: { bookmakers: 'pinnacle', markets: 'h2h,totals', oddsFormat: 'decimal',
          eventIds: [...new Set(group.map(e => e.eventId))].join(',') },
      });
      const capturedAt = new Date().toISOString();
      for (const e of group) {
        if (Date.parse(capturedAt) >= Date.parse(e.commenceTime)) continue;
        const event = data.find(ev => ev.id === e.eventId);
        if (!event || Math.abs(Date.parse(event.commence_time) - Date.parse(e.commenceTime)) > 60000) continue;
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
    cadenceHours: 6, priceMaxAgeSeconds: 120, closingWindowMinutes: 5 };
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
    const needsScan = process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 6 * 3600000;
    const pending = await db.collection('_placard_opportunities').where('closingStatus', '==', 'pendente').get();
    const needsClosing = pending.docs.some(d => Date.parse(d.data().commenceTime) - Date.now() <= 5 * 60000);
    const output = `needs_scan=${needsScan}\nneeds_work=${needsScan || needsClosing}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, output);
    else console.log(output);
    return;
  }
  let entries = await allEntries(db);
  // Fechamento tem prioridade sobre nova coleta.
  await captureClosing(db, entries);
  const state = (await control.get()).data() || {};
  const due = process.env.PLACARD_FORCE_SCAN === '1' || !state.lastAttemptAt || Date.now() - Date.parse(state.lastAttemptAt) >= 6 * 3600000;
  let result;
  if (due) {
    await control.set({ lastAttemptAt: new Date().toISOString() }, { merge: true });
    try { result = await scan(db); }
    catch (e) { result = { rows: [], errors: [{ error: e.message }], diagnostics: [] }; }
    await control.set({ result }, { merge: true });
  } else result = state.result || { rows: [], errors: [], diagnostics: [] };
  entries = await allEntries(db);
  await publish(db, result, entries);
  fs.writeFileSync('placard_run_summary.json', JSON.stringify({ ...report(entries), scan: due,
    opportunities: result.rows.length, errors: result.errors }, null, 2));
  if (due && result.errors.length) throw new Error(`Coleta incompleta: ${result.errors.map(e => e.competition || e.error).join(', ')}`);
}
module.exports = { scan, captureClosing, allEntries, publish };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
