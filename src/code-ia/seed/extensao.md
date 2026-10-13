# Como criar uma extensão de navegador Chrome com Manifest V3
Estrutura mínima: pasta com `manifest.json` e os scripts.
```json
{
  "manifest_version": 3,
  "name": "Minha Extensão",
  "version": "1.0.0",
  "description": "Exemplo mínimo",
  "permissions": ["storage", "activeTab"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    { "matches": ["https://www.youtube.com/*"], "js": ["content.js"], "run_at": "document_idle" }
  ]
}
```
Para testar: abra `chrome://extensions`, ligue o modo desenvolvedor e use "Carregar sem compactação".

# Como um content script conversa com o service worker da extensão
```js
// content.js
chrome.runtime.sendMessage({ tipo: 'ola', url: location.href }, (resp) => console.log(resp));

// background.js
chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (msg.tipo === 'ola') responder({ ok: true });
});
```

# Como salvar configurações da extensão com chrome.storage
```js
await chrome.storage.sync.set({ ativo: true });
const { ativo } = await chrome.storage.sync.get({ ativo: false });
```
Ponha `"storage"` em `permissions` no manifest.

# Como mexer no player de vídeo do YouTube com content script
```js
const video = document.querySelector('video');
if (video) {
  video.playbackRate = 1.25;
  console.log('tempo atual', video.currentTime, 'buffer', video.buffered.length);
}
```
O YouTube troca de página sem recarregar; escute o evento `yt-navigate-finish` para rodar de novo.
