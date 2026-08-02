/**
 * sync_odds_br.js
 * Busca odds reais da Pinnacle BR via sports2.pinnacle.bet.br,
 * recalcula edge/Kelly e atualiza o Firestore.
 *
 * Pré-requisitos:
 *   - FIREBASE_SERVICE_ACCOUNT no .env
 *   - npm install firebase-admin axios
 *
 * Uso:
 *   node sync_odds_br.js            → todos os esportes
 *   node sync_odds_br.js nba        → só NBA BR
 *   node sync_odds_br.js nhl        → só NHL
 *   node sync_odds_br.js mlb
 *   node sync_odds_br.js tennis
 */

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

// ── Carrega .env ──────────────────────────────────────────────────────────────
for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf-8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && k.trim()) process.env[k.trim()] = v.join('=').trim();
}

const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ── Configuração por esporte ──────────────────────────────────────────────────
const SPORT_CONFIG = {
  nba:    { col: 'results', doc: 'nba_props_br', minEdge: 10, calib: 'nba'    },
  nhl:    { col: 'results', doc: 'nhl_props',    minEdge: 15, calib: 'nhl'    },
  mlb:    { col: 'results', doc: 'mlb_props',    minEdge: 15, calib: 'nba'    },
  tennis: { col: 'results', doc: 'tennis_props', minEdge: 5,  calib: 'tennis' },
};

// ── Tabelas de calibração ─────────────────────────────────────────────────────
const CALIB_TABLES = {
  nba: [
    { raw: 0.519, cal: 0.504 },
    { raw: 0.576, cal: 0.572 },
    { raw: 0.625, cal: 0.608 },
    { raw: 0.674, cal: 0.671 },
    { raw: 0.723, cal: 0.720 },
    { raw: 0.771, cal: 0.764 },
    { raw: 0.816, cal: 0.811 },
  ],
  nhl: [
    { raw: 0.521, cal: 0.531 },
    { raw: 0.578, cal: 0.534 },
    { raw: 0.623, cal: 0.534 },
    { raw: 0.675, cal: 0.539 },
    { raw: 0.723, cal: 0.576 },
    { raw: 0.771, cal: 0.587 },
    { raw: 0.822, cal: 0.618 },
    { raw: 0.871, cal: 0.625 },
    { raw: 0.922, cal: 0.639 },
  ],
  tennis: [
    { raw: 0.521, cal: 0.435 },
    { raw: 0.578, cal: 0.476 },
    { raw: 0.623, cal: 0.525 },
    { raw: 0.676, cal: 0.572 },
    { raw: 0.724, cal: 0.608 },
    { raw: 0.773, cal: 0.675 },
    { raw: 0.824, cal: 0.709 },
    { raw: 0.874, cal: 0.750 },
    { raw: 0.924, cal: 0.803 },
    { raw: 0.974, cal: 0.833 },
  ],
};

// ── Matemática ────────────────────────────────────────────────────────────────
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCDF(x, mu, sigma) {
  if (sigma <= 0) return x >= mu ? 1 : 0;
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.sqrt(2))));
}

function calibrate(p, table) {
  if (p < 0.5) return 1 - calibrate(1 - p, table);
  const n = table.length;
  if (p <= table[0].raw) {
    const slope = (table[1].cal - table[0].cal) / (table[1].raw - table[0].raw);
    return Math.min(1, Math.max(0, table[0].cal + slope * (p - table[0].raw)));
  }
  if (p >= table[n - 1].raw) {
    const slope = (table[n - 1].cal - table[n - 2].cal) / (table[n - 1].raw - table[n - 2].raw);
    return Math.min(1, Math.max(0, table[n - 1].cal + slope * (p - table[n - 1].raw)));
  }
  for (let i = 0; i < n - 1; i++) {
    if (p >= table[i].raw && p <= table[i + 1].raw) {
      const t = (p - table[i].raw) / (table[i + 1].raw - table[i].raw);
      return table[i].cal + t * (table[i + 1].cal - table[i].cal);
    }
  }
  return p;
}

function calcKelly(prob, odds) {
  const b = odds - 1;
  const q = 1 - prob;
  const k = (prob * b - q) / b;
  return Math.max(0, parseFloat((k * 0.25 * 100).toFixed(2)));
}

