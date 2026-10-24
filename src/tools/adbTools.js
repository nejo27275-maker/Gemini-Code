// src/tools/adbTools.js
// v0.43.0 — ADB: controlar os APARELHOS DO PRÓPRIO USUÁRIO (uma Android TV, um celular, um tablet) por
// USB ou pela rede local. É uma ferramenta de desenvolvedor padrão (o mesmo `adb` do Android SDK); serve
// para ver o que está instalado, abrir/instalar apps, navegar na TV pelo controle virtual, ajustar
// configurações e depurar. NÃO é para invadir aparelho de terceiros: o adb só conecta onde o dono já
// autorizou a depuração USB/por rede (o aparelho mostra um aviso e pede para confiar na chave).
//
// Segurança, igual ao run_shell:
//   - comandos montados como LISTA de argumentos (execFile, sem shell): nada de injeção por aspas/;/$().
//   - toda ação que MUDA o aparelho (conectar, instalar, abrir/fechar app, digitar, tecla, config, shell,
//     reiniciar) pede confirmação no terminal, a menos que adbConfirm:false ou uma regra "permitir" cubra.
//   - ações só de leitura (listar aparelhos, info, apps, estado, tela, logcat) não pedem confirmação.
//   - ações irreversíveis (reiniciar, desinstalar, limpar dados, "adb shell" destrutivo) avisam em
//     destaque e pedem confirmação mesmo com adbConfirm:false.
//   - a regra "negar" do config (src/permissions.js) continua valendo antes de tudo (vem do loop do agente).
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { ask } = require('../ui/prompt');
const permissions = require('../permissions');
const { isDestructiveCommand } = require('./shellTools');

const TIMEOUT_MS = 60000;
const MAX_BUFFER = 16 * 1024 * 1024; // screencap/logcat podem ser grandes
// Alvo = serial USB (ex.: "ABCD1234"), "ip" ou "ip:porta", "emulator-5554", ou nome mDNS. Nunca começa com
// "-" (não pode virar uma flag do adb) nem tem espaço/metacaractere (defesa extra; execFile já não usa shell).
const ALVO_OK = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const PACOTE_OK = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/; // com.exemplo.app

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

// Ações que só LEEM (não pedem confirmação).
const SO_LEITURA = new Set(['dispositivos', 'info', 'apps', 'estado', 'tela', 'logcat']);
// Ações irreversíveis/sensíveis: confirmam sempre, com aviso em destaque.
const SENSIVEIS = new Set(['reiniciar', 'desinstalar', 'limpar']);

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
          enum: ['dispositivos', 'conectar', 'desconectar', 'tcpip', 'info', 'apps', 'estado', 'tela', 'logcat',
            'abrir_app', 'fechar_app', 'instalar', 'desinstalar', 'limpar', 'tecla', 'digitar', 'config', 'reiniciar', 'shell'],
          description: 'dispositivos=lista; conectar/desconectar/tcpip=rede (Wi-Fi); info/apps/estado/tela/logcat=leitura; ' +
            'abrir_app/fechar_app/instalar/desinstalar/limpar=apps; tecla/digitar=controle; config=settings; reiniciar; shell=comando livre.',
        },
        alvo: { type: 'string', description: 'Aparelho: serial USB, "ip" ou "ip:porta" (padrão adbSerial do config; conectar/tcpip usam o ip).' },
        app: { type: 'string', description: 'Pacote do app (ex.: com.netflix.ninja) para abrir_app/fechar_app/desinstalar/limpar.' },
        arquivo: { type: 'string', description: 'instalar: caminho do .apk; tela: onde salvar o .png (padrão: ./tela-<hora>.png).' },
        tecla: { type: 'string', description: `tecla: ${Object.keys(TECLAS).join(', ')}, ou um KEYCODE_* / número.` },
        texto: { type: 'string', description: 'digitar: texto a enviar ao campo em foco no aparelho.' },
        espaco: { type: 'string', enum: ['system', 'secure', 'global'], description: 'config: área de settings.' },
        chave: { type: 'string', description: 'config: nome da configuração (sem valor = ler; com valor = gravar).' },
        valor: { type: 'string', description: 'config: valor a gravar (se ausente, apenas lê a chave).' },
        comando: { type: 'string', description: 'shell: comando a rodar no aparelho (adb shell). Pede confirmação, como o run_shell.' },
        porta: { type: 'integer', description: 'conectar/tcpip: porta do adb por rede (padrão adbPorta, normalmente 5555).' },
        linhas: { type: 'integer', description: 'logcat: quantas linhas finais trazer (padrão 200, máx. 2000).' },
      },
      required: ['acao'],
    },
  },
];

function validarAlvo(alvo) {
  const v = String(alvo || '').trim();
  if (!v) return '';
  if (!ALVO_OK.test(v)) throw new Error(`alvo inválido: "${alvo}". Use serial, ip ou ip:porta (sem espaços nem "-" no começo).`);
  return v;
}

