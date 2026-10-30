# Etapa 2 — Escopo proposto: do modelo de animação ao motor que decide

> **Status deste documento: PROPOSTA.** Não é escopo contratado nem entrega. Descreve o que
> precisa existir para que os indicadores deixem de ser SIMULADOS e passem a ser calculados,
> com os critérios de aceite propostos para negociação. Nenhum número aqui foi medido em
> planta.

Depende de `ESCOPO_ETAPA1.md` (o que já existe) e `ARQUITETURA.md` (onde cada peça encaixa).

---

## 1. Objetivo

Substituir o simulador ilustrativo por um **motor de processo** que responda, com conta
rastreável, à pergunta que a Etapa 1 só sabe exibir como espaço reservado: *este cenário é
viável, com que margem, e por quê?*

Em termos de contrato: hoje `feasibility-*`, `surrogate-*` e `cfd-case` são schemas validados
e adaptadores que respondem `indisponível`. A Etapa 2 entrega **as implementações por trás
desses mesmos contratos**, sem redesenhar a HMI.

---

## 2. O contrato já existe; falta quem responda por trás

| Contrato | Quem responde na Etapa 1 | Quem deve responder na Etapa 2 | Rota/artefato de referência |
|---|---|---|---|
| `telemetry-frame` | `plant-sim.js` (SIMULADO) | Backend do gêmeo (ingestão + inferência) | `WS /ws/live`, `GET /api/v1/state` |
| `sensor-frame` | `adapters.js` → mapeamento local | Gateway OPC UA / MQTT | `digital_twin/ingestion/schema.py::SensorReading` |
| `cfd-case` | manifesto, nada executa | Executor de caso + extração de campos | `cfd/run_case.py`, `postProcessing/digitalTwinExtract` |
| `surrogate-request` / `-response` | nenhum modelo carregado | Runtime ONNX versionado | `surrogates/export/manifest.json` |
| `feasibility-request` / `-response` | `envelope()` — só faixas | Motor termodinâmico/cinético | **a construir** (W1) |
| `wear-dataset` | dataset sintético | Medição de espessura + calibração | `GET /api/v1/refractory/wear` |

---

## 3. Blocos de trabalho

### W1 · Balanço de massa e energia (o núcleo)

Implementa a resposta de `feasibility-response`, com um `id` de checagem por equação. Cada
checagem devolve `ok`, `value`, `limit`, `unit` e `equation`, como o contrato já exige.

| Checagem (`id`) | O que calcula | Entradas do contrato | Critério proposto |
|---|---|---|---|
| `mass_balance` | Fecha briquete → Fe + escória + gás de topo (C, O, Fe, CaO) | `briquette`, `energy.coalKgH`, `energy.oxygenNm3h` | Resíduo ≤ 2 % da massa de entrada |
| `energy_balance` | `Q_entrada / Q_requerido` (oxidação de C, pós-combustão, redução; aquecimento, fusão, perdas) | `energy.*`, `briquette` | Razão ≥ 1,0 |
| `boudouard_equilibrium` | Equilíbrio `C + CO₂ ⇌ 2CO` na temperatura do leito | `energy.targetTempC`, composição do gás | Afastamento da constante de equilíbrio dentro da banda declarada |
| `residence_time` | `τ = V_leito / Ṽ_sólido` | `geometry.bedHeightM`, carga, `velocities.briquetteResidenceMin` | τ dentro da janela 26–34 min (faixa declarada) |
| `jet_penetration` | Penetração do jato de O₂ (correlação) | `velocities.jetVelocityMs`, `geometry.tuyereCount`, `rInner` | `r/R` ≥ 1,0 |
| `refractory_life` | Taxa de desgaste × espessura disponível | `refractoryThicknessMm`, campos térmicos | Vida útil ≥ número de corridas alvo |

Duas exigências de método, não de resultado:

- **Toda equação cita a fonte** (`equation` preenchido) — correlação empírica, lei de
  conservação ou referência bibliográfica. Uma checagem sem fonte não é aceita.
- **O veredito é reprovável.** O payload de exemplo em
  `data/samples/feasibility-response.sample.json` retorna `feasible: false` com
  `energy_balance = 0,93` (déficit de calor). Ele é um **exemplo de contrato**, não um
  resultado de engenharia — mas mostra a forma desejada: o motor precisa poder dizer “não”.

