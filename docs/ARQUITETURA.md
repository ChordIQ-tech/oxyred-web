# Arquitetura — gêmeo digital web do Oxy-Red (Etapa 1)

Documento técnico da aplicação em `web/`: como está organizada, por onde o dado anda, quais
fronteiras não podem ser cruzadas e onde exatamente um serviço real substitui o simulado.

Complementa, e não substitui, o `ARCHITECTURE.md` da raiz do repositório — aquele fixa os
contratos do **stack completo** (CAD, malha, CFD, surrogates, backend FastAPI, HMI React).
Este fixa a **aplicação web estática** entregue na Etapa 1.

---

## 1. Visão geral

```text
                 ┌──────────────────────────────────────────────────────────┐
                 │                     web/ (estático)                      │
                 │                                                          │
  data/*.json ──►│ main.js ──► domain/wear.js     (normalização)            │
  contracts/     │    │                                                     │
  *.schema.json  │    ├────► scene/twin-scene.js  (three.js, 3D + rótulos)  │
                 │    │            │ onTelemetry (4 Hz)                    │
                 │    │            ▼                                        │
                 │    ├────► domain/plant-sim.js  (telemetria SIMULADA)     │
                 │    │            │ frame                                 │
                 │    │            ▼                                        │
                 │    ├────► ui/hmi.js            (painéis, tour, modais)    │
                 │    │                                                     │
                 │    └────► platform/contracts.js ──► platform/schema.js   │
                 │                (valida os 8 schemas em runtime)          │
                 │                                                          │
                 │  platform/adapters.js  → CFD / surrogate / sensores /     │
                 │                          viabilidade: indisponível + razão│
                 └──────────────────────────────────────────────────────────┘
```

Sem backend, sem build, sem banco. A única saída de rede é o carregamento de
`data/`, `contracts/` e das bibliotecas externas (three.js e fontes).

---

## 2. Estrutura e responsabilidades

| Caminho | Responsabilidade | Pode importar | **Não pode** |
|---|---|---|---|
| `index.html` | Estrutura do DOM, textos, modais | CSS, três `<script>` | conter regra de negócio |
| `styles/app.css` | Tema visual, layout | — | — |
| `src/main.js` | Bootstrap e ligação entre camadas | todas | conter cálculo |
| `src/domain/params.js` | Fonte única de geometria, processo, regiões, cenário | — | tocar DOM ou three.js |
| `src/domain/plant-sim.js` | Telemetria ilustrativa, envelope, produção estimada | `params.js` | tocar DOM ou three.js |
| `src/domain/wear.js` | Parsing, normalização, rampa de cor, estatística, vida restante | `params.js` | tocar DOM ou three.js |
| `src/domain/process-steps.js` | Roteiro do tour: etapas, legendas, química, foco | — | tocar DOM ou three.js |
| `src/domain/format.js` | Formatação pt-BR e sparkline | — | — |
| `src/platform/schema.js` | Validador de subconjunto de JSON Schema | — | — |
| `src/platform/contracts.js` | Registro dos 8 contratos + carga/validação | `schema.js` | tocar three.js |
| `src/platform/adapters.js` | Adaptadores de serviço (mocks declarados) | `params.js` | fingir resultado |
| `src/scene/twin-scene.js` | Cena 3D, câmera, rótulos, malha de desgaste, animação | `params.js`, `process-steps.js`, `wear.js` | decidir regra de negócio |
| `src/ui/hmi.js` | Painéis, abas, sliders, modais, teclado | domínio + `contracts.js` | calcular física |
| `tools/shot.mjs` | Captura headless por CDP | Node `child_process` | depender de biblioteca externa |

Três regras de fronteira, verificáveis por leitura de import:

1. **`domain/` é puro.** Nenhum arquivo de domínio importa `three`, `document` ou `window`.
   É o que permite testá-los em Node e reusá-los no backend.
2. **`scene/` não decide.** A cena lê a rota de temperatura, o dataset de desgaste e as etapas
   do tour — não define o que é viável, nem formata número.
3. **`ui/` não calcula.** A HMI só apresenta o `frame` que o simulador devolve.

---

## 3. Ciclo de execução

1. `main.js` busca `./data/wear-demo.json`; se falhar, usa `demoWearDataset()` embutido e
   avisa no console (a aplicação **não** cai por falta de dado).
2. Cria cena, simulador (`seed: 20260806`), plataforma e HMI; aplica o dataset; assina
   `onStep` e `onTelemetry`.
3. `scene.start()` dispara `requestAnimationFrame`. A cada quadro, `dt` é limitado a 0,1 s
   para não explodir em aba que volta do segundo plano.
