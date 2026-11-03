// src/computador.js (v0.47.0) — usar o computador/notebook como uma pessoa: print da tela, mouse, teclado, janelas.
// Linux (X11: xdotool + import/scrot/maim/gnome-screenshot; Wayland: grim + ydotool), macOS (screencapture, osascript e
// cliclick) e Windows (PowerShell). Tudo por argumento (execFile), nunca por uma linha de shell: o texto digitado e o
// título de uma janela não são interpretados. Cada sistema monta os comandos numa função PURA (comandos()), testada
// sem precisar da tela de verdade.
//
// O que NÃO faz: rodar um programa qualquer pelo nome ("abrir" aceita site, arquivo/pasta e app instalado — comando é
// com o run_shell, que tem a sandbox). Quem chama (src/tools/computadorTools.js) pergunta antes de cada ação.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_TEXTO = 2000;
const MAX_COORD = 20000; // vários monitores lado a lado
const TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Teclas: um nome amigável (pt/en) -> o nome em cada sistema
// ---------------------------------------------------------------------------

const MODIFICADORES = { ctrl: 'ctrl', control: 'ctrl', controle: 'ctrl', alt: 'alt', option: 'alt', opcao: 'alt', shift: 'shift', maiusculas: 'shift', super: 'super', windows: 'super', win: 'super', cmd: 'cmd', command: 'cmd', comando: 'cmd', meta: 'super' };
const NOMEADAS = {
  enter: 'enter', return: 'enter', tab: 'tab', esc: 'esc', escape: 'esc', espaco: 'space', space: 'space',
  backspace: 'backspace', apagar: 'backspace', delete: 'delete', del: 'delete', excluir: 'delete',
  cima: 'up', up: 'up', baixo: 'down', down: 'down', esquerda: 'left', left: 'left', direita: 'right', right: 'right',
  home: 'home', inicio: 'home', end: 'end', fim: 'end', pgup: 'pageup', pageup: 'pageup', pgdn: 'pagedown', pagedown: 'pagedown',
  printscreen: 'print', print: 'print',
};
for (let i = 1; i <= 12; i++) NOMEADAS[`f${i}`] = `f${i}`;

const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "ctrl+shift+t" -> { mods: ['ctrl','shift'], tecla: 't' }. Lança Error com a lista do que vale. */
function lerCombinacao(combo) {
  const partes = semAcento(combo).split(/\s*\+\s*/).filter(Boolean);
  if (!partes.length || partes.length > 4) throw new Error('"tecla" é uma tecla ou combinação, ex.: enter, ctrl+c, alt+tab, super, ctrl+shift+t.');
  const mods = [];
  let tecla = null;
  for (const p of partes) {
    if (Object.prototype.hasOwnProperty.call(MODIFICADORES, p)) { const m = MODIFICADORES[p]; if (!mods.includes(m)) mods.push(m); continue; }
    if (tecla) throw new Error(`"${combo}": só uma tecla além de ctrl/alt/shift/super/cmd.`);
    if (Object.prototype.hasOwnProperty.call(NOMEADAS, p)) tecla = NOMEADAS[p];
    else if (/^[a-z0-9]$/.test(p)) tecla = p;
    else throw new Error(`tecla desconhecida: "${p}". Valem: letras, números, ${Object.keys(NOMEADAS).filter((k, i, l) => l.indexOf(k) === i).slice(0, 30).join(', ')}..., e ctrl/alt/shift/super/cmd.`);
  }
  if (!tecla && mods.length === 1) return { mods: [], tecla: mods[0] }; // "super" sozinho abre o menu
  if (!tecla) throw new Error(`"${combo}": falta a tecla (ex.: ctrl+c).`);
  return { mods, tecla };
}

