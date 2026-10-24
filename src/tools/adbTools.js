// src/tools/adbTools.js
// v0.43.0 — ADB: controlar os APARELHOS DO PRÓPRIO USUÁRIO (uma Android TV, um celular, um tablet) por
// USB ou pela rede local. É uma ferramenta de desenvolvedor padrão (o mesmo `adb` do Android SDK); serve
// para ver o que está instalado, abrir/instalar apps, navegar na TV pelo controle virtual, ajustar
// configurações e depurar. NÃO é para invadir aparelho de terceiros: o adb só conecta onde o dono já
// autorizou a depuração USB/por rede (o aparelho mostra um aviso e pede para confiar na chave).
//
// Segurança:
//   - nesta máquina, o adb roda com execFile e uma LISTA de argumentos: nenhum shell local interpreta nada.
//   - NO APARELHO: `adb shell a b c` junta os argumentos com espaço SEM escapar (como o ssh) e o shell da TV
//     os interpreta. v0.43.2: cada argumento vai entre aspas simples (noAparelho) — antes "digitar" com o
//     texto "a;reboot" reiniciava a TV, e um "valor" de config podia rodar qualquer comando lá.
//   - toda ação que MUDA o aparelho pede confirmação no terminal, a menos que adbConfirm:false ou uma regra
//     "permitir" cubra; as só de leitura (dispositivos, info, apps, estado, tela, logcat) não pedem.
//   - reiniciar, desinstalar, limpar dados, gravar em settings secure/global e o shell LIVRE confirmam
//     SEMPRE (um comando livre não dá para classificar com segurança: "pm uninstall" e "reboot" passavam
//     pela heurística, que é de comandos de PC).
//   - "tela" só cria um .png NOVO, fora das pastas e arquivos protegidos do gemini-code.
//   - o texto das confirmações é exibido sem o terminal interpretar controles (src/ui/textoSeguro.js).
//   - a regra "negar" do config (src/permissions.js) vale antes de tudo (vem do loop do agente).
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { ask } = require('../ui/prompt');
const { paraExibir } = require('../ui/textoSeguro');
const permissions = require('../permissions');

const TIMEOUT_MS = 60000;
const MAX_BUFFER = 16 * 1024 * 1024; // screencap/logcat podem ser grandes
// Alvo = serial USB (ex.: "ABCD1234"), "ip" ou "ip:porta", "emulator-5554", ou nome mDNS. Nunca começa com
// "-" (não pode virar uma flag do adb) nem tem espaço/metacaractere.
const ALVO_OK = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const PACOTE_OK = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/; // com.exemplo.app
const CHAVE_OK = /^[A-Za-z0-9_.]{1,100}$/;
const MAX_TEXTO = 1000;

// Teclas amigáveis -> KEYCODE do Android (o essencial para navegar numa TV pelo "controle virtual").
const TECLAS = Object.freeze({
  cima: 'KEYCODE_DPAD_UP', baixo: 'KEYCODE_DPAD_DOWN', esquerda: 'KEYCODE_DPAD_LEFT', direita: 'KEYCODE_DPAD_RIGHT',
  ok: 'KEYCODE_DPAD_CENTER', enter: 'KEYCODE_ENTER', voltar: 'KEYCODE_BACK', inicio: 'KEYCODE_HOME', home: 'KEYCODE_HOME',
  menu: 'KEYCODE_MENU', play: 'KEYCODE_MEDIA_PLAY_PAUSE', pause: 'KEYCODE_MEDIA_PLAY_PAUSE', parar: 'KEYCODE_MEDIA_STOP',
  proximo: 'KEYCODE_MEDIA_NEXT', anterior: 'KEYCODE_MEDIA_PREVIOUS', 'volume+': 'KEYCODE_VOLUME_UP',
  'volume-': 'KEYCODE_VOLUME_DOWN', mudo: 'KEYCODE_VOLUME_MUTE', power: 'KEYCODE_POWER', liga: 'KEYCODE_POWER',
  apps: 'KEYCODE_ALL_APPS', buscar: 'KEYCODE_SEARCH',
});
const ESPACOS_CONFIG = new Set(['system', 'secure', 'global']);

