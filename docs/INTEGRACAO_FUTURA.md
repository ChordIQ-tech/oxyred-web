# Integração futura — como plugar serviço real sem reescrever a interface

Este documento é operacional: diz **onde** cada serviço real entra, **com que contrato** ele
conversa, **o que falta** hoje e **como provar** que a troca funcionou. É o contrato entre a
demonstração da Etapa 1 e o stack que já existe no repositório (CFD, surrogates, backend
FastAPI).

---

## 1. Princípio: contrato antes de implementação

A Etapa 1 fixou os schemas e deixou adaptadores que respondem `indisponível` com a razão.
Integrar é **substituir a implementação do adaptador**, não mexer na HMI. Se uma integração
exigir mudar o desenho da tela, é sinal de que o contrato estava errado — e o contrato precisa
mudar primeiro, nos dois lados, no mesmo commit.

Essa regra não é teórica. O `ARCHITECTURE.md` §5.1 registra o que aconteceu neste projeto
quando backend e HMI foram implementados em paralelo a partir do nome da rota: os campos
divergiram na prática (temperatura em Celsius sem sufixo de um lado, Kelvin com sufixo
`_est_K` do outro) e a integração só funcionou depois de os dois lados serem amarrados ao
schema escrito.

---

## 2. Os cinco pontos de integração

| # | Adaptador (`web/src/platform/adapters.js`) | Contrato | Estado na Etapa 1 | Entra como |
|---|---|---|---|---|
| 1 | `sensors` | `sensor-frame` | Mapeia telemetria local para tags de campo | Gateway OPC UA / MQTT |
| 2 | — (hoje o frame vem do simulador) | `telemetry-frame` | `plant-sim.js`, `mode = simulado` | `WS /ws/live` do backend |
| 3 | `cfd` | `cfd-case` | Manifesto validado, nada executa | Executor de caso + extração |
| 4 | `surrogate` | `surrogate-request` / `-response` | Nenhum modelo carregado | Runtime ONNX versionado |
| 5 | `feasibility` | `feasibility-request` / `-response` | Só `envelope()` — faixas declaradas | Motor termodinâmico (Etapa 2, W1) |

---

## 3. Ponto 1 — Ingestão de campo (OPC UA / MQTT)

**Contrato:** `contracts/sensor-frame.schema.json`
**Alvo no repositório:** `digital_twin/ingestion/schema.py::SensorReading` → hypertable
`sensor_readings` (TimescaleDB).

Mapeamento de tags. A coluna “hoje” mostra o que o adaptador preenche na Etapa 1 — e o que
**não** é medição:

| Campo do contrato | Unidade | Origem prevista | Hoje |
|---|---|---|---|
| `bath_temp_c` | °C | Termopar (OPC UA) | valor SIMULADO do simulador |
| `tap_open` | bool | Tag digital do PLC (leitura) | estado da animação |
| `oxygen_flow_nm3h` | Nm³/h | Vazão de O₂ (OPC UA) | valor SIMULADO |
| `offgas_co_pct` | % | Analisador de gás (MQTT) | valor SIMULADO |
| `offgas_co2_pct` | % | Analisador de gás (MQTT) | valor SIMULADO |
| `metal_level_pct` | % | Nível/balança (OPC UA) ou balanço de massa | nível **da animação** |
| `refractory_working_temp_c` | °C | Termopar no refratário | **estimativa grosseira**: 91,7 % da temperatura do metal |

O último campo merece destaque: na Etapa 1 ele é **calculado** a partir da temperatura do
metal (`metalTempC × 0,917`). É um preenchimento ilustrativo de contrato, não uma leitura —
e não pode aparecer em tela como temperatura de refratário medida.

O que falta para integrar:

1. Endpoint OPC UA (URL, política de segurança, certificado de cliente) e broker MQTT (TLS,
   autenticação).
2. Mapa de tags versionado: tag de campo ↔ campo do contrato ↔ unidade ↔ faixa plausível.
3. Estratégia de qualidade: `good` só com leitura válida e dentro da faixa; `uncertain` para
   valor em *hold* ou fora de faixa; `bad` para falha de comunicação.
4. Regra de procedência: `source = opcua | mqtt` e `quality = good` são **condição** para o
   `mode` do `telemetry-frame` virar `medido`.

Aceite: injetar 1 h de leitura de bancada e obter frames válidos contra o schema, sem queda
de pacote silenciosa; derrubar o gateway e ver `quality: bad` — não valor congelado.

---

## 4. Ponto 2 — Telemetria do backend

**Contrato:** `contracts/telemetry-frame.schema.json`
**Alvo no repositório:** `WS /ws/live` e `GET /api/v1/state` (FastAPI, porta 8000).

O `frame` que a HMI consome já tem a forma do contrato: `t`, `mode`, `metalTempC`,
`metalLevelPct`, `tapOpen`, `oxygenNm3h`, `recirculatedNm3h`, `offgas`, `production`,
`scenario`, `regions`.

Integração é trocar a fonte: em vez de `simulator.sample(sceneState, 0.25)`, assinar o
WebSocket e entregar o frame recebido a `hmi.update`. Detalhes que precisam de decisão:

- **`t`**: hoje é tempo simulado acumulado desde o início da sessão. Vindo do backend, deve ser
  o instante do dado (epoch), e o relógio do cabeçalho precisa mudar de semântica.
- **`regions`**: permanece `null` até existir modelo de campo. Não preencher com zero.
- **Reconexão**: queda de WebSocket não pode congelar indicador — a HMI deve marcar o painel
  como desatualizado e exibir o instante do último frame.
- **`mode`**: só `medido` com ingestão de campo em qualidade boa (ponto 1).

Aceite: subir backend + HMI, ver 10 min de frames sem erro de schema; derrubar o backend e ver
estado “desatualizado”, não número parado fingindo atualidade.

---

## 5. Ponto 3 — CFD

**Contrato:** `contracts/cfd-case.schema.json`
**Alvo no repositório:** `cfd/run_case.py`, extração em
`postProcessing/digitalTwinExtract/<time>/fields.json` (formato no `ARCHITECTURE.md` §3).

O manifesto já descreve caso, solver, geometria, regiões e saídas esperadas. O que falta é o
executor e a extração de campos no formato que o contrato descreve.

Bloqueio real, já documentado: o caso **diverge** antes do regime permanente. A instabilidade
termoquímica em `refractory_working`/`bed` foi mitigada (janela estável de ~0,12 s para
~1–2,4 s) e não resolvida. Consequência prática: não existe campo de referência em regime para
comparar com o gêmeo. Integrar CFD agora produziria números de um transiente inicial, que
**não** representam operação — e apresentá-los como estado do reator seria falso.

Aceite, quando o caso estabilizar: rodar o manifesto de exemplo, obter `status: concluido`,
campos com as dimensões da grade declarada e comparação com um caso de referência versionado.

---

## 6. Ponto 4 — Surrogates

**Contratos:** `surrogate-request` / `surrogate-response`
**Alvo no repositório:** `surrogates/export/<name>.onnx` + `surrogates/export/manifest.json`.

- Requisição leva `model` (`scalar` | `field`), `version` e `inputs` (vazão de O₂, carga,
  briquete, espessura de refratário, alvo de temperatura).
- Resposta devolve `outputs` e **`source`**: `cfd` ou `synthetic`. Esse campo é obrigatório por
  contrato e existe para impedir que um proxy sintético seja apresentado como modelo treinado
  em CFD.
- Hoje os modelos existentes foram treinados em dataset **sintético** (FNO com RMSE 65,8 K
  contra 98,2 K do DeepONet, em validação sintética). Portanto, na integração, `source` deve
  sair `synthetic` — e a interface tem de mostrar isso.

Aceite: inferência de 1 000 casos em lote, schema válido, latência registrada, `source`
correto em 100 % das respostas, e bloqueio explícito quando `version` não existir no
manifesto.

---

## 7. Ponto 5 — Viabilidade

**Contratos:** `feasibility-request` / `feasibility-response`
**Alvo:** motor novo (Etapa 2, W1) — ver `ESCOPO_ETAPA2.md` §3.

O adaptador hoje expõe apenas `envelope()` (faixas declaradas) e devolve
`available: false` para `evaluate()`. A integração substitui `envelope()` por uma chamada ao
motor, que devolve `feasible`, `checks[]` (com `id`, `value`, `limit`, `equation`),
`production` e `residuals`.

Regra de apresentação: **veredito sem margem não é veredito**. A tela deve mostrar o valor
contra o limite e o resíduo de cada balanço — não apenas um semáforo.

Aceite: casos de referência com resultado conhecido, incluindo pelo menos um cenário que
reprova; reprodutibilidade bit a bit para a mesma entrada e mesma `modelVersion`.

---

## 8. Regras de procedência (valem para todos os pontos)

1. **Nenhum número sem rótulo.** SIMULADO / SINTÉTICO / ESTIMADO / DECLARADO / OBSERVADO /
   PREVISTO, com origem e instante.
2. **`medido` é estado, não estilo.** Só com ingestão de campo em qualidade boa; cai para
   `simulado` ou `uncertain` no primeiro sinal de problema.
3. **`source` de surrogate é exibido**, nunca omitido.
4. **Estimativa derivada de outra medida não vira medida.** O caso de
   `refractory_working_temp_c` é o exemplo a não repetir.
5. **Dado sintético nunca ocupa o lugar do medido** em relatório, slide ou captura de tela.

---

## 9. Segurança e governança

- **Leitura apenas.** Nenhuma integração desta lista escreve na planta. Habilitar escrita exige
  análise de risco, validação de engenharia, gestão de mudança, cibersegurança e aprovação
  formal — e não é escopo nem da Etapa 1 nem da Etapa 2.
- **Rede**: gateway OPC UA e broker MQTT em segmento segregado, TLS, certificados com rotação
  e sem credencial em código (o `.env.example` do repositório existe para isso).
- **Auditoria**: todo frame medido deve poder ser rastreado até a tag, o instrumento e o
  instante — inclusive depois, a partir do histórico.
- **Degradação graciosa**: falha de integração rebaixa o modo e avisa; nunca inventa valor nem
  trava a interface.

---

## 10. Ordem sugerida

| Ordem | Integração | Por quê agora |
|---|---|---|
| 1 | Viabilidade (ponto 5) | Não depende de hardware nem de CFD; transforma o espaço reservado em resposta calculada |
| 2 | Ingestão (ponto 1) em bancada | Habilita `medido` e destrava todo o resto |
| 3 | Telemetria (ponto 2) | Passa a HMI a consumir backend real |
| 4 | Surrogates (ponto 4) | Depende de modelo e de versionamento; útil assim que houver inferência |
| 5 | CFD (ponto 3) | Depende da estabilização do caso |

Cada linha só avança com o critério de aceite da sua seção cumprido e registrado — não por
disponibilidade de código.
