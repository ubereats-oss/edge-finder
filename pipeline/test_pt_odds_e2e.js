// pipeline/test_pt_odds_e2e.js
// Teste de ponta a ponta da tela "Conferir odds" com dados simulados — sem
// Firebase real (nenhuma chamada admin.firestore()) e sem The Odds API real
// (nenhuma chamada à rede). Exercita as funções de produção de verdade onde
// não dependem de rede/Firebase (model_ledger.js, closing_odds_rules.js,
// capture_closing_odds.js — describeClosingPriceMatch/computeClv — e
// generate_pt_value_report.js); só fabrica no lugar da rede/Firestore os
// dados que viriam de lá (referência da Pinnacle, documento odds_checks,
// resposta de odds de fechamento, boxscore apurado).
//
// Idempotente: limpa qualquer resíduo de execução anterior antes e depois,
// usando um eventId exclusivo de teste que nunca aparece em dado real.
//
// Uso: node pipeline/test_pt_odds_e2e.js
// Sai com código 1 se qualquer etapa falhar.

const fs = require('fs');
const path = require('path');
const ledger = require('./model_ledger');
const closingOddsRules = require('./closing_odds_rules');
const { describeClosingPriceMatch, computeClv } = require('./capture_closing_odds');
const { computeRows, renderMarkdown } = require('./generate_pt_value_report');

const TEST_EVENT_ID = 'teste-e2e-simulado-0001';
const TEST_ESPORTE = 'basketball/nba';
const TEST_MARKET = 'points';
const TEST_PLAYER = 'Jogador Teste E2E';
const TEST_LINE = 24.5;
const TEST_SIDE = 'Over';

const results = [];
function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
    console.log(`[OK] ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
    console.log(`[FALHOU] ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function partitionPathFor(commenceTime) {
  const month = ledger.monthOf(commenceTime);
  return path.join(ledger.HISTORY_DIR, `model_ledger_nba_${month}.json`);
}

function cleanupTestEntries(commenceTime) {
  const file = partitionPathFor(commenceTime);
  if (!fs.existsSync(file)) return;
  const entries = ledger.loadPartitionFile(file).filter(e => e.eventId !== TEST_EVENT_ID);
  if (entries.length) ledger.savePartitionFile(file, entries);
  else fs.unlinkSync(file);
}

// Resolve k tal que (1/oddsA)^k + (1/oddsB)^k = 1 — mesma função de
// pipeline/get_pinnacle_reference.js (não exportada de lá; copiada aqui só
// pra teste, qualquer mudança no original deve ser espelhada aqui).
function powerMethodFair(oddsA, oddsB) {
  const pA = 1 / oddsA, pB = 1 / oddsB;
  let lo = 1, hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const sum = Math.pow(pA, mid) + Math.pow(pB, mid);
    if (sum > 1) lo = mid; else hi = mid;
  }
  const k = (lo + hi) / 2;
  const fairA = Math.pow(pA, k);
  const fairB = Math.pow(pB, k);
  const norm = fairA + fairB;
  return { fairA: fairA / norm, fairB: fairB / norm };
}

