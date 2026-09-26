# Relatório de desempenho — histórico central de indicações

Gerado em: 2026-09-26T14:31:13.710Z

Só inclui indicações publicadas, resolvidas e válidas para calibração (mesmo critério da calibração — NHL pré-correção da agregação de odds fica de fora, por exemplo). Push e cancelado entram no lucro/ROI mas não na taxa de acerto.

| Esporte | Mercado | Faixa de edge | Nº resolvidas válidas | Taxa de acerto real | Taxa prevista calibrada | ROI | CLV médio | Estado do segmento | Faltam p/ calibrar |
|---|---|---|---|---|---|---|---|---|---|
| americanfootball/nfl | passTDs | 0-5% | 4 | 50.0% (4 decididas) | 63.9% (bruta 70.7%) | 25.2% | 1.4% (4/4 exata); ajustado —; mov. favor — | em_amostra | 21 |
| americanfootball/nfl | passYards | -5-0% | 2 | 50.0% (2 decididas) | 70.3% (bruta 68.8%) | — | 0.0% (2/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 0-5% | 15 | 46.7% (15 decididas) | 59.1% (bruta 68.4%) | -22.6% | 0.3% (2/15 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | passYards | 5-10% | 5 | 0.0% (5 decididas) | 59.7% (bruta 86.6%) | -100.0% | 0.0% (1/5 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 0-5% | 2 | 50.0% (2 decididas) | 58.8% (bruta 67.8%) | -38.1% | -1.6% (1/2 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 15-20% | 3 | 66.7% (3 decididas) | 61.5% (bruta 79.6%) | 50.2% | 2.4% (3/3 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptions | 20-25% | 4 | 50.0% (4 decididas) | 62.6% (bruta 85.6%) | 28.0% | 2.7% (3/4 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | -5-0% | 2 | 50.0% (2 decididas) | 31.3% (bruta 29.0%) | — | —; ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 0-5% | 50 | 55.6% (45 decididas) | 56.4% (bruta 69.7%) | 3.1% | -0.1% (18/50 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 15-20% | 4 | 50.0% (4 decididas) | 71.4% (bruta 88.3%) | -11.1% | 1.6% (1/4 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 20-25% | 4 | 75.0% (4 decididas) | 72.3% (bruta 88.7%) | 52.6% | -0.5% (1/4 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 25-30% | 1 | 0.0% (1 decididas) | 66.8% (bruta 86.6%) | -100.0% | 0.0% (1/1 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 30-35% | 1 | 0.0% (1 decididas) | 85.8% (bruta 93.9%) | -100.0% | 2.1% (1/1 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | receptionYards | 5-10% | 9 | 55.6% (9 decididas) | 59.1% (bruta 85.1%) | 3.4% | 0.5% (2/9 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | rushYards | 15-20% | 5 | 20.0% (5 decididas) | 53.2% (bruta 53.6%) | -45.5% | -3.1% (1/5 exata); ajustado —; mov. favor — | calibrado | 0 |
| americanfootball/nfl | rushYards | 20-25% | 4 | 50.0% (4 decididas) | 57.7% (bruta 95.8%) | 63.5% | 0.0% (1/4 exata); ajustado —; mov. favor — | calibrado | 0 |

## Cobertura de CLV por coorte

| Coorte de criação | Publicadas resolvidas | CLV exato | CLV ajustado | Cobertura total | Sem CLV por motivo |
|---|---|---|---|---|---|
| antes_primeira_captura | 3 | 0 | 0 | 0.0% | registrada_antes_da_captura_existir: 3 |
| captura_inicial_pre_jit | 86 | 30 | 0 | 34.9% | registrada_antes_do_controle_de_status_da_captura: 56 |
| jit_pre_controle_status | 26 | 12 | 0 | 46.2% | registrada_antes_do_controle_de_status_da_captura: 10; cota_api_esgotada_na_captura_pre_fix: 3; captura_expirada_sem_odd_gravada: 1 |

## Apostas reais

Inclui só apostas registradas com identificador de indicação. Apostas manuais sem indicação de origem ficam fora desta visão e são sinalizadas abaixo.

Fonte: firestore
Apostas sem indicação de origem: 179

| Esporte | Mercado | Apostas | Resolvidas | Taxa de acerto | Stake | Lucro | ROI | CLV médio | Sem ledger |
|---|---|---|---|---|---|---|---|---|---|
| _sem apostas rastreadas ainda_ | | | | | | | | | |
