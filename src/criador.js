// src/criador.js (v0.46.0) — "gemini-code criar site|app NOME" e "gemini-code criar servir PASTA"
// Gera um ponto de partida pronto e bem-feito, SEM IA (funciona offline e não gasta nada):
//   site  página responsiva (celular e PC), modo escuro, acessível, com seções e menu no celular;
//   app   PWA: instala no celular pelo navegador ("Adicionar à tela inicial"), funciona sem internet (service worker)
//         e já vem com uma lista que salva no aparelho — para o agente transformar no app que você quiser.
// Depois é só pedir ao agente: "no ./meu-site, troque as cores e escreva o texto da minha padaria".
// "servir" abre um servidor só em 127.0.0.1 para ver o site/app (o PWA precisa de http, não de file://).
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const NOME_OK = /^[a-z0-9][a-z0-9_-]{0,40}$/i;

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS_BASE = `:root { --fundo: #ffffff; --texto: #1d2329; --sutil: #5d6772; --destaque: #2563eb; --cartao: #f3f5f8; --raio: 14px; }
@media (prefers-color-scheme: dark) { :root { --fundo: #111418; --texto: #e7ebef; --sutil: #9aa5b1; --destaque: #60a5fa; --cartao: #1b2026; } }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--fundo); color: var(--texto); }
a { color: var(--destaque); }
img { max-width: 100%; height: auto; }
.container { max-width: 1040px; margin: 0 auto; padding: 0 16px; }
.botao { display: inline-block; background: var(--destaque); color: #fff; padding: 12px 20px; border-radius: 999px; text-decoration: none; font-weight: 600; border: 0; font-size: 1rem; cursor: pointer; }
.botao:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--destaque); outline-offset: 2px; }
`;

function arquivosSite({ titulo, descricao }) {
  return {
    'index.html': `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="topo">
  <div class="container barra">
    <a class="marca" href="#inicio">${esc(titulo)}</a>
    <button class="menu-botao" aria-expanded="false" aria-controls="menu">Menu</button>
    <nav id="menu" class="menu" aria-label="Principal">
      <a href="#sobre">Sobre</a>
      <a href="#servicos">Serviços</a>
      <a href="#contato">Contato</a>
    </nav>
  </div>
</header>
<main id="inicio">
  <section class="hero">
    <div class="container">
      <h1>${esc(titulo)}</h1>
      <p class="lead">${esc(descricao)}</p>
      <a class="botao" href="#contato">Fale com a gente</a>
    </div>
  </section>
  <section id="sobre" class="container secao">
    <h2>Sobre</h2>
    <p>Conte aqui a sua história: quem você é, o que faz e por que as pessoas podem confiar em você.</p>
  </section>
  <section id="servicos" class="container secao">
    <h2>Serviços</h2>
    <div class="grade">
      <article class="cartao"><h3>Serviço 1</h3><p>O que é, para quem é e quanto custa.</p></article>
      <article class="cartao"><h3>Serviço 2</h3><p>Um benefício claro, em uma ou duas frases.</p></article>
      <article class="cartao"><h3>Serviço 3</h3><p>Prova social: um depoimento ou um número.</p></article>
    </div>
  </section>
  <section id="contato" class="container secao">
    <h2>Contato</h2>
    <p>WhatsApp: (00) 00000-0000 · E-mail: contato@exemplo.com</p>
  </section>
</main>
<footer class="rodape"><div class="container">© <span id="ano"></span> ${esc(titulo)}</div></footer>
<script src="script.js"></script>
</body>
</html>
`,
    'style.css': `${CSS_BASE}
.topo { position: sticky; top: 0; background: var(--fundo); border-bottom: 1px solid rgba(127,127,127,.2); z-index: 10; }
.barra { display: flex; align-items: center; justify-content: space-between; min-height: 60px; gap: 12px; }
.marca { font-weight: 800; text-decoration: none; color: var(--texto); font-size: 1.15rem; }
.menu { display: flex; gap: 20px; }
.menu a { text-decoration: none; color: var(--texto); font-weight: 500; }
.menu-botao { display: none; background: none; border: 1px solid rgba(127,127,127,.4); color: var(--texto); border-radius: 8px; padding: 6px 12px; font-size: 1rem; }
.hero { padding: 72px 0 56px; background: linear-gradient(135deg, rgba(37,99,235,.12), transparent); }
.hero h1 { font-size: clamp(2rem, 6vw, 3.2rem); line-height: 1.1; margin: 0 0 12px; }
.lead { font-size: 1.2rem; color: var(--sutil); max-width: 40em; margin: 0 0 24px; }
.secao { padding: 48px 16px; }
.grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.cartao { background: var(--cartao); border-radius: var(--raio); padding: 20px; }
.cartao h3 { margin-top: 0; }
.rodape { padding: 32px 0; color: var(--sutil); border-top: 1px solid rgba(127,127,127,.2); }
@media (max-width: 680px) {
  .menu-botao { display: block; }
  .menu { display: none; position: absolute; top: 60px; left: 0; right: 0; flex-direction: column; background: var(--fundo); padding: 12px 16px; border-bottom: 1px solid rgba(127,127,127,.2); }
  .menu.aberto { display: flex; }
}
`,
    'script.js': `// menu do celular e o ano no rodapé
const botao = document.querySelector('.menu-botao');
const menu = document.getElementById('menu');
botao.addEventListener('click', () => {
  const aberto = menu.classList.toggle('aberto');
  botao.setAttribute('aria-expanded', String(aberto));
});
menu.addEventListener('click', (e) => { if (e.target.tagName === 'A') { menu.classList.remove('aberto'); botao.setAttribute('aria-expanded', 'false'); } });
document.getElementById('ano').textContent = new Date().getFullYear();
`,
  };
}

