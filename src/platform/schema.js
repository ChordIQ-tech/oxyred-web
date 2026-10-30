/**
 * Validador de um subconjunto de JSON Schema (2020-12).
 *
 * Deliberadamente pequeno e sem dependências: cobre só o que os contratos deste
 * repositório usam — `type`, `properties`, `required`, `items`, `enum`,
 * `const`, `minimum`, `maximum`, `minItems`, `maxItems`, `additionalProperties`.
 * Serve para validar contratos em teste e em tempo de execução no navegador.
 */

const typeOf = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
};

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some(t => matchesType(value, t));
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeOf(value) === type;
}

/**
 * @returns {{valid: boolean, errors: Array<{path: string, message: string}>}}
 */
export function validate(value, schema, path = '$', root = schema) {
  const errors = [];
  const push = (p, message) => errors.push({ path: p, message });

  if (!schema || typeof schema !== 'object') return { valid: true, errors };

  // Referência local (#/$defs/nome) — só o caso usado pelos contratos daqui.
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    const target = schema.$ref
      .slice(2)
      .split('/')
      .reduce((acc, key) => (acc ? acc[key.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), root);
    if (!target) {
      push(path, `$ref não resolvido: ${schema.$ref}`);
      return { valid: false, errors };
    }
    const r = validate(value, target, path, root);
    errors.push(...r.errors);
    return { valid: errors.length === 0, errors };
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    push(path, `esperado ${JSON.stringify(schema.type)}, recebido ${typeOf(value)}`);
    return { valid: false, errors };
  }
  if (schema.const !== undefined && value !== schema.const) {
    push(path, `esperado const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    push(path, `valor fora do enum ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) push(path, `abaixo do mínimo ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) push(path, `acima do máximo ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) push(path, `menos de ${schema.minItems} itens`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) push(path, `mais de ${schema.maxItems} itens`);
    if (schema.items) {
      value.forEach((item, i) => {
        const r = validate(item, schema.items, `${path}[${i}]`, root);
        errors.push(...r.errors);
      });
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    (schema.required || []).forEach(key => {
      if (!(key in value)) push(`${path}.${key}`, 'campo obrigatório ausente');
    });
    Object.entries(schema.properties || {}).forEach(([key, sub]) => {
      if (key in value) {
        const r = validate(value[key], sub, `${path}.${key}`, root);
        errors.push(...r.errors);
      }
    });
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      Object.keys(value).forEach(key => {
        if (!allowed.has(key)) push(`${path}.${key}`, 'propriedade não prevista no contrato');
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Valida e devolve uma mensagem curta pronta para o painel. */
export function validateSummary(value, schema) {
  const result = validate(value, schema);
  if (result.valid) return { ok: true, detail: 'contrato válido' };
  const first = result.errors[0];
  return {
    ok: false,
    detail: `${result.errors.length} erro(s): ${first.path} ${first.message}`
  };
}