// Ações que só LEEM o aparelho (não pedem confirmação). "tela" grava nesta máquina, mas só um .png NOVO,
// fora das áreas protegidas (destinoDoPrint) — como criar um arquivo novo, que também não pergunta.
const SO_LEITURA = new Set(['dispositivos', 'descobrir', 'info', 'apps', 'estado', 'tela', 'logcat']);
// Confirmam SEMPRE, mesmo com adbConfirm:false ou regra "permitir".
const SENSIVEIS = new Set(['reiniciar', 'desinstalar', 'limpar', 'shell']);

const declarations = [
  {
    name: 'adb',
    description:
      'Controla um aparelho Android DO PRÓPRIO USUÁRIO por adb (USB ou rede local): Android TV, celular, tablet. ' +
      'Use para listar aparelhos, ver/instalar/abrir apps, navegar numa TV (teclas do controle), digitar texto, ajustar ' +
      'configurações, tirar print, ver logs e depurar. O aparelho precisa ter a depuração USB/por rede ligada e ter ' +
      'confiado nesta máquina. Ações que mudam o aparelho pedem confirmação do usuário.',
    parameters: {
      type: 'object',
      properties: {
        acao: {
          type: 'string',
          enum: ['dispositivos', 'descobrir', 'parear', 'conectar', 'desconectar', 'tcpip', 'info', 'apps', 'estado', 'tela', 'logcat',
            'abrir_app', 'fechar_app', 'instalar', 'desinstalar', 'limpar', 'tecla', 'digitar', 'config', 'reiniciar', 'shell'],
          description: 'dispositivos=lista; descobrir=acha aparelhos com depuração por Wi-Fi na rede; parear=Android 11+ (código de 6 dígitos ' +
            'da tela "Parear com código"); conectar/desconectar/tcpip=rede; info/apps/estado/tela/logcat=leitura; ' +
            'abrir_app/fechar_app/instalar/desinstalar/limpar=apps; tecla/digitar=controle; config=settings; reiniciar; shell=comando livre.',
        },
        alvo: { type: 'string', description: 'Aparelho: serial USB, "ip" ou "ip:porta" (padrão adbSerial do config; conectar/tcpip usam o ip; parear usa o ip:porta DE PAREAMENTO, que é outra porta).' },
        codigo: { type: 'string', description: 'parear: código de 6 dígitos mostrado no aparelho.' },
        app: { type: 'string', description: 'Pacote do app (ex.: com.netflix.ninja) para abrir_app/fechar_app/desinstalar/limpar.' },
        arquivo: { type: 'string', description: 'instalar: caminho do .apk; tela: .png NOVO onde salvar (padrão: ./tela-<hora>.png).' },
        tecla: { type: 'string', description: `tecla: ${Object.keys(TECLAS).join(', ')}, ou um KEYCODE_* / número.` },
        texto: { type: 'string', description: 'digitar: texto a enviar ao campo em foco no aparelho.' },
        espaco: { type: 'string', enum: ['system', 'secure', 'global'], description: 'config: área de settings.' },
        chave: { type: 'string', description: 'config: nome da configuração (sem valor = ler; com valor = gravar).' },
        valor: { type: 'string', description: 'config: valor a gravar (se ausente, apenas lê a chave).' },
        comando: { type: 'string', description: 'shell: comando livre no aparelho (adb shell). Sempre pede confirmação.' },
        porta: { type: 'integer', description: 'conectar/tcpip: porta do adb por rede (padrão adbPorta, normalmente 5555).' },
        linhas: { type: 'integer', description: 'logcat: quantas linhas finais trazer (padrão 200, máx. 2000).' },
      },
      required: ['acao'],
    },
  },
];