function arquivosApp({ titulo, descricao, nome }) {
  const curto = titulo.length > 12 ? titulo.slice(0, 12) : titulo;
  return {
    'index.html': `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<meta name="theme-color" content="#2563eb">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon.svg">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="topo"><h1>${esc(titulo)}</h1><p>${esc(descricao)}</p></header>
<main class="container">
  <form id="form" class="nova" autocomplete="off">
    <label for="texto" class="oculto">Novo item</label>
    <input id="texto" placeholder="Adicionar..." maxlength="200" required>
    <button class="botao" type="submit">Adicionar</button>
  </form>
  <ul id="lista" class="lista" aria-live="polite"></ul>
  <p id="vazio" class="vazio">Nada por aqui ainda.</p>
  <button id="instalar" class="botao secundario" hidden>Instalar o app</button>
</main>
<script src="app.js"></script>
</body>
</html>
`,
    'style.css': `${CSS_BASE}
body { padding-bottom: env(safe-area-inset-bottom); }
.topo { background: var(--destaque); color: #fff; padding: calc(20px + env(safe-area-inset-top)) 16px 20px; }
.topo h1 { margin: 0; font-size: 1.5rem; } .topo p { margin: 4px 0 0; opacity: .9; }
.container { max-width: 640px; padding-top: 16px; }
.nova { display: flex; gap: 8px; }
.nova input { flex: 1; font-size: 1rem; padding: 12px 14px; border-radius: 999px; border: 1px solid rgba(127,127,127,.4); background: var(--fundo); color: var(--texto); }
.lista { list-style: none; padding: 0; margin: 16px 0; }
.lista li { display: flex; align-items: center; gap: 12px; background: var(--cartao); border-radius: var(--raio); padding: 12px 14px; margin-bottom: 8px; }
.lista li.feito span { text-decoration: line-through; color: var(--sutil); }
.lista span { flex: 1; word-break: break-word; }
.lista input[type=checkbox] { width: 22px; height: 22px; }
.apagar { background: none; border: 0; color: var(--sutil); font-size: 1.3rem; cursor: pointer; padding: 4px 8px; }
.vazio { color: var(--sutil); text-align: center; }
.secundario { background: var(--cartao); color: var(--texto); display: block; margin: 24px auto; }
.oculto { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`,
    'app.js': `// Lista simples que fica salva NO APARELHO (localStorage) — ponto de partida para o seu app.
const CHAVE = '${nome}:itens';
const lista = document.getElementById('lista');
const vazio = document.getElementById('vazio');
let itens = [];
try { itens = JSON.parse(localStorage.getItem(CHAVE)) || []; } catch { itens = []; }

function salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch { /* sem espaço ou modo privado */ } }

function desenhar() {
  lista.replaceChildren(...itens.map((item, i) => {
    const li = document.createElement('li');
    li.className = item.feito ? 'feito' : '';
    const marca = document.createElement('input');
    marca.type = 'checkbox';
    marca.checked = item.feito;
    marca.setAttribute('aria-label', 'Concluído');
    marca.addEventListener('change', () => { itens[i].feito = marca.checked; salvar(); desenhar(); });
    const texto = document.createElement('span');
    texto.textContent = item.texto; // textContent: o que a pessoa digita nunca vira HTML
    const apagar = document.createElement('button');
    apagar.className = 'apagar';
    apagar.textContent = '×';
    apagar.setAttribute('aria-label', 'Apagar ' + item.texto);
    apagar.addEventListener('click', () => { itens.splice(i, 1); salvar(); desenhar(); });
    li.append(marca, texto, apagar);
    return li;
  }));
  vazio.hidden = itens.length > 0;
}

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const campo = document.getElementById('texto');
  const texto = campo.value.trim();
  if (!texto) return;
  itens.push({ texto, feito: false });
  campo.value = '';
  salvar();
  desenhar();
});

// "Instalar o app" quando o navegador oferecer
let pedidoInstalar = null;
const botaoInstalar = document.getElementById('instalar');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedidoInstalar = e; botaoInstalar.hidden = false; });
botaoInstalar.addEventListener('click', async () => { if (!pedidoInstalar) return; pedidoInstalar.prompt(); pedidoInstalar = null; botaoInstalar.hidden = true; });

// funciona sem internet depois da primeira visita
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

desenhar();
`,
    'sw.js': `// Service worker: guarda os arquivos do app para abrir sem internet. Mude VERSAO quando alterar os arquivos.
const VERSAO = '${nome}-v1';
const ARQUIVOS = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
`,
    'manifest.webmanifest': `${JSON.stringify({
      name: titulo, short_name: curto, description: descricao, lang: 'pt-BR', start_url: './', scope: './',
      display: 'standalone', background_color: '#ffffff', theme_color: '#2563eb',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    }, null, 2)}\n`,
    'icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#2563eb"/><text x="256" y="330" font-family="system-ui, sans-serif" font-size="260" font-weight="700" text-anchor="middle" fill="#fff">${esc(titulo.trim().charAt(0).toUpperCase() || 'A')}</text></svg>\n`,
  };
}

