# Etapa 1 — Escopo entregue: modelo de animação e base arquitetural

Entrega da **Chordiq** para o Processo 4G / Oxy-Red, com apoio da **Gavea Tech** na concepção
operacional. Commit de referência: `29f3719` (2026-10-30). Aplicação: `web/`.

Este documento responde a três perguntas: **o que foi entregue**, **o que exatamente cada
número na tela significa** e **o que não está nesta etapa**.

---

## 1. Objetivo da etapa

Construir, sobre a geometria e o roteiro técnico já existentes, uma **interface de gêmeo
digital** — cena 3D navegável, painéis de indicadores, mapa de desgaste do revestimento e
painel de contratos — junto com a **base arquitetural** (schemas JSON, pontos de integração,
adaptadores) que a Etapa 2 vai preencher com modelos físicos.

O produto desta etapa é uma **interface que não mente sobre o que ainda não sabe**: os
números são declarados como simulados, os contratos são validados ao abrir a página, e cada
ponto de integração sem serviço real responde *indisponível, com a razão* em vez de inventar
resultado.

---

## 2. O que foi entregue

| Item | Onde está | Evidência de que funciona |
|---|---|---|
| Cena 3D do reator, com 8 etapas de tour (~82 s no total) | `src/scene/twin-scene.js`, `src/domain/process-steps.js` | Roda no navegador; tour avança e emite estado por callback |
| HMI: 3 abas, 6 controles, 2 modais, teclado | `src/ui/hmi.js`, `index.html` | Página abre com `body[data-ready=true]` |
| 9 indicadores de processo | `hmi.js` (`update`) | Valores atualizados a 4 Hz (ver §4) |
| Cenário com 3 sliders + checagem de envelope | `plant-sim.js` (`checkOperatingEnvelope`) | Veredito muda ao sair da faixa |
| Mapa de desgaste fiadas × setores (5 zonas) | `wear.js`, `twin-scene.js` (`makeZoneMesh`) | Cor por célula conforme rampa; corridas restantes calculadas |
| Carregamento de dados de desgaste pelo usuário (CSV/JSON) | `wear.js` (`parseWearText`) | Validação com mensagem de erro por linha |
| 8 contratos de dados em JSON Schema | `contracts/*.schema.json` | Painel “Plataforma” valida em tempo de execução |
| Validador de JSON Schema sem dependências | `src/platform/schema.js` | Subconjunto 2020-12 (ver §5) |
| 4 adaptadores de plataforma com estado explícito | `src/platform/adapters.js` | Serviço ausente responde `available: false` + razão |
| Tool de captura headless (CDP) | `tools/shot.mjs` | Sai com código 1 em erro de console |
| Este conjunto de 5 documentos, com leitor próprio | `web/docs/` | Abre pelo modal “Sobre” em `docs/leitor.html` |

---

## 3. Rótulos de evidência

Todo número apresentado nesta interface — e nos documentos desta pasta — carrega um rótulo.
O rótulo não é decorativo: define o que se pode afirmar sobre o valor.

| Rótulo | Significa | Onde aparece na Etapa 1 |
|---|---|---|
| **SIMULADO** | Gerado por oscilação determinística em torno de um cenário fixo. Sem modelo físico. | Todos os indicadores do painel “Indicadores” |
| **SINTÉTICO** | Conjunto de dados fabricado para exercitar a interface. Não é medição. | `data/wear-demo.json`, painel de desgaste |
| **ESTIMADO** | Aritmética sobre um cenário, com relação ilustrativa declarada. | Produção estimada, consumo específico, t/ano |
| **DECLARADO · NÃO VALIDADO** | Faixa tirada do roteiro técnico, não confirmada contra a planta. | Envelope operacional (§5) |
| **OBSERVADO** | Medição de campo com procedência. | **Nenhum valor nesta etapa** |
| **PREVISTO** | Extrapolação de tendência a partir de histórico. | **Nenhum valor nesta etapa** (ver §4, “corridas até o limite”) |

Uma premissa de projeto — como *“o circuito de gases é fechado, emissão zero”* — é uma
afirmação de intenção de engenharia, não um resultado medido. Está rotulada como premissa em
`data/operating-point.json` e no tour do processo.

