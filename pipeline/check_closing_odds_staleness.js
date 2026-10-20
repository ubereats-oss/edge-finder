// pipeline/check_closing_odds_staleness.js
// Verifica se existe indicação elegível (mesma checagem do gate de
// capture_closing_odds.yml) esperando captura de odd de fechamento E se o
// workflow "Capturar Odd de Fechamento" ficou mais de 6h sem rodar com
// sucesso — se os dois forem verdade, avisa por e-mail (uma vez por dia,
// controlado por um marcador salvo na branch data).
//
// Precisa de GH_TOKEN (leitura de runs do workflow) e das variáveis de SMTP
// (ALERT_SMTP_HOST/PORT/USER/PASS, ALERT_EMAIL_TO) no ambiente — ver
// .github/workflows/alert_closing_odds_stale.yml.
//
// Uso: node pipeline/check_closing_odds_staleness.js
// Sai com código 0 sempre que a checagem rodou (mesmo sem alertar); só
// falha (exit 1) em erro de execução real.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const HISTORY_DIR = path.join(__dirname, '..', 'odds_history');
const MARKER_FILE = path.join(__dirname, '..', '_closing_odds_alert_marker.json');

const GH_OWNER = 'ubereats-oss';
const GH_REPO = 'edge-finder';
const GH_WORKFLOW_FILE = 'capture_closing_odds.yml';

function hasElegiveisPendentes() {
  if (!fs.existsSync(HISTORY_DIR)) return { pendentes: 0 };
  const files = fs.readdirSync(HISTORY_DIR).filter(f => f.startsWith('model_ledger_') && f.endsWith('.json'));
  let pendentes = 0;
  for (const f of files) {
    let entries;
    try { entries = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8')); } catch { continue; }
    for (const e of entries) {
      if (e.hasModelProb === false || e.validForCalibration === false) continue;
      if (e.resolutionStatus !== 'pendente') continue;
      const status = e.closingOddsStatus || ((e.closingOdds !== null && e.closingOdds !== undefined) ? 'capturada' : 'pendente');
      if (status === 'pendente') pendentes++;
    }
  }
  return { pendentes };
}

// A API do GitHub aceita workflow_dispatch com sucesso (204) mesmo num
// workflow desabilitado — nenhuma execução chega a ser criada, sem nenhum
// erro visível no disparo. Foi exatamente essa a causa de 13 dias sem
// nenhuma captura em setembro/outubro: vale checar isso explicitamente,
// não só "quanto tempo desde a última execução".
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

async function lastSuccessfulRunAt(token) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE}/runs?status=success&per_page=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const run = body.workflow_runs?.[0];
  return run ? new Date(run.updated_at ?? run.created_at).getTime() : null;
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

async function enviarEmail({ pendentes, horasSemRodar, estadoWorkflow }) {
  const transporter = nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST,
    port: parseInt(process.env.ALERT_SMTP_PORT || '465', 10),
    secure: (process.env.ALERT_SMTP_PORT || '465') === '465',
    auth: { user: process.env.ALERT_SMTP_USER, pass: process.env.ALERT_SMTP_PASS },
  });
  const avisoEstado = estadoWorkflow !== 'active'
    ? `\n\nATENÇÃO: o workflow está "${estadoWorkflow}" no GitHub (não ativo) — é por isso que não roda. Vá em Settings > Actions > General > Capturar Odd de Fechamento e reative. O GitHub aceita o disparo normalmente mesmo desabilitado, sem erro nenhum, só não cria execução nenhuma — foi exatamente essa a causa do hiato de 13 dias em setembro/outubro.`
    : '';
  await transporter.sendMail({
    from: process.env.ALERT_SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: `Edge Finder: captura de odd de fechamento parada há ${horasSemRodar}h`,
    text: `O workflow "Capturar Odd de Fechamento" não roda com sucesso há ${horasSemRodar}h e existem ${pendentes} indicação(ões) elegível(is) esperando a odd de fechamento.${avisoEstado}\n\nVerifique em https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW_FILE} e o segredo GH_DISPATCH_TOKEN (closingOddsScheduler para de disparar se ele expirar/for revogado).`,
  });
}