function main() {
  const commenceTime = new Date(Date.now() + 90 * 60 * 1000).toISOString(); // +90min — dentro da janela de 2h antes do jogo
  cleanupTestEntries(commenceTime); // idempotência: remove resíduo de execução anterior

  let pinnacleRow, check, ledgerEntry, reportRows;

  // 1) Gerar referência fictícia da Pinnacle (mesmo método de potência da produção)
  step('1. Gerar referência fictícia da Pinnacle', () => {
    const { fairA, fairB } = powerMethodFair(1.91, 1.95); // Over 1.91 / Under 1.95 (overround ~4.3%, realista)
    assert(Math.abs(fairA + fairB - 1) < 1e-9, 'probabilidades justas não somam 1');
    const fairOdds = 1 / fairA;
    pinnacleRow = {
      esporte: TEST_ESPORTE,
      eventId: TEST_EVENT_ID,
      game: 'Time Teste A x Time Teste B',
      commenceTime,
      market: TEST_MARKET,
      line: TEST_LINE,
      side: TEST_SIDE,
      player: TEST_PLAYER,
      pinnacleOdds: 1.91,
      fairProbPct: parseFloat((fairA * 100).toFixed(2)),
      fairOdds: parseFloat(fairOdds.toFixed(3)),
      minValueOdds: parseFloat((fairOdds * 1.01).toFixed(3)),
    };
    return `fairProbPct=${pinnacleRow.fairProbPct}% minValueOdds=${pinnacleRow.minValueOdds}`;
  });

  // 2) Registrar uma conferência (o que ApiService.createOddsCheck gravaria no Firestore)
  step('2. Registrar conferência (odd acima da mínima, casa Betano)', () => {
    const oddDigitada = 2.05;
    assert(oddDigitada >= pinnacleRow.minValueOdds, 'odd de teste deveria estar acima da mínima de valor');
    const fairProb = pinnacleRow.fairProbPct / 100;
    const edgePct = (oddDigitada * fairProb - 1) * 100;
    assert(edgePct > 0, 'deveria ter vantagem positiva com essa odd');
    const kellyFull = Math.max(0, Math.min(100, ((fairProb * oddDigitada - 1) / (oddDigitada - 1)) * 100));
    const kellyPct = kellyFull * 0.25; // RiskConfig.kellyFraction — não recalculado, só repassado como na tela
    check = {
      id: 'teste-check-0001',
      esporte: pinnacleRow.esporte,
      eventId: pinnacleRow.eventId,
      game: pinnacleRow.game,
      commenceTime: pinnacleRow.commenceTime,
      market: pinnacleRow.market,
      line: pinnacleRow.line,
      side: pinnacleRow.side,
      player: pinnacleRow.player,
      bookmaker: 'Betano',
      oddDigitada,
      fairProbPct: pinnacleRow.fairProbPct,
      pinnacleOdds: pinnacleRow.pinnacleOdds,
      minValueOdds: pinnacleRow.minValueOdds,
      edgePct: parseFloat(edgePct.toFixed(2)),
      kellyPct: parseFloat(kellyPct.toFixed(2)),
      apostaFeita: false,
      syncedToLedger: false,
    };
    return `edgePct=${check.edgePct}% kellyPct=${check.kellyPct}%`;
  });

  // 3) Marcar como feita (o que ApiService.markOddsCheckAsFeita faria no doc)
  step('3. Marcar conferência como aposta feita', () => {
    check.apostaFeita = true;
    assert(check.apostaFeita === true, 'flag apostaFeita não ficou true');
  });

  // 4) Sincronizar pro histórico central (sync_pt_odds_checks.js, sem Firestore:
  // o "doc" já está em memória como `check`, igual ao que viria de db.collection('odds_checks'))
  step('4. Sincronizar conferência pro histórico central (ledger.recordEvaluation)', () => {
    ledger.recordEvaluation({
      esporte: check.esporte,
      eventId: check.eventId,
      game: check.game,
      commenceTime: check.commenceTime,
      player: check.player,
      market: check.market,
      line: check.line,
      side: check.side,
      modelProb: check.fairProbPct,
      rawProb: check.fairProbPct,
      odds: check.oddDigitada,
      bookmaker: 'pinnacle', // fechamento vem da Pinnacle, não da casa PT — ver nota em sync_pt_odds_checks.js
      edge: check.edgePct,
      kelly: check.kellyPct,
      published: true,
      source: 'pt_odds_check',
      hasModelProb: true,
      validForCalibration: true,
      runId: new Date().toISOString(),
    });
    const summary = ledger.flush();
    assert(summary.partitionsSaved === 1, `esperava 1 partição salva, veio ${summary.partitionsSaved}`);

    const file = partitionPathFor(check.commenceTime);
    assert(fs.existsSync(file), `partição não foi criada: ${file}`);
    const entries = ledger.loadPartitionFile(file);
    ledgerEntry = entries.find(e => e.eventId === TEST_EVENT_ID);
    assert(ledgerEntry, 'entrada de teste não encontrada na partição gravada');
    assert(ledgerEntry.source === 'pt_odds_check', 'source gravado incorretamente');
    assert(ledgerEntry.resolutionStatus === 'pendente', 'resolutionStatus deveria começar pendente');
    assert(ledgerEntry.closingOddsStatus === 'pendente', 'closingOddsStatus deveria começar pendente');

    check.indicationId = ledgerEntry.indicationId;
    check.syncedToLedger = true;
    return `gravado em ${path.basename(file)}, indicationId=${ledgerEntry.indicationId}`;
  });

  // 4b) Confirma que a entrada seria pega pelo gate de captura de fechamento
  // (mesma checagem usada por capture_closing_odds.yml e pelo closingOddsScheduler)
  step('4b. Confirmar elegibilidade pro gate de captura de fechamento', () => {
    assert(closingOddsRules.isClosingOddsEligible(ledgerEntry), 'entrada não passou em isClosingOddsEligible');
    assert(closingOddsRules.isWithinCaptureWindow(ledgerEntry, Date.now()), 'entrada fora da janela de captura (verificar commenceTime de teste)');
    return 'elegível e dentro da janela de 2h antes do evento';
  });

  // 5) Simular fechamento: resposta fabricada da The Odds API (o que
  // fetchEventOdds traria de verdade), processada pela função REAL de
  // produção (describeClosingPriceMatch + computeClv, sem rede nenhuma)
  step('5. Simular captura de odd de fechamento (função real, resposta fabricada)', () => {
    const fakeOddsData = {
      bookmakers: [
        {
          key: 'pinnacle',
          markets: [
            {
              key: 'player_points',
              outcomes: [
                { description: TEST_PLAYER, point: TEST_LINE, name: 'Over', price: 1.87 }, // linha fechou um pouco mais cara que a odd tomada (2.05) — CLV positivo esperado
                { description: TEST_PLAYER, point: TEST_LINE, name: 'Under', price: 1.98 },
              ],
            },
          ],
        },
      ],
    };
    const match = describeClosingPriceMatch(fakeOddsData, 'player_points', ledgerEntry.player, ledgerEntry.line, ledgerEntry.side, ledgerEntry.bookmaker);
    assert(match.price !== null, `odd de fechamento não encontrada: ${match.reason}`);
    const clv = computeClv(ledgerEntry.odds, match.price);
    assert(typeof clv === 'number', 'CLV não calculado');

    ledgerEntry.closingOdds = match.price;
    ledgerEntry.clv = clv;
    ledgerEntry.closingOddsStatus = 'capturada';
    return `closingOdds=${match.price} clv=${clv}%`;
  });

  // 6) Simular apuração de resultado (mesmo formato de settle_model_ledger.js,
  // sem chamar a ESPN de verdade)
  step('6. Simular apuração de resultado (valor real acima da linha, Over ganha)', () => {
    const valorReal = 28; // > 24.5 → Over ganha
    ledgerEntry.result = { status: 'ganhou', valorReal, apuradoEm: new Date().toISOString() };
    ledgerEntry.resolutionStatus = 'resolvido';

    const file = partitionPathFor(ledgerEntry.commenceTime);
    const entries = ledger.loadPartitionFile(file).map(e => e.eventId === TEST_EVENT_ID ? ledgerEntry : e);
    ledger.savePartitionFile(file, entries);
    return `valorReal=${valorReal}, status=${ledgerEntry.result.status}`;
  });

  // 7) Gerar o relatório "Valor real nas casas que posso usar" (função real
  // de produção, só a leitura do Firestore é trocada pelo array em memória)
  step('7. Gerar relatório "Valor real nas casas que posso usar"', () => {
    const fakeChecks = [check]; // no lugar do snap.docs.map(d => d.data())
    const ledgerEntries = [ledgerEntry]; // no lugar de loadPtLedgerEntries() — mesma forma, 1 entrada

    reportRows = computeRows(fakeChecks, ledgerEntries);
    assert(reportRows.length === 1, `esperava 1 grupo casa+esporte+mercado, veio ${reportRows.length}`);
    const row = reportRows[0];
    assert(row.bookmaker === 'Betano', 'relatório não agrupou pela casa PT correta');
    assert(row.nConferencias === 1, 'nConferencias incorreto');
    assert(row.nAcimaMinimo === 1, 'nAcimaMinimo incorreto');
    assert(row.pctAcimaMinimo === 100, 'pctAcimaMinimo incorreto');
    assert(row.nAmostrasClv === 1, 'nAmostrasClv deveria contar a aposta apurada com CLV');
    assert(typeof row.clvMedio === 'number', 'clvMedio não calculado');
    assert(row.clvIc95Lower === null, 'com n=1 não deveria ter IC95 calculável');

    const md = renderMarkdown(reportRows, new Date().toISOString());
    assert(md.includes('Betano'), 'markdown renderizado não contém a casa');
    return `casa=${row.bookmaker} clvMedio=${row.clvMedio}% nConferencias=${row.nConferencias}`;
  });

  cleanupTestEntries(check.commenceTime);

  const falhas = results.filter(r => !r.ok);
  console.log(`\n${results.length - falhas.length}/${results.length} etapas OK.`);
  if (falhas.length) {
    console.log(`${falhas.length} etapa(s) falharam: ${falhas.map(f => f.name).join('; ')}`);
    process.exit(1);
  }
}

main();