// Linux (xdotool) usa keysyms do X
const XKEY = { enter: 'Return', tab: 'Tab', esc: 'Escape', space: 'space', backspace: 'BackSpace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', print: 'Print', ctrl: 'ctrl', alt: 'alt', shift: 'shift', super: 'super', cmd: 'super' };
const xkey = (t) => XKEY[t] || (/^f\d+$/.test(t) ? t.toUpperCase() : t);

// macOS: key codes (teclas sem letra) e os modificadores do AppleScript
const MAC_CODIGO = { enter: 36, tab: 48, esc: 53, space: 49, backspace: 51, delete: 117, up: 126, down: 125, left: 123, right: 124, home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 };
const MAC_MOD = { ctrl: 'control down', alt: 'option down', shift: 'shift down', cmd: 'command down', super: 'command down' };

// Windows: virtual-key codes (keybd_event)
const VK = { ctrl: 0x11, alt: 0x12, shift: 0x10, super: 0x5b, cmd: 0x5b, enter: 0x0d, tab: 0x09, esc: 0x1b, space: 0x20, backspace: 0x08, delete: 0x2e, up: 0x26, down: 0x28, left: 0x25, right: 0x27, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, print: 0x2c };
const vk = (t) => VK[t] ?? (/^f(\d+)$/.test(t) ? 0x6f + Number(t.slice(1)) : t.toUpperCase().charCodeAt(0));

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function coordenada(v, nome) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isInteger(n) || n < 0 || n > MAX_COORD) throw new Error(`"${nome}" precisa ser um número inteiro de 0 a ${MAX_COORD} (pixels da tela).`);
  return n;
}

function textoValido(v) {
  if (typeof v !== 'string' || !v) throw new Error('informe o "texto".');
  if (v.includes('\0')) throw new Error('o texto tem um caractere nulo.');
  if (v.length > MAX_TEXTO) throw new Error(`texto longo demais (máx. ${MAX_TEXTO}).`);
  return v;
}

const BOTOES = { esquerdo: 1, left: 1, meio: 2, middle: 2, direito: 3, right: 3 };

// ---------------------------------------------------------------------------
// Onde estamos: sistema, tela gráfica e programas disponíveis
// ---------------------------------------------------------------------------

function temComandoPadrao(nome, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
    try { const p = path.join(dir, nome); fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return true; } catch { /* segue */ }
  }
  return false;
}

/** { plataforma, sessao: 'x11'|'wayland'|'mac'|'windows'|null, faltando: [...] } */
function ambiente({ plataforma = process.platform, env = process.env, temComando = (n) => temComandoPadrao(n, env) } = {}) {
  if (plataforma === 'darwin') return { plataforma, sessao: 'mac', mouse: temComando('cliclick'), print: true };
  if (plataforma === 'win32') return { plataforma, sessao: 'windows', mouse: true, print: true };
  if (plataforma === 'linux') {
    const wayland = Boolean(env.WAYLAND_DISPLAY) && (env.XDG_SESSION_TYPE === 'wayland' || !env.DISPLAY);
    if (wayland) {
      return { plataforma, sessao: 'wayland', mouse: temComando('ydotool'), print: temComando('grim') ? 'grim' : null };
    }
    if (env.DISPLAY) {
      const print = ['import', 'maim', 'scrot', 'gnome-screenshot'].find((n) => temComando(n)) || null;
      return { plataforma, sessao: 'x11', mouse: temComando('xdotool'), print, janelas: temComando('wmctrl') ? 'wmctrl' : (temComando('xdotool') ? 'xdotool' : null) };
    }
  }
  return { plataforma, sessao: null };
}

const SEM_TELA = 'Esta sessão não tem tela gráfica (SSH, Termux ou servidor). No celular, use a ferramenta adb (ui/tocar/deslizar); para o PC, rode o gemini-code no próprio computador (ou mande a tarefa pelo cowork).';

