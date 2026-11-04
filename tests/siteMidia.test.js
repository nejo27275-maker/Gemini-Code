'use strict';
// v0.51.0: foto, vídeo e áudio no modo site — /api/enviar (o arquivo cru), /api/midia (só o que o servidor
// registrou), o evento "midia" com o que as ferramentas criaram, o histórico com as mídias de volta, a ferramenta
// "video" ligada só nesta execução, e a página de verdade num Chrome/Chromium (mandar uma foto e ver o resultado).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-sitemidia-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const test = require('node:test');
const assert = require('node:assert/strict');
const site = require('../src/site/servidor');
const midiaGerada = require('../src/midiaGerada');

const TOKEN = 'token-de-teste-midia-1234567890';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(200, 7)]);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const fechar = [];
test.afterEach(async () => { while (fechar.length) await fechar.pop()(); });
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

let n = 0;
async function subir(opcoes = {}) {
  const pasta = fs.mkdtempSync(path.join(HOME, `proj-${n++}-`));
  const ligadas = [];
  const s = site.criarServidorSite({ token: TOKEN, pasta, ligarFerramenta: (nome) => { ligadas.push(nome); return true; }, ...opcoes });
  await new Promise((r) => s.servidor.listen(0, '127.0.0.1', r));
  fechar.push(() => new Promise((r) => s.servidor.close(r)));
  return { ...s, porta: s.servidor.address().port, pasta, ligadas, recebida: path.join(fs.realpathSync(pasta), site.PASTA_RECEBIDA) };
}

