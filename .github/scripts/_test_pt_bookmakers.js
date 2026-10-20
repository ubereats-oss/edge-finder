const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const targets = [
  { name: 'Betano', urls: [
    'https://www.betano.pt/sport/basquetebol/eua/nba/',
    'https://www.betano.pt/sport/futebol/portugal/liga-portugal/',
  ] },
  { name: 'Betclic', urls: [
    'https://www.betclic.pt/basquetebol-s2/nba-c61',
    'https://www.betclic.pt/futebol-s1/liga-portugal-c127',
  ] },
  { name: 'Placard', urls: [
    'https://www.placard.pt/pt/apostas-desportivas/basquetebol/eua/nba',
    'https://www.placard.pt/pt/apostas-desportivas/futebol/portugal/liga-portugal',
  ] },
  { name: 'Bwin', urls: [
    'https://www.bwin.pt/pt/sports/basquetebol-7/eua/nba-13',
    'https://www.bwin.pt/pt/sports/futebol-4/portugal/liga-portugal-94',
  ] },
  { name: 'Solverde', urls: [
    'https://www.solverde.pt/apostas-desportivas/basquetebol',
    'https://www.solverde.pt/apostas-desportivas/futebol',
  ] },
];

async function tryUrl(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'pt-PT,pt;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const snippet = body.slice(0, 500).replace(/\s+/g, ' ');
    const signals = [];
    if (/captcha|cloudflare|are you a robot|checking your browser|cf-browser-verification/i.test(body)) signals.push('ANTI-ROBO/CLOUDFLARE');
    if (/geo.?block|not available in your (country|region)|país não|region not supported|access denied/i.test(body)) signals.push('GEO-BLOCK');
    if (/login|sign.?in|iniciar sess(ã|a)o/i.test(body) && body.length < 3000) signals.push('PODE EXIGIR LOGIN (pagina curta)');
    console.log(`    status=${res.status} tamanho=${body.length} sinais=[${signals.join(', ') || 'nenhum'}]`);
    console.log(`    trecho: ${snippet}`);
    return { status: res.status, length: body.length, signals };
  } catch (e) {
    console.log(`    ERRO DE REDE: ${e.code || e.message}`);
    return { error: e.code || e.message };
  }
}

async function main() {
  for (const t of targets) {
    console.log(`\n=== ${t.name} ===`);
    for (const url of t.urls) {
      console.log(`  GET ${url}`);
      await tryUrl(url);
    }
  }
}

main();
