// Temporada "atual" de cada esporte, calculada pela data — nunca um ano fixo
// no código (que precisaria ser editado manualmente a cada virada de temporada).

function currentSeasonOctJun(now = new Date()) {
  // NBA e NHL: temporada out–jun, rotulada pelo ano em que termina.
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month >= 10 ? year + 1 : year;
}

function currentSeasonSepFeb(now = new Date()) {
  // NFL: temporada set–fev, rotulada pelo ano em que termina.
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month >= 9 ? year + 1 : year;
}

function currentSeasonCalendarYear(now = new Date()) {
  // MLB: a temporada é o próprio ano calendário.
  return now.getUTCFullYear();
}

module.exports = { currentSeasonOctJun, currentSeasonSepFeb, currentSeasonCalendarYear };