function dicaInstalar(amb, o) {
  if (amb.sessao === 'x11') return o === 'print' ? 'Instale o ImageMagick (sudo apt install imagemagick) ou o scrot.' : 'Instale o xdotool (sudo apt install xdotool).';
  if (amb.sessao === 'wayland') return o === 'print' ? 'Instale o grim (sudo apt install grim).' : 'No Wayland, mouse e teclado precisam do ydotool com o serviço ydotoold rodando (ou entre numa sessão X11).';
  if (amb.sessao === 'mac') return 'Para clicar, instale o cliclick: brew install cliclick. (Dê ao Terminal as permissões de Acessibilidade e de Gravação de Tela, em Ajustes do Sistema → Privacidade e Segurança.)';
  return '';
}

// ---------------------------------------------------------------------------
// Comandos de cada sistema — PURO: devolve [{ arquivo, args }] (sem rodar nada)
// ---------------------------------------------------------------------------

// PowerShell: string entre aspas simples (o '' é o escape) e o script em base64 UTF-16LE (-EncodedCommand), sem shell
const psAspas = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ps = (script) => ({ arquivo: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] });
const PS_USER32 = "Add-Type -Namespace GC -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,int e); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte k,byte s,uint f,int e);'";

// SendKeys: + ^ % ~ ( ) { } [ ] são especiais — cada um vai entre chaves
const sendKeysLiteral = (t) => t.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, '{ENTER}');

// AppleScript recebe o texto por argumento (item 1 of argv) — nunca dentro do código. O argumento vai com o prefixo
// "T:" (tirado no script): um texto começando com "-e" seria lido pelo osascript como OUTRO comando AppleScript.
const osa = (linhas, argv = []) => ({ arquivo: 'osascript', args: [...linhas.flatMap((l) => ['-e', l]), ...argv.map((x) => `T:${x}`)] });
const ARG1 = '(text 3 thru -1 of (item 1 of argv))';

/**
 * @param {string} acao clicar | mover | digitar | tecla | rolar | tela | janelas | focar
 * @returns {{ arquivo: string, args: string[] }[]}
 */