// ---------------------------------------------------------------------------
// Validação e montagem dos argumentos
// ---------------------------------------------------------------------------

function validarAlvo(alvo) {
  const v = String(alvo || '').trim();
  if (!v) return '';
  if (!ALVO_OK.test(v)) throw new Error(`alvo inválido: "${paraExibir(alvo)}". Use serial, ip ou ip:porta (sem espaços nem "-" no começo).`);
  return v;
}

function validarPorta(porta) {
  const n = Number(porta);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`porta inválida: "${paraExibir(porta)}" (use um número de 1 a 65535).`);
  return n;
}

function hostPorta(alvo, portaPadrao) {
  const v = validarAlvo(alvo);
  if (!v) throw new Error('informe o "alvo" (ip do aparelho) para conectar.');
  const m = /^(.*):(\d+)$/.exec(v);
  return m ? `${m[1]}:${validarPorta(m[2])}` : `${v}:${validarPorta(portaPadrao)}`;
}

/** Aspas simples para o shell POSIX do aparelho (mksh/toybox): o argumento chega literal, sem expansão. */
const aspas = (arg) => `'${String(arg).replace(/'/g, "'\\''")}'`;

/** argv de `adb shell` com cada parte entre aspas — o shell do aparelho não interpreta ; $() | & etc. */
const noAparelho = (...partes) => ['shell', partes.map(aspas).join(' ')];

/** Argumentos base com o alvo (-s) quando houver. */
function comAlvo(alvo, resto) {
  return alvo ? ['-s', alvo, ...resto] : resto;
}

/** Destino do print: .png novo, fora dos arquivos e pastas protegidos. @returns {string} caminho absoluto */
const destinoDoPrint = (arquivo) => require('./protectedPaths').destinoPngNovo(arquivo, 'tela');

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function rodarAdb(adbPath, argv, { binaria = false } = {}) {
  return new Promise((resolve) => {
    execFile(adbPath, argv, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: binaria ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        return resolve({ erro: 'adb não encontrado. Instale o android-tools (Termux: pkg install android-tools; Debian/Ubuntu: apt install adb; macOS: brew install android-platform-tools) ou aponte o caminho com: gemini-code config set-adb-path /caminho/do/adb.' });
      }
      const out = binaria ? stdout : String(stdout || '');
      const errTxt = String(stderr || '');
      if (err) {
        const motivo = err.killed ? `sem terminar em ${TIMEOUT_MS}ms (timeout)` : `exit ${err.code ?? '?'}`;
        return resolve({ erro: `adb falhou (${motivo}): ${(errTxt || (binaria ? '' : out) || err.message).toString().trim().slice(0, 2000)}` });
      }
      resolve({ stdout: out, stderr: errTxt });
    });
  });
}