4. A cena emite telemetria **no máximo a cada 0,25 s** de tempo real (ou imediatamente quando
   o estado do furo de corrida muda). Cada emissão avança o simulador em `dt = 0,25 s`
   simulados; o relógio do cabeçalho mostra esse tempo simulado desde o início da sessão.
5. `hmi.update(frame, sceneState)` escreve os 9 indicadores; `setClock` o relógio;
   `setMode` o badge, apenas quando o modo muda.
6. Contratos são validados em segundo plano (`requestIdleCallback`, limite de 3 s; ou
   `setTimeout` de 1,2 s onde não houver). Abrir a aba “Plataforma” força a carga.
7. Aba oculta (`visibilitychange`) → `scene.stop()`; aba visível → `scene.start()`. Economia de
   GPU/bateria, não mudança de estado.

Histórico: o simulador mantém uma janela de **240 amostras** (≈ 60 s simulados) para o
sparkline de temperatura. Ao estourar, descarta a mais antiga.

Handle de depuração: `window.__oxyred = { scene, simulator, platform, dataset, ready, telemetry() }`.
É o que a captura headless consulta.

---

## 4. Estado

Todo o estado é **em memória**. Não há `localStorage`, `sessionStorage`, cookie, IndexedDB ou
chamada de escrita. Consequências deliberadas:

- Recarregar a página volta ao dataset de exemplo e aos parâmetros de partida.
- Dados colados no modal “Dados” valem para a sessão do navegador e não saem dele — é esse o
  sentido da mensagem “valem para este navegador”.
- Duas abas abertas são duas sessões independentes; não há sincronização.

---

## 5. Contratos de dados

Oito schemas em `contracts/`, registrados em `src/platform/contracts.js`:

| `key` | Schema | Payload de exemplo | Integração |
|---|---|---|---|
| `wear` | `wear-dataset` | `data/wear-demo.json` | pronta |
| `telemetry` | `telemetry-frame` | `data/samples/telemetry-frame.sample.json` | pronta |
| `sensors` | `sensor-frame` | idem | etapa 2 |
| `cfd` | `cfd-case` | idem | etapa 2 |
| `surrogateRequest` | `surrogate-request` | idem | etapa 2 |
| `surrogateResponse` | `surrogate-response` | idem | etapa 2 |
| `feasibilityRequest` | `feasibility-request` | idem | etapa 2 |
| `feasibilityResponse` | `feasibility-response` | idem | etapa 2 |

Validação em tempo de execução, ao abrir a aba “Plataforma”: cada schema precisa declarar
`$schema` e `title`/`$id`; cada exemplo precisa passar na validação. O resumo do cabeçalho
(`8/8 válidos · 2 prontos`) conta, respectivamente, contratos válidos e contratos cuja
integração real já existe.

**Limite importante do validador.** `src/platform/schema.js` implementa um subconjunto de
JSON Schema 2020-12: `type`, `properties`, `required`, `items`, `enum`, `const`, `minimum`,
`maximum`, `minItems`, `maxItems`, `additionalProperties` e `$ref` local (`#/...`). Palavras
como `oneOf`, `pattern`, `format`, `uniqueItems` e `$ref` remoto **não** são validadas. Se um
schema novo usar essas palavras, o painel continua dizendo “válido” — a validação real precisa
acontecer no backend, com validador completo.

Normalização do dataset de desgaste (`normalizeWearDataset`) aceita três formatos: o canônico
do repositório (`zones` + `snaps`), o do módulo 3D (`snapshots[].valores`) e um valor único
(`valores`). Limites: 200 fiadas × 360 setores por zona; cinco zonas fixas
(`cuba_superior`, `cuba_inferior`, `ventaneiras`, `cadinho_parede`, `soleira`).

---

## 6. Simulador ilustrativo

`src/domain/plant-sim.js` não resolve física. O que ele faz, por escrito:

- Prng **mulberry32** com semente fixa (`20260806`) → mesma leitura em toda sessão e em toda
  máquina. Determinismo é requisito de demonstração e de captura headless.
- Temperatura: alvo do cenário + duas senoides (0,21 e 0,83 rad/s) + deriva aleatória semeada,
  presa a 1.480–1.536 °C. Durante o vazamento, subtrai até 8 °C.
- Vazões e gás de topo: cenário × oscilação percentual; CO preso em 20–60 %.
- Produção: `Fe = O₂ × 2,85 kg/Nm³`; briquete `= Fe × 1,62`; anual `= Fe × 8760 / 1000`.
  Relação ilustrativa declarada — não é estequiometria validada.
- Envelope: cinco comparações de faixa (§5 de `ESCOPO_ETAPA1.md`).

O ponto de substituição é o adaptador, não a HMI — ver `INTEGRACAO_FUTURA.md`.

