const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function getRanking() {
  const url = 'https://www.tennisexplorer.com/ranking/atp-men/';

  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);

    const ranking = {};
    let count = 0;

    $('table.result tbody.flags tr').each((i, el) => {
      const tds = $(el).find('td');
      const rank = parseInt(tds.eq(0).text().trim());
      const rawName = tds.filter('.t-name').text().trim();

      if (!rank || !rawName) return;

      ranking[rawName] = rank;
      count++;
    });

    if (count === 0) {
      console.error('ERRO: nenhum jogador extraído. Verifique o HTML.');
      return;
    }

    fs.writeFileSync('ranking.json', JSON.stringify(ranking, null, 2));
    console.log(`Ranking salvo: ${count} jogadores.`);
  } catch (err) {
    console.error('Erro ao buscar ranking:', err.message);
  }
}

getRanking();
