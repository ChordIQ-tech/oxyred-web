# Manual de operação — gêmeo digital web do Oxy-Red

Para quem vai **abrir, demonstrar, alimentar com dados e verificar** a aplicação em `web/`.
Não é manual de engenharia de processo: o que cada número significa está em
`ESCOPO_ETAPA1.md` §4; onde cada peça encaixa, em `ARQUITETURA.md`.

> **Aviso que vale para toda a aplicação.** Os indicadores são **SIMULADOS** e o mapa de
> desgaste usa dado **SINTÉTICO**. Nada aqui é medição de planta, nada aqui deve orientar
> decisão operacional, e o gêmeo **não escreve** em nenhum equipamento.

---

## 1. Requisitos

| Para | Você precisa de |
|---|---|
| Abrir a aplicação | Navegador moderno com WebGL (Chrome, Edge, Firefox ou Safari atual) |
| Rodar localmente | `python3` (só para o servidor estático) |
| Captura headless | Node 18+ e Google Chrome instalado |
| Publicar | Acesso de escrita ao repositório público `oxyred-web` |

A aplicação **não** funciona aberta por `file://` (duplo clique no `index.html`): módulos ES
exigem HTTP. É a causa mais comum de “tela preta”.

---

## 2. Rodar localmente

```bash
cd web
./serve.sh              # http://localhost:8080
./serve.sh 8090         # outra porta
```

Equivalente, se preferir não usar o script:

```bash
cd web && python3 -m http.server 8080
```

Abra `http://localhost:8080`. A página está pronta quando o cabeçalho mostra a cena renderizada
e a legenda de fluxos aparece. Verificação programática: `document.body.dataset.ready === "true"`.

---

## 3. Publicar / atualizar o site

O site público é `https://chordiq-tech.github.io/oxyred-web/`, servido de um repositório
separado que contém **uma cópia** do conteúdo de `web/` mais um arquivo `.nojekyll`.

Atualizar:

1. Alterar o que for preciso em `web/` no repositório do gêmeo e validar localmente (§2).
2. Copiar o conteúdo de `web/` para o repositório público (mantendo `.nojekyll` na raiz).
3. `git commit` + `git push` no repositório público.
4. Aguardar o build do Pages (~30 s) e conferir com
   `curl -I https://chordiq-tech.github.io/oxyred-web/` → `HTTP 200`.

**Não há sincronização automática.** Alteração em `web/` não aparece no site até o passo 2–3.
Automatizar exige um workflow no repositório público e o escopo `workflow` habilitado no `gh`
(`gh auth refresh -s workflow`); sem isso, o caminho é a cópia manual.

---

## 4. A tela

### 4.1 Cabeçalho

- **Gêmeo Digital · Etapa 1** e o nome do reator.
- **Badge de modo**: `Simulação` (amarelo) ou `Dados de campo` quando houver ingestão real.
  Na Etapa 1, sempre `Simulação`.
- **Relógio**: tempo decorrido na sessão, em `hh:mm:ss`.

### 4.2 Painel esquerdo — três abas

| Aba | Conteúdo |
|---|---|
| **Indicadores** | Nove leituras: temperatura do metal, nível de metal, furo de corrida, O₂/recirculado, gás de topo (CO/CO₂/H₂), produção estimada, consumo específico de briquete, desgaste máximo do refratário, corridas até o limite. “Corridas até o limite” aparece como `—` quando o dataset tem menos de duas corridas (não há tendência para extrapolar) |
| **Cenário** | Três sliders (carga de briquete 12–32 t/h, O₂ puro 4.000–11.000 Nm³/h, alvo de temperatura 1.480–1.536 °C), veredito de envelope e lista de checagens |
| **Plataforma** | Os oito contratos de dados, validados na hora, com o estado de integração de cada um |

Na aba **Cenário**, mexer em um slider altera a simulação na hora e recalcula a produção
estimada. O veredito é **checagem de faixa**, não análise termodinâmica: veja
`ESCOPO_ETAPA1.md` §5 antes de citar o resultado.

### 4.3 Controles (coluna à direita da cena)

| Botão | O que faz |
|---|---|
| **Vista interna / externa** | Alterna o corte seccional do reator |
| **Fluxos** | Liga/desliga as partículas de fluxo (e a legenda) |
| **Desgaste** | Liga/desliga a malha colorida do revestimento |
| **Recentrar** | Volta a câmera ao enquadramento e retoma o acompanhamento do tour |
| **Dados** | Abre o modal para carregar desgaste (CSV/JSON) |
| **Sobre** | Escopo da etapa, créditos e links para esta documentação |

