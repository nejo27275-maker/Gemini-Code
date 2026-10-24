// src/cowork/canalSeguro.js
// v0.43.0 — canal cifrado do cowork (protocolo 2). Antes o celular mandava o token em TEXTO PURO por
// ws:// e todas as tarefas e respostas iam abertas: qualquer um na mesma rede Wi-Fi capturava o token
// (Wireshark, ARP spoofing) e passava a rodar o agente inteiro no PC — arquivos e shell.
//
// Agora, só com primitivas padrão do Node (sem dependência nova):
//   1. servidor -> cliente  { type:'hello', v:2, nonce, pub }          nonce de 32 bytes + chave X25519 efêmera
//   2. cliente  -> servidor { type:'auth',  v:2, nonce, pub, prova }   prova = HMAC(kAuth, "cliente" ‖ transcrição)
//   3. servidor -> cliente  { type:'auth_ok', prova }                  prova = HMAC(kAuth, "servidor" ‖ transcrição)
//   4. depois, só          { type:'sec', n, c }                       AES-256-GCM, nonce = direção ‖ contador
// kAuth = HKDF-SHA256(token). transcrição = rótulo ‖ nonceS ‖ pubS ‖ nonceC ‖ pubC.
// Chaves de sessão = HKDF-SHA256(X25519(efêmeras), sal = HMAC(kAuth, transcrição)), uma por direção.
//
// O que isso garante: o token nunca passa pela rede; os DOIS lados provam que conhecem o token (um
// servidor falso não recebe suas tarefas); quem está no meio não lê nem altera nada (GCM autentica cada
// mensagem); mensagem repetida, fora de ordem ou cortada derruba a conexão (contador estrito); e cada
// conexão tem chaves novas — quem gravou o tráfego e depois roubou o token não decifra o que gravou
// (sigilo futuro). O que NÃO esconde: o tamanho e o horário das mensagens.
'use strict';

const crypto = require('crypto');

const VERSAO = 2;
const ROTULO = Buffer.from('gemini-code-cowork-v2');
const TAM = 32; // nonces, chaves públicas X25519, provas HMAC-SHA256 e chaves AES-256
const CLIENTE = 1; // direção cliente -> servidor
const SERVIDOR = 2; // direção servidor -> cliente
const MIN_TOKEN = 32;

class ErroDeCanal extends Error {
  /** @param {string} codigo 'versao' | 'token' | 'protocolo' | 'impostor' */
  constructor(codigo, mensagem) {
    super(mensagem);
    this.codigo = codigo;
  }
}

const b64 = (buf) => buf.toString('base64');

function bytes(valor, campo) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) throw new ErroDeCanal('protocolo', `campo "${campo}" inválido`);
  const buf = Buffer.from(valor, 'base64');
  if (buf.length !== TAM) throw new ErroDeCanal('protocolo', `campo "${campo}" com tamanho errado`);
  return buf;
}

function validarToken(token) {
  if (typeof token !== 'string' || token.trim().length < MIN_TOKEN) {
    throw new Error(`Token do cowork fraco ou vazio (mínimo ${MIN_TOKEN} caracteres). Apague ~/.gemini-code/cowork-token.txt e rode "gemini-code cowork server" para gerar outro.`);
  }
  return token.trim();
}

function chaveDeAutenticacao(token) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(validarToken(token), 'utf8'), ROTULO, 'autenticacao', TAM));
}

function parEfemero() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { privateKey, pub: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url') };
}

/** X25519 com a chave pública do outro lado. Recusa ponto de ordem baixa (segredo todo zero). */
function segredoCompartilhado(privateKey, pubOutro) {
  let segredo;
  try {
    const publicKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: pubOutro.toString('base64url') }, format: 'jwk' });
    segredo = crypto.diffieHellman({ privateKey, publicKey });
  } catch {
    throw new ErroDeCanal('protocolo', 'chave pública inválida');
  }
  if (segredo.every((b) => b === 0)) throw new ErroDeCanal('protocolo', 'chave pública inválida');
  return segredo;
}

const transcricao = (nonceS, pubS, nonceC, pubC) => Buffer.concat([ROTULO, nonceS, pubS, nonceC, pubC]);
const prova = (kAuth, papel, transc) => crypto.createHmac('sha256', kAuth).update(papel).update(transc).digest();

function chavesDeSessao(segredo, kAuth, transc) {
  const sal = crypto.createHmac('sha256', kAuth).update('sal').update(transc).digest();
  const k = Buffer.from(crypto.hkdfSync('sha256', segredo, sal, 'chaves de sessao', TAM * 2));
  return { clienteParaServidor: k.subarray(0, TAM), servidorParaCliente: k.subarray(TAM) };
}

function ivEAad(direcao, n) {
  const iv = Buffer.alloc(12);
  iv.writeUInt8(direcao, 0);
  iv.writeBigUInt64BE(BigInt(n), 4);
  return { iv, aad: Buffer.concat([ROTULO, iv]) };
}

/** Cifra objetos numa direção; o contador começa em 0 e nunca repete (nonce único por chave). */
function criarSelo(chave, direcao) {
  let n = 0;
  return (obj) => {
    const { iv, aad } = ivEAad(direcao, n);
    const cifra = crypto.createCipheriv('aes-256-gcm', chave, iv);
    cifra.setAAD(aad);
    const corpo = Buffer.concat([cifra.update(JSON.stringify(obj), 'utf8'), cifra.final(), cifra.getAuthTag()]);
    return { type: 'sec', n: n++, c: b64(corpo) };
  };
}

