// pipeline/check_closing_odds_staleness.js
// Avisa quando a captura existente falha ou quando a coleta local Betano
// fica mais de 6h sem ciclo bem-sucedido:
//
//   1) A coleta local da Betano não registra ciclo bem-sucedido há mais de 6h.
//   2) Existe indicação elegível cujo jogo já começou e que nunca teve
//      NENHUMA tentativa de captura registrada (closingOddsLastAttemptAt
//      ausente e nunca capturada) — sinal direto de que o mecanismo não
//      rodou quando devia, não de falta de dado.
//   3) O workflow "Capturar Odd de Fechamento" está desabilitado no GitHub
//      (ver nota abaixo — a causa real dos 13 dias sem captura em
//      setembro/outubro).
//
// No máximo 1 e-mail por dia (marcador salvo na branch data).
//
// Precisa de GH_TOKEN (leitura do estado do workflow) e das variáveis de
// SMTP (ALERT_SMTP_HOST/PORT/USER/PASS, ALERT_EMAIL_TO) no ambiente — ver
// .github/workflows/alert_closing_odds_stale.yml.
//
// Uso: node pipeline/check_closing_odds_staleness.js

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
const MARKER_FILE = path.join(__dirname, '..', '_closing_odds_alert_marker.json');

const GH_OWNER = 'ubereats-oss';
const GH_REPO = 'edge-finder';
const GH_WORKFLOW_FILE = 'capture_closing_odds.yml';

const SPORT_MARKET_KEYS = {
  'basketball/nba': ['h2h', 'points', 'rebounds', 'assists', 'steals', 'threes'],
  'baseball/mlb': ['h2h', 'hits', 'strikeouts', 'hitsAllowed'],
  'hockey/nhl': ['points', 'goals', 'assists', 'shots'],
  'americanfootball/nfl': ['passYards', 'passTDs', 'rushYards', 'receptions', 'receptionYards'],
};

function jogosSemNenhumaTentativa() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  const now = Date.now();
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('model_ledger_') && f.endsWith('.json'));
  const achados = [];
  for (const f of files) {
    let entries;
    try { entries = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8')); } catch { continue; }
    for (const e of entries) {
      if (e.hasModelProb === false || e.validForCalibration === false) continue;
      const markets = SPORT_MARKET_KEYS[e.esporte];
      if (!markets || !markets.includes(e.market)) continue;
      const status = e.closingOddsStatus || ((e.closingOdds !== null && e.closingOdds !== undefined) ? 'capturada' : 'pendente');
      if (status !== 'pendente') continue; // já capturada ou expirada (expirada = teve tentativa em algum momento, por definição)
      const commence = new Date(e.commenceTime).getTime();
      if (isNaN(commence) || commence > now) continue; // jogo ainda não começou — não é alerta, é só ainda não chegou a hora
      if (e.closingOddsLastAttemptAt) continue; // já tentou (não bateu com a odd exata — motivo de dado, não de mecanismo parado)
      achados.push({ esporte: e.esporte, player: e.player, market: e.market, game: e.game, commenceTime: e.commenceTime });
    }
  }
  return achados;
}

// A API do GitHub aceita workflow_dispatch com sucesso (204) mesmo num
// workflow desabilitado — nenhuma execução chega a ser criada, sem nenhum
// erro visível no disparo. Foi exatamente essa a causa de 13 dias sem
// nenhuma captura em setembro/outubro: vale checar isso explicitamente.
async function workflowState(token) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).state;
}

function isBetanoHeartbeatStale(lastSuccessAt, now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000) {
  const last = Date.parse(lastSuccessAt || '');
  return !Number.isFinite(last) || last > now || now - last > maxAgeMs;
}

function brasiliaClock(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
}

function isBetanoScheduledHeartbeatStale(lastSuccessAt, now = Date.now()) {
  const last = Date.parse(lastSuccessAt || '');
  if (!Number.isFinite(last) || last > now) return true;
  const effectiveNow = new Date(brasiliaClock(now - 45 * 60000));
  const due = new Date(effectiveNow);
  const hour = [11, 13, 15, 17, 19, 21, 23].filter(slot => slot <= effectiveNow.getUTCHours()).at(-1);
  if (hour === undefined) due.setUTCDate(due.getUTCDate() - 1);
  due.setUTCHours(hour ?? 23, 0, 0, 0);
  return brasiliaClock(last) < due.getTime();
}

async function betanoHeartbeat() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT ausente.');
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const snapshot = await admin.firestore().collection('local_bookmaker_status').doc('betano').get();
  return snapshot.exists ? snapshot.data() : {};
}

function marcadorDeHoje() {
  if (!fs.existsSync(MARKER_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf-8')).lastAlertDate ?? null;
  } catch {
    return null;
  }
}

function salvarMarcador(dataISO) {
  fs.writeFileSync(MARKER_FILE, JSON.stringify({ lastAlertDate: dataISO }, null, 2));
}

function smtpConfigurado() {
  return !!(process.env.ALERT_SMTP_HOST && process.env.ALERT_SMTP_USER && process.env.ALERT_SMTP_PASS && process.env.ALERT_EMAIL_TO);
}

function transporter() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST,
    port: parseInt(process.env.ALERT_SMTP_PORT || '465', 10),
    secure: (process.env.ALERT_SMTP_PORT || '465') === '465',
    auth: { user: process.env.ALERT_SMTP_USER, pass: process.env.ALERT_SMTP_PASS },
  });
}