function hostPorta(alvo, portaPadrao) {
  const v = validarAlvo(alvo);
  if (!v) throw new Error('informe o "alvo" (ip do aparelho) para conectar.');
  return v.includes(':') ? v : `${v}:${portaPadrao}`;
}

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

/** Argumentos base com o alvo (-s) quando houver. */
function comAlvo(alvo, resto) {
  return alvo ? ['-s', alvo, ...resto] : resto;
}

function textoSaida(r, vazio = '(sem saída)') {
  if (r.erro) return r.erro;
  const s = `${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.trim();
  return s || vazio;
}

// Descreve, em uma linha, o que a ação vai fazer (para a confirmação e o aviso).
function descreverAcao(acao, args, alvo) {
  const onde = alvo ? ` em ${alvo}` : '';
  switch (acao) {
    case 'conectar': return `conectar por rede a ${args.alvo}`;
    case 'desconectar': return `desconectar ${args.alvo || '(todos)'}`;
    case 'tcpip': return `ligar o adb por Wi-Fi na porta ${args.porta || loadConfig().adbPorta}${onde}`;
    case 'abrir_app': return `abrir o app ${args.app}${onde}`;
    case 'fechar_app': return `fechar o app ${args.app}${onde}`;
    case 'instalar': return `instalar ${args.arquivo}${onde}`;
    case 'desinstalar': return `DESINSTALAR o app ${args.app}${onde}`;
    case 'limpar': return `APAGAR os dados do app ${args.app}${onde}`;
    case 'tecla': return `enviar a tecla ${args.tecla}${onde}`;
    case 'digitar': return `digitar "${String(args.texto || '').slice(0, 60)}"${onde}`;
    case 'config': return `${args.valor !== undefined ? 'gravar' : 'ler'} ${args.espaco}/${args.chave}${args.valor !== undefined ? ` = ${args.valor}` : ''}${onde}`;
    case 'reiniciar': return `REINICIAR o aparelho${onde}`;
    case 'shell': return `rodar no aparelho${onde}: ${args.comando}`;
    default: return `${acao}${onde}`;
  }
}

// `deps` existe só para teste: substitui a pergunta de confirmação (ask) sem abrir o terminal. Em uso
// normal (chat/CLI) ninguém passa deps e o comportamento é o mesmo.
async function execute(name, args = {}, deps = {}) {
  if (name !== 'adb') throw new Error(`Ferramenta adb desconhecida: ${name}`);
  const perguntar = deps.ask || ask;
  const cfg = loadConfig();
  const adbPath = cfg.adbPath || 'adb';
  const acao = String(args.acao || '').trim();
  if (!acao) return 'Erro: adb precisa de "acao".';

  let alvo;
  try { alvo = validarAlvo(args.alvo || (acao === 'conectar' || acao === 'desconectar' ? '' : cfg.adbSerial)); }
  catch (e) { return `Erro: ${e.message}`; }

  // Confirmação para tudo que muda o aparelho (SO_LEITURA é liberado). Ações sensíveis confirmam
  // mesmo com adbConfirm:false; as demais respeitam adbConfirm e uma regra "permitir".
  if (!SO_LEITURA.has(acao)) {
    const sensivel = SENSIVEIS.has(acao) || (acao === 'shell' && isDestructiveCommand(String(args.comando || '')));
    const liberado = !sensivel && (cfg.adbConfirm === false || permissions.permitido('adb', args, cfg));
    if (!liberado) {
      const aviso = sensivel ? '\n[gemini-code] ATENÇÃO: ação irreversível no aparelho.' : '';
      const resp = String(await perguntar(`${aviso}\n[gemini-code/adb] ${descreverAcao(acao, args, alvo)}\nConfirmar? (s/n) `)).toLowerCase();
      if (resp !== 's' && resp !== 'y') return 'Ação de adb cancelada pelo usuário.';
    }
  }

  try {
    switch (acao) {
      case 'dispositivos': {
        const r = await rodarAdb(adbPath, ['devices', '-l']);
        return textoSaida(r, 'Nenhum aparelho. Ligue a depuração USB/por rede e confie nesta máquina; por Wi-Fi use acao:"conectar".');
      }
      case 'conectar': {
        const r = await rodarAdb(adbPath, ['connect', hostPorta(args.alvo, args.porta || cfg.adbPorta)]);
        return textoSaida(r);
      }
      case 'desconectar':
        return textoSaida(await rodarAdb(adbPath, args.alvo ? ['disconnect', validarAlvo(args.alvo)] : ['disconnect']));
      case 'tcpip':
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['tcpip', String(args.porta || cfg.adbPorta)])), 'ok (agora use acao:"conectar" com o ip do aparelho).');
      case 'info': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'getprop']));
        if (r.erro) return r.erro;
        const prop = (k) => (r.stdout.match(new RegExp(`\\[${k}\\]:\\s*\\[(.*?)\\]`)) || [])[1] || '?';
        return `marca: ${prop('ro.product.brand')}\nmodelo: ${prop('ro.product.model')}\nAndroid: ${prop('ro.build.version.release')} (API ${prop('ro.build.version.sdk')})\ntipo: ${prop('ro.build.characteristics')}`;
      }
      case 'apps': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'pm', 'list', 'packages', '-3']));
        if (r.erro) return r.erro;
        const lista = r.stdout.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).sort();
        return lista.length ? `Apps instalados pelo usuário (${lista.length}):\n${lista.join('\n')}` : 'Nenhum app de usuário listado.';
      }
      case 'estado': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'dumpsys', 'activity', 'activities']));
        if (r.erro) return r.erro;
        const foco = (r.stdout.match(/mResumedActivity.*?\{[^}]*\s(\S+\/\S+)/) || r.stdout.match(/mfocusedApp=.*?\s(\S+\/\S+)/) || [])[1];
        return foco ? `App em foco agora: ${foco}` : 'Não consegui identificar o app em foco (o aparelho pode estar na tela inicial).';
      }
      case 'tela': {
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['exec-out', 'screencap', '-p']), { binaria: true });
        if (r.erro) return r.erro;
        if (!r.stdout || !r.stdout.length) return 'Erro: o aparelho não devolveu imagem (alguns apps bloqueiam captura de tela).';
        const destino = path.resolve(String(args.arquivo || `tela-${new Date().toISOString().replace(/[:.]/g, '-')}.png`));
        fs.writeFileSync(destino, r.stdout);
        return `Print salvo: ${destino} (${Math.round(r.stdout.length / 1024)} KB)`;
      }
      case 'logcat': {
        const n = Math.min(2000, Math.max(1, Math.floor(Number(args.linhas)) || 200));
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['logcat', '-d', '-t', String(n)]));
        return textoSaida(r, '(log vazio)');
      }
      case 'abrir_app': {
        if (!PACOTE_OK.test(String(args.app || ''))) return 'Erro: informe "app" (ex.: com.netflix.ninja). Veja os instalados com acao:"apps".';
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'monkey', '-p', args.app, '-c', 'android.intent.category.LAUNCHER', '1']));
        return r.erro ? r.erro : `App ${args.app} iniciado.`;
      }
      case 'fechar_app':
        if (!PACOTE_OK.test(String(args.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'am', 'force-stop', args.app])), `App ${args.app} fechado.`);
      case 'instalar': {
        const apk = path.resolve(String(args.arquivo || ''));
        if (!args.arquivo || !fs.existsSync(apk)) return `Erro: .apk não encontrado: ${args.arquivo}`;
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['install', '-r', apk]));
        return textoSaida(r);
      }
      case 'desinstalar':
        if (!PACOTE_OK.test(String(args.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['uninstall', args.app])));
      case 'limpar':
        if (!PACOTE_OK.test(String(args.app || ''))) return 'Erro: informe "app".';
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'pm', 'clear', args.app])));
      case 'tecla': {
        const bruta = String(args.tecla || '').trim();
        const key = TECLAS[bruta.toLowerCase()] || (/^(KEYCODE_[A-Z0-9_]+|\d{1,4})$/.test(bruta) ? bruta : null);
        if (!key) return `Erro: tecla "${args.tecla}" desconhecida. Use uma de: ${Object.keys(TECLAS).join(', ')}, ou um KEYCODE_*/número.`;
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'input', 'keyevent', key])), `Tecla ${bruta} enviada.`);
      }
      case 'digitar': {
        const texto = String(args.texto ?? '');
        if (!texto) return 'Erro: informe "texto".';
        // input text não aceita espaço cru; o Android usa %s. Vai como UM argumento (sem shell).
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'input', 'text', texto.replace(/ /g, '%s')])), 'Texto enviado.');
      }
      case 'config': {
        const espaco = String(args.espaco || '').trim();
        if (!ESPACOS_CONFIG.has(espaco)) return 'Erro: "espaco" deve ser system, secure ou global.';
        if (!args.chave) return 'Erro: informe "chave".';
        const chave = String(args.chave).trim();
        if (!/^[A-Za-z0-9_.]+$/.test(chave)) return 'Erro: "chave" inválida.';
        if (args.valor === undefined) return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'settings', 'get', espaco, chave])));
        const r = await rodarAdb(adbPath, comAlvo(alvo, ['shell', 'settings', 'put', espaco, chave, String(args.valor)]));
        return r.erro ? r.erro : `settings ${espaco}/${chave} = ${args.valor}`;
      }
      case 'reiniciar':
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['reboot'])), 'Reiniciando o aparelho...');
      case 'shell': {
        const comando = String(args.comando || '').trim();
        if (!comando) return 'Erro: informe "comando" para o shell do aparelho.';
        // Vai como um único argumento para `adb shell`, que o repassa ao shell DO APARELHO (não ao desta máquina).
        return textoSaida(await rodarAdb(adbPath, comAlvo(alvo, ['shell', comando])));
      }
      default:
        return `Erro: ação de adb desconhecida: "${acao}".`;
    }
  } catch (e) {
    return `Erro: ${e.message}`;
  }
}

module.exports = { declarations, execute, TECLAS, validarAlvo, hostPorta, descreverAcao, SO_LEITURA, SENSIVEIS };