### 4.4 Tour do processo (cartão inferior direito)

Oito etapas, ~82 s no total, com reprodução automática:

1. Briquete autorredutor · 2. Composição do briquete · 3. Carga contínua pelo topo ·
4. Injeção de O₂ e redução · 5. Circuito fechado de gases · 6. Pós-combustão ·
7. Fusão e gotejamento · 8. Vazamento e granulação

Botões: **◀** etapa anterior, **❚❚ / ▶** pausar/reproduzir, **▶** próxima. Os oito pontos
abaixo do título pulam direto para a etapa. Pausar o tour **não** congela os indicadores; ele
congela a troca de etapa e o acompanhamento de câmera.

> Autoplay desligado automaticamente se o sistema estiver com “reduzir movimento” ativado.

### 4.5 Cena

- **Arrastar** orbita a câmera (e desliga o acompanhamento do tour).
- **Roda do mouse** aproxima/afasta; em tela de toque, **pinça**.
- **← / →** trocam de etapa; **Esc** fecha modais.
- Em janelas estreitas a interface entra em modo compacto; girar o celular para paisagem
  reorganiza a cena.

---

## 5. Carregar dados de desgaste

Modal **Dados** → colar texto, escolher arquivo, ou usar **Exemplo CSV** / **Exemplo JSON**.
**Aplicar** valida e aplica; **Voltar ao exemplo** restaura o dataset de partida.

### 5.1 Formato CSV

```csv
# tipo=desgaste_mm
# espessura_inicial_mm=450
# espessura_minima_mm=150
# limite_mm=300
zona,fiada,setor,valor,corrida
ventaneiras,1,1,82,Corrida 1
ventaneiras,1,2,85,Corrida 1
```

- Colunas obrigatórias: `zona`, `fiada`, `setor`, `valor`. `corrida` é opcional (agrupa
  snapshots; sem ela, tudo vira um snapshot “Dados”).
- Metadados em linhas `# chave=valor`: `tipo`, `espessura_inicial_mm`, `espessura_minima_mm`,
  `limite_mm`, `escala_max`.
- Separador `,`, `;` ou tabulação — detectado na linha de cabeçalho. Com `;`, aceita vírgula
  decimal (`82,5`).
- Zonas válidas: `cuba_superior`, `cuba_inferior`, `ventaneiras`, `cadinho_parede`, `soleira`.
  Use só as que tiver; zonas desconhecidas são ignoradas com aviso.
- **Fiada 1 é a mais baixa** de cada zona. Na soleira, **fiada 1 é o anel central**.
- **Setor 1 começa em 0°, no furo de corrida**, crescendo no sentido anti-horário visto de
  cima.
- O número de fiadas e setores é lido do próprio dado (máx. 200 × 360).

### 5.2 Formato JSON

Três formas aceitas:

```jsonc
// 1) canônico do repositório
{ "zones": { "ventaneiras": { "N": 3, "M": 8, "e0": 450, "emin": 150 } },
  "snaps": [ { "x": 150, "label": "Corrida 150", "wear": { "ventaneiras": [[80,81,…]] } } ] }

// 2) do módulo 3D (matrizes por zona)
{ "tipo": "desgaste_mm", "espessura_inicial_mm": 450, "limite_mm": 300,
  "snapshots": [ { "rotulo": "Corrida 1", "valores": { "ventaneiras": [[80,81,…]] } } ] }

// 3) valor único
{ "valores": { "ventaneiras": [[80,81,…]] } }
```

### 5.3 Tipos de valor

| `tipo` | Significado | Observação |
|---|---|---|
| `desgaste_mm` | Espessura perdida, em mm | Padrão |
| `espessura_residual_mm` | Quanto sobrou | Exige `espessura_inicial_mm`; o app converte para desgaste |
| `indice` | Número adimensional | Escala padrão 1,5 quando não informada |

`limite_mm` (ou `escala_max`) é o desgaste em que a rampa chega ao vermelho. Sem esse valor, a
escala é derivada de `e0 − emin` ou arredondada para cima a partir do pior valor lido.

### 5.4 Erros comuns

| Mensagem | Causa |
|---|---|
| “O cabeçalho do CSV precisa de: zona, fiada, setor, valor” | Falta coluna obrigatória |
| “Linha N: fiada e setor devem ser inteiros a partir de 1” | Índice 0 ou texto |
| “Zona X: matriz de desgaste N×M esperada” | Matriz com dimensão diferente da declarada em `zones` |
| “Com espessura_residual_mm é preciso informar espessura_inicial_mm” | Falta o `e0` |
| “Nenhuma zona reconhecida” | Nome de zona fora da lista |

