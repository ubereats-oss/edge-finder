// pipeline/risk_guards.js
// Guardas de publicação que dependem de mais de um candidato do mesmo jogo
// (por isso não dá pra aplicar dentro do loop principal de cada model_*.js,
// que avalia um candidato de cada vez): máximo de apostas por jogo e máximo
// de apostas por jogador no mesmo jogo.
//
// Teto de edge e segmento desabilitado são por candidato isolado — aplicados
// diretamente em cada model_*.js antes de chamar isto.

const config = require('./risk_config');

/**
 * Recebe a lista completa de candidatos avaliados numa execução (cada um já
 * com `published`/`rejectionReason` definidos pelas guardas por candidato —
 * edge mínimo, teto de edge, segmento desabilitado). Só reconsidera quem
 * ainda está `published: true`; nunca reabre quem já foi rejeitado antes.
 * Modifica os candidatos in-place e devolve a mesma lista.
 *
 * Cada candidato precisa de: { game, player, edge, published, rejectionReason }.
 */
function applyGameGuards(candidates) {
  const byGame = new Map();
  for (const c of candidates) {
    if (!c.published) continue;
    if (!byGame.has(c.game)) byGame.set(c.game, []);
    byGame.get(c.game).push(c);
  }

  for (const list of byGame.values()) {
    // Máximo por jogador no mesmo jogo: entre indicações do mesmo jogador,
    // fica só a(s) de maior edge, até o limite configurado.
    const byPlayer = new Map();
    for (const c of list) {
      if (!byPlayer.has(c.player)) byPlayer.set(c.player, []);
      byPlayer.get(c.player).push(c);
    }
    for (const playerList of byPlayer.values()) {
      if (playerList.length <= config.MAX_BETS_PER_PLAYER_PER_GAME) continue;
      playerList.sort((a, b) => b.edge - a.edge);
      for (const loser of playerList.slice(config.MAX_BETS_PER_PLAYER_PER_GAME)) {
        loser.published = false;
        loser.rejectionReason = 'guarda_max_por_jogador';
      }
    }

    // Máximo de apostas por jogo, entre quem sobrou depois do limite por jogador.
    const stillIn = list.filter(c => c.published);
    if (stillIn.length <= config.MAX_BETS_PER_GAME) continue;
    stillIn.sort((a, b) => b.edge - a.edge);
    for (const loser of stillIn.slice(config.MAX_BETS_PER_GAME)) {
      loser.published = false;
      loser.rejectionReason = 'guarda_max_apostas_jogo';
    }
  }

  return candidates;
}

module.exports = { applyGameGuards };
