const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

function runScript(script) {
  return new Promise((resolve, reject) => {
    execFile('node', [script], { cwd: __dirname }, (err, stdout, stderr) => {
      if (err) reject(stderr || err.message);
      else resolve(stdout);
    });
  });
}

function readJsonWithTimestamp(file) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return { data: [], lastUpdated: null };
  const stat = fs.statSync(filePath);
  const data = JSON.parse(fs.readFileSync(filePath));
  return { data: Array.isArray(data) ? data : [], lastUpdated: stat.mtime.toISOString() };
}

// ── Tênis ──────────────────────────────────────────────

app.post('/api/tennis/update-ranking', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_ranking.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/tennis/update-odds', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_odds.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/tennis/run-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_prob.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/tennis/results', (req, res) => {
  res.json(readJsonWithTimestamp('model_results.json'));
});

// ── NBA H2H ────────────────────────────────────────────

app.post('/api/nba/update-scores', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_nba_scores.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/nba/update-odds', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_nba_odds.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/nba/run-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_nba.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/nba/results', (req, res) => {
  res.json(readJsonWithTimestamp('nba_results.json'));
});

// ── NBA Props ──────────────────────────────────────────

app.post('/api/nba/update-player-stats', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_nba_player_stats.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/nba/update-props', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_nba_props.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/nba/run-props-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_nba_props.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/nba/props', (req, res) => {
  res.json(readJsonWithTimestamp('nba_props_results.json'));
});

// ── NBA Props BR (Pinnacle) ────────────────────────────────────────────────────

app.post('/api/nba/update-props-br', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_nba_props_br.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/nba/run-props-br-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_nba_props_br.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/nba/props-br', (req, res) => {
  res.json(readJsonWithTimestamp('nba_props_br_results.json'));
});
// ── MLB H2H ────────────────────────────────────────────

app.post('/api/mlb/update-scores', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_mlb_scores.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/mlb/update-odds', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_mlb_odds.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/mlb/run-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_mlb.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/mlb/results', (req, res) => {
  res.json(readJsonWithTimestamp('mlb_results.json'));
});

// ── MLB Props ──────────────────────────────────────────

app.post('/api/mlb/update-props', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('get_mlb_props.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/mlb/run-props-model', async (req, res) => {
  try { res.json({ ok: true, log: await runScript('model_mlb_props.js') }); }
  catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

app.get('/api/mlb/props', (req, res) => {
  res.json(readJsonWithTimestamp('mlb_props_results.json'));
});

// ──────────────────────────────────────────────────────
app.get('/api/nba/player-stats/:name', (req, res) => {
  const file = path.join(__dirname, 'nba_player_stats.json');
  if (!fs.existsSync(file)) return res.json(null);
  const all = JSON.parse(fs.readFileSync(file));
  const name = req.params.name;
  const data = all[name] || null;
  res.json(data);
});
app.listen(3001, () => console.log('Servidor rodando em http://localhost:3001'));
