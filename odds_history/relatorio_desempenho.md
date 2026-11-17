# Relatório de desempenho — histórico central de indicações

Gerado em: 2026-11-17T19:14:05.865Z

## Teste NFL receptions

Candidato único sobrando após desabilitar todos os props de NHL e NFL receptionYards por CLV ~0% (ver DISABLED_SEGMENTS em pipeline/risk_config.js). Meta de amostra: 100 indicações com CLV exato (publicadas e válidas, resolvidas ou não — CLV independe do resultado do jogo).

- Indicações com CLV: **4/100**
- CLV médio: **-5.28%**
- IC95%: **-6.51% a -4.04%**
- CLV médio das 4 mais recentes: **-5.28%**
- Veredito: **EM TESTE ⏳**

Só inclui indicações publicadas, resolvidas e válidas para calibração (mesmo critério da calibração — NHL pré-correção da agregação de odds fica de fora, por exemplo). Push e cancelado entram no lucro/ROI mas não na taxa de acerto.

Taxa prevista calibrada sempre separada por versão do método de calibração (antigo = isotônica pura, pré pipeline/calibration.js commit d048389; novo = com piso de amostra por nó, teto 5-95% e encolhimento gradual) — método antigo nunca contamina a leitura do novo. CLV/ROI da tabela principal continuam agregados; a coluna de CLV/ROI também traz o recorte só do método novo.