function comandos(acao, a, amb, { saida } = {}) {
  const s = amb.sessao;
  if (!s) throw new Error(SEM_TELA);
  switch (acao) {
    case 'tela': {
      if (s === 'mac') return [{ arquivo: 'screencapture', args: ['-x', saida] }];
      if (s === 'windows') {
        return [ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Left,$b.Top,0,0,$i.Size); $i.Save(${psAspas(saida)},[System.Drawing.Imaging.ImageFormat]::Png)`)];
      }
      if (!amb.print) throw new Error(`Sem programa de print da tela. ${dicaInstalar(amb, 'print')}`);
      if (amb.print === 'grim') return [{ arquivo: 'grim', args: [saida] }];
      if (amb.print === 'import') return [{ arquivo: 'import', args: ['-window', 'root', `png:${saida}`] }];
      if (amb.print === 'maim') return [{ arquivo: 'maim', args: [saida] }];
      if (amb.print === 'scrot') return [{ arquivo: 'scrot', args: ['--overwrite', saida] }];
      return [{ arquivo: 'gnome-screenshot', args: ['-f', saida] }];
    }
    case 'janelas': {
      if (s === 'mac') return [osa(['tell application "System Events" to get name of every process whose background only is false'])];
      if (s === 'windows') return [ps("Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { \"$($_.ProcessName): $($_.MainWindowTitle)\" }")];
      if (s === 'wayland') throw new Error('No Wayland não dá para listar as janelas de outros apps (é uma regra de segurança do próprio Wayland).');
      if (amb.janelas === 'wmctrl') return [{ arquivo: 'wmctrl', args: ['-l'] }];
      if (amb.janelas === 'xdotool') return [{ arquivo: 'xdotool', args: ['search', '--onlyvisible', '--name', '.', 'getwindowname', '%@'] }];
      throw new Error('Instale o wmctrl (sudo apt install wmctrl) para listar as janelas.');
    }
    case 'focar': {
      const titulo = textoValido(a.titulo || a.texto).slice(0, 200);
      if (s === 'mac') return [osa(['on run argv', `tell application ${ARG1} to activate`, 'end run'], [titulo])];
      if (s === 'windows') return [ps(`$ok=(New-Object -ComObject WScript.Shell).AppActivate(${psAspas(titulo)}); if (-not $ok) { exit 1 }`)];
      if (s === 'wayland') throw new Error('No Wayland, trocar de janela é com o teclado: tecla "alt+tab" ou "super".');
      if (titulo.startsWith('-')) throw new Error('o título não pode começar com "-".');
      if (amb.janelas === 'wmctrl') return [{ arquivo: 'wmctrl', args: ['-a', titulo] }];
      return [{ arquivo: 'xdotool', args: ['search', '--onlyvisible', '--name', titulo, 'windowactivate'] }];
    }
    default: break;
  }
  // mouse e teclado
  if (!amb.mouse) throw new Error(`Sem programa para mouse/teclado. ${dicaInstalar(amb, 'mouse')}`);
  switch (acao) {
    case 'clicar':
    case 'mover': {
      const x = coordenada(a.x, 'x');
      const y = coordenada(a.y, 'y');
      const botao = a.botao === undefined || a.botao === null || a.botao === '' ? 1 : BOTOES[semAcento(a.botao)];
      if (!botao) throw new Error('"botao": esquerdo, direito ou meio.');
      const duplo = a.duplo === true;
      if (s === 'mac') {
        if (acao === 'mover') return [{ arquivo: 'cliclick', args: [`m:${x},${y}`] }];
        return [{ arquivo: 'cliclick', args: [`${duplo ? 'dc' : botao === 3 ? 'rc' : 'c'}:${x},${y}`] }];
      }
      if (s === 'windows') {
        const [baixo, cima] = botao === 3 ? [0x0008, 0x0010] : botao === 2 ? [0x0020, 0x0040] : [0x0002, 0x0004];
        const clique = `[GC.U]::mouse_event(${baixo},0,0,0,0); [GC.U]::mouse_event(${cima},0,0,0,0)`;
        return [ps(`${PS_USER32}; [GC.U]::SetCursorPos(${x},${y}) | Out-Null${acao === 'clicar' ? `; ${clique}${duplo ? `; Start-Sleep -Milliseconds 60; ${clique}` : ''}` : ''}`)];
      }
      if (s === 'wayland') {
        const mov = { arquivo: 'ydotool', args: ['mousemove', '--absolute', '-x', String(x), '-y', String(y)] };
        if (acao === 'mover') return [mov];
        const codigo = botao === 3 ? '0xC1' : botao === 2 ? '0xC2' : '0xC0';
        return [mov, { arquivo: 'ydotool', args: ['click', ...(duplo ? ['--repeat', '2'] : []), codigo] }];
      }
      return [{ arquivo: 'xdotool', args: ['mousemove', '--sync', String(x), String(y), ...(acao === 'clicar' ? ['click', ...(duplo ? ['--repeat', '2'] : []), String(botao)] : [])] }];
    }
    case 'digitar': {
      const texto = textoValido(a.texto);
      if (s === 'mac') return [osa(['on run argv', `tell application "System Events" to keystroke ${ARG1}`, 'end run'], [texto])];
      if (s === 'windows') return [ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psAspas(sendKeysLiteral(texto))})`)];
      if (s === 'wayland') return [{ arquivo: 'ydotool', args: ['type', '--', texto] }];
      return [{ arquivo: 'xdotool', args: ['type', '--delay', '12', '--', texto] }];
    }
    case 'tecla': {
      const { mods, tecla } = lerCombinacao(a.tecla);
      if (s === 'mac') {
        const usando = mods.length ? ` using {${mods.map((m) => MAC_MOD[m]).join(', ')}}` : '';
        if (Object.prototype.hasOwnProperty.call(MAC_CODIGO, tecla)) return [osa([`tell application "System Events" to key code ${MAC_CODIGO[tecla]}${usando}`])];
        if (/^[a-z0-9]$/.test(tecla)) return [osa([`tell application "System Events" to keystroke "${tecla}"${usando}`])];
        if (tecla === 'super' || tecla === 'cmd') return [osa(['tell application "System Events" to key code 49 using {command down}'])]; // Spotlight
        throw new Error(`a tecla "${tecla}" não existe no Mac.`);
      }
      if (s === 'windows') {
        const ordem = [...mods.map(vk), vk(tecla)];
        const desce = ordem.map((c) => `[GC.U]::keybd_event(${c},0,0,0)`).join('; ');
        const sobe = [...ordem].reverse().map((c) => `[GC.U]::keybd_event(${c},0,2,0)`).join('; ');
        return [ps(`${PS_USER32}; ${desce}; ${sobe}`)];
      }
      if (s === 'wayland') return [{ arquivo: 'ydotool', args: ['key', [...mods, tecla].map(xkey).join('+')] }];
      return [{ arquivo: 'xdotool', args: ['key', '--clearmodifiers', [...mods, tecla].map(xkey).join('+')] }];
    }
    case 'rolar': {
      const dir = semAcento(a.direcao || 'baixo');
      if (!['cima', 'baixo', 'esquerda', 'direita'].includes(dir)) throw new Error('"direcao": cima, baixo, esquerda ou direita.');
      const n = a.quantidade === undefined || a.quantidade === null || a.quantidade === '' ? 3 : Number(a.quantidade);
      if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('"quantidade" vai de 1 a 20.');
      if (s === 'mac') {
        const codigo = { cima: 116, baixo: 121, esquerda: 123, direita: 124 }[dir]; // Page Up/Down, setas
        return Array.from({ length: Math.min(n, 5) }, () => osa([`tell application "System Events" to key code ${codigo}`]));
      }
      if (s === 'windows') {
        const [flag, dado] = dir === 'cima' ? [0x0800, 120 * n] : dir === 'baixo' ? [0x0800, -120 * n] : dir === 'direita' ? [0x01000, 120 * n] : [0x01000, -120 * n];
        return [ps(`${PS_USER32}; [GC.U]::mouse_event(${flag},0,0,${dado},0)`)];
      }
      if (s === 'wayland') {
        const eixo = dir === 'cima' || dir === 'baixo' ? '-y' : '-x';
        const passo = dir === 'cima' || dir === 'esquerda' ? -n : n;
        return [{ arquivo: 'ydotool', args: ['mousemove', '--wheel', eixo, String(passo)] }];
      }
      return [{ arquivo: 'xdotool', args: ['click', '--repeat', String(n), { cima: '4', baixo: '5', esquerda: '6', direita: '7' }[dir]] }];
    }
    default:
      throw new Error(`ação desconhecida: ${acao}`);
  }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function rodarUm({ arquivo, args }, { execFileFn = execFile } = {}) {
  return new Promise((resolve) => {
    try {
      execFileFn(arquivo, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') return resolve({ erro: `não achei o programa "${arquivo}".` });
        if (err) return resolve({ erro: `${arquivo} falhou: ${String(stderr || err.message).trim().slice(0, 300)}` });
        resolve({ saida: String(stdout || '') });
      });
    } catch (e) { resolve({ erro: e.message }); }
  });
}

