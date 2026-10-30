/**
 * Bootstrap do gêmeo digital: carrega dados, cria a cena, liga HMI e simulador.
 */

import { normalizeWearDataset, parseWearText, demoWearDataset, sampleWearCsv, sampleWearJson } from './domain/wear.js';
import { createPlantSimulator } from './domain/plant-sim.js';
import { createPlatform } from './platform/adapters.js';
import { createTwinScene } from './scene/twin-scene.js';
import { createHmi } from './ui/hmi.js';

const $ = id => document.getElementById(id);

async function loadDataset() {
  try {
    const res = await fetch('./data/wear-demo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return normalizeWearDataset(raw, { synthetic: String(raw.origem || '').startsWith('sint') });
  } catch (err) {
    console.warn('Dataset de desgaste não carregado; usando exemplo embutido.', err.message);
    return demoWearDataset();
  }
}

async function boot() {
  const dataset = await loadDataset();

  const scene = createTwinScene({ container: $('scene') });
  const simulator = createPlantSimulator({ seed: 20260806 });
  const platform = createPlatform();
  const stage = $('stage');

  const hmi = createHmi({
    scene,
    simulator,
    platform,
    dataset,
    onReloadDefault: {
      dataset: () => demoWearDataset(),
      parse: text => parseWearText(text),
      sampleCsv: sampleWearCsv,
      sampleJson: sampleWearJson
    }
  });

  scene.applyDataset(dataset);

  scene.onStep(s => hmi.setStep(s));

  let lastMode = null;
  scene.onTelemetry(sceneState => {
    const frame = simulator.sample(sceneState, 0.25);
    hmi.update(frame, sceneState);
    hmi.setClock(frame.t);
    if (frame.mode !== lastMode) {
      hmi.setMode(frame);
      lastMode = frame.mode;
    }
  });

  // Aquece as abas que fazem trabalho assíncrono (contratos) sem bloquear a cena.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => hmi.loadPlatform(), { timeout: 3000 });
  } else {
    setTimeout(() => hmi.loadPlatform(), 1200);
  }

  scene.start();
  stage.dataset.boot = 'ready';
  document.body.dataset.ready = 'true';

  // Pausa a animação quando a aba não está visível (economiza bateria/GPU).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) scene.stop();
    else scene.start();
  });

  // Expõe um handle mínimo para depuração e para os testes de fumaça headless.
  window.__oxyred = {
    scene,
    simulator,
    platform,
    dataset,
    ready: true,
    telemetry: () => simulator.history().at(-1) ?? null
  };
}

boot().catch(err => {
  const el = $('bootError');
  el.textContent = `Falha ao iniciar o gêmeo digital: ${err.message}`;
  el.classList.add('show');
  document.body.dataset.ready = 'error';
  console.error(err);
});
