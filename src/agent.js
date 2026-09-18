// src/agent.js
// Loop agentivo: manda a mensagem pro Gemini junto com a lista de
// ferramentas; se o modelo pedir para chamar uma ferramenta, executa e
// devolve o resultado, repetindo até o modelo responder só com texto.
'use strict';

const chalk = require('chalk');
const { loadConfig } = require('./config');
const { chatWithTools } = require('./gemini');
const tools = require('./tools');
const { listSkills } = require('./skills/loader');

function buildSystemInstruction(extra) {
  const skills = listSkills();
  const skillsList = skills.length
    ? skills.map((s) => `- ${s.name}: ${s.description} (ler com read_skill em "${s.path}")`).join('\n')
    : '(nenhuma skill instalada em ~/.gemini-code/skills)';

  const base = (
    'Você é o gemini-code, um agente de programação e automação que roda no ' +
    'terminal (Termux/Linux), no mesmo espírito do Claude Code. Você pode ler e ' +
    'escrever arquivos, rodar comandos de shell, chamar ferramentas de MCP ' +
    'conectadas e consultar skills para seguir boas práticas em tarefas específicas. ' +
    'Seja direto, explique o que vai fazer antes de rodar comandos que alteram o ' +
    'sistema, e prefira soluções simples e corretas.\n\n' +
    'Skills disponíveis:\n' + skillsList
  );

  // "extra" é a instrução adicional de uma persona (agents/*.json,
  // campo "systemInstructionExtra") — antes esse campo existia no JSON de
  // exemplo mas não era lido em lugar nenhum do código.
  return extra ? `${base}\n\n${extra}` : base;
}

/** Roda uma única "rodada" do agente para uma instrução do usuário. */
async function runOnce(userMessage, { history = [], modelName, extraSystemInstruction, allowedTools } = {}) {
  const cfg = loadConfig();
  const declarations = await tools.getAllDeclarations(allowedTools);
  const systemInstruction = buildSystemInstruction(extraSystemInstruction);

  const convo = [...history, { role: 'user', parts: [{ text: userMessage }] }];

  // Limite alto (não removido de propósito): sem nenhum teto, se o modelo
  // entrar num loop chamando ferramenta sem nunca fechar com texto, o
  // agente fica preso rodando pra sempre, gastando cota da API sem o
  // usuário perceber. 60 passos é alto o bastante pra nunca interromper uma
  // tarefa normal, mas ainda corta um loop de verdade.
  for (let step = 0; step < 60; step++) {
    const response = await chatWithTools({
      modelName: modelName || cfg.model,
      systemInstruction,
      history: convo,
      tools: declarations,
    });

    const calls = response.functionCalls ? response.functionCalls() : [];
    if (!calls || calls.length === 0) {
      const text = response.text();
      convo.push({ role: 'model', parts: [{ text }] });
      return { text, history: convo };
    }

    // O modelo pediu para usar uma ou mais ferramentas.
    // Ecoa os parts exatamente como o Google devolveu (preserva o "id" de
    // cada functionCall e qualquer outro campo, como thoughtSignature).
    // Gemini 3.5+ exige que a functionResponse devolva o mesmo id — só
    // reconstruir {name, args} como antes perdia esse campo e quebrava o
    // turno seguinte.
    convo.push({ role: 'model', parts: response.rawParts() });

    const responseParts = [];
    for (const call of calls) {
      console.log(chalk.dim(`\n→ usando ferramenta: ${call.name}(${JSON.stringify(call.args)})`));
      let result;
      try {
        result = await tools.execute(call.name, call.args || {}, allowedTools);
      } catch (err) {
        result = `Erro: ${err.message}`;
      }
      responseParts.push({
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: { result: String(result).slice(0, 20000) },
        },
      });
    }
    // Bug corrigido (set/2026): o Google mudou a API por baixo — o
    // "generateContent" clássico (usado aqui via @google/generative-ai)
    // agora rejeita role:"function" com "Role 'function' is not supported"
    // e uma lista de roles válidos que não inclui "function" mais. Isso
    // travava QUALQUER uso de ferramenta (run_shell, read_file, MCP, etc.):
    // a primeira chamada até funcionava, mas assim que o resultado da
    // ferramenta voltava pro modelo (2º turno), a API rejeitava. O próprio
    // formato de function-calling do Gemini sempre aceitou functionResponse
    // dentro de role:"user" como alternativa — é o que usamos agora.
    convo.push({ role: 'user', parts: responseParts });
  }

  // Se chegou aqui, o modelo ficou 8 rodadas seguidas só chamando
  // ferramentas sem nunca fechar com uma resposta em texto. Antes essa
  // mensagem de aviso era devolvida pro usuário mas NÃO entrava em `convo`
  // — na próxima chamada de `runOnce` com esse `history`, o modelo perdia o
  // fio: via os `functionResponse` das ferramentas mas nenhuma fala do
  // "assistente" fechando aquele turno, o que deixa o histórico inconsistente.
  const aviso = '(número máximo de passos de ferramenta atingido)';
  convo.push({ role: 'model', parts: [{ text: aviso }] });
  return { text: aviso, history: convo };
}

module.exports = { runOnce, buildSystemInstruction };