function textoSaida(r, vazio = '(sem saída)') {
  if (r.erro) return r.erro;
  const s = `${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.trim();
  return s || vazio;
}

/** Ação sensível para ESTA chamada (confirma sempre). */
function ehSensivel(acao, args) {
  if (SENSIVEIS.has(acao)) return true;
  // Gravar em secure/global mexe em segurança e rede do aparelho (verificação de apps, adb, proxy...).
  return acao === 'config' && args.valor !== undefined && String(args.espaco || '').trim() !== 'system';
}

/** Uma linha dizendo o que a ação vai fazer (para a confirmação). Exibida com paraExibir. */
function descreverAcao(acao, args, alvo) {
  const onde = alvo ? ` em ${alvo}` : '';
  const texto = String(args.texto ?? '');
  switch (acao) {
    case 'parear': return `parear com ${args.alvo} (o aparelho passa a confiar nesta máquina)`;
    case 'conectar': return `conectar por rede a ${args.alvo}`;
    case 'desconectar': return `desconectar ${args.alvo || '(todos)'}`;
    case 'tcpip': return `ligar o adb por Wi-Fi na porta ${args.porta || loadConfig().adbPorta}${onde}`;
    case 'abrir_app': return `abrir o app ${args.app}${onde}`;
    case 'fechar_app': return `fechar o app ${args.app}${onde}`;
    case 'instalar': return `instalar ${args.arquivo}${onde}`;
    case 'desinstalar': return `DESINSTALAR o app ${args.app}${onde}`;
    case 'limpar': return `APAGAR os dados do app ${args.app}${onde}`;
    case 'tecla': return `enviar a tecla ${args.tecla}${onde}`;
    case 'digitar': return `digitar${onde}: "${texto.length > 300 ? `${texto.slice(0, 300)}…" (+${texto.length - 300} caracteres)` : `${texto}"`}`;
    case 'config': return `${args.valor !== undefined ? 'GRAVAR' : 'ler'} ${args.espaco}/${args.chave}${args.valor !== undefined ? ` = ${args.valor}` : ''}${onde}`;
    case 'reiniciar': return `REINICIAR o aparelho${onde}`;
    case 'shell': return `rodar no aparelho${onde}: ${args.comando}`;
    default: return `${acao}${onde}`;
  }
}

