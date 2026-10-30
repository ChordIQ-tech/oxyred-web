/**
 * Registro de contratos: cada arquivo em `web/contracts/` é carregado em tempo
 * de execução, validado contra um payload de exemplo e exibido no painel
 * "Plataforma". É a prova visível de que a base está pronta para a integração
 * futura (CFD, surrogates, sensores, viabilidade) sem que nada disso rode ainda.
 */

import { validate } from './schema.js';

/**
 * `integration` descreve o estado real da integração, não o do contrato:
 *  - ready: contrato e payload validados, pronto para receber dados reais;
 *  - pending: contrato pronto, modelo/execução pertence à Etapa 2.
 */
export const CONTRACT_REGISTRY = Object.freeze([
  {
    key: 'wear',
    label: 'Dataset de desgaste',
    schema: 'contracts/wear-dataset.schema.json',
    sample: 'data/wear-demo.json',
    integration: 'ready',
    note: 'Dados sintéticos, formato final. Aceita medição real sem mudar a HMI.'
  },
  {
    key: 'telemetry',
    label: 'Telemetria do gêmeo',
    schema: 'contracts/telemetry-frame.schema.json',
    sample: 'data/samples/telemetry-frame.sample.json',
    integration: 'ready',
    note: 'Hoje preenchido pelo simulador; depois pela ingestão de campo.'
  },
  {
    key: 'sensors',
    label: 'Frame de sensor (OPC UA/MQTT)',
    schema: 'contracts/sensor-frame.schema.json',
    sample: 'data/samples/sensor-frame.sample.json',
    integration: 'pending',
    note: 'Sem conexão com a planta: falta endpoint, certificados e mapa de tags.'
  },
  {
    key: 'cfd',
    label: 'Caso CFD multirregião',
    schema: 'contracts/cfd-case.schema.json',
    sample: 'data/samples/cfd-case.sample.json',
    integration: 'pending',
    note: 'Manifesto validado; nenhum caso executado nesta etapa.'
  },
  {
    key: 'surrogateRequest',
    label: 'Surrogate · requisição',
    schema: 'contracts/surrogate-request.schema.json',
    sample: 'data/samples/surrogate-request.sample.json',
    integration: 'pending',
    note: 'Nenhum modelo carregado; ponto de inferência definido.'
  },
  {
    key: 'surrogateResponse',
    label: 'Surrogate · resposta',
    schema: 'contracts/surrogate-response.schema.json',
    sample: 'data/samples/surrogate-response.sample.json',
    integration: 'pending',
    note: 'Distingue modelo treinado em CFD real de proxy sintético.'
  },
  {
    key: 'feasibilityRequest',
    label: 'Viabilidade · requisição',
    schema: 'contracts/feasibility-request.schema.json',
    sample: 'data/samples/feasibility-request.sample.json',
    integration: 'pending',
    note: 'Geometria, energia, velocidades e briquete — o motor é da Etapa 2.'
  },
  {
    key: 'feasibilityResponse',
    label: 'Viabilidade · resposta',
    schema: 'contracts/feasibility-response.schema.json',
    sample: 'data/samples/feasibility-response.sample.json',
    integration: 'pending',
    note: 'Veredito sim/não por equação, resíduos de balanço e produção estimada.'
  }
]);

/** Lê um JSON por caminho relativo ao diretório da aplicação. */
async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Falha ao carregar ${path} (${res.status})`);
  return res.json();
}

/**
 * Carrega e valida todos os contratos.
 * @returns {Promise<Array<{key,label,integration,note,schemaOk,sampleOk,detail}>>}
 */
export async function loadContractStatus() {
  const results = [];
  for (const entry of CONTRACT_REGISTRY) {
    const item = { ...entry, schemaOk: false, sampleOk: false, detail: '' };
    try {
      const [schema, sample] = await Promise.all([fetchJson(entry.schema), fetchJson(entry.sample)]);
      item.schemaOk = Boolean(schema && schema.$schema && (schema.title || schema.$id));
      if (!item.schemaOk) {
        item.detail = 'schema sem $schema/title';
      } else {
        const result = validate(sample, schema);
        item.sampleOk = result.valid;
        item.errors = result.errors.slice(0, 2);
        item.detail = result.valid
          ? 'payload de exemplo válido'
          : `${result.errors.length} erro(s) no exemplo`;
      }
    } catch (err) {
      item.detail = err.message;
    }
    results.push(item);
  }
  return results;
}

/** Resumo para o cabeçalho do painel. */
export function summarize(statuses) {
  const total = statuses.length;
  const valid = statuses.filter(s => s.schemaOk && s.sampleOk).length;
  const ready = statuses.filter(s => s.integration === 'ready' && s.schemaOk && s.sampleOk).length;
  return { total, valid, ready };
}