---

## 4. O que cada indicador é, exatamente

Nenhum destes números vem de CFD, de surrogate ou de instrumento. A tabela existe para que
ninguém precise abrir o código para saber a origem de um valor na tela.

| Indicador | Origem real | Rótulo | Na Etapa 2 |
|---|---|---|---|
| Temperatura do metal | `targetTemp` + soma de duas senoides + deriva aleatória semeada, presa à faixa 1.480–1.536 °C | SIMULADO | Inferência/medição com procedência |
| Nível de metal no cadinho | Fração do nível de ferro **da animação**, que sobe e desce com o ciclo de vazamento da cena | SIMULADO | Sensor de nível ou balanço de massa |
| Furo de corrida | Estado do ciclo de vazamento da cena (abre na etapa 8 do tour) | SIMULADO | Tag digital do PLC |
| O₂ puro / gás recirculado | `oxygen` do cenário × (1 + 1 % seno); recirculado escala com a carga | SIMULADO | Vazão medida |
| Gás de topo CO / CO₂ / H₂ | Composição base do cenário ± oscilação (CO preso em 20–60 %) | SIMULADO (ver nota) | Analisador de gás |
| Produção estimada | `Fe = O₂ × 2,85 kg/Nm³`; briquete = Fe × 1,62 kg/kg | ESTIMADO | Balanço de massa validado |
| Consumo específico de briquete | Constante 1,62 kg/kg Fe no cenário | ESTIMADO | Balanço de massa validado |
| Desgaste máximo do refratário | Pior célula do dataset sintético | SINTÉTICO | Medição de espessura |
| Corridas até o limite | Regressão linear do desgaste máximo vs. corrida (3 pontos no exemplo) | ESTIMADO / não PREVISTO — a série é sintética | Previsão com histórico medido |

> **Nota sobre o rótulo do gás de topo.** O valor exibido é SIMULADO como os demais. A
> composição base (CO 41 %, CO₂ 34 %, H₂ 18 %) vem do roteiro técnico e está marcada como
> premissa de cenário, não como medição.

Detalhe de implementação que importa para auditoria: a relação `2,85 kg Fe/Nm³ O₂` equivale a
**~0,35 Nm³ de O₂ por kg de Fe**, e é uma relação ilustrativa declarada em
`plant-sim.js` — **não** um balanço estequiométrico validado. Com os parâmetros de partida
(7.900 Nm³/h) ela resulta em 22.515 kg/h e ~197 mil t/ano, ou seja, 98,6 % da capacidade
nominal de 200 mil t/ano. Esse número **não** é uma promessa de produção.

---

## 5. Envelope operacional: checagem de faixa, não de física

A aba “Cenário” verifica cinco condições. Todas comparam um parâmetro com uma faixa
**declarada**; nenhuma resolve equação de processo.

| Checagem | Critério | Rótulo |
|---|---|---|
| Temperatura do metal | 1.480–1.536 °C | DECLARADO · NÃO VALIDADO |
| Vazão de O₂ | 4.000–11.000 Nm³/h (turndown) | DECLARADO · NÃO VALIDADO |
| Carga de briquete | 12–32 t/h | DECLARADO · NÃO VALIDADO |
| Carbono redutor no briquete | 18–28 % mássico | DECLARADO · NÃO VALIDADO |
| Rendimento de Fe | O₂ / carga < 0,42 Nm³/kg | DECLARADO · NÃO VALIDADO |

Duas observações honestas sobre esse painel:

1. **A checagem de carbono nunca falha na interface.** O teor de carbono é um parâmetro fixo
   do cenário (23 %) e não é exposto como slider. A linha existe para mostrar que o critério
   foi previsto; ela só passa a discriminar quando a composição do briquete for uma variável
   de entrada (Etapa 2).
2. **A checagem de rendimento é a única que pode reprovar** com os três sliders disponíveis:
   com O₂ no máximo (11.000) e carga no mínimo (12.000), a razão chega a 0,92 e o veredito
   fica fora do envelope.

O veredito termodinâmico completo — balanço de massa e energia, equilíbrio de Boudouard,
tempo de residência, penetração do jato — é o motor da Etapa 2, e o contrato de entrada e
saída dele já está definido (`feasibility-request` / `feasibility-response`).

