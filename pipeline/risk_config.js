// pipeline/risk_config.js
// Configuração central de calibração e controle de risco por segmento.
// Um segmento é a combinação esporte + mercado (ex.: 'hockey/nhl' + 'goals').
// Editar os valores abaixo diretamente pra ajustar o comportamento do pipeline.
// Runtimes isolados podem manter espelhos explícitos desses valores.

module.exports = {
  // Fração padrão do Kelly usada para dimensionar a aposta sugerida.
  KELLY_FRACTION: 0.25,

  // ── Calibração ────────────────────────────────────────────────────────────
  // Nº mínimo de apostas resolvidas e válidas (ganhou/perdeu binário) que um
  // segmento precisa acumular antes de usar a regressão isotônica. Abaixo
  // disso o segmento fica em "em_amostra" (ver mais abaixo).
  MIN_SAMPLE_TO_CALIBRATE: 30,

  // Enquanto em "em_amostra", a probabilidade calibrada é uma mistura entre a
  // bruta do modelo e a implícita do mercado:
  //   calibrada = shrink*bruta + (1-shrink)*implícita
  // `shrink` cresce linearmente de MIN_SHRINK_TO_RAW (amostra 0) até 1.0
  // (amostra completa, quando passa a calibração plena via isotônica).
  MIN_SHRINK_TO_RAW: 0.2,

  // Mesma lógica pro tamanho da aposta: o Kelly sugerido é multiplicado por
  // essa fração quando a amostra é 0, subindo linearmente até 1.0 (Kelly
  // cheio) quando o segmento completa a amostra mínima.
  MIN_STAKE_FRACTION: 0.25,

  // ── Guardas de publicação (aplicadas depois do cálculo de edge/Kelly,
  // antes de publicar a indicação) ────────────────────────────────────────
  // Edge acima disso (%) é tratado como erro de modelo, não como oportunidade
  // real — a indicação é descartada, não publicada.
  EDGE_CAP_PCT: 40,

  // Piso mínimo de edge (%) pra publicar. Abaixo disso a indicação continua
  // registrada no histórico central (com motivo edge_abaixo_limiar), só não
  // é oferecida como aposta — mesmo padrão que model_mlb_props.js (15),
  // model_nhl_props.js (15) e model_nba_props_br.js (10) já aplicam, cada
  // um com seu próprio valor local. Este aqui é o piso central usado por
  // model_nba_props.js e model_nfl_props.js, que não tinham piso nenhum.
  MIN_EDGE_PCT: 15,

  // Máximo de indicações publicadas por jogo (evento). Acima disso, ficam só
  // as de maior edge; o resto é rejeitado por essa guarda.
  MAX_BETS_PER_GAME: 3,

  // Máximo de indicações publicadas por jogador, no mesmo jogo (mercados
  // diferentes do mesmo jogador competem entre si; fica só a de maior edge).
  MAX_BETS_PER_PLAYER_PER_GAME: 1,

  // ── Segmentos desabilitados ──────────────────────────────────────────────
  // Nunca publicados, independente de edge — a indicação ainda é registrada
  // no histórico central (com o motivo), só não é oferecida como aposta.
  // Início: props de arremessador do MLB (strikeouts e hitsAllowed), que
  // acertaram 1 de 15 no histórico real com o modelo emitindo 70%-89%.
  DISABLED_SEGMENTS: [
    { esporte: 'baseball/mlb', market: 'strikeouts' },
    { esporte: 'baseball/mlb', market: 'hitsAllowed' },
  ],

  // ── Invalidação de histórico pré-correção ────────────────────────────────
  // Apostas de NHL avaliadas antes desta data usaram odds da agregação
  // cruzada entre casas com o bug que misturava linhas diferentes de Over e
  // Under (corrigido nesta mesma sessão, 06/09/2026) — não representam o
  // mercado real e ficam de fora da calibração e das estatísticas de acerto,
  // mas continuam visíveis no histórico e no cálculo de lucro.
  NHL_ODDS_FIX_CUTOFF: '2026-09-06T00:00:00Z',

  // Função auxiliar: um segmento (esporte+mercado) está na lista de
  // desabilitados?
  isSegmentDisabled(esporte, market) {
    return this.DISABLED_SEGMENTS.some(s => s.esporte === esporte && s.market === market);
  },
};
