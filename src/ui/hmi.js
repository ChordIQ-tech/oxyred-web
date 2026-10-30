/**
 * HMI: liga a cena 3D e o simulador aos painéis do index.html.
 * Não contém regra de negócio — só apresentação e eventos.
 */

import { FLOW_LEGEND, STEPS } from '../domain/process-steps.js';
import { PROCESS } from '../domain/params.js';
import { int, dec1, dec2, pct1, clock, sparklinePoints } from '../domain/format.js';
import { wearStats, remainingRuns } from '../domain/wear.js';
import { loadContractStatus, summarize } from '../platform/contracts.js';

const $ = id => document.getElementById(id);

export function createHmi({ scene, simulator, platform, dataset, onReloadDefault }) {
  const state = {
    dataset,
    frame: null,
    step: null,
    statuses: []
  };

  // ------------------------------------------------------------ abas
  const tabs = [
    { btn: $('tabIndicators'), pane: $('paneIndicators') },
    { btn: $('tabScenario'), pane: $('paneScenario') },
    { btn: $('tabPlatform'), pane: $('panePlatform') }
  ];
  function selectTab(index) {
    tabs.forEach((t, i) => {
      const on = i === index;
      t.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      t.pane.hidden = !on;
    });
    if (index === 2) loadPlatform();
  }
  tabs.forEach((t, i) => t.btn.addEventListener('click', () => selectTab(i)));

  // ------------------------------------------------------------ legenda
  const chips = $('legendChips');
  chips.innerHTML = FLOW_LEGEND.map(f => {
    const style = f.color === 'ferro'
      ? 'background:radial-gradient(circle,#ffffff 0%,#f3f6ff 45%,#ffcf8a 100%);box-shadow:0 0 7px #ffcf8a'
      : `background:${f.color}`;
    return `<span><i class="${f.hollow ? 'n2' : ''}" style="${style}"></i>${f.label}</span>`;
  }).join('');

  // ------------------------------------------------------------ tour
  const dotsWrap = $('stepDots');
  const dots = [];
  for (let i = 0; i < 8; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => scene.goStep(i));
    dotsWrap.appendChild(b);
    dots.push(b);
  }
  dots.forEach((b, i) => {
    b.title = `${i + 1} · ${STEPS[i].name}`;
    b.setAttribute('aria-label', `Ir para a etapa ${i + 1}: ${STEPS[i].name}`);
  });

  $('pPlay').addEventListener('click', () => scene.setPlaying(!scene.isPlaying()));
  $('pNext').addEventListener('click', () => scene.nextStep());
  $('pPrev').addEventListener('click', () => scene.prevStep());
  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (document.querySelector('.modal.open')) return;
    if (e.key === 'ArrowRight') scene.nextStep();
    else if (e.key === 'ArrowLeft') scene.prevStep();
  });

  function setStep(s) {
    state.step = s;
    $('stepNum').textContent = s.index < 0 ? '' : `${s.index + 1}/${s.total}`;
    $('stepName').textContent = s.step.name;
    $('stepCap').textContent = s.step.cap;
    $('stepChem').innerHTML = (s.step.chem || [])
      .map(c => `<span${s.step.chemZero ? ' class="z"' : ''}>${c}</span>`)
      .join('');
    $('mix').style.display = s.step.mix ? 'block' : 'none';
    dots.forEach((b, k) => {
      b.classList.toggle('done', k < s.index);
      b.firstChild.style.width = k < s.index ? '100%' : '0%';
    });
    const play = $('pPlay');
    play.textContent = s.playing ? '❚❚' : '▶';
    play.title = s.playing ? 'Pausar tour' : 'Reproduzir tour';
    play.setAttribute('aria-label', play.title);
    play.classList.toggle('active', !s.playing);
  }

  // ------------------------------------------------------------ controles
  function syncToggle(btn, on, labelOn, labelOff) {
    btn.classList.toggle('on', on);
    btn.classList.toggle('off', !on);
    if (labelOn) btn.innerHTML = on ? labelOn : labelOff;
  }

  $('btnView').addEventListener('click', () => {
    const on = !scene.isCutView();
    scene.setCutView(on);
    syncToggle($('btnView'), on, 'Vista<br>interna', 'Vista<br>externa');
  });
  $('btnFlows').addEventListener('click', () => {
    const on = !scene.areFlowsVisible();
    scene.setFlowsVisible(on);
    syncToggle($('btnFlows'), on);
    $('legend').style.display = on ? '' : 'none';
  });
  $('btnWear').addEventListener('click', () => {
    const on = !scene.isWearVisible();
    scene.setWearVisible(on);
    syncToggle($('btnWear'), on);
  });
  $('btnCenter').addEventListener('click', () => {
    scene.resetCamera();
    scene.goStep(state.step ? state.step.index : -1);
  });

  // ------------------------------------------------------------ modais
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => $(el.dataset.close).classList.remove('open'));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  });
  const openModal = id => $(id).classList.add('open');

  $('btnData').addEventListener('click', () => openModal('dataPanel'));
  $('btnAbout').addEventListener('click', () => openModal('aboutPanel'));

  // ------------------------------------------------------------ dados
  const dpMsg = $('dpMsg');
  const setMsg = (kind, html) => {
    dpMsg.className = kind;
    dpMsg.innerHTML = html;
  };

  $('dpApply').addEventListener('click', () => {
    try {
      const text = $('dataText').value;
      if (!text.trim()) throw new Error('Cole os dados ou escolha um arquivo.');
      const ds = onReloadDefault.parse(text);
      setDataset(ds);
      const zones = Object.keys(ds.dims).length;
      setMsg('ok', `Dados aplicados: ${zones} zona(s), ${ds.snaps.length} corrida(s). Escala: vermelho a partir de ${dec1(ds.escalaMax)}${ds.unit}.`
        + ds.warns.map(w => `<span class="w">${w}</span>`).join(''));
    } catch (err) {
      setMsg('err', (err instanceof SyntaxError ? 'JSON inválido: ' : '') + err.message);
    }
  });
  $('dpFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      $('dataText').value = String(r.result);
      $('dpApply').click();
    };
    r.readAsText(f);
    e.target.value = '';
  });
  $('dpSampleCsv').addEventListener('click', () => {
    $('dataText').value = onReloadDefault.sampleCsv();
    setMsg('', '');
  });
  $('dpSampleJson').addEventListener('click', () => {
    $('dataText').value = onReloadDefault.sampleJson();
    setMsg('', '');
  });
  $('dpReset').addEventListener('click', () => {
    $('dataText').value = '';
    setDataset(onReloadDefault.dataset());
    setMsg('ok', 'Voltei aos dados de partida.');
  });

  // ------------------------------------------------------------ dataset
  let ds = null;
  function setDataset(next) {
    ds = next;
    state.dataset = next;
    scene.applyDataset(next);
    const stats = wearStats(next);
    $('datasetLabel').textContent = `${next.snaps.length} corrida(s) · ${next.synthetic ? 'sintético' : 'carregado'}`;
    $('rampMax').textContent = `limite ${int(next.escalaMax)}${next.unit}`;
    $('kWear').innerHTML = `${int(stats.worst.value)}<i>${next.unit}</i>`;
    $('kWearBar').style.width = `${Math.min(100, stats.fractionOfLimit * 100).toFixed(1)}%`;
    const life = remainingRuns(next);
    $('kLife').textContent = life ? `${int(Math.round(life.runs))} corridas` : '—';
  }

  // ------------------------------------------------------------ cenário
  const sliders = [
    { key: 'throughput', el: $('sThroughput'), out: $('sThroughputVal'), fmt: v => `${int(v)} kg/h` },
    { key: 'oxygen', el: $('sOxygen'), out: $('sOxygenVal'), fmt: v => `${int(v)} Nm³/h` },
    { key: 'targetTemp', el: $('sTemp'), out: $('sTempVal'), fmt: v => `${int(v)} °C` }
  ];

  function renderScenario() {
    const p = simulator.params;
    sliders.forEach(s => {
      s.el.value = p[s.key];
      s.out.textContent = s.fmt(p[s.key]);
    });
    const env = simulator.envelope();
    $('verdict').className = `verdict ${env.feasible ? 'ok' : 'bad'}`;
    $('verdictText').textContent = env.feasible
      ? 'Dentro do envelope declarado'
      : 'Fora do envelope — ajuste os parâmetros';
    $('checks').innerHTML = env.items.map(i => `
      <div class="check ${i.ok ? '' : 'bad'}">
        <span class="dot"></span>
        <span>
          <span class="txt">${i.label}</span>
          <span class="detail">${i.detail}</span>
        </span>
      </div>`).join('');
    const est = simulator.production();
    $('sProd').textContent = `${int(est.feKgH)} kg/h · ${int(est.annualT)} t/ano`;
  }

  sliders.forEach(s => {
    s.el.addEventListener('input', () => {
      const v = Number(s.el.value);
      simulator.setParam(s.key, v);
      s.out.textContent = s.fmt(v);
      // A animação acompanha a intensidade do cenário (apenas efeito visual).
      const load = simulator.params.oxygen / 7900;
      scene.setVisualScale(0.6 + 0.4 * load);
      renderScenario();
    });
  });
  renderScenario();

  // ------------------------------------------------------------ plataforma
  let platformLoaded = false;
  async function loadPlatform() {
    if (platformLoaded) return;
    const rows = $('platRows');
    rows.innerHTML = '<div class="platrow"><span class="dot"></span><span><span class="name">Carregando contratos…</span></span></div>';
    try {
      const statuses = await loadContractStatus();
      state.statuses = statuses;
      const sum = summarize(statuses);
      $('platSummary').textContent = `${sum.valid}/${sum.total} válidos · ${sum.ready} prontos`;
      rows.innerHTML = statuses.map(s => {
        const contractOk = s.schemaOk && s.sampleOk;
        const cls = !contractOk ? 'bad' : (s.integration === 'ready' ? 'ready' : 'pending');
        const contractTxt = contractOk ? 'contrato ok' : 'contrato inválido';
        const integTxt = s.integration === 'ready' ? 'pronto' : 'etapa 2';
        return `
          <div class="platrow ${cls}">
            <span class="dot"></span>
            <span style="flex:1">
              <span class="name">${s.label}<span>${contractTxt} · ${integTxt}</span></span>
              <span class="note">${s.detail || s.note}</span>
            </span>
          </div>`;
      }).join('') + platform.status().map(a => `
        <div class="platrow ${a.status === 'simulado' ? 'pending' : 'pending'}">
          <span class="dot"></span>
          <span style="flex:1">
            <span class="name">Adaptador · ${a.kind}<span>${a.status}</span></span>
            <span class="note">${a.description}</span>
          </span>
        </div>`).join('');
      platformLoaded = true;
    } catch (err) {
      rows.innerHTML = `<div class="platrow bad"><span class="dot"></span><span><span class="name">Falha ao validar contratos</span><span class="note">${err.message}</span></span></div>`;
    }
  }

  // ------------------------------------------------------------ indicadores
  function update(frame, sceneState) {
    state.frame = frame;
    if (sceneState && sceneState.stepIdx >= 0 && dots[sceneState.stepIdx]) {
      const p = Math.max(0, Math.min(1, sceneState.stepProgress || 0));
      dots[sceneState.stepIdx].firstChild.style.width = `${(p * 100).toFixed(1)}%`;
    }
    const t = frame.metalTempC;
    $('kTemp').innerHTML = `${int(Math.round(t))}<i>°C</i>`;
    $('kTempBar').style.width = `${((t - PROCESS.metalTempMinC) / (PROCESS.metalTempMaxC - PROCESS.metalTempMinC)) * 100}%`;

    const hist = simulator.history().map(h => h.metalTempC);
    $('kTempSpark').setAttribute('points', sparklinePoints(hist));

    $('kLevel').innerHTML = `${int(frame.metalLevelPct)}<i>%</i>`;
    $('kLevelBar').style.width = `${frame.metalLevelPct}%`;

    $('kTap').textContent = frame.tapOpen ? 'Aberto' : 'Fechado';
    $('kTap').classList.toggle('ok', frame.tapOpen);

    $('kFlows').innerHTML = `${int(frame.oxygenNm3h)} / ${int(frame.recirculatedNm3h)}<i>Nm³/h</i>`;
    $('kOffgas').innerHTML = `${pct1(frame.offgas.coPct)} / ${pct1(frame.offgas.co2Pct)} / ${pct1(frame.offgas.h2Pct)}`;
    $('kProd').innerHTML = `${int(frame.production.feKgH)}<i>kg/h</i>`;
    $('kSpecific').innerHTML = `${dec2(frame.production.specificBriquette)}<i>kg/kg Fe</i>`;
  }

  function setClock(seconds) {
    $('clockBadge').textContent = clock(seconds);
  }

  function setMode(frame) {
    const badge = $('modeBadge');
    badge.textContent = frame.mode === 'medido' ? 'Dados de campo' : 'Simulação';
    badge.classList.toggle('warn', frame.mode !== 'medido');
  }

  // inicializa dataset e textos fixos
  setDataset(dataset);
  $('btnView').innerHTML = 'Vista<br>interna';

  return {
    setStep,
    update,
    setClock,
    setMode,
    setDataset,
    renderScenario,
    loadPlatform,
    state
  };
}