---

## 6. Escala de referência da animação

A geometria animada é a do reator descrito no roteiro técnico:

| Grandeza | Valor | Fonte |
|---|---|---|
| Diâmetro da face quente | 3,6 m (r = 1,8 m) | `params.js` |
| Raio do casco | 2,34 m | `params.js` |
| Altura total | 11,85 m | `params.js` |
| Nível de carga no topo do leito | 10,6 m | `params.js` |
| Ventaneiras | 8 | `params.js` |
| Refratário de trabalho | 450 mm inicial / 150 mm mínimo | `params.js` |
| Capacidade nominal | 200 mil t/ano | `params.js`, `operating-point.json` |

**Isto não é a mesma escala do domínio CFD do repositório.** O caso `chtMultiRegionFoam` em
`cfd/` usa um domínio reduzido (raio externo 0,80 m, altura 3,40 m, ~100 kg/h de Fe) para
viabilizar o cálculo. Os números da animação e os números do CFD **não são comparáveis**
diretamente. Ver `ARQUITETURA.md` §8.

---

## 7. Critérios de aceite da Etapa 1 — com verificação

| Critério | Como verificar | Resultado esperado |
|---|---|---|
| Aplicação abre sem erro de console | `cd web && ./serve.sh` e abrir `http://localhost:8080` | Cena renderiza, `document.body.dataset.ready === "true"` |
| Contratos válidos | Aba “Plataforma” | `8/8 válidos · 2 prontos` |
| Nenhum serviço ausente finge resposta | Aba “Plataforma”, linhas com “etapa 2” | Adaptadores CFD/surrogate/viabilidade marcados indisponíveis |
| Dados de desgaste carregáveis | Modal “Dados” → “Exemplo CSV” → “Aplicar” | 2 zonas, 1 corrida, mensagem de sucesso |
| Desgaste rejeita dado malformado | Colar CSV sem a coluna `valor` | Erro explícito, dataset anterior preservado |
| Captura headless limpa | `node tools/shot.mjs http://localhost:8080 /tmp/x.png` | Código de saída 0 |
| Site público responde | `curl -I https://chordiq-tech.github.io/oxyred-web/` | `HTTP 200` |

---

## 8. Fora do escopo da Etapa 1 (explícito)

- Execução de CFD, em qualquer escala.
- Inferência de qualquer modelo substituto (surrogate) — nenhum modelo é carregado.
- Motor termodinâmico, cinético ou de viabilidade.
- Ingestão de campo (OPC UA, MQTT), banco de dados, backend.
- Calibração do modelo de desgaste com histórico medido.
- **Escrita em PLC, em qualquer hipótese.** Ver `INTEGRACAO_FUTURA.md` §6.
- Qualquer afirmação de ganho de processo. Ganho hipotético não é ganho comprovado; nada foi
  medido em planta.

---

## 9. Pendências registradas nesta entrega

São conhecidas, não foram escondidas e não impedem o uso da demonstração:

1. `tests/web/` está **vazio**. O comentário no topo de `src/domain/wear.js` afirma que as
   funções puras existem “para poderem ser testadas em Node (`tests/web`)” — a intenção está
   registrada, os testes ainda não foram escritos.
2. Não há CI para `web/`. O único workflow do repositório é o build do executável Windows.
3. `web/` não é citado no `README.md` da raiz do repositório; a entrada para esta aplicação é
   o próprio `web/docs/` (esta pasta).
4. Dados de desgaste carregados pelo modal vivem **em memória**: recarregar a página volta ao
   dataset de exemplo. Nada é enviado a servidor — é o que a mensagem “valem para este
   navegador” significa.
5. three.js vem de CDN fixada em **r128**. Em rede isolada a cena não carrega; ver
   `MANUAL_OPERACAO.md` §7.

---

## 10. Definição de pronto (Etapa 1)

A etapa está pronta quando, e apenas quando: a demonstração roda de ponta a ponta sem erro de
console; todo número na tela tem rótulo de evidência rastreável ao código; todo contrato de
integração é validado em tempo de execução; todo serviço ausente declara ausência e motivo; e
o site publicado responde às cinco páginas de documentação desta pasta.