// ── Detecção de tipo de prop pelo nome do evento ──────────────────────────────
// Ex: "Donovan Mitchell Total Points" → { player: "Donovan Mitchell", prop: "points" }
const PROP_PATTERNS = [
  { pattern: /total points/i,      prop: 'points'      },
  { pattern: /total rebounds/i,    prop: 'rebounds'    },
  { pattern: /total assists/i,     prop: 'assists'     },
  { pattern: /total steals/i,      prop: 'steals'      },
  { pattern: /3-pointers made|threes made|three pointers/i, prop: 'threes' },
  { pattern: /total goals/i,       prop: 'goals'       },
  { pattern: /total blocked/i,     prop: 'blocked'     },
  { pattern: /total hits$/i,       prop: 'hits'        },
  { pattern: /total strikeouts/i,  prop: 'strikeouts'  },
  { pattern: /hits allowed/i,      prop: 'hitsAllowed' },
  { pattern: /total sets/i,        prop: 'sets'        },
  { pattern: /total games/i,       prop: 'games'       },
];

function parseEventName(name) {
  for (const { pattern, prop } of PROP_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      // Remove o tipo da prop do nome para extrair o jogador
      const player = name.replace(pattern, '').replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
      return { player, prop };
    }
  }
  return null;
}

// ── Busca props da Pinnacle BR ────────────────────────────────────────────────
async function fetchPinnacleProps(pinnacleId) {
  try {
    const res = await axios.get(
      `https://sports2.pinnacle.bet.br/sports-service/sv/euro/odds/event`,
      {
        params: { eventId: pinnacleId, oddsType: 1, version: 0, specialVersion: 0 },
        headers: { 'Accept': 'application/json', 'Accept-Language': 'pt-BR' },
        timeout: 10000,
      }
    );

    const specials = res.data?.specials;
    if (!Array.isArray(specials)) return null;

    const playerPropsGroup = specials.find(s => s.code === 'player-props');
    if (!playerPropsGroup?.events?.length) return null;

    const result = {};

    for (const event of playerPropsGroup.events) {
      if (event.status !== 'O') continue; // só mercados abertos
      if (event.bt !== 'OVER_UNDER') continue;

      const parsed = parseEventName(event.name);
      if (!parsed) continue;

      const { player, prop } = parsed;

      const overC  = event.contestants.find(c => c.n === 'Over');
      const underC = event.contestants.find(c => c.n === 'Under');
      if (!overC || !underC) continue;

      const overOdds  = parseFloat(overC.p);
      const underOdds = parseFloat(underC.p);
      const line      = parseFloat(overC.h ?? underC.h);

      if (isNaN(overOdds) || isNaN(underOdds) || isNaN(line)) continue;

      if (!result[player]) result[player] = {};
      result[player][prop] = { over: overOdds, under: underOdds, line };
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.error(`  Erro ao buscar pinnacleId ${pinnacleId}: ${e.response?.status || e.message}`);
    return null;
  }
}

// ── Fuzzy match de nomes ──────────────────────────────────────────────────────
function normName(n) {
  return (n || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
}

function findPlayer(propPlayer, scrapedOdds) {
  const norm = normName(propPlayer);
  for (const [name, data] of Object.entries(scrapedOdds)) {
    const n = normName(name);
    if (n === norm) return data;
    const parts = norm.split(' ');
    if (parts.length >= 2 && n.includes(parts[parts.length - 1])) return data;
  }
  return null;
}

// ── Recálculo ─────────────────────────────────────────────────────────────────
function recalcProp(prop, oddsOverBR, oddsUnderBR, lineBR, calibTable) {
  const mu    = prop.playerAvg;
  const sigma = prop.playerStd;
  const line  = lineBR ?? prop.line;

  const pOverRaw  = 1 - normalCDF(line, mu, sigma);
  const pUnderRaw = normalCDF(line, mu, sigma);
  const pOver     = calibrate(pOverRaw, calibTable);
  const pUnder    = calibrate(pUnderRaw, calibTable);

  const edgeOver  = pOver  - 1 / oddsOverBR;
  const edgeUnder = pUnder - 1 / oddsUnderBR;

  const bestSide = edgeOver >= edgeUnder ? 'Over'     : 'Under';
  const bestProb = edgeOver >= edgeUnder ? pOver      : pUnder;
  const bestOdds = edgeOver >= edgeUnder ? oddsOverBR : oddsUnderBR;
  const bestEdge = edgeOver >= edgeUnder ? edgeOver   : edgeUnder;

  return {
    ...prop,
    line,
    oddsOver:          oddsOverBR,
    oddsUnder:         oddsUnderBR,
    side:              bestSide,
    odds:              bestOdds,
    modelProb:         parseFloat((bestProb * 100).toFixed(1)),
    impliedProb:       parseFloat(((1 / bestOdds) * 100).toFixed(1)),
    edge:              parseFloat((bestEdge * 100).toFixed(2)),
    kelly:             calcKelly(bestProb, bestOdds),
    inefficientMarket: !prop.lowSample && (bestEdge * 100) >= 20,
    formWarning:       prop.playerAvg5 !== null &&
                       (bestSide === 'Over' ? prop.playerAvg5 < line : prop.playerAvg5 > line),
    _brSync:           new Date().toISOString(),
  };
}

// ── Firestore ─────────────────────────────────────────────────────────────────
async function readFirestore(col, doc) {
  const snap = await db.collection(col).doc(doc).get();
  if (!snap.exists) return [];
  const raw = snap.data();
  return Array.isArray(raw.data) ? raw.data : [];
}

async function writeFirestore(col, doc, data) {
  await db.collection(col).doc(doc).set({
    data,
    lastUpdated: new Date().toISOString(),
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  ✅ ${col}/${doc} → ${data.length} itens`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Processa um esporte ───────────────────────────────────────────────────────
async function processSport(sportKey) {
  const cfg = SPORT_CONFIG[sportKey];
  if (!cfg) { console.error(`Esporte desconhecido: ${sportKey}`); return; }

  console.log(`\n📋 ${sportKey.toUpperCase()} — lendo Firestore (${cfg.col}/${cfg.doc})...`);
  const props = await readFirestore(cfg.col, cfg.doc);

  if (!props.length) {
    console.log(`  Vazio — pulando`);
    return;
  }

  const calibTable = CALIB_TABLES[cfg.calib] || CALIB_TABLES.nba;

  // Agrupa por pinnacleId
  const byGame = {};
  props.forEach((prop, idx) => {
    if (!prop.pinnacleId) return;
    if (!byGame[prop.pinnacleId]) {
      byGame[prop.pinnacleId] = { pinnacleId: prop.pinnacleId, indices: [] };
    }
    byGame[prop.pinnacleId].indices.push(idx);
  });

  const gameCount = Object.keys(byGame).length;
  if (!gameCount) {
    console.log(`  Nenhuma prop com pinnacleId — pipeline precisa rodar com versão atualizada`);
    return;
  }

  console.log(`  ${props.length} props | ${gameCount} jogo(s)`);

  const updatedProps = [...props];
  let updated = 0, unchanged = 0, failed = 0, removed = 0;

  for (const { pinnacleId, indices } of Object.values(byGame)) {
    const gameName = props[indices[0]]?.game || pinnacleId;
    process.stdout.write(`  ${gameName}... `);

    const scrapedOdds = await fetchPinnacleProps(pinnacleId);

    if (!scrapedOdds) {
      console.log('❌ sem dados');
      failed++;
      await sleep(300);
      continue;
    }

    let gameUpdated = 0;

    for (const idx of indices) {
      const prop = props[idx];
      const playerOdds = findPlayer(prop.player, scrapedOdds);
      if (!playerOdds) continue;

      const propOdds = playerOdds[prop.prop];
      if (!propOdds) continue;

      const { over: oddsOverBR, under: oddsUnderBR, line: lineBR } = propOdds;

      const lineChanged = Math.abs(lineBR - prop.line) > 0.01;
      const oddsChanged = Math.abs(oddsOverBR - prop.oddsOver) > 0.001 ||
                          Math.abs(oddsUnderBR - prop.oddsUnder) > 0.001;

      if (!lineChanged && !oddsChanged) { unchanged++; continue; }

      const recalculated = recalcProp(prop, oddsOverBR, oddsUnderBR, lineBR, calibTable);

      if (recalculated.edge < cfg.minEdge) {
        updatedProps[idx] = null;
        process.stdout.write(`\n    ⚠️  ${prop.player} ${prop.prop} removido (edge BR ${recalculated.edge}% < ${cfg.minEdge}%)\n`);
        removed++;
        continue;
      }

      updatedProps[idx] = recalculated;
      gameUpdated++;
      updated++;
    }

    console.log(gameUpdated > 0 ? `✅ ${gameUpdated} atualizada(s)` : '— sem mudanças');
    await sleep(200);
  }

  console.log(`  Total: ${updated} atualizadas | ${unchanged} sem mudança | ${removed} removidas | ${failed} falhas`);

  if (updated > 0 || removed > 0) {
    const final = updatedProps.filter(Boolean);
    final.sort((a, b) => b.edge - a.edge);
    await writeFirestore(cfg.col, cfg.doc, final);
  } else {
    console.log(`  Sem alterações — Firestore não atualizado`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const sportArg = process.argv[2];
  const sports   = sportArg ? [sportArg] : Object.keys(SPORT_CONFIG);

  console.log('🔄 sync_odds_br.js — Pinnacle BR → Firestore\n');

  for (const sport of sports) {
    await processSport(sport);
  }

  console.log('\n✅ Concluído.');
  process.exit(0);
}

main().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