async function enviarEmail({ semTentativa, estadoWorkflow, betanoStatus, betanoReadError }) {
  const desabilitado = estadoWorkflow !== 'active' && estadoWorkflow !== 'desconhecido';
  const partes = [];
  const localAtrasada = betanoReadError || isBetanoScheduledHeartbeatStale(betanoStatus.lastSuccessAt);
  if (localAtrasada) {
    const ultimaFalha = betanoStatus.lastFailure
      ? `${betanoStatus.lastFailureAt || 'horário não registrado'}: ${betanoStatus.lastFailure}`
      : 'nenhuma falha de execução registrada; confira o último resultado da tarefa no Agendador';
    partes.push(`A coleta local Betano/Retabet não concluiu o último horário previsto. Último sucesso: ${betanoStatus.lastSuccessAt || 'nunca registrado'}. Verifique o Agendador de Tarefas do Windows no computador ${betanoStatus.computerName || 'da coleta'}, tarefa "${betanoStatus.taskName || 'EdgeFinder-Betano-Local'}". Última falha registrada: ${ultimaFalha}.${betanoReadError ? ` Erro ao ler Firestore: ${betanoReadError}` : ''}`);
  }
  if (desabilitado) {
    partes.push(`O workflow "Capturar Odd de Fechamento" está "${estadoWorkflow}" no GitHub (não ativo) — é por isso que não roda. Vá em Settings > Actions > General > Capturar Odd de Fechamento e reative. O GitHub aceita o disparo normalmente mesmo desabilitado, sem erro nenhum, só não cria execução nenhuma — foi exatamente essa a causa do hiato de 13 dias em setembro/outubro.`);
  }
  if (semTentativa.length) {
    const lista = semTentativa.slice(0, 15).map(e => `- ${e.game} — ${e.player ?? ''} ${e.market} (início ${e.commenceTime})`).join('\n');
    partes.push(`${semTentativa.length} indicação(ões) com jogo já começado nunca tiveram nenhuma tentativa de captura de odd de fechamento:\n${lista}`);
  }
  const subject = desabilitado
    ? 'Edge Finder: captura de odd de fechamento DESABILITADA no GitHub'
    : localAtrasada && !semTentativa.length ? 'Edge Finder: coleta local Betano/Retabet atrasada'
      : 'Edge Finder: coleta ou captura de odds está parada';
  if (desabilitado || semTentativa.length) partes.push(`Captura de fechamento: https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE}`);
  await transporter().sendMail({
    from: process.env.ALERT_SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text: partes.join('\n\n'),
  });
}

async function enviarEmailDeTeste() {
  await transporter().sendMail({
    from: process.env.ALERT_SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: 'Edge Finder: e-mail de teste do alerta de captura de fechamento',
    text: 'Isto é um teste manual (forcar_teste=true) do alerta de "Capturar Odd de Fechamento". Se você recebeu este e-mail, os segredos ALERT_SMTP_HOST/PORT/USER/PASS e ALERT_EMAIL_TO estão configurados corretamente.',
  });
}

async function main() {
  if (process.env.FORCAR_TESTE === 'true') {
    console.log('[alerta] forcar_teste=true — ignorando condições, mandando e-mail de teste.');
    if (!smtpConfigurado()) {
      console.error('[alerta] faltam segredos de e-mail — não dá pra mandar o teste.');
      process.exitCode = 1;
      return;
    }
    await enviarEmailDeTeste();
    console.log('[alerta] e-mail de teste enviado.');
    return;
  }

  const semTentativa = jogosSemNenhumaTentativa();
  console.log(`[alerta] ${semTentativa.length} indicação(ões) com jogo começado e nenhuma tentativa de captura.`);

  const token = process.env.GH_TOKEN;
  let estadoWorkflow = 'desconhecido';
  if (token) {
    estadoWorkflow = await workflowState(token);
    console.log(`[alerta] estado do workflow no GitHub: ${estadoWorkflow}.`);
  } else {
    console.log('[alerta] GH_TOKEN ausente — não dá pra checar o estado do workflow.');
  }

  let betanoStatus = {};
  let betanoReadError = null;
  try {
    betanoStatus = await betanoHeartbeat();
  } catch (error) {
    betanoReadError = error.message;
  }
  const betanoStale = betanoReadError || isBetanoScheduledHeartbeatStale(betanoStatus.lastSuccessAt);
  console.log(`[alerta] heartbeat Betano ${betanoStale ? 'ausente/atrasado' : 'atual'}: ${betanoStatus.lastSuccessAt || 'sem registro'}.`);

  const desabilitado = estadoWorkflow !== 'active' && estadoWorkflow !== 'desconhecido';
  if (!desabilitado && semTentativa.length === 0 && !betanoStale) {
    console.log('[alerta] workflow ativo e nenhum jogo sem tentativa — nada a fazer.');
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  if (marcadorDeHoje() === hoje) {
    console.log('[alerta] já avisado hoje — não manda de novo.');
    return;
  }

  if (!smtpConfigurado()) {
    console.warn('[alerta] condição de alerta atingida, mas faltam segredos de e-mail (ALERT_SMTP_HOST/PORT/USER/PASS, ALERT_EMAIL_TO) — configure-os pra habilitar o envio.');
    return;
  }

  await enviarEmail({ semTentativa, estadoWorkflow, betanoStatus, betanoReadError });
  salvarMarcador(hoje);
  console.log('[alerta] e-mail enviado.');
}

if (require.main === module) main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
module.exports = { isBetanoHeartbeatStale, isBetanoScheduledHeartbeatStale };
