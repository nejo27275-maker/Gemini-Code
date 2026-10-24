// Perfis de execução inspirados em padrões públicos de agentes de programação.
// Os perfis limitados usam allowlists reais; prompts sozinhos não são controles de segurança.
'use strict';

const READ_TOOLS = Object.freeze(['read_file', 'list_dir', 'search_files', 'read_skill']);
const PROFILES = Object.freeze({
  coder: {
    name: 'coder',
    aliases: ['executor', 'implementador'],
    description: 'Implementa a tarefa, pode editar arquivos e executar ferramentas disponíveis.',
    tools: null,
    artifactType: 'tarefa',
    instructions: 'PERFIL CODER: inspecione o projeto antes de alterar; faça mudanças pequenas; rode testes e verificações relevantes; informe exatamente o que foi e não foi verificado. Respeite confirmações e permissões das ferramentas.',
  },
  explore: {
    name: 'explore',
    aliases: ['explorador', 'explorer'],
    description: 'Explora o repositório apenas com ferramentas de leitura.',
    tools: READ_TOOLS,
    artifactType: 'analise',
    instructions: 'PERFIL EXPLORE (somente leitura): não edite, escreva, execute comandos nem publique nada. Mapeie a arquitetura, cite caminhos de arquivos e evidências específicas, liste incertezas e próximos passos.',
  },
  plan: {
    name: 'plan',
    aliases: ['planejador', 'planner'],
    description: 'Produz plano de implementação sem alterar arquivos.',
    tools: READ_TOOLS,
    artifactType: 'plano',
    instructions: 'PERFIL PLAN (somente leitura): não modifique arquivos nem execute comandos. Entregue objetivo, achados sobre o repositório, etapas ordenadas, dependências, riscos, testes de aceitação e critérios de conclusão. Não diga que implementou.',
  },
  review: {
    name: 'review',
    aliases: ['revisor', 'reviewer'],
    description: 'Revisa código em modo somente leitura, priorizando bugs e riscos comprováveis.',
    tools: READ_TOOLS,
    artifactType: 'revisao',
    instructions: 'PERFIL REVIEW (somente leitura): não altere nada. Priorize achados por severidade e inclua caminho/linha quando possível, cenário de reprodução, impacto e correção sugerida. Separe bugs comprovados de hipóteses; se não encontrar achados, informe escopo revisado e limitações.',
  },
  test: {
    name: 'test',
    aliases: ['tester', 'testador'],
    description: 'Inspeciona o projeto e executa apenas a ferramenta de verificações reconhecida.',
    tools: Object.freeze([...READ_TOOLS, 'run_checks']),
    artifactType: 'testes',
    instructions: 'PERFIL TEST: inspecione scripts de teste antes de executá-los; utilize apenas run_checks para verificar; não edite arquivos. Informe comandos/verificações realmente executados e seus resultados. Se run_checks não reconhecer o projeto, não invente resultados.',
  },
});

const ALIASES = new Map();
for (const profile of Object.values(PROFILES)) {
  ALIASES.set(profile.name, profile.name);
  for (const alias of profile.aliases) ALIASES.set(alias, profile.name);
}

function resolveProfile(name = 'coder') {
  const normalized = String(name || 'coder').trim().toLowerCase();
  const canonical = ALIASES.get(normalized);
  if (!canonical) throw new Error(`Perfil desconhecido: ${normalized}. Perfis: ${Object.keys(PROFILES).join(', ')}.`);
  return PROFILES[canonical];
}


function parseRunArgs(args = []) {
  let profileName = null;
  let createCheckpoint = false;
  let legacyReadOnly = false;
  let json = false;
  const imagens = [];
  const instructionParts = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === '--checkpoint') createCheckpoint = true;
    else if (arg === '--read-only') legacyReadOnly = true;
    // v0.41.0: --json (saída estruturada para automação/CI) e --imagem ARQUIVO (repetível).
    else if (arg === '--json') json = true;
    else if (arg === '--imagem' || arg === '--image') {
      if (!args[i + 1] || String(args[i + 1]).startsWith('--')) throw new Error(`Informe o arquivo da imagem após ${arg}.`);
      imagens.push(String(args[++i]));
    }
    else if (arg === '--profile') {
      if (!args[i + 1] || String(args[i + 1]).startsWith('--')) throw new Error('Informe o nome do perfil após --profile.');
      profileName = String(args[++i]);
    } else if (arg.startsWith('--profile=')) profileName = arg.slice('--profile='.length);
    else if (arg.startsWith('--')) throw new Error(`Opção desconhecida em run: ${arg}`);
    else instructionParts.push(arg);
  }
  if (legacyReadOnly && profileName) throw new Error('Use --read-only ou --profile, não os dois juntos.');
  const profile = resolveProfile(profileName || (legacyReadOnly ? 'explore' : 'coder'));
  return { profile, createCheckpoint, instruction: instructionParts.join(' ').trim(), legacyReadOnly, json, imagens };
}

function listProfiles() {
  return Object.values(PROFILES).map(({ name, aliases, description, tools, artifactType }) => ({
    name, aliases: [...aliases], description, tools: tools ? [...tools] : 'todas as ferramentas autorizadas pela sessão', artifactType,
  }));
}

module.exports = { PROFILES, READ_TOOLS, resolveProfile, listProfiles, parseRunArgs };