async function enviarEmailDeTeste() {
  const transporter = nodemailer.createTransport({
    host: process.env.ALERT_SMTP_HOST,
    port: parseInt(process.env.ALERT_SMTP_PORT || '465', 10),
    secure: (process.env.ALERT_SMTP_PORT || '465') === '465',
    auth: { user: process.env.ALERT_SMTP_USER, pass: process.env.ALERT_SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.ALERT_SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject: 'Edge Finder: e-mail de teste do alerta de captura de fechamento',
    text: 'Isto é um teste manual (forcar_teste=true) do alerta de "Capturar Odd de Fechamento" parada. Se você recebeu este e-mail, os segredos ALERT_SMTP_HOST/PORT/USER/PASS e ALERT_EMAIL_TO estão configurados corretamente.',
  });
}

async function main() {
  if (process.env.FORCAR_TESTE === 'true') {
    console.log('[alerta] forcar_teste=true — ignorando condições, mandando e-mail de teste.');
    if (!process.env.ALERT_SMTP_HOST || !process.env.ALERT_SMTP_USER || !process.env.ALERT_SMTP_PASS || !process.env.ALERT_EMAIL_TO) {
      console.error('[alerta] faltam segredos de e-mail — não dá pra mandar o teste.');
      process.exitCode = 1;
      return;
    }
    await enviarEmailDeTeste();
    console.log('[alerta] e-mail de teste enviado.');
    return;
  }

  const { pendentes } = hasElegiveisPendentes();
  console.log(`[alerta] ${pendentes} indicação(ões) elegível(is) pendente(s).`);
  if (pendentes === 0) {
    console.log('[alerta] nada pendente — não precisa checar o workflow.');
    return;
  }

  const token = process.env.GH_TOKEN;
  if (!token) {
    console.log('[alerta] GH_TOKEN ausente — não dá pra checar a última execução.');
    return;
  }
  const estadoWorkflow = await workflowState(token);
  console.log(`[alerta] estado do workflow no GitHub: ${estadoWorkflow}.`);
  const lastRun = await lastSuccessfulRunAt(token);
  const horasSemRodar = lastRun === null ? Infinity : (Date.now() - lastRun) / (60 * 60 * 1000);
  console.log(`[alerta] última execução com sucesso: ${lastRun === null ? 'nenhuma encontrada' : new Date(lastRun).toISOString()} (${horasSemRodar.toFixed(1)}h atrás).`);

  const desabilitado = estadoWorkflow !== 'active';
  if (!desabilitado && Date.now() - (lastRun ?? 0) <= STALE_AFTER_MS) {
    console.log('[alerta] workflow ativo e dentro das 6h — nada a fazer.');
    return;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  if (marcadorDeHoje() === hoje) {
    console.log('[alerta] já avisado hoje — não manda de novo.');
    return;
  }

  if (!process.env.ALERT_SMTP_HOST || !process.env.ALERT_SMTP_USER || !process.env.ALERT_SMTP_PASS || !process.env.ALERT_EMAIL_TO) {
    console.warn('[alerta] condição de alerta atingida, mas faltam segredos de e-mail (ALERT_SMTP_HOST/PORT/USER/PASS, ALERT_EMAIL_TO) — configure-os pra habilitar o envio.');
    return;
  }

  const horasLabel = Number.isFinite(horasSemRodar) ? Math.round(horasSemRodar) : 'nunca (nenhuma execução com sucesso encontrada)';
  await enviarEmail({ pendentes, horasSemRodar: horasLabel, estadoWorkflow });
  salvarMarcador(hoje);
  console.log('[alerta] e-mail enviado.');
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });
