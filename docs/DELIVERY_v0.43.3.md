# Entrega v0.43.3 — cowork testado de verdade, TVs Android 11+ e ESLint real

- Cowork por WebSocket real testado automaticamente (`tests/coworkWebSocket.test.js`; roda no CI, que instala o `ws`). Corrigido: porta ocupada derrubava o servidor com pilha técnica.
- ADB: `descobrir` (mDNS) e `parear` (código de 6 dígitos do Android 11+), comandos `gemini-code adb descobrir|parear`, guia atualizado; `doctor` mostra adb e ws.
- ESLint real: `eslint.config.js` (ESLint 9/10), `npm run lint` sem `--ext` e com zero avisos; CI instala ESLint 10.1.0 fixo no job do Node 22.
- CI em Node 20 e 22.
- Testes: 776 (775 passando, 1 pulado como root) no Node 20 e 22 com `ws`. Não testado: TV real, Node 24.
