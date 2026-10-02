# Relatório de desempenho — histórico central de indicações

Gerado em: 2026-10-02T16:18:38.795Z

Só inclui indicações publicadas, resolvidas e válidas para calibração (mesmo critério da calibração — NHL pré-correção da agregação de odds fica de fora, por exemplo). Push e cancelado entram no lucro/ROI mas não na taxa de acerto.

| Esporte | Mercado | Faixa de edge | Nº resolvidas válidas | Taxa de acerto real | Taxa prevista calibrada | ROI | CLV médio | Estado do segmento | Faltam p/ calibrar |
|---|---|---|---|---|---|---|---|---|---|
| americanfootball/nfl | passTDs | 0-5% | 4 | 50.0% (4 decididas) | 63.9% (bruta 70.7%) | 25.2% | 1.4% (4/4 exata); ajustado —; mov. favor — | em_amostra | 10 |
| americanfootball/nfl | passTDs | 15-20% | 1 | 0.0% (1 decididas) | 74.0% (bruta 96.3%) | -100.0% | -3.3% (1/1 exata); ajustado —; mov. favor 0.0% (0/1) | em_amostra | 10 |
| americanfootball/nfl | passYards | -5-0% | 2 | 50.0% (2 decididas) | 70.3% (bruta 68.8%) | — | 0.0% (2/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 0-5% | 15 | 46.7% (15 decididas) | 59.1% (bruta 68.4%) | -22.6% | 0.3% (2/15 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 5-10% | 5 | 0.0% (5 decididas) | 59.7% (bruta 86.6%) | -100.0% | 0.0% (1/5 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 0-5% | 2 | 50.0% (2 decididas) | 58.8% (bruta 67.8%) | -38.1% | -1.6% (1/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 15-20% | 10 | 70.0% (10 decididas) | 65.5% (bruta 84.7%) | 43.7% | 3.6% (9/10 exata); ajustado —; mov. favor 0.0% (0/6) | calibrado | 0 |
| americanfootball/nfl | receptions | 20-25% | 6 | 50.0% (6 decididas) | 64.2% (bruta 85.5%) | 22.6% | 2.6% (5/6 exata); ajustado —; mov. favor 0.0% (0/2) | calibrado | 0 |
| americanfootball/nfl | receptions | 30-35% | 2 | 50.0% (2 decididas) | 80.4% (bruta 93.5%) | 8.1% | -0.5% (2/2 exata); ajustado —; mov. favor 0.0% (0/2) | calibrado | 0 |
| americanfootball/nfl | receptionYards | -5-0% | 2 | 50.0% (2 decididas) | 31.3% (bruta 29.0%) | — | —; ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 0-5% | 50 | 55.6% (45 decididas) | 56.4% (bruta 69.7%) | 3.1% | -0.1% (18/50 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 15-20% | 5 | 40.0% (5 decididas) | 69.5% (bruta 89.1%) | -25.6% | 0.8% (2/5 exata); ajustado —; mov. favor 0.0% (0/1) | calibrado | 0 |
| americanfootball/nfl | receptionYards | 20-25% | 4 | 75.0% (4 decididas) | 72.3% (bruta 88.7%) | 52.6% | -0.5% (1/4 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 25-30% | 1 | 0.0% (1 decididas) | 66.8% (bruta 86.6%) | -100.0% | 0.0% (1/1 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 30-35% | 1 | 0.0% (1 decididas) | 85.8% (bruta 93.9%) | -100.0% | 2.1% (1/1 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 5-10% | 9 | 55.6% (9 decididas) | 59.1% (bruta 85.1%) | 3.4% | 0.5% (2/9 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | rushYards | 15-20% | 8 | 12.5% (8 decididas) | 56.6% (bruta 58.5%) | -68.6% | -1.0% (3/8 exata); ajustado 3.6% (1/8 ajustada); mov. favor 33.3% (1/3) | calibrado | 0 |
| americanfootball/nfl | rushYards | 20-25% | 6 | 66.7% (6 decididas) | 63.4% (bruta 92.9%) | 73.7% | 0.0% (1/6 exata); ajustado -3.4% (2/6 ajustada); mov. favor 50.0% (1/2) | calibrado | 0 |
| americanfootball/nfl | rushYards | 25-30% | 1 | 100.0% (1 decididas) | 79.8% (bruta 89.7%) | 91.0% | —; ajustado -6.8% (1/1 ajustada); mov. favor 0.0% (0/1) | calibrado | 0 |

## Cobertura de CLV por coorte

| Coorte de criação | Publicadas resolvidas | CLV exato | CLV ajustado | Cobertura total | Sem CLV por motivo |
|---|---|---|---|---|---|
| antes_primeira_captura | 3 | 0 | 0 | 0.0% | registrada_antes_da_captura_existir: 3 |
| captura_inicial_pre_jit | 86 | 30 | 0 | 34.9% | registrada_antes_do_controle_de_status_da_captura: 56 |
| jit_pre_controle_status | 27 | 12 | 1 | 48.1% | registrada_antes_do_controle_de_status_da_captura: 10; cota_api_esgotada_na_captura_pre_fix: 3; captura_expirada_sem_odd_gravada: 1 |
| apos_fix_dependencia_be2ab14 | 18 | 14 | 3 | 94.4% | jogador_indisponivel_no_mercado: 1 |

## Apostas reais

Inclui só apostas registradas com identificador de indicação. Apostas manuais sem indicação de origem ficam fora desta visão e são sinalizadas abaixo.

Fonte: firestore
Apostas sem indicação de origem: 179

| Esporte | Mercado | Apostas | Resolvidas | Taxa de acerto | Stake | Lucro | ROI | CLV médio | Sem ledger |
|---|---|---|---|---|---|---|---|---|---|
| _sem apostas rastreadas ainda_ | | | | | | | | | |