---

## 7. Cena 3D

- three.js **r128** global (`window.THREE`), carregada por `<script>` no `index.html` a partir
  de `cdnjs`. Não há bundler; a cena falha com mensagem explícita se `THREE` não existir.
- `createTwinScene({ container })` devolve uma API pequena: `applyDataset`,
  `setWearSnapshot` / `getWearSnapshot`, `setCutView` / `isCutView`, `setFlowsVisible` /
  `areFlowsVisible`, `setWearVisible` / `isWearVisible`, `setLabelsVisible`, `goStep`,
  `nextStep`, `prevStep`, `setPlaying` / `isPlaying`, `onStep`, `onTelemetry`,
  `setVisualScale`, `resetCamera`, `start`, `stop`, `resize`, `dispose`.
- Malha de desgaste: uma malha por zona, gerada a partir de `dims` do dataset; cor por célula
  pela rampa `wearRamp` (azul → branco → amarelo → laranja); célula sem dado fica cinza.
- Desempenho: `pixelRatio` limitado a 2; cena pausada em aba oculta; `prefers-reduced-motion`
  respeitado no carregamento.
- A geometria é **esquemática e ampliada**, não um desenho de projeto: serve para leitura de
  processo, não para cotas.

---

## 8. Escala e nomenclatura

Dois vocabulários são compartilhados com o resto do repositório, e isso é deliberado:

- **Regiões** (`freeboard`, `bed`, `bath_slag`, `bath_metal`, `refractory_working`,
  `refractory_insulating`, `shell_steel`) — os mesmos nomes do caso `chtMultiRegionFoam`. O
  campo `telemetry-frame.regions` usa exatamente essas chaves.
- **Zonas de desgaste** — as cinco zonas do mapa fiadas × setores.

O que **não** é compartilhado é a escala:

| Referência | Geometria | Produção de referência | Uso |
|---|---|---|---|
| Animação (`web/`) | Ø 3,6 m · 11,85 m | 200 mil t/ano nominal | Demonstrar o processo e a HMI |
| Domínio CFD (`cfd/`, `cad/`, `mesh/`) | raio externo 0,80 m · 3,40 m | ~100 kg/h de Fe | Viabilizar o cálculo multirregião |
| POC declarada em `web/data/operating-point.json` | Ø 3,6 m | 200 kg/h | Referência de prova de conceito |

Essas três referências **não são intercambiáveis** e os números de uma não podem ser
apresentados como resultado da outra. Fixar uma fonte única por finalidade é item de escopo da
Etapa 2 (`ESCOPO_ETAPA2.md` §6). A `operating-point.json` também declara explicitamente que
vazões e produção são ilustrativas e que a malha CFD usa cunha em escala reduzida.

---

## 9. Hospedagem e restrições

- **Estático, sem build.** ES modules exigem HTTP: abrir `index.html` por `file://` falha por
  política de origem. Use `./serve.sh` (`python3 -m http.server 8080`).
- **Publicação**: repositório público `ChordIQ-tech/oxyred-web`, que recebe uma cópia do
  conteúdo de `web/` mais um `.nojekyll` (sem ele o Pages processa os arquivos como Jekyll e
  ignora diretórios iniciados por `_`). URL: `https://chordiq-tech.github.io/oxyred-web/`.
- **Sem sincronização automática**: alteração em `web/` no repositório do gêmeo **não**
  aparece no site. O passo de cópia é manual (ou automatizado por workflow, que exige escopo
  `workflow` no `gh`).
- **Dependência externa**: three.js (cdnjs) e Google Fonts. Em rede isolada, a cena não
  carrega. Para uso offline é preciso vendorizar as duas dependências em `web/vendor/`.
- **Sem backend**: nada é gravado, nada é enviado. O site é uma demonstração, não um sistema
  de supervisão.

---

## 10. Dívidas técnicas conhecidas

| Dívida | Impacto | Correção |
|---|---|---|
| `tests/web/` vazio (o comentário em `wear.js` promete testes) | Domínio sem rede de segurança em refatoração | Escrever os testes em Node (`node --test`) |
| Ausência de CI para `web/` | Regressão silenciosa | Workflow de lint/smoke + captura headless |
| Validador de schema parcial | Contrato inválido pode passar por válido | Validar no backend com validador completo |
| three.js r128 fixa via CDN | Sem uso offline; upgrade manual | Vendorizar e fixar versão local |
| `README.md` da raiz não cita `web/` | Descoberta depende desta pasta | Adicionar um parágrafo de entrada |
| Sem persistência de sessão | Recarregar perde dados colados | Fora de escopo; se necessário, `localStorage` com aviso |