/** Roda a ação. Devolve { ok, texto, arquivo? } — nunca lança. */
async function executar(acao, a = {}, { amb = ambiente(), execFileFn, cwd = process.cwd() } = {}) {
  try {
    if (acao === 'abrir') return await abrir(a.alvo, { amb, execFileFn, cwd });
    let saida;
    if (acao === 'tela') {
      saida = require('./tools/protectedPaths').destinoPngNovo(a.arquivo ? path.resolve(cwd, a.arquivo) : path.join(cwd, `tela-pc-${new Date().toISOString().replace(/[:.]/g, '-')}.png`), 'tela-pc');
      if (fs.existsSync(saida)) return { ok: false, texto: `Erro: ${saida} já existe; escolha outro nome.` };
    }
    const passos = comandos(acao, a, amb, { saida });
    let ultima = '';
    for (const p of passos) {
      const r = await rodarUm(p, { execFileFn });
      if (r.erro) return { ok: false, texto: `Erro: ${r.erro}${/não achei o programa/.test(r.erro) ? ` ${dicaInstalar(amb, acao === 'tela' ? 'print' : 'mouse')}` : ''}` };
      ultima = r.saida;
    }
    switch (acao) {
      case 'tela': {
        if (!fs.existsSync(saida)) return { ok: false, texto: 'Erro: o print não foi gerado (no Mac: dê ao Terminal a permissão de Gravação de Tela).' };
        return { ok: true, arquivo: saida, texto: `Print da tela salvo: ${saida} (${Math.round(fs.statSync(saida).size / 1024)} KB). Para ver o que tem nele (e onde clicar), use a ferramenta imagem com acao "descrever".${amb.sessao === 'mac' ? ' Em tela Retina, as posições do print são o dobro das do clique (divida por 2).' : ''}` };
      }
      case 'janelas': {
        const linhas = ultima.split(/\r?\n|, /).map((l) => l.trim()).filter(Boolean).slice(0, 80);
        return { ok: true, texto: linhas.length ? `[títulos de janelas — podem conter texto de terceiros]\n${linhas.join('\n')}` : 'Nenhuma janela listada.' };
      }
      case 'clicar': return { ok: true, texto: `Cliquei${a.duplo === true ? ' duas vezes' : ''} em ${a.x},${a.y}.` };
      case 'mover': return { ok: true, texto: `Mouse em ${a.x},${a.y}.` };
      case 'digitar': return { ok: true, texto: `Digitei ${String(a.texto).length} caractere(s).` };
      case 'tecla': return { ok: true, texto: `Tecla ${a.tecla} enviada.` };
      case 'rolar': return { ok: true, texto: `Rolei para ${a.direcao || 'baixo'}.` };
      case 'focar': return { ok: true, texto: `Janela "${a.titulo || a.texto}" em primeiro plano.` };
      default: return { ok: true, texto: 'Feito.' };
    }
  } catch (e) {
    return { ok: false, texto: `Erro: ${e.message}` };
  }
}