// `deps` existe só para teste: substitui a pergunta de confirmação (ask) sem abrir o terminal. Em uso
// normal (chat/CLI) ninguém passa deps e o comportamento é o mesmo.
async function execute(name, args = {}, deps = {}) {
  if (name !== 'adb') throw new Error(`Ferramenta adb desconhecida: ${name}`);
  const a = args && typeof args === 'object' ? args : {};
  const perguntar = deps.ask || ask;
  const cfg = loadConfig();
  const adbPath = cfg.adbPath || 'adb';
  const acao = String(a.acao || '').trim();
  if (!acao) return 'Erro: adb precisa de "acao".';
  if (!declarations[0].parameters.properties.acao.enum.includes(acao)) return `Erro: ação de adb desconhecida: "${paraExibir(acao)}".`;

  let alvo;
  try { alvo = validarAlvo(a.alvo || (['conectar', 'desconectar', 'parear', 'descobrir'].includes(acao) ? '' : cfg.adbSerial)); }
  catch (e) { return `Erro: ${e.message}`; }

  if (!SO_LEITURA.has(acao)) {
    const sensivel = ehSensivel(acao, a);
    const liberado = !sensivel && (cfg.adbConfirm === false || permissions.permitido('adb', a, cfg));
    if (!liberado) {
      const aviso = sensivel ? '\n[gemini-code] ATENÇÃO: ação sensível no aparelho.' : '';
      const resp = String(await perguntar(`${aviso}\n[gemini-code/adb] ${paraExibir(descreverAcao(acao, a, alvo))}\nConfirmar? (s/n) `)).trim().toLowerCase();
      if (resp !== 's' && resp !== 'y') return 'Ação de adb cancelada pelo usuário.';
    }
  }

  try {
    switch (acao) {
      case 'dispositivos': {
        const r = await rodarAdb(adbPath, ['devices', '-l']);
        return textoSaida(r, 'Nenhum aparelho. Ligue a depuração USB/por rede e confie nesta máquina; por Wi-Fi use acao:"conectar".');
      }
      case 'descobrir': {
        // Aparelhos anunciando a depuração por Wi-Fi na rede local (mDNS). Nem toda rede/roteador deixa passar.
        const r = await rodarAdb(adbPath, ['mdns', 'services']);
        if (r.erro) return r.erro;
        const achados = r.stdout.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /_adb/.test(p[1]));
        if (!achados.length) return 'Nenhum aparelho anunciando depuração por Wi-Fi. Na TV: Opções do desenvolvedor → Depuração por Wi-Fi ligada (Android 11+), ou use o IP com acao:"conectar".';
        return achados.map(([nome, tipo, end]) => `${end}  ${nome}  ${/pairing/.test(tipo) ? '(pareamento: use acao:"parear" com o código da tela)' : '(pronto para acao:"conectar")'}`).join('\n');
      }
      case 'parear': {
        // Android 11+: "Depuração por Wi-Fi" → "Parear dispositivo com código" mostra ip:porta e 6 dígitos.
        const codigo = String(a.codigo ?? '').trim();
        if (!/^\d{6}$/.test(codigo)) return 'Erro: informe "codigo" com os 6 dígitos mostrados no aparelho.';
        const v = validarAlvo(a.alvo);
        if (!/:\d+$/.test(v)) return 'Erro: informe "alvo" como ip:porta DE PAREAMENTO (aparece junto com o código; não é a porta de conectar).';
        const r = await rodarAdb(adbPath, ['pair', hostPorta(v, 0), codigo]);
        if (r.erro) return r.erro;
        return /Successfully paired/i.test(r.stdout) ? `${r.stdout.trim()}\nAgora conecte com acao:"conectar" usando o ip:porta mostrado na tela "Depuração por Wi-Fi" (outra porta).` : textoSaida(r);
      }
      case 'conectar':
        return textoSaida(await rodarAdb(adbPath, ['connect', hostPorta(a.alvo, a.porta || cfg.adbPorta)]));
      case 'desconectar':
        return textoSaida(await rodarAdb(adbPath, a.alvo ? ['disconnect', validarAlvo(a.alvo)] : ['disconnect']));
      case 'tcpip':
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['tcpip', String(validarPorta(a.porta || cfg.adbPorta))])), 'ok (agora use acao:"conectar" com o ip do aparelho).');
      case 'info': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, noAparelho('getprop')));
        if (r.erro) return r.erro;
        const prop = (k) => (r.stdout.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]:\\s*\\[(.*?)\\]`)) || [])[1] || '?';
        return `marca: ${prop('ro.product.brand')}\nmodelo: ${prop('ro.product.model')}\nAndroid: ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})\ntipo: ${prop('ro.build.characteristics')}`;
      }
      case 'apps': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, noAparelho('pm', 'list', 'packages', '-3')));
        if (r.erro) return r.erro;
        const lista = r.stdout.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).sort();
        return lista.length ? `Apps instalados pelo usuário (${lista.length}):\n${lista.join('\n')}` : 'Nenhum app de usuário listado.';
      }
      case 'estado': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, noAparelho('dumpsys', 'activity', 'activities')));
        if (r.erro) return r.erro;
        const foco = (r.stdout.match(/mResumedActivity.*?\{[^}]*\s(\S+\/\S+)/) || r.stdout.match(/mfocusedApp=.*?\s(\S+\/\S+)/) || [])[1];
        return foco ? `App em foco agora: ${foco}` : 'Não consegui identificar o app em foco (o aparelho pode estar na tela inicial).';
      }
      case 'tela': {
        const destino = destinoDoPrint(a.arquivo);
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['exec-out', 'screencap', '-p']), { binaria: true });
        if (r.erro) return r.erro;
        if (!r.stdout || !r.stdout.length) return 'Erro: o aparelho não devolveu imagem (alguns apps bloqueiam captura de tela).';
        try { fs.writeFileSync(destino, r.stdout, { flag: 'wx' }); } // wx: nunca sobrescreve um arquivo existente
        catch (e) { return e.code === 'EEXIST' ? `Erro: ${destino} já existe; escolha outro nome para o print.` : `Erro ao salvar o print: ${e.message}`; }
        return `Print salvo: ${destino} (${Math.round(r.stdout.length / 1024)} KB)`;
      }
      case 'logcat': {
        const n = Math.min(2000, Math.max(1, Math.floor(Number(a.linhas)) || 200));
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['logcat', '-d', '-t', String(n)])), '(log vazio)');
      }
      case 'abrir_app': {
        if (!PACOTE_OK.test(String(a.app || ''))) return 'Erro: informe "app" (ex.: com.netflix.ninja). Veja os instalados com acao:"apps".';
        const r = await rodarAdb(adbPath, comAlvo(alvo, noAparelho('monkey', '-p', a.app, '-c', 'android.intent.category.LAUNCHER', '1')));
        if (r.erro) return r.erro;
        // O monkey sai com 0 mesmo quando o app não existe: o motivo vem no texto.
        if (/No activities found|monkey aborted|Error:/i.test(`${r.stdout}\n${r.stderr}`)) return `Erro: não consegui abrir ${a.app} (app não instalado ou sem tela inicial). Veja os instalados com acao:"apps".`;
        return `App ${a.app} iniciado.`;
      }
      case 'fechar_app':
        if (!PACOTE_OK.test(String(a.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, noAparelho('am', 'force-stop', a.app))), `App ${a.app} fechado.`);
      case 'instalar': {
        const apk = path.resolve(String(a.arquivo || ''));
        if (!a.arquivo || path.extname(apk).toLowerCase() !== '.apk') return 'Erro: informe "arquivo" com um .apk.';
        if (!fs.existsSync(apk)) return `Erro: .apk não encontrado: ${apk}`;
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['install', '-r', apk])));
      }
      case 'desinstalar':
        if (!PACOTE_OK.test(String(a.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['uninstall', a.app])));
      case 'limpar':
        if (!PACOTE_OK.test(String(a.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, noAparelho('pm', 'clear', a.app))));
      case 'tecla': {
        const bruta = String(a.tecla || '').trim();
        const key = TECLAS[bruta.toLowerCase()] || (/^(KEYCODE_[A-Z0-9_]+|\d{1,4})$/.test(bruta) ? bruta : null);
        if (!key) return `Erro: tecla "${paraExibir(bruta)}" desconhecida. Use uma de: ${Object.keys(TECLAS).join(', ')}, ou um KEYCODE_*/número.`;
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, noAparelho('input', 'keyevent', key))), `Tecla ${bruta} enviada.`);
      }
      case 'digitar': {
        const texto = String(a.texto ?? '');
        if (!texto) return 'Erro: informe "texto".';
        if (texto.length > MAX_TEXTO) return `Erro: texto longo demais (máx. ${MAX_TEXTO} caracteres).`;
        // "input text" troca %s por espaço e não aceita espaço cru. As aspas protegem do shell do aparelho.
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, noAparelho('input', 'text', texto.replace(/ /g, '%s')))), 'Texto enviado.');
      }
      case 'config': {
        const espaco = String(a.espaco || '').trim();
        if (!ESPACOS_CONFIG.has(espaco)) return 'Erro: "espaco" deve ser system, secure ou global.';
        const chave = String(a.chave || '').trim();
        if (!CHAVE_OK.test(chave)) return 'Erro: informe uma "chave" válida (letras, números, _ e .).';
        if (a.valor === undefined) return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, noAparelho('settings', 'get', espaco, chave))));
        const r = await rodarAdb(adbPath, comAlvo(alvo, noAparelho('settings', 'put', espaco, chave, String(a.valor))));
        return r.erro ? r.erro : `settings ${espaco}/${chave} = ${a.valor}`;
      }
      case 'reiniciar':
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['reboot'])), 'Reiniciando o aparelho...');
      case 'shell': {
        const comando = String(a.comando || '').trim();
        if (!comando) return 'Erro: informe "comando" para o shell do aparelho.';
        // Comando LIVRE: o shell do aparelho interpreta de propósito (por isso confirma sempre).
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', comando])));
      }
      default:
        return `Erro: ação de adb desconhecida: "${paraExibir(acao)}".`;
    }
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

module.exports = { declarations, execute, TECLAS, validarAlvo, validarPorta, hostPorta, descreverAcao, noAparelho, SO_LEITURA, SENSIVEIS };
