# Erro EADDRINUSE porta já em uso no Node.js
Outro programa já está usando a porta. Descubra e encerre, ou troque a porta.
```bash
pkill -f node
PORT=3001 node servidor.js
```
No código: `app.listen(process.env.PORT || 3000)`.

# Erro Cannot find module no Node.js
Falta instalar a dependência ou o caminho está errado.
```bash
npm install
npm install nome-do-modulo
```
Confira se está na pasta certa do projeto (`pwd`) e se o caminho relativo começa com `./`.

# Erro command not found no Termux
O programa não está instalado. Procure o pacote e instale.
```bash
pkg search nome
pkg install nome
```

# Erro ECONNREFUSED ao conectar em localhost
O servidor de destino não está rodando ou está em outra porta. Ex.: no Ollama rode `ollama serve` antes. Confira com `curl http://127.0.0.1:PORTA`.

# Erro 429 ou RESOURCE_EXHAUSTED da API do Gemini
Acabou a cota de uso do modelo. Espere o tempo que a mensagem indicar e reenvie; troque de modelo ou ative cobrança na conta do Google AI Studio se precisar de mais limite.

# Erro SyntaxError Unexpected token no JSON.parse
O texto não é JSON válido (muitas vezes é uma página HTML de erro). Veja o que chegou antes de converter.
```js
const texto = await res.text();
try { return JSON.parse(texto); } catch { throw new Error('Resposta não é JSON: ' + texto.slice(0, 200)); }
```

# Erro permission denied ao rodar script no Termux
```bash
chmod +x script.sh
./script.sh
```

# Erro de memória ou o Termux fecha sozinho
O Android encerra apps em segundo plano. Use `termux-wake-lock`, desative a otimização de bateria do Termux e evite modelos grandes demais para a RAM do aparelho.

# Erro CORS blocked by CORS policy no navegador
O servidor da API precisa permitir a origem da sua página. No seu próprio servidor adicione o cabeçalho `Access-Control-Allow-Origin`; em API de terceiros, faça a chamada pelo seu servidor (proxy) em vez de direto do navegador.

# Erro TypeError Cannot read properties of undefined no JavaScript
Você tentou usar `.algo` em algo que é `undefined` ou `null`. Veja qual variável veio vazia (a mensagem diz a propriedade) e proteja o acesso.
```js
const nome = usuario?.perfil?.nome ?? 'sem nome';   // encadeamento opcional + valor padrão
if (!Array.isArray(lista)) lista = [];              // garanta o tipo antes de usar .map/.length
console.log(typeof usuario, usuario);                // descubra o que realmente chegou
```
Causas comuns: resposta de API sem o campo, `await` esquecido, ou ler a variável antes dela ser preenchida.

# Erro ENOENT no such file or directory no Node.js
O arquivo ou pasta não existe nesse caminho. Caminho relativo é contado a partir de onde você RODOU o comando, não de onde o script está.
```js
const path = require('path');
const fs = require('fs');
const arquivo = path.join(__dirname, 'dados.json');   // sempre relativo ao script
if (!fs.existsSync(arquivo)) fs.writeFileSync(arquivo, '[]');
fs.mkdirSync(path.join(__dirname, 'saida'), { recursive: true });
```

# Erro EACCES permission denied no Node.js ou npm
Sem permissão pra escrever ou usar a porta. No Termux/Linux não use sudo no npm: mude a pasta ou o dono. Portas abaixo de 1024 pedem root; use 3000 ou 8080.
```bash
ls -l arquivo.js
chmod u+rw arquivo.js
npm config set prefix ~/.npm-global
```

# Erro require is not defined in ES module scope no Node.js
O projeto está em modo ES (`"type": "module"` no package.json ou arquivo .mjs), onde não existe `require`. Troque por import ou volte ao modo antigo.
```js
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);   // se precisar do require mesmo assim
```
Ou tire `"type": "module"` do package.json / renomeie o arquivo para .cjs.

# Erro ModuleNotFoundError No module named no Python
O pacote não está instalado no Python que você está usando (ou o ambiente virtual não está ativo).
```bash
python -m pip install nome-do-pacote
python -m pip list | grep -i nome
source venv/bin/activate
```
Dica: instale com `python -m pip` (o mesmo Python que roda o script). Nomes diferentes: `cv2` vem de `opencv-python`, `PIL` vem de `pillow`.

# Erro IndentationError unexpected indent no Python
Python usa o recuo (espaços) pra saber o que está dentro de cada bloco. Misturar tab com espaço ou recuar errado dá esse erro. Use 4 espaços em tudo.
```python
if ativo:
    print("dentro do if")   # 4 espaços
    for i in range(3):
        print(i)            # 8 espaços
```

# Erro fetch failed ou ETIMEDOUT ao chamar uma API no Node.js
A conexão não completou: sem internet, DNS, firewall, URL errada ou servidor lento. Teste a URL no terminal e coloque timeout.
```bash
curl -I https://api.exemplo.com
```
```js
try {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  console.log(r.status);
} catch (e) {
  console.error('falhou:', e.cause ? e.cause.code : e.message);   // ENOTFOUND, ETIMEDOUT, ECONNRESET…
}
```

# Erro git push rejected non-fast-forward
O repositório remoto tem commits que você não tem. Puxe e junte antes de enviar.
```bash
git pull --rebase origin main
git push origin main
```
Se der conflito, edite os arquivos marcados, depois `git add .` e `git rebase --continue`. Evite `push --force` sem ter certeza.