/** "abrir": site (http/https), arquivo/pasta que existe, ou app instalado pelo nome — nunca um comando. */
async function abrir(alvo, { amb, execFileFn, cwd }) {
  const bruto = typeof alvo === 'string' ? alvo.trim() : '';
  if (!bruto) return { ok: false, texto: 'Erro: informe o "alvo": um site (https://...), um arquivo/pasta ou o nome de um app.' };
  const { abrir: abrirPadrao } = require('./abrir');
  const viaPadrao = (x) => abrirPadrao(x, execFileFn ? { execFileFn } : {});
  if (/^https?:\/\//i.test(bruto)) {
    let u;
    try { u = new URL(bruto); } catch { return { ok: false, texto: 'Erro: endereço inválido.' }; }
    if (u.username || u.password) return { ok: false, texto: 'Erro: não ponha usuário/senha no endereço.' };
    return (await viaPadrao(u.href)) ? { ok: true, texto: `Abrindo ${u.href}` } : { ok: false, texto: 'Erro: não consegui abrir o navegador.' };
  }
  const caminho = path.resolve(cwd, bruto.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (fs.existsSync(caminho)) {
    const { isSecret } = require('./tools/protectedPaths');
    if (isSecret(caminho)) return { ok: false, texto: 'Erro: esse arquivo é protegido do gemini-code.' };
    return (await viaPadrao(caminho)) ? { ok: true, texto: `Abrindo ${caminho}` } : { ok: false, texto: 'Erro: não consegui abrir.' };
  }
  // app pelo nome: só como app instalado (macOS "open -a"; Linux um .desktop que existe) — nunca rodar o nome como comando
  if (!/^[\p{L}\p{N} ._-]{1,80}$/u.test(bruto) || bruto.startsWith('-')) return { ok: false, texto: 'Erro: nome de app inválido.' };
  if (amb.sessao === 'mac') {
    const r = await rodarUm({ arquivo: 'open', args: ['-a', bruto] }, { execFileFn });
    return r.erro ? { ok: false, texto: `Erro: não achei o app "${bruto}".` } : { ok: true, texto: `Abrindo o app ${bruto}.` };
  }
  if (amb.sessao === 'x11' || amb.sessao === 'wayland') {
    const id = semAcento(bruto).replace(/\s+/g, '-');
    const pastas = ['/usr/share/applications', '/usr/local/share/applications', path.join(os.homedir(), '.local/share/applications'), '/var/lib/flatpak/exports/share/applications', '/var/lib/snapd/desktop/applications'];
    let desktop = null;
    for (const p of pastas) {
      let nomes;
      try { nomes = fs.readdirSync(p).filter((n) => n.endsWith('.desktop')); } catch { continue; }
      desktop = nomes.find((n) => semAcento(n.slice(0, -8)) === id) || nomes.find((n) => semAcento(n.slice(0, -8)).split('.').pop() === id) || null;
      if (desktop) break;
    }
    if (desktop) {
      const r = await rodarUm({ arquivo: 'gtk-launch', args: [desktop.slice(0, -8)] }, { execFileFn });
      if (!r.erro) return { ok: true, texto: `Abrindo o app ${desktop.slice(0, -8)}.` };
    }
  }
  return { ok: false, texto: `Erro: não achei o app "${bruto}". Pelo teclado funciona em qualquer sistema: tecla "super", digitar "${bruto}" e tecla "enter".` };
}

/** Uma linha dizendo o que a ação vai fazer (para a confirmação; quem mostra passa por paraExibir). */
function descrever(acao, a) {
  switch (acao) {
    case 'tela': return 'tirar um print da TELA INTEIRA do computador (o que estiver aberto vai para o modelo ver)';
    case 'clicar': return `clicar${a.duplo === true ? ' duas vezes' : ''}${a.botao && semAcento(a.botao) !== 'esquerdo' ? ` com o botão ${a.botao}` : ''} em ${a.x},${a.y}`;
    case 'mover': return `mover o mouse para ${a.x},${a.y}`;
    case 'digitar': { const t = String(a.texto ?? ''); return `digitar: "${t.length > 300 ? `${t.slice(0, 300)}…" (+${t.length - 300})` : `${t}"`}`; }
    case 'tecla': return `apertar ${a.tecla}`;
    case 'rolar': return `rolar para ${a.direcao || 'baixo'}${a.quantidade ? ` (${a.quantidade}x)` : ''}`;
    case 'focar': return `trazer para a frente a janela "${a.titulo || a.texto}"`;
    case 'abrir': return `abrir ${a.alvo}`;
    default: return acao;
  }
}

/** O comando como se escreve (para as regras "permitir"/"negar": "computador(tecla ctrl+c)"). */
function textoDaAcao(acao, a = {}) {
  const partes = [acao];
  for (const c of ['x', 'y', 'tecla', 'direcao', 'titulo', 'alvo', 'texto']) if (a[c] !== undefined && a[c] !== null && a[c] !== '') partes.push(String(a[c]));
  return partes.join(' ');
}

module.exports = { ambiente, comandos, executar, descrever, textoDaAcao, lerCombinacao, sendKeysLiteral, SEM_TELA, dicaInstalar, MAX_TEXTO };