function pedir(porta, { metodo = 'POST', caminho = '/', headers = {}, corpo } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { host: `127.0.0.1:${porta}`, ...headers } }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bruto: Buffer.concat(partes), corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', reject);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}
const enviar = (porta, corpo, { tipo = 'image/png', nome = 'foto.png', headers = {} } = {}) => pedir(porta, {
  caminho: '/api/enviar', corpo, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': tipo, 'x-nome': encodeURIComponent(nome), ...headers },
});
const api = (porta, caminho, obj) => pedir(porta, { caminho, corpo: JSON.stringify(obj), headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` } });
const json = (r) => JSON.parse(r.corpo);
const eventos = (r) => r.corpo.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sobras = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('.recebendo-')) : []);

test('CSP: as prévias (blob:) podem aparecer; nada de fora', () => {
  assert.match(site.CSP, /img-src 'self' data: blob:/);
  assert.match(site.CSP, /media-src 'self' blob: mediastream:/);
  assert.match(site.CSP, /default-src 'none'/);
});

test('nome do arquivo recebido: só o nome, sem controles nem caracteres proibidos, e a extensão vem do TIPO', () => {
  const casos = [
    ['foto.png', '.png', 'foto.png'], ['../../etc/passwd', '.jpg', 'passwd.jpg'], ['..%2F..%2Fx.png', '.png', 'x.png'],
    ['C:\\Users\\a\\IMG_1234.HEIC', '.jpg', 'IMG_1234.jpg'], ['foto.html', '.jpg', 'foto.jpg'], ['.bashrc', '.png', 'arquivo.png'],
    ['-rf --no-preserve-root', '.mp4', 'rf --no-preserve-root.mp4'], ['CON', '.png', '_CON.png'], ['%E2%80%AEgpj.exe', '.jpg', 'gpj.jpg'],
    ['a<b>:c"d|e?f*g%h#i', '.png', 'a_b__c_d_e_f_g_h_i.png'], ['linha\nquebrada\u0007.png', '.png', 'linhaquebrada.png'], ['', '.mov', 'arquivo.mov'],
    ['%ZZ inválido.png', '.png', '_ZZ inválido.png'], ['ac\u0327a\u0303o.png', '.png', 'ação.png'],
  ];
  for (const [bruto, ext, esperado] of casos) assert.equal(site.nomeDoEnvio(bruto, ext), esperado, JSON.stringify(bruto));
  assert.equal(site.nomeDoEnvio(encodeURIComponent('férias 2026 ☀️.jpg'), '.jpg'), 'férias 2026 ☀️.jpg', 'a página manda em encodeURIComponent');
  assert.equal(site.nomeDoEnvio('x'.repeat(300), '.png'), `${'x'.repeat(80)}.png`);
});

test('primeiros bytes: cada tipo confere com o conteúdo de verdade', () => {
  assert.equal(site.assinaturaOk('.png', PNG), true);
  assert.equal(site.assinaturaOk('.mp4', MP4), true);
  assert.equal(site.assinaturaOk('.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])), true);
  assert.equal(site.assinaturaOk('.png', Buffer.from('<html><script>alert(1)</script>')), false, 'HTML chamado de PNG');
  assert.equal(site.assinaturaOk('.mp4', PNG), false);
  assert.equal(site.assinaturaOk('.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])), true);
  assert.equal(site.assinaturaOk('.png', Buffer.from([0x89, 0x50])), false, 'curto demais');
});

test('envio: sem chave 401 (antes de ler o arquivo); outro site 403; Host falso 421; só os tipos de mídia da lista', async () => {
  const s = await subir();
  assert.equal((await pedir(s.porta, { caminho: '/api/enviar', corpo: PNG, headers: { 'content-type': 'image/png' } })).status, 401);
  assert.equal((await enviar(s.porta, PNG, { headers: { authorization: 'Bearer errado' } })).status, 401);
  assert.equal((await enviar(s.porta, PNG, { headers: { origin: 'https://site-malicioso.example' } })).status, 403);
  assert.equal((await enviar(s.porta, PNG, { headers: { host: `malicioso.example:${s.porta}` } })).status, 421);
  // os tipos que outro site manda sem pedir licença (CORS "simples") nunca entram, nem HTML/SVG
  for (const tipo of ['text/plain', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded', 'text/html', 'image/svg+xml', 'application/json', 'application/octet-stream', '']) {
    const r = await enviar(s.porta, PNG, { tipo });
    assert.equal(r.status, 415, tipo);
  }
  // recusado antes de ler o arquivo: a conexão fecha (o servidor não lê o envio inteiro para nada)
  const semChave = await pedir(s.porta, { caminho: '/api/enviar', corpo: PNG, headers: { 'content-type': 'image/png' } });
  assert.equal(semChave.headers.connection, 'close');
  assert.equal((await enviar(s.porta, PNG, { tipo: 'text/plain' })).headers.connection, 'close');
  const heic = await enviar(s.porta, PNG, { tipo: 'image/heic', nome: 'IMG.HEIC' });
  assert.equal(heic.status, 415);
  assert.match(json(heic).erro, /HEIC.*Mais Compatível/);
  const disfarce = await enviar(s.porta, Buffer.from('<html><script>alert(1)</script></html>'), { tipo: 'image/png' });
  assert.equal(disfarce.status, 415, 'conteúdo que não é do tipo informado');
  assert.match(json(disfarce).erro, /não é do tipo informado/);
  assert.equal((await enviar(s.porta, Buffer.alloc(0))).status, 400, 'vazio');
  assert.deepEqual(sobras(s.recebida), [], 'nada sobrou pela metade');
  assert.deepEqual(fs.existsSync(s.recebida) ? fs.readdirSync(s.recebida) : [], fs.existsSync(s.recebida) ? ['.gitignore'] : [], 'nenhum arquivo recusado ficou');
  assert.deepEqual(s.ligadas, []);
});

test('envio: tamanho máximo — declarado (responde na hora) e no meio do envio (sem Content-Length)', async () => {
  const s = await subir({ maxEnvio: 1000 });
  const declarado = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/enviar', headers: { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'video/mp4', 'content-length': String(10 * 1024 ** 3) } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => { resolve({ status: res.statusCode, corpo }); req.destroy(); });
    });
    req.on('error', () => {});
    req.flushHeaders();
  });
  assert.equal(declarado.status, 413);
  assert.match(JSON.parse(declarado.corpo).erro, /grande demais \(máx\. 1000 bytes\)/);
  // sem Content-Length (em pedaços): conta no caminho e para
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/enviar', headers: { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'image/png', 'x-nome': 'grande.png' } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, corpo }));
    });
    req.on('error', reject);
    req.write(PNG);
    for (let i = 0; i < 5; i++) req.write(Buffer.alloc(500, 1));
    req.end();
  });
  assert.equal(r.status, 413);
  assert.deepEqual(sobras(s.recebida), []);
  assert.ok(!fs.readdirSync(s.recebida).includes('grande.png'));
});

test('envio: guarda em midia-recebida (com .gitignore), nunca sobrescreve, e vídeo liga a ferramenta "video"', async () => {
  const s = await subir();
  const r1 = await enviar(s.porta, PNG, { nome: 'praia.png' });
  assert.equal(r1.status, 200, r1.corpo);
  const a = json(r1);
  assert.deepEqual([a.ok, a.nome, a.midia, a.tamanho, a.caminho], [true, 'praia.png', 'imagem', PNG.length, 'midia-recebida/praia.png']);
  assert.match(a.id, /^[A-Za-z0-9_-]{16}$/);
  assert.ok(fs.readFileSync(path.join(s.recebida, 'praia.png')).equals(PNG));
  assert.equal(fs.readFileSync(path.join(s.recebida, '.gitignore'), 'utf8').trim().split('\n').pop(), '*', 'as fotos não vão para o git');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(s.recebida, 'praia.png')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(s.recebida).mode & 0o777, 0o700);
  }
  const r2 = json(await enviar(s.porta, Buffer.concat([PNG, Buffer.from([0])]), { nome: 'praia.png' }));
  assert.equal(r2.caminho, 'midia-recebida/praia-2.png', 'mesmo nome: vira -2');
  assert.ok(fs.readFileSync(path.join(s.recebida, 'praia.png')).equals(PNG), 'o primeiro continua igual');
  assert.notEqual(r2.id, a.id);
  assert.deepEqual(s.ligadas, [], 'foto não liga a ferramenta de vídeo');
  const v = json(await enviar(s.porta, MP4, { tipo: 'video/quicktime', nome: 'IMG_0001.MOV' }));
  assert.deepEqual([v.nome, v.midia], ['IMG_0001.mov', 'video']);
  assert.deepEqual(s.ligadas, ['video'], 'mandou um vídeo: a ferramenta "video" entra nesta execução');
  assert.deepEqual(sobras(s.recebida), []);
});

test('envio: "midia-recebida" que é um link (num projeto baixado da internet) é recusada — nada vai parar fora', { skip: process.platform === 'win32' && 'links simbólicos exigem permissão no Windows' }, async () => {
  const s = await subir();
  const alvo = fs.mkdtempSync(path.join(HOME, 'alvo-'));
  fs.symlinkSync(alvo, path.join(s.pasta, site.PASTA_RECEBIDA));
  const r = await enviar(s.porta, PNG);
  assert.equal(r.status, 409);
  assert.match(json(r).erro, /não é uma pasta comum/);
  assert.deepEqual(fs.readdirSync(alvo), []);
});

test('envio: sobra antiga de um envio cortado (programa fechado no meio) é limpa no próximo envio', async () => {
  const s = await subir();
  assert.equal((await enviar(s.porta, PNG)).status, 200);
  const velho = path.join(s.recebida, '.recebendo-velho');
  const novo = path.join(s.recebida, '.recebendo-agora');
  fs.writeFileSync(velho, 'x');
  fs.writeFileSync(novo, 'x');
  const ontem = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(velho, ontem, ontem);
  assert.equal((await enviar(s.porta, PNG)).status, 200);
  assert.ok(!fs.existsSync(velho), 'a sobra de mais de 1 dia saiu');
  assert.ok(fs.existsSync(novo), 'a de agora (pode ser um envio em andamento) fica');
});

test('envio: um por vez (409); envio cortado no meio não deixa arquivo pela metade e libera o próximo', async () => {
  const s = await subir();
  let liberar;
  const lento = new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: s.porta, method: 'POST', path: '/api/enviar', headers: { host: `127.0.0.1:${s.porta}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'video/mp4', 'x-nome': 'lento.mp4', 'content-length': String(MP4.length + 1000) } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve('cortado'));
    req.on('close', () => resolve('cortado'));
    req.write(MP4);
    liberar = (cortar) => { if (cortar) req.destroy(); else req.end(Buffer.alloc(1000)); };
  });
  for (let i = 0; i < 40 && !sobras(s.recebida).length; i++) await dormir(25);
  assert.equal(sobras(s.recebida).length, 1, 'recebendo num arquivo temporário');
  assert.equal((await enviar(s.porta, PNG)).status, 409, 'outro envio espera');
  liberar(true); // a página fechou no meio
  assert.equal(await lento, 'cortado');
  for (let i = 0; i < 80 && sobras(s.recebida).length; i++) await dormir(25);
  assert.deepEqual(sobras(s.recebida), [], 'o temporário foi apagado');
  assert.ok(!fs.readdirSync(s.recebida).some((f) => f.startsWith('lento')), 'nada com o nome final');
  let r;
  for (let i = 0; i < 40; i++) { r = await enviar(s.porta, PNG); if (r.status !== 409) break; await dormir(25); }
  assert.equal(r.status, 200, 'o próximo envio funciona');
});