function readme({ tipo, titulo, nome }) {
  const app = tipo === 'app';
  return `# ${titulo}

Criado com \`gemini-code criar ${tipo}\`. ${app ? 'É um PWA: instala no celular pelo navegador e funciona sem internet.' : 'Site responsivo (celular e PC), com modo escuro.'}

## Ver no seu aparelho

\`\`\`bash
gemini-code criar servir ${nome}        # abre em http://127.0.0.1:8080 (só neste aparelho)
\`\`\`
${app ? '\nNo celular, abra o endereço no Chrome e toque em **"Instalar o app"** (ou menu ⋮ → "Adicionar à tela inicial").\n' : '\nOu abra o index.html direto no navegador.\n'}
## Personalizar com o agente

\`\`\`bash
gemini-code chat
> no ./${nome}, ${app ? 'transforme a lista num app de controle de gastos com total por mês' : 'escreva o texto da minha padaria e use tons de marrom'}
\`\`\`

## Publicar de graça

- **GitHub Pages**: suba a pasta num repositório e ative Pages (Settings → Pages).
- **Netlify Drop**: arraste a pasta em https://app.netlify.com/drop.
${app ? '\nPara instalar como app, o endereço precisa ser https (os dois acima já são).\n' : ''}`;
}

/** Cria a pasta com os arquivos. Devolve { pasta, arquivos }. */
function criar({ tipo, nome, titulo, descricao, cwd = process.cwd() }) {
  if (tipo !== 'site' && tipo !== 'app') throw new Error('tipo precisa ser "site" ou "app".');
  if (!NOME_OK.test(String(nome || ''))) throw new Error('nome da pasta: letras, números, - ou _ (até 41), ex.: minha-padaria');
  const pasta = path.resolve(cwd, nome);
  if (fs.existsSync(pasta) && fs.readdirSync(pasta).length) throw new Error(`a pasta ${nome} já existe e não está vazia — escolha outro nome.`);
  const { isProtected, isSecret } = require('./tools/protectedPaths');
  if (isProtected(pasta) || isSecret(pasta)) throw new Error('essa pasta é protegida do gemini-code.');
  const t = String(titulo || nome).replace(/\s+/g, ' ').trim().slice(0, 80);
  const d = String(descricao || (tipo === 'app' ? 'Um app simples que funciona até sem internet.' : 'Bem-vindo! Conheça o nosso trabalho.')).replace(/\s+/g, ' ').trim().slice(0, 200);
  const arquivos = { ...(tipo === 'site' ? arquivosSite({ titulo: t, descricao: d }) : arquivosApp({ titulo: t, descricao: d, nome })), 'README.md': readme({ tipo, titulo: t, nome }) };
  fs.mkdirSync(pasta, { recursive: true });
  for (const [arq, conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(pasta, arq), conteudo, { flag: 'wx' });
  return { pasta, arquivos: Object.keys(arquivos) };
}

const TIPOS_HTTP = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

/**
 * Servidor estático SÓ em 127.0.0.1: GET/HEAD, nada fora da pasta (nem por "..", nem por link), sem listar pastas,
 * arquivos e pastas com ponto (.env, .git) nunca. Pedido malformado vira 400 — não derruba o processo.
 */
function servidor(pasta) {
  let raiz;
  try { raiz = fs.realpathSync(pasta); } catch { throw new Error(`pasta não encontrada: ${pasta}`); }
  if (!fs.statSync(raiz).isDirectory()) throw new Error(`não é uma pasta: ${pasta}`);
  return http.createServer((req, res) => {
    const responder = (status, texto) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : texto); };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return responder(405, 'Método não permitido');
      let caminho;
      try { caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return responder(400, 'Endereço inválido'); }
      if (caminho.includes('\0') || caminho.split('/').some((p) => p.startsWith('.'))) return responder(404, 'Não encontrado');
      let alvo = path.join(raiz, caminho);
      if (caminho.endsWith('/')) alvo = path.join(alvo, 'index.html');
      let real;
      try { real = fs.realpathSync(alvo); } catch { return responder(404, 'Não encontrado'); }
      if (real !== raiz && !real.startsWith(raiz + path.sep)) return responder(404, 'Não encontrado');
      const st = fs.statSync(real);
      if (st.isDirectory()) {
        // v0.46.1: o endereço ia decodificado no cabeçalho — pasta com acento ("fotos-ç") dava 500, e "/%2Fimg" virava
        // "//img/", que o navegador lê como OUTRO host. Agora só os pedaços, codificados, sempre começando com uma "/".
        const destino = `/${caminho.split('/').filter(Boolean).map(encodeURIComponent).join('/')}/`;
        res.writeHead(301, { location: destino.replace(/^\/+/, '/') });
        return res.end();
      }
      res.writeHead(200, { 'content-type': TIPOS_HTTP[path.extname(real).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) responder(500, 'Erro');
      else res.destroy();
    }
  });
}

module.exports = { criar, servidor, NOME_OK, esc };
