#!/usr/bin/env node
/**
 * Captura de tela headless via Chrome DevTools Protocol (sem dependências).
 *
 * Uso: node tools/shot.mjs <url> <arquivo.png> [--w=1440] [--h=900] [--wait=8000]
 *
 * Sirva a pasta antes (`./serve.sh`) — ES modules não carregam por file://.
 * Sai com código 1 se a página registrar erro de console/exceção.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1] || 'shot.png';
const opt = k => {
  const prefix = `--${k}=`;
  const hit = args.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};
const width = Number(opt('w') || 1440);
const height = Number(opt('h') || 900);
const waitMs = Number(opt('wait') || 8000);
const evalBefore = opt('eval');
const port = Number(opt('port') || 9333);

if (!url) {
  console.error('uso: node tools/shot.mjs <url> <arquivo.png>');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'oxy-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  `--window-size=${width},${height}`,
  'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForEndpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch { /* ainda subindo */ }
    await sleep(150);
  }
  throw new Error('Chrome não abriu a porta de depuração');
}

let msgId = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return { ws, send, events, open };
}

try {
  await waitForEndpoint();
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await created.json();
  const { ws, send, events, open } = connect(target.webSocketDebuggerUrl);
  await open;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url });

  // espera o app sinalizar prontidão (ou o limite)
  const deadline = Date.now() + waitMs;
  let ready = false;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: "document.body && document.body.dataset ? document.body.dataset.ready : ''",
      returnByValue: true
    });
    if (r.result && r.result.value === 'true') { ready = true; break; }
    if (r.result && r.result.value === 'error') break;
    await sleep(250);
  }

  if (evalBefore) {
    const r = await send('Runtime.evaluate', { expression: evalBefore, awaitPromise: true, returnByValue: true });
    console.log('eval:', JSON.stringify(r));
    await sleep(900);
  }

  await sleep(1200); // deixa a cena desenhar alguns quadros

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const problems = [];
  for (const ev of events) {
    if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails;
      problems.push(`exceção: ${d.exception?.description || d.text}`);
    }
    if (ev.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(ev.params.type)) {
      problems.push(`${ev.params.type}: ${ev.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
      problems.push(`log: ${ev.params.entry.text} ${ev.params.entry.url || ''}`);
    }
  }

  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      ready: document.body.dataset.ready,
      boot: document.getElementById('stage')?.dataset.boot,
      canvas: !!document.querySelector('#scene canvas'),
      labels: document.querySelectorAll('.label3d').length,
      platform: document.getElementById('platSummary')?.textContent,
      kpis: {
        temp: document.getElementById('kTemp')?.textContent,
        wear: document.getElementById('kWear')?.textContent,
        life: document.getElementById('kLife')?.textContent,
        prod: document.getElementById('kProd')?.textContent
      }
    })`,
    returnByValue: true
  });

  console.log(`captura: ${out}`);
  console.log(`estado: ${info.result.value}`);
  if (!ready) problems.push('app não sinalizou ready=true');
  if (problems.length) {
    console.error('problemas:\n  ' + [...new Set(problems)].join('\n  '));
    ws.close();
    process.exit(1);
  }
  ws.close();
  process.exit(0);
} catch (err) {
  console.error('falha:', err.message);
  process.exit(1);
} finally {
  chrome.kill('SIGKILL');
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 200);
}