Ao errar, o dataset anterior **permanece** aplicado — a tela não fica vazia.

> Os dados carregados ficam em memória da sessão: recarregar a página volta ao exemplo. Nada é
> enviado a servidor.

---

## 6. Verificação de saúde

| Verificação | Procedimento | Esperado |
|---|---|---|
| Aplicação | Abrir a URL e olhar o console | Sem erro; cena renderiza |
| Contratos | Aba **Plataforma** | `8/8 válidos · 2 prontos` |
| Adaptadores | Aba **Plataforma**, linhas de adaptador | CFD/surrogate/viabilidade marcados indisponíveis ou “simulado” |
| Desgaste | Modal **Dados** → **Exemplo CSV** → **Aplicar** | “Dados aplicados: 2 zona(s), 1 corrida(s). Escala: vermelho a partir de 300,0 mm.” |
| Captura | `node tools/shot.mjs http://localhost:8080 /tmp/shot.png` | Saída 0; `ready: true`, `canvas: true` |
| Site público | `curl -I https://chordiq-tech.github.io/oxyred-web/` | `HTTP 200` |

A captura headless imprime um JSON de estado e **sai com código 1** se a página não ficar
pronta ou se houver erro de console — use isso como teste de fumaça antes de publicar.

---

## 7. Problemas comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| Tela preta, faixa “Falha ao carregar…” | three.js não veio do CDN (rede bloqueada) ou `file://` | Servir por HTTP; liberar `cdnjs.cloudflare.com`; ver console |
| Faixa “Falha ao iniciar o gêmeo digital” | Dataset inválido ou WebGL indisponível | Ler a mensagem do console; testar em outro navegador |
| “Plataforma · carregando…” parado | A validação busca oito arquivos; em máquina carregada leva alguns segundos | Aguardar; abrir a aba força a carga; conferir se `contracts/` existe |
| Contrato em vermelho | Schema ou exemplo inválido | Corrigir o par schema/exemplo; a mensagem indica o erro |
| Cena lenta / travando | GPU integrada ou janela muito grande | Fechar outras abas; reduzir a janela; `pixelRatio` já é limitado a 2 |
| Indicadores congelados com a aba em segundo plano | A animação pausa em aba oculta (por desenho) | Voltar à aba |
| Documentos do modal “Sobre” dão 404 | `docs/` não foi copiada na publicação | Refazer o passo 2 da §3 |
| Documento abre como texto puro (`#`, `|`) | Renderizador (`marked`) não veio do CDN | Liberar `cdnjs.cloudflare.com`; o link “Markdown puro” é o mesmo conteúdo sem render |
| Captura sai preta | Página ainda carregando | Aumentar `--wait` (ex.: `--wait=12000`); rodar com a máquina livre |

---

## 8. Limites de uso (leia antes de apresentar)

- Os nove indicadores são **SIMULADOS**; o desgaste é **SINTÉTICO**; a produção é
  **ESTIMADA** por relação ilustrativa. Ver `ESCOPO_ETAPA1.md` §3–4.
- **Não** use esta tela para decisão de operação, de segurança ou de manutenção.
- **Não** apresente “corridas até o limite” como previsão de vida do refratário: é regressão
  sobre três corridas sintéticas.
- **Não** cite ganho de rendimento, de consumo ou de emissão a partir desta demonstração.
  Ganho hipotético não é ganho comprovado.
- O gêmeo **não escreve** em PLC nem em qualquer equipamento. Escrita exige análise de risco,
  validação de engenharia, gestão de mudança, cibersegurança e aprovação formal — ver
  `INTEGRACAO_FUTURA.md` §9.

---

## 9. Manutenção rápida — onde mexer

| Objetivo | Arquivo |
|---|---|
| Geometria, faixas de processo, zonas, cenário | `src/domain/params.js` |
| Texto/duração/foco das etapas do tour | `src/domain/process-steps.js` |
| Comportamento da telemetria ilustrativa | `src/domain/plant-sim.js` |
| Rampa de cor do desgaste, parsing, vida restante | `src/domain/wear.js` |
| Textos, painéis, botões, modais | `index.html` + `src/ui/hmi.js` |
| Cena 3D, câmera, rótulos | `src/scene/twin-scene.js` |
| Contratos e exemplos | `contracts/`, `data/samples/`, `src/platform/contracts.js` |
| Tema visual | `styles/app.css` |

Rotina mínima após qualquer alteração: rodar localmente (§2), conferir contratos (§6), rodar a
captura headless (§6) e só então publicar (§3).
