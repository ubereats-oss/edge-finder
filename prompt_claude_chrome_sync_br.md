Você vai scraper as odds de props de jogadores da Pinnacle BR e enviá-las para uma Cloud Function que atualiza o Firestore do app Edge Finder. Siga os passos abaixo com precisão.

---

## PASSO 1 — Leia as props ativas do Firestore

Acesse esta URL e leia o conteúdo JSON:
https://firestore.googleapis.com/v1/projects/odds-app-edge/databases/(default)/documents/results/nba_props_br

Do JSON retornado, extraia a lista `fields.data.arrayValue.values`. Cada item tem:
- `player` → nome do jogador
- `prop` → tipo (points, rebounds, assists, steals, threes)
- `pinnacleId` → ID do jogo na Pinnacle
- `pinnacleSlug` → slug da URL

Agrupe os jogos únicos por `pinnacleId`. Você vai precisar visitar cada jogo uma vez.

---

## PASSO 2 — Para cada jogo, scrape as odds BR

Para cada `pinnacleId` único, acesse:
`https://pinnacle.bet.br/sportsbook/standard/basketball/nba/{pinnacleSlug}/{pinnacleId}`

Na página, clique na aba **"Props"** ou **"Jogador"** para carregar as props dos jogadores.

Para cada jogador e prop visíveis, extraia:
- Nome do jogador
- Tipo da prop (points, rebounds, assists, steals, threes)
- Linha (número após Over/Under)
- Odd Over (decimal)
- Odd Under (decimal)

Monte um objeto no formato:
```json
{
  "NomeDoJogador": {
    "points": { "over": 1.87, "under": 1.95, "line": 25.5 },
    "rebounds": { "over": 1.90, "under": 1.90, "line": 6.5 }
  }
}
```

Repita para todos os jogos.

---

## PASSO 3 — Envie para a Cloud Function

Faça um POST para:
`https://southamerica-east1-odds-app-edge.cloudfunctions.net/syncOddsBr`

Headers: `Content-Type: application/json`

Body:
```json
{
  "sport": "nba",
  "odds": { ...objeto com todos os jogadores de todos os jogos... }
}
```

---

## PASSO 4 — Reporte o resultado

Após o POST, mostre a resposta da Cloud Function:
- Quantas props foram atualizadas
- Quantas foram removidas (edge caiu abaixo do mínimo)
- Quantas ficaram sem mudança

Se a Cloud Function retornar erro, mostre o erro completo.

---

## REGRAS IMPORTANTES

- Não invente odds. Só use valores que você viu na página.
- Se uma prop não estiver visível na Pinnacle BR, simplesmente não a inclua no objeto.
- Se a aba "Props" não carregar, espere 3 segundos e tente novamente.
- Processe todos os jogos antes de fazer o POST (um único POST com todos os dados).
