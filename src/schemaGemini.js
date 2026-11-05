// src/schemaGemini.js (v0.45.1)
// As declarações de ferramenta do MCP vêm em JSON Schema completo (gerado por zod, pydantic...): "$schema",
// "additionalProperties", "$ref"/"$defs", "const", "oneOf", "type": ["string", "null"], formatos como "uri".
// O campo "parameters" da API do Gemini aceita só um subconjunto (o Schema do OpenAPI 3.0) e responde 400
// ("Unknown name additionalProperties") para o pedido INTEIRO — um único servidor MCP desses derrubava o
// chat. Aqui o esquema é traduzido para o subconjunto, sem perder o que importa para o modelo (nomes, tipos,
// descrições, obrigatórios, enums). Os provedores compatíveis com OpenAI (llama.cpp, Ollama, OpenRouter)
// aceitam JSON Schema e continuam recebendo o original.
'use strict';

// Conjunto conservador (o que existe no Schema da API há tempo); "default"/"example" ficam de fora de propósito.
const PERMITIDOS = new Set([
  'type', 'format', 'title', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required',
  'minLength', 'maxLength', 'pattern', 'anyOf', 'items', 'minimum', 'maximum',
]);
const TIPOS = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const FORMATOS = { string: new Set(['date-time', 'enum']), number: new Set(['float', 'double']), integer: new Set(['int32', 'int64']) };
const MAX_PROFUNDIDADE = 12;

/** "#/$defs/Nome" ou "#/definitions/Nome" dentro do próprio esquema; outra referência vira null. */
function resolverRef(ref, raiz) {
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(String(ref));
  if (!m) return null;
  const nome = m[2].replace(/~1/g, '/').replace(/~0/g, '~');
  const defs = raiz && raiz[m[1]];
  return defs && typeof defs[nome] === 'object' ? defs[nome] : null;
}

function converter(no, raiz, profundidade, refsAbertas) {
  if (!no || typeof no !== 'object' || Array.isArray(no)) return {};
  if (profundidade > MAX_PROFUNDIDADE) return { type: 'object', description: no.description || '(estrutura aninhada demais)' };
  if (no.$ref) {
    const alvo = resolverRef(no.$ref, raiz);
    // referência a si mesmo (árvore, lista ligada) ou externa: vira um objeto genérico, sem laço infinito
    if (!alvo || refsAbertas.has(no.$ref)) return { type: 'object', ...(no.description ? { description: no.description } : {}) };
    const abertas = new Set(refsAbertas).add(no.$ref);
    return converter({ ...alvo, ...(no.description ? { description: no.description } : {}) }, raiz, profundidade + 1, abertas);
  }
  const ir = (filho) => converter(filho, raiz, profundidade + 1, refsAbertas);
  const out = {};

  // allOf: junta as partes (o caso comum é uma só, ou "base + extras")
  if (Array.isArray(no.allOf) && no.allOf.length) {
    const { allOf, ...resto } = no;
    const partes = [...allOf.map(ir), converter(resto, raiz, profundidade, refsAbertas)];
    const junto = Object.assign({}, ...partes);
    const props = Object.assign({}, ...partes.map((p) => p.properties || {}));
    const req = [...new Set(partes.flatMap((p) => p.required || []))].filter((k) => k in props);
    delete junto.required;
    if (Object.keys(props).length) { junto.properties = props; junto.type = junto.type || 'object'; } else delete junto.properties;
    if (req.length) junto.required = req;
    return junto;
  }

  // type: ["string", "null"] -> string + nullable; vários tipos -> anyOf
  // "STRING" (estilo enum da API) e "string" (JSON Schema) são o mesmo tipo
  let tipo = typeof no.type === 'string' ? no.type.toLowerCase() : Array.isArray(no.type) ? no.type.map((t) => String(t).toLowerCase()) : no.type;
  if (Array.isArray(tipo)) {
    const semNull = tipo.filter((t) => t !== 'null');
    if (semNull.length !== tipo.length) out.nullable = true;
    if (semNull.length === 1) tipo = semNull[0];
    else if (semNull.length > 1) {
      out.anyOf = semNull.filter((t) => TIPOS.has(t)).map((t) => converter({ ...no, type: t, description: undefined }, raiz, profundidade + 1, refsAbertas));
      tipo = undefined;
    } else tipo = undefined;
  }
  if (tipo === 'null') { out.nullable = true; tipo = undefined; }
  if (tipo && TIPOS.has(tipo)) out.type = tipo;

  const variantes = Array.isArray(no.anyOf) ? no.anyOf : Array.isArray(no.oneOf) ? no.oneOf : null;
  if (variantes && variantes.length) {
    const naoNulas = variantes.filter((v) => !(v && v.type === 'null'));
    if (naoNulas.length !== variantes.length) out.nullable = true;
    // uma variante só (o padrão "X ou null" do pydantic/zod): vira ela mesma
    if (naoNulas.length === 1) Object.assign(out, ir(naoNulas[0]));
    else if (naoNulas.length > 1) out.anyOf = naoNulas.map(ir);
  }

  if ('const' in no && typeof no.const === 'string') { out.enum = [no.const]; out.type = out.type || 'string'; }

  for (const [chave, valor] of Object.entries(no)) {
    if (!PERMITIDOS.has(chave) || chave in out) continue;
    if (chave === 'type' || chave === 'anyOf') continue; // já tratados
    if (chave === 'properties') {
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        out.properties = Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, ir(v)]));
      }
    } else if (chave === 'items') {
      out.items = ir(Array.isArray(valor) ? valor[0] : valor);
    } else if (chave === 'enum') {
      // a API só aceita enum de textos; enum de números vira só o tipo (o modelo ainda vê a descrição)
      if (Array.isArray(valor) && valor.length && valor.every((v) => typeof v === 'string')) out.enum = valor;
    } else if (chave === 'format') {
      if (out.type && FORMATOS[out.type] && FORMATOS[out.type].has(valor)) out.format = valor;
    } else if (chave === 'required') {
      if (Array.isArray(valor)) out.required = valor.filter((k) => typeof k === 'string');
    } else if (chave === 'description' || chave === 'title' || chave === 'pattern') {
      if (typeof valor === 'string') out[chave] = valor;
    } else {
      out[chave] = valor;
    }
  }
  if (out.enum && !out.type) out.type = 'string';
  if (out.properties && !out.type) out.type = 'object';
  if (out.items && !out.type) out.type = 'array';
  if (out.type === 'array' && !out.items) out.items = { type: 'string' };
  // "required" só pode citar propriedades que existem
  if (out.required) {
    out.required = out.required.filter((k) => out.properties && k in out.properties);
    if (!out.required.length) delete out.required;
  }
  return out;
}

/** Esquema de "parameters" de uma ferramenta -> subconjunto aceito pelo Gemini (ou undefined: sem parâmetros). */
function paraGemini(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = converter(schema, schema, 0, new Set());
  // objeto sem propriedades no topo: a API recusa ("properties should be non-empty"); ferramenta sem argumentos
  if ((out.type === 'object' || !out.type) && (!out.properties || !Object.keys(out.properties).length)) return undefined;
  if (!out.type) out.type = 'object';
  return out;
}

/** Declarações de ferramenta prontas para o Gemini (não altera as originais). */
function declaracoesParaGemini(tools) {
  return (tools || []).map((d) => {
    const parameters = paraGemini(d.parameters);
    const resto = { ...d };
    delete resto.parameters;
    return parameters ? { ...resto, parameters } : resto;
  });
}

module.exports = { paraGemini, declaracoesParaGemini };