/** Decifra só a próxima mensagem esperada: repetida, pulada, alterada ou de outra direção = erro. */
function criarAbridor(chave, direcao) {
  let esperado = 0;
  return (msg) => {
    if (!msg || msg.type !== 'sec' || msg.n !== esperado || typeof msg.c !== 'string') {
      throw new ErroDeCanal('protocolo', 'mensagem fora de ordem, repetida ou sem cifra');
    }
    const corpo = Buffer.from(msg.c, 'base64');
    if (corpo.length < 17) throw new ErroDeCanal('protocolo', 'mensagem cifrada curta demais');
    const { iv, aad } = ivEAad(direcao, esperado);
    try {
      const decifra = crypto.createDecipheriv('aes-256-gcm', chave, iv);
      decifra.setAAD(aad);
      decifra.setAuthTag(corpo.subarray(corpo.length - 16));
      const texto = Buffer.concat([decifra.update(corpo.subarray(0, corpo.length - 16)), decifra.final()]).toString('utf8');
      esperado++;
      return JSON.parse(texto);
    } catch {
      throw new ErroDeCanal('protocolo', 'mensagem adulterada ou de outra sessão');
    }
  };
}

/** Lado do servidor (PC). `hello` vai assim que a conexão abre; `receberAuth` responde ou lança ErroDeCanal. */
function servidor(token) {
  const kAuth = chaveDeAutenticacao(token);
  const { privateKey, pub } = parEfemero();
  const nonce = crypto.randomBytes(TAM);
  let selar = null;
  let abrir = null;
  return {
    hello: { type: 'hello', v: VERSAO, nonce: b64(nonce), pub: b64(pub) },
    get pronto() { return selar !== null; },
    receberAuth(msg) {
      if (selar) throw new ErroDeCanal('protocolo', 'aperto de mão repetido');
      if (!msg || msg.type !== 'auth') throw new ErroDeCanal('protocolo', 'esperava a autenticação');
      if (msg.v !== VERSAO) throw new ErroDeCanal('versao', 'Cliente de versão antiga (manda o token aberto na rede). Atualize o gemini-code do celular.');
      const nonceC = bytes(msg.nonce, 'nonce');
      const pubC = bytes(msg.pub, 'pub');
      const recebida = bytes(msg.prova, 'prova');
      const transc = transcricao(nonce, pub, nonceC, pubC);
      if (!crypto.timingSafeEqual(recebida, prova(kAuth, 'cliente', transc))) throw new ErroDeCanal('token', 'Token inválido.');
      const k = chavesDeSessao(segredoCompartilhado(privateKey, pubC), kAuth, transc);
      selar = criarSelo(k.servidorParaCliente, SERVIDOR);
      abrir = criarAbridor(k.clienteParaServidor, CLIENTE);
      return { type: 'auth_ok', prova: b64(prova(kAuth, 'servidor', transc)) };
    },
    selar(obj) { if (!selar) throw new ErroDeCanal('protocolo', 'canal ainda não autenticado'); return selar(obj); },
    abrir(msg) { if (!abrir) throw new ErroDeCanal('protocolo', 'canal ainda não autenticado'); return abrir(msg); },
  };
}

/** Lado do cliente (celular). Responde ao hello e só confia no servidor depois de conferir a prova dele. */
function cliente(token) {
  const kAuth = chaveDeAutenticacao(token);
  const { privateKey, pub } = parEfemero();
  const nonce = crypto.randomBytes(TAM);
  let pendente = null; // { transc, chaves } entre o auth e o auth_ok
  let selar = null;
  let abrir = null;
  return {
    get pronto() { return selar !== null; },
    receberHello(msg) {
      if (pendente || selar) throw new ErroDeCanal('protocolo', 'hello repetido');
      if (!msg || msg.type !== 'hello') throw new ErroDeCanal('protocolo', 'esperava o hello do servidor');
      if (msg.v !== VERSAO) throw new ErroDeCanal('versao', 'O PC roda uma versão do gemini-code com outro protocolo do cowork. Atualize os dois lados.');
      const nonceS = bytes(msg.nonce, 'nonce');
      const pubS = bytes(msg.pub, 'pub');
      const transc = transcricao(nonceS, pubS, nonce, pub);
      pendente = { transc, chaves: chavesDeSessao(segredoCompartilhado(privateKey, pubS), kAuth, transc) };
      return { type: 'auth', v: VERSAO, nonce: b64(nonce), pub: b64(pub), prova: b64(prova(kAuth, 'cliente', transc)) };
    },
    confirmar(msg) {
      if (!pendente) throw new ErroDeCanal('protocolo', 'confirmação antes do hello');
      if (!msg || msg.type !== 'auth_ok') throw new ErroDeCanal('protocolo', 'esperava a confirmação do servidor');
      if (!crypto.timingSafeEqual(bytes(msg.prova, 'prova'), prova(kAuth, 'servidor', pendente.transc))) {
        throw new ErroDeCanal('impostor', 'O PC não provou que conhece o token: pode ser um impostor na rede. Conexão encerrada.');
      }
      selar = criarSelo(pendente.chaves.clienteParaServidor, CLIENTE);
      abrir = criarAbridor(pendente.chaves.servidorParaCliente, SERVIDOR);
      pendente = null;
    },
    selar(obj) { if (!selar) throw new ErroDeCanal('protocolo', 'canal ainda não autenticado'); return selar(obj); },
    abrir(msg) { if (!abrir) throw new ErroDeCanal('protocolo', 'canal ainda não autenticado'); return abrir(msg); },
  };
}

module.exports = { VERSAO, MIN_TOKEN, ErroDeCanal, servidor, cliente, validarToken, criarSelo, criarAbridor };
