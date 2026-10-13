# Como funciona o code-ia
O code-ia é o modelo próprio do gemini-code. Ele roda 100% no seu aparelho, sem internet e sem modelo de terceiros por trás. Ele busca no que aprendeu (exemplos embutidos, seu `knowledge/`, suas `skills/` e o que você ensinou) e completa código com um gerador n-grama treinado do zero. Ele é pequeno: responde bem sobre o que está no corpus e melhora quando você ensina mais.

# Como ensinar o code-ia
Rode `gemini-code code-ia learn arquivo-ou-pasta` com arquivos `.md` ou `.txt`. Cada título (`#`, `##`, `###`) vira uma pergunta e o texto abaixo vira a resposta; blocos de código entram no gerador. O modelo é refeito na hora.

# Como completar código com o code-ia
Use `gemini-code code-ia complete "trecho de código"` ou, no chat, escreva `completa: trecho de código`.

# Como trocar para o code-ia ou voltar para o Gemini
No chat: `/codeia` usa o code-ia, `/cloud` usa o Gemini e `/auto` volta ao automático. Fixo: `gemini-code config set-provider code-ia`.

# Como criar um bot de WhatsApp com Baileys
Instale com `npm install @whiskeysockets/baileys`.
```js
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    const texto = m.message?.conversation || m.message?.extendedTextMessage?.text;
    if (!m.key.fromMe && texto === '!ping') await sock.sendMessage(m.key.remoteJid, { text: 'pong' });
  });
}
iniciar();
```
Versões novas do Baileys podem pedir outro modo de login; confira a documentação da versão instalada.