### W2 · Desgaste calibrado

Hoje o mapa fiadas × setores é alimentado por um dataset **SINTÉTICO** e a vida restante vem
de uma regressão sobre três corridas fabricadas. Para virar previsão:

1. Definir o plano de medição (pontos por zona, método, incerteza) — a estrutura de zonas,
   fiadas e setores já está pronta e não muda.
2. Coletar histórico medido e rotular como **OBSERVADO**, com data e método.
3. Calibrar taxa de desgaste contra temperatura de face quente, fluxo e química.
4. Só então apresentar tendência, com rótulo **PREVISTO** e barra de incerteza.

Até o passo 4, "corridas até o limite" continua ESTIMADO — e a interface deve continuar
dizendo isso.

### W3 · Ingestão de campo

- Gateway OPC UA (termopares, balança) e MQTT (analisador de gás) normalizados para
  `sensor-frame`, com `quality` (`good` / `uncertain` / `bad`) e `source` (`opcua` / `mqtt`).
- Mapa de tags versionado (tag de campo ↔ campo do contrato ↔ unidade ↔ faixa plausível).
- `mode` do `telemetry-frame` só passa a `medido` quando a origem for campo **e** a qualidade
  for `good`. Sem isso, permanece `simulado` ou `uncertain`.

### W4 · Acoplamento CFD / surrogate

- Executor de caso a partir do manifesto `cfd-case`, com `status` honesto (`concluido`,
  `divergiu`).
- Runtime de inferência carregando ONNX de `surrogates/export/` com versão obrigatória.
- `source` (`cfd` ou `synthetic`) exibido junto de cada saída de surrogate. O contrato já
  proíbe apresentar proxy sintético como modelo treinado em CFD.

### W5 · HMI: de “envelope declarado” a “veredito com margem”

- Substituir a checagem de faixa pelo painel de viabilidade alimentado por W1, mantendo a
  checagem de faixa como primeira peneira.
- Preencher `telemetry-frame.regions` (temperatura e frações por região) e exibir o campo
  quando houver modelo de campo.
- Carimbar procedência por número: rótulo de evidência + origem + instante.
- Badge de modo passa a distinguir de fato `SIMULAÇÃO` de `DADOS DE CAMPO`.

### W6 · Validação e operação

- Casos de referência com resultado conhecido, versionados, para regressão do motor.
- Testes automatizados do domínio em Node (`tests/web/`) e do motor em Python.
- Registro de incerteza por checagem: nenhum veredito sem banda.

---

## 4. Contratos a evoluir

| Contrato | Mudança necessária | Motivo |
|---|---|---|
| `telemetry-frame` | `regions` sai de `null` para objeto por região | Já previsto no schema; falta o produtor |
| `feasibility-response` | Fixar o conjunto de `id` de checagens e a banda de cada critério | Sem isso o consumidor não sabe o que esperar |
| `wear-dataset` | Metadados de calibração: método de medição, data, incerteza | Distinguir sintético de medido de forma auditável |
| `sensor-frame` | Versão do mapa de tags e unidade por tag | Evitar divergência de nomes (lição do §5.1 da `ARCHITECTURE.md`) |
| `surrogate-response` | `modelHash` além de `version` | Rastrear qual arquivo ONNX gerou o número |

Regra que vale para toda a lista: **contrato e consumidor mudam no mesmo commit**, e o schema
publicado é a fonte única. A divergência entre backend e HMI já ocorreu uma vez neste projeto
por implementar os dois lados a partir do nome da rota; não repetir.

---

## 5. Critérios de aceite propostos

Todos os limiares abaixo são **PROPOSTA**, a fechar com a engenharia.

| Critério | Limiar proposto | Como medir |
|---|---|---|
| Fechamento de massa | \|resíduo\| ≤ 2 % | Casos de referência de W1 |
| Fechamento de energia | \|resíduo\| ≤ 5 % | Idem |
| Reprodução de pontos de referência | ± 15 K na temperatura do metal, ± 3 p.p. no Fe do gás | Contra dados de campanha |
| Veredito reprovável | Pelo menos um cenário de referência deve reprovar | Suíte de regressão |
| Desgaste calibrado | RMSE ≤ 20 mm contra medição, até a 3ª campanha | W2 |
| Procedência | 100 % dos números com rótulo e origem | Auditoria da HMI |
| Ingestão | `medido` só com `quality = good` e certificado válido | Teste de integração |
| Nenhuma escrita em ato | Zero tags de escrita habilitadas | Inspeção de configuração |

---

## 6. Pré-requisitos e bloqueios conhecidos

Estes bloqueios são reais e estão documentados no `ARCHITECTURE.md` §7 e no `README.md`:

| Bloqueio | Evidência | O que destrava |
|---|---|---|
| CFD diverge antes do regime permanente | Instabilidade termoquímica em `refractory_working`/`bed` mitigada: janela estável subiu de ~0,12 s para ~1–2,4 s, não resolvida | Depurar a condição de contorno de acoplamento térmico na interface; sem isso não há campo de referência em regime |
| Surrogates treinados em dado sintético | FNO RMSE 65,8 K contra 98,2 K do DeepONet — em validação **sintética** | Campanha CFD real em escala plena (depende do item acima) |
| Desgaste não calibrado | Modelos de `refractory_working` e `refractory_insulating` sem ajuste | Plano de medição (W2) |
| OPC UA / MQTT nunca testados contra hardware | Declarado no §7.1 da `ARCHITECTURE.md` | Bancada com CLP/gateway reais, mapa de tags, certificados |
| Rendimento de Fe pode passar de 100 % | Sintoma de surrogate com pouco dado; hoje há clamp de plausibilidade | Dado de treino real + validação física |
| Malha fixa por caso | `dr_ref_working` varia no DoE sem re-gerar malha (régua de validade limitada) | Script de re-malha por caso |
| Escala de referência inconsistente | `ARCHITECTURE.md` §1 usa domínio reduzido (~100 kg/h Fe); `web/data/operating-point.json` cita 200 kg/h de POC; a animação usa Ø 3,6 m / 200 mil t/ano | Fixar **uma** escala como fonte única por finalidade (animação, CFD, POC) e rotular cada número com a escala a que pertence |

O último item é pré-requisito de escopo, não detalhe: sem ele, qualquer comparação entre
animação, CFD e POC é inválida — e apresentar essas escalas como equivalentes seria uma
afirmação falsa.

---

## 7. Fora do escopo, inclusive na Etapa 2

- **Malha fechada de controle e qualquer escrita no PLC.** Escrever em automação de processo
  exige análise de risco, validação de engenharia, gestão de mudança, cibersegurança e
  aprovação formal. A Etapa 2 é de leitura e prescrição, não de atuação.
- **Garantia de ganho.** Melhoria de rendimento, de consumo específico ou de vida de
  refratário é hipótese a medir em campanha; ganho hipotético não é ganho comprovado.
- **Substituição de instrumento** ou de sistema de supervisão existente.
- **Representação de dado sintético como medição**, em qualquer tela, relatório ou slide.

---

## 8. Ordem de execução e dependências

| Fase | Conteúdo | Pode começar quando |
|---|---|---|
| 1 | W1 (balanço 0-D/1-D) + casos de referência + contratos fechados | Já — não depende de CFD |
| 2 | W3 (ingestão) em bancada + mapa de tags | Com acesso a CLP/gateway |
| 3 | W2 (plano e primeira campanha de medição de desgaste) | Com a planta disponível para medição |
| 4 | W4 (CFD em regime + surrogate real) | Com a instabilidade do CFD resolvida |
| 5 | W5 + W6 (HMI com veredito, testes, carimbo de procedência) | Ao final de cada bloco, incrementalmente |

O bloco 1 é o único que não depende de terceiros e entrega valor imediato: transforma o
espaço reservado “viabilidade” em resposta calculada, com o dado que já existe.

---

## 9. Definição de pronto (Etapa 2)

A etapa está pronta quando: a aba “Cenário” responde viabilidade com equação citada e margem;
cada número na tela carrega rótulo e origem; `mode = medido` só aparece com dado de campo de
qualidade boa; o desgaste tem histórico medido e previsão com incerteza; e nenhuma tag de
escrita para a planta existe na configuração.
