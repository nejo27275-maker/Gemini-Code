// src/imagens.js (v0.41.0)
// Imagem como entrada do agente (screenshot de erro, mockup, foto da câmera do celular).
// Antes não havia caminho multimodal nenhum: read_file recusa binário e o README prometia
// "tirar foto e mandar pro agente" sem código que fizesse isso.
// A imagem entra na mensagem do usuário como parte inlineData (formato Gemini); o provedor
// OpenAI-compatível converte para image_url. Depois do turno ela vira um marcador de texto
// (ver tirarImagensDoHistorico) para não reenviar megabytes a cada mensagem nem inchar a sessão.
'use strict';

const fs = require('fs');
const path = require('path');

const TIPOS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_BYTES = 15 * 1024 * 1024; // o Gemini aceita até ~20 MB por pedido inline, com folga para o resto

/** @returns {{inlineData: {mimeType: string, data: string}, nome: string}} ou lança Error com mensagem clara. */
function lerImagem(caminho) {
  if (typeof caminho !== 'string' || !caminho) throw new Error('Informe o caminho da imagem.');
  const { isSecret } = require('./tools/protectedPaths');
  if (isSecret(caminho)) throw new Error('Esse arquivo guarda segredos do gemini-code e não pode ser enviado.');
  const mimeType = TIPOS[path.extname(caminho).toLowerCase()];
  if (!mimeType) throw new Error(`Formato não suportado: ${path.extname(caminho) || '(sem extensão)'} — use ${Object.keys(TIPOS).join(', ')}.`);
  let st;
  try { st = fs.statSync(caminho); } catch { throw new Error(`Imagem não encontrada: ${caminho}`); }
  if (!st.isFile()) throw new Error(`Não é um arquivo: ${caminho}`);
  if (st.size === 0) throw new Error(`Imagem vazia: ${caminho}`);
  if (st.size > MAX_BYTES) throw new Error(`Imagem grande demais (${st.size} bytes; máximo ${MAX_BYTES}). Reduza antes de enviar.`);
  return { inlineData: { mimeType, data: fs.readFileSync(caminho).toString('base64') }, nome: path.basename(caminho) };
}

/** Partes da mensagem do usuário: imagens primeiro, depois o texto. */
function partesComImagens(texto, imagens = []) {
  return [...imagens.map((i) => ({ inlineData: i.inlineData })), { text: texto }];
}

/** Troca imagens já vistas por um marcador curto (não altera o histórico recebido). */
function tirarImagensDoHistorico(history) {
  let mudou = false;
  const novo = (history || []).map((m) => {
    if (!Array.isArray(m.parts) || !m.parts.some((p) => p && p.inlineData)) return m;
    mudou = true;
    return { ...m, parts: m.parts.map((p) => (p && p.inlineData ? { text: `[imagem ${p.inlineData.mimeType} enviada nesta mensagem; já analisada]` } : p)) };
  });
  return mudou ? novo : history;
}

module.exports = { lerImagem, partesComImagens, tirarImagensDoHistorico, TIPOS, MAX_BYTES };