| Esporte | Mercado | Faixa de edge | Nº resolvidas válidas | Taxa de acerto real | Taxa prevista calibrada (por método) | ROI agregado | CLV médio agregado (+ recorte método novo) | Estado do segmento | Faltam p/ calibrar |
|---|---|---|---|---|---|---|---|---|---|
| americanfootball/nfl | passTDs | 0-5% | 4 | 50.0% (4 decididas) | antigo 63.9% (bruta 70.7%) (n=4) · novo: sem dados | 25.2% | 1.4% (4/4 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passTDs | 15-20% | 9 | 44.4% (9 decididas) | antigo 79.1% (bruta 87.4%) (n=5) · novo 52.3% (bruta 38.9%) (n=4) | -8.3% | 1.3% (9/9 exata); ajustado —; mov. favor 0.0% (0/9) · recorte novo: ROI 39.6%, CLV 1.86% (4/4) | calibrado | 0 |
| americanfootball/nfl | passTDs | 20-25% | 3 | 66.7% (3 decididas) | antigo 72.7% (bruta 77.3%) (n=2) · novo 64.3% (bruta 64.5%) (n=1) | 43.6% | -1.9% (3/3 exata); ajustado —; mov. favor 0.0% (0/3) · recorte novo: ROI 142.0%, CLV 0.00% (1/1) | calibrado | 0 |
| americanfootball/nfl | passTDs | 25-30% | 2 | 50.0% (2 decididas) | antigo 76.9% (bruta 85.2%) (n=2) · novo: sem dados | -12.0% | -2.4% (2/2 exata); ajustado —; mov. favor 0.0% (0/2) | calibrado | 0 |
| americanfootball/nfl | passYards | -5-0% | 2 | 50.0% (2 decididas) | antigo 70.3% (bruta 68.8%) (n=2) · novo: sem dados | — | 0.0% (2/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 0-5% | 15 | 46.7% (15 decididas) | antigo 59.1% (bruta 68.4%) (n=15) · novo: sem dados | -22.6% | 0.3% (2/15 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 5-10% | 5 | 0.0% (5 decididas) | antigo 59.7% (bruta 86.6%) (n=5) · novo: sem dados | -100.0% | 0.0% (1/5 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 0-5% | 2 | 50.0% (2 decididas) | antigo 58.8% (bruta 67.8%) (n=2) · novo: sem dados | -38.1% | -1.6% (1/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 15-20% | 28 | 67.9% (28 decididas) | antigo 66.3% (bruta 83.3%) (n=25) · novo 54.9% (bruta 73.5%) (n=3) | 42.5% | 1.3% (26/28 exata); ajustado —; mov. favor 0.0% (0/23) · recorte novo: ROI -18.5%, CLV 0.07% (3/3) | calibrado | 0 |
| americanfootball/nfl | receptions | 20-25% | 15 | 40.0% (15 decididas) | antigo 67.7% (bruta 85.7%) (n=14) · novo 56.4% (bruta 77.9%) (n=1) | -9.5% | 0.8% (13/15 exata); ajustado -27.6% (1/15 ajustada); mov. favor 0.0% (0/11) · recorte novo: ROI -100.0%, CLV 0.00% (1/1) | calibrado | 0 |
| americanfootball/nfl | receptions | 25-30% | 5 | 80.0% (5 decididas) | antigo 75.1% (bruta 90.5%) (n=5) · novo: sem dados | 65.6% | 4.0% (4/5 exata); ajustado —; mov. favor 0.0% (0/4) | calibrado | 0 |
| americanfootball/nfl | receptions | 30-35% | 6 | 50.0% (6 decididas) | antigo 80.2% (bruta 92.8%) (n=6) · novo: sem dados | 4.6% | 0.9% (5/6 exata); ajustado -51.9% (1/6 ajustada); mov. favor 0.0% (0/6) | calibrado | 0 |
| americanfootball/nfl | receptions | 35-40% | 1 | 0.0% (1 decididas) | antigo 73.1% (bruta 86.4%) (n=1) · novo: sem dados | -100.0% | —; ajustado 12.7% (1/1 ajustada); mov. favor 0.0% (0/1) | calibrado | 0 |
| americanfootball/nfl | receptionYards | -5-0% | 2 | 50.0% (2 decididas) | antigo 31.3% (bruta 29.0%) (n=2) · novo: sem dados | — | —; ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 0-5% | 50 | 55.6% (45 decididas) | antigo 56.4% (bruta 69.7%) (n=50) · novo: sem dados | 3.1% | -0.1% (18/50 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 15-20% | 10 | 40.0% (10 decididas) | antigo 70.1% (bruta 90.1%) (n=10) · novo: sem dados | -26.1% | 0.4% (4/10 exata); ajustado 1.6% (3/10 ajustada); mov. favor 33.3% (2/6) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 20-25% | 8 | 75.0% (8 decididas) | antigo 75.0% (bruta 90.1%) (n=8) · novo: sem dados | 39.8% | -0.2% (3/8 exata); ajustado -13.7% (2/8 ajustada); mov. favor 0.0% (0/4) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 25-30% | 2 | 0.0% (2 decididas) | antigo 66.7% (bruta 93.0%) (n=2) · novo: sem dados | -100.0% | 0.0% (1/2 exata); ajustado -17.5% (1/2 ajustada); mov. favor 0.0% (0/1) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 30-35% | 3 | 33.3% (3 decididas) | antigo 85.5% (bruta 97.8%) (n=3) · novo: sem dados | -41.0% | 2.1% (1/3 exata); ajustado 15.1% (2/3 ajustada); mov. favor 50.0% (1/2) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 35-40% | 2 | 50.0% (2 decididas) | antigo 90.5% (bruta 99.8%) (n=2) · novo: sem dados | -1.8% | —; ajustado 8.6% (1/2 ajustada); mov. favor 100.0% (1/1) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 5-10% | 9 | 55.6% (9 decididas) | antigo 59.1% (bruta 85.1%) (n=9) · novo: sem dados | 3.4% | 0.5% (2/9 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | rushYards | 15-20% | 10 | 10.0% (10 decididas) | antigo 58.0% (bruta 62.4%) (n=9) · novo 48.0% (bruta 71.5%) (n=1) | -75.1% | -0.4% (4/10 exata); ajustado -7.6% (2/10 ajustada); mov. favor 20.0% (1/5) · recorte novo: ROI -100.0%, CLV — (0/1) | calibrado | 0 |
| americanfootball/nfl | rushYards | 20-25% | 9 | 44.4% (9 decididas) | antigo 61.0% (bruta 89.5%) (n=7) · novo 48.3% (bruta 83.2%) (n=2) | 25.7% | 0.7% (3/9 exata); ajustado -19.5% (3/9 ajustada); mov. favor 20.0% (1/5) · recorte novo: ROI -100.0%, CLV 3.95% (1/2) | calibrado | 0 |
| americanfootball/nfl | rushYards | 25-30% | 4 | 25.0% (4 decididas) | antigo 78.7% (bruta 97.1%) (n=4) · novo: sem dados | -50.3% | —; ajustado -17.1% (4/4 ajustada); mov. favor 0.0% (0/4) | calibrado | 0 |
| hockey/nhl | assists | 15-20% | 38 | 60.5% (38 decididas) | antigo 75.2% (bruta 67.6%) (n=38) · novo: sem dados | 3.9% | 0.2% (32/38 exata); ajustado —; mov. favor 0.0% (0/32) | calibrado | 0 |
| hockey/nhl | assists | 20-25% | 16 | 62.5% (16 decididas) | antigo 68.7% (bruta 54.9%) (n=16) · novo: sem dados | 25.7% | -0.3% (13/16 exata); ajustado —; mov. favor 0.0% (0/13) | calibrado | 0 |
| hockey/nhl | assists | 25-30% | 3 | 33.3% (3 decididas) | antigo 70.9% (bruta 52.1%) (n=3) · novo: sem dados | -24.7% | 0.0% (1/3 exata); ajustado —; mov. favor 0.0% (0/1) | calibrado | 0 |
| hockey/nhl | assists | 30-35% | 4 | 75.0% (4 decididas) | antigo 73.5% (bruta 50.1%) (n=4) · novo: sem dados | 74.9% | 0.0% (1/4 exata); ajustado —; mov. favor 0.0% (0/1) | calibrado | 0 |
| hockey/nhl | assists | 35-40% | 3 | 33.3% (3 decididas) | antigo 71.0% (bruta 34.0%) (n=3) · novo: sem dados | 12.4% | 0.6% (3/3 exata); ajustado —; mov. favor 0.0% (0/3) | calibrado | 0 |
| hockey/nhl | points | 15-20% | 9 | 44.4% (9 decididas) | antigo 81.9% (bruta 77.5%) (n=9) · novo: sem dados | -27.7% | 0.1% (7/9 exata); ajustado —; mov. favor 0.0% (0/7) | calibrado | 0 |
| hockey/nhl | points | 20-25% | 2 | 0.0% (2 decididas) | antigo 66.0% (bruta 54.1%) (n=2) · novo: sem dados | -100.0% | 0.0% (2/2 exata); ajustado —; mov. favor 0.0% (0/2) | calibrado | 0 |
| hockey/nhl | points | 25-30% | 3 | 33.3% (3 decididas) | antigo 76.6% (bruta 76.2%) (n=3) · novo: sem dados | -28.1% | 0.7% (3/3 exata); ajustado —; mov. favor 0.0% (0/3) | calibrado | 0 |

## Cobertura de CLV por coorte

| Coorte de criação | Publicadas resolvidas | CLV exato | CLV ajustado | Cobertura total | Sem CLV por motivo |
|---|---|---|---|---|---|
| antes_primeira_captura | 3 | 0 | 0 | 0.0% | captura_expirada_sem_odd_gravada: 3 |
| captura_inicial_pre_jit | 86 | 30 | 0 | 34.9% | captura_expirada_sem_odd_gravada: 56 |
| jit_pre_controle_status | 27 | 12 | 1 | 48.1% | captura_expirada_sem_odd_gravada: 11; cota_api_esgotada_na_captura_pre_fix: 3 |
| apos_fix_dependencia_be2ab14 | 168 | 128 | 20 | 88.1% | jogador_indisponivel_no_mercado: 1; linha_mudou_ate_fechamento: 2; captura_expirada_sem_odd_gravada: 17 |

## Apostas reais

Inclui só apostas registradas com identificador de indicação. Apostas manuais sem indicação de origem ficam fora desta visão e são sinalizadas abaixo.

Fonte: firestore
Apostas sem indicação de origem: 179

| Esporte | Mercado | Apostas | Resolvidas | Taxa de acerto | Stake | Lucro | ROI | CLV médio | Sem ledger |
|---|---|---|---|---|---|---|---|---|---|
| _sem apostas rastreadas ainda_ | | | | | | | | | |