test('/api/midia: devolve só o que foi registrado, com o tipo certo; some quando o arquivo some ou vira link', async () => {
  const s = await subir();
  const a = json(await enviar(s.porta, PNG));
  const r = await api(s.porta, '/api/midia', { id: a.id });
  assert.equal(r.status, 200);
  assert.ok(r.bruto.equals(PNG));
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], site.CSP);
  assert.match(r.headers['content-disposition'], /^attachment; filename\*=UTF-8''foto\.png$/);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal((await pedir(s.porta, { caminho: '/api/midia', corpo: JSON.stringify({ id: a.id }), headers: { 'content-type': 'application/json' } })).status, 401);
  for (const id of ['nao-existe', '../../etc/passwd', 123, null]) assert.equal((await api(s.porta, '/api/midia', { id })).status, 404, String(id));
  const arq = path.join(s.recebida, 'foto.png');
  if (process.platform !== 'win32') {
    fs.rmSync(arq);
    fs.writeFileSync(path.join(HOME, 'outro.png'), PNG);
    fs.symlinkSync(path.join(HOME, 'outro.png'), arq);
    assert.equal((await api(s.porta, '/api/midia', { id: a.id })).status, 404, 'virou um link: não segue');
  }
  fs.rmSync(arq, { force: true });
  assert.equal((await api(s.porta, '/api/midia', { id: a.id })).status, 404, 'sumiu');
});

test('conversa com anexos: o agente recebe o caminho e VÊ a foto; anexo desconhecido é recusado', async () => {
  const recebidos = [];
  const s = await subir({ conversar: async (texto, o) => { recebidos.push({ texto, imagens: o.imagens }); return { texto: 'ok', historico: [] }; } });
  const foto = json(await enviar(s.porta, PNG, { nome: 'praia.png' }));
  const video = json(await enviar(s.porta, MP4, { tipo: 'video/mp4', nome: 'passeio.mp4' }));
  assert.equal((await api(s.porta, '/api/conversa', { texto: 'oi', anexos: ['inventado'] })).status, 400);
  assert.equal((await api(s.porta, '/api/conversa', { texto: 'oi', anexos: 'x' })).status, 400);
  assert.equal((await api(s.porta, '/api/conversa', { texto: 'oi', anexos: Array(11).fill(foto.id) })).status, 400);
  assert.equal(recebidos.length, 0);
  const r = await api(s.porta, '/api/conversa', { texto: 'deixa pronta pro feed', anexos: [foto.id, video.id] });
  assert.equal(r.status, 200);
  assert.equal(recebidos[0].texto, `deixa pronta pro feed\n\n[arquivos que enviei pela página: midia-recebida/praia.png (foto, ${PNG.length} bytes); midia-recebida/passeio.mp4 (vídeo, ${MP4.length} bytes)]`);
  assert.equal(recebidos[0].imagens.length, 1, 'só a foto vai para o modelo ver');
  assert.equal(recebidos[0].imagens[0].inlineData.mimeType, 'image/png');
  assert.equal(recebidos[0].imagens[0].inlineData.data, PNG.toString('base64'));
  // fotos demais para um pedido: só até ~15 MB vão para o modelo ver (todas vão pelo caminho)
  const imagens = require('../src/imagens');
  const grande = Buffer.concat([PNG, Buffer.alloc(Math.ceil(imagens.MAX_BYTES * 0.6))]);
  const g1 = json(await enviar(s.porta, grande, { nome: 'g1.png' }));
  const g2 = json(await enviar(s.porta, grande, { nome: 'g2.png' }));
  await api(s.porta, '/api/conversa', { texto: 'duas grandes', anexos: [g1.id, g2.id] });
  assert.equal(recebidos[1].imagens.length, 1, 'a segunda passaria do limite do pedido');
  assert.match(recebidos[1].texto, /g1\.png.*g2\.png/s);
  // só o anexo, sem texto
  await api(s.porta, '/api/conversa', { texto: '', anexos: [foto.id] });
  assert.match(recebidos[2].texto, /^\[arquivos que enviei pela página: midia-recebida\/praia\.png/);
  assert.equal((await api(s.porta, '/api/conversa', { texto: '' })).status, 400, 'sem texto e sem anexo: vazio');
});

test('o que as ferramentas criam aparece na página (evento "midia") e volta no histórico; segredo nunca', async () => {
  const s = await subir({
    conversar: async (texto, { historico }) => {
      const editada = path.join(s.pasta, 'praia-editada.png');
      fs.writeFileSync(editada, PNG);
      midiaGerada.registrar(editada);
      midiaGerada.registrar(editada); // a mesma duas vezes: um evento só
      const saude = path.join(HOME, '.gemini-code', 'saude');
      fs.mkdirSync(saude, { recursive: true });
      fs.writeFileSync(path.join(saude, 'exame.png'), PNG);
      midiaGerada.registrar(path.join(saude, 'exame.png')); // pasta de segredos: nunca vai para a página
      fs.writeFileSync(path.join(s.pasta, 'nota.txt'), 'x');
      midiaGerada.registrar(path.join(s.pasta, 'nota.txt')); // não é mídia
      return { texto: 'Pronto!', historico: [...historico, { role: 'user', parts: [{ text: '[imagem image/png enviada nesta mensagem; já analisada]' }, { text: texto }] }, { role: 'model', parts: [{ text: 'Pronto!' }] }] };
    },
  });
  const foto = json(await enviar(s.porta, PNG, { nome: 'praia.png' }));
  const evs = eventos(await api(s.porta, '/api/conversa', { texto: 'edita', anexos: [foto.id] }));
  const midias = evs.filter((e) => e.tipo === 'midia');
  assert.equal(midias.length, 1, JSON.stringify(evs));
  assert.deepEqual([midias[0].nome, midias[0].midia, midias[0].tamanho], ['praia-editada.png', 'imagem', PNG.length]);
  assert.ok(evs.findIndex((e) => e.tipo === 'midia') < evs.findIndex((e) => e.tipo === 'resposta'));
  assert.ok((await api(s.porta, '/api/midia', { id: midias[0].id })).bruto.equals(PNG));
  midiaGerada.registrar(path.join(s.pasta, 'praia-editada.png')); // fora de uma conversa: ninguém ouvindo
  // recarregar a página: a foto mandada volta na sua mensagem (sem a linha dos caminhos) e a editada, na resposta
  const h = json(await api(s.porta, '/api/historico', {}));
  assert.deepEqual(h.mensagens.map((m) => [m.quem, m.texto, (m.midias || []).map((x) => x.nome)]), [['voce', 'edita', ['praia.png']], ['agente', 'Pronto!', ['praia-editada.png']]]);
  assert.equal(h.mensagens[0].midias[0].id, foto.id);
  // conversa nova: as prévias somem da página (os arquivos ficam no disco)
  await api(s.porta, '/api/limpar', {});
  assert.equal((await api(s.porta, '/api/midia', { id: midias[0].id })).status, 404);
  assert.ok(fs.existsSync(path.join(s.recebida, 'praia.png')));
});

test('paraExibicao: o marcador de imagem já analisada não aparece como fala', () => {
  const m = site.paraExibicao([{ role: 'user', parts: [{ text: '[imagem image/jpeg enviada nesta mensagem; já analisada]' }, { text: 'o que tem na foto?' }] }]);
  assert.deepEqual(m, [{ quem: 'voce', texto: 'o que tem na foto?' }]);
});

test('ferramenta "video" ligada nesta execução: entra no chat comum, nunca alarga um aliado; câmera nunca', async () => {
  const tools = require('../src/tools');
  const nomes = async (lista) => (await tools.getAllDeclarations(lista)).map((d) => d.name);
  assert.ok(!(await nomes()).includes('video'), 'por padrão, sob demanda');
  assert.equal(tools.ligarNaSessao('camera'), false);
  assert.equal(tools.ligarNaSessao('saude_registrar'), false);
  assert.equal(tools.ligarNaSessao('video'), true);
  const todas = await nomes();
  assert.ok(todas.includes('video'));
  assert.ok(!todas.includes('camera') && !todas.includes('saude_registrar'));
  assert.ok(!(await nomes(['read_file'])).includes('video'), 'a lista de um aliado continua a mesma');
  assert.deepEqual(tools.LIGAVEIS_NA_SESSAO, ['video']);
});

// ---------------------------------------------------------------------------
// A página de verdade num Chrome/Chromium
// ---------------------------------------------------------------------------
const { Navegador, acharNavegador } = require('../src/navegador');
const pular = acharNavegador() ? false : 'nenhum Chrome/Chromium instalado';

test('navegador real: mandar uma foto pelo clipe, ver a prévia, e a foto editada aparecer na resposta (e voltar ao recarregar)', { skip: pular, timeout: 90000 }, async (t) => {
  const recebidos = [];
  const s = await subir({
    conversar: async (texto, { historico, onText }) => {
      recebidos.push(texto);
      const editada = path.join(s.pasta, 'midia-recebida', 'praia-editada.png');
      fs.copyFileSync(path.join(s.pasta, 'midia-recebida', 'praia.png'), editada);
      midiaGerada.registrar(editada);
      onText('Prontinho: ajustei para o feed.');
      return { texto: 'Prontinho: ajustei para o feed.', historico: [...historico, { role: 'user', parts: [{ text: texto }] }, { role: 'model', parts: [{ text: 'Prontinho: ajustei para o feed.' }] }] };
    },
  });
  const foto = path.join(HOME, 'praia.png');
  fs.writeFileSync(foto, PNG);
  const nav = new Navegador({ executavel: acharNavegador(), permitirLocal: true, navegacaoBarrada: () => null });
  await nav.iniciar();
  t.after(() => nav.fechar());
  await nav.abrir(s.endereco('/chat'));
  assert.ok(await nav.esperarTexto('Como posso ajudar', 10000), 'a página subiu');
  const { result } = await nav.enviar('Runtime.evaluate', { expression: "document.getElementById('arquivo')" });
  await nav.enviar('DOM.setFileInputFiles', { files: [foto], objectId: result.objectId });
  assert.ok(await nav.esperarTexto('pronto', 10000), 'o arquivo subiu');
  assert.ok(fs.readFileSync(path.join(s.recebida, 'praia.png')).equals(PNG), 'chegou inteiro no servidor');
  await nav.avaliar("document.getElementById('texto').value = 'deixa pronta pro feed'");
  await nav.avaliar("document.getElementById('btn-enviar').click()");
  assert.ok(await nav.esperarTexto('Prontinho', 10000), 'a resposta chegou');
  assert.match(recebidos[0], /^deixa pronta pro feed\n\n\[arquivos que enviei pela página: midia-recebida\/praia\.png \(foto, /);
  const estado = async () => nav.avaliar(`(async () => {
    const espera = (s) => new Promise((r) => setTimeout(r, s));
    for (let i = 0; i < 50 && document.querySelectorAll('img.midia-conteudo').length < 2; i++) await espera(100);
    const imgs = [...document.querySelectorAll('img.midia-conteudo')];
    for (const i of imgs) if (!i.complete) await new Promise((r) => { i.onload = r; i.onerror = r; });
    return {
      voce: [...document.querySelectorAll('.msg-voce img.midia-conteudo')].map((i) => [i.src.slice(0, 5), i.naturalWidth]),
      agente: [...document.querySelectorAll('.msg-agente img.midia-conteudo')].map((i) => [i.src.slice(0, 5), i.naturalWidth]),
      baixar: [...document.querySelectorAll('.msg-agente a.midia-baixar')].map((a) => a.getAttribute('download')),
      bandeja: document.getElementById('anexos').hidden,
      balao: [...document.querySelectorAll('.msg-voce .balao')].map((b) => b.textContent),
    };
  })()`);
  const e = await estado();
  assert.deepEqual(e.voce, [['blob:', 1]], 'a sua foto aparece na sua mensagem (a CSP deixa o blob:)');
  assert.deepEqual(e.agente, [['blob:', 1]], 'a foto editada aparece na resposta, carregada pela API');
  assert.deepEqual(e.baixar, ['praia-editada.png']);
  assert.equal(e.bandeja, true, 'a bandeja de envio esvaziou');
  assert.deepEqual(e.balao, ['deixa pronta pro feed']);
  // recarregar: as duas voltam (agora as duas pela API), e a linha dos caminhos não aparece
  await nav.abrir(`http://127.0.0.1:${s.porta}/chat`);
  assert.ok(await nav.esperarTexto('Prontinho', 10000));
  const depois = await estado();
  assert.deepEqual(depois.voce, [['blob:', 1]]);
  assert.deepEqual(depois.agente, [['blob:', 1]]);
  assert.deepEqual(depois.balao, ['deixa pronta pro feed']);
});
