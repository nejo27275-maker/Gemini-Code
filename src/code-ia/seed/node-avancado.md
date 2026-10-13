# Como usar banco de dados SQLite em Node.js
Instale com `npm install better-sqlite3`.
```js
const Database = require('better-sqlite3');
const db = new Database('dados.db');
db.exec('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nome TEXT, moedas INTEGER DEFAULT 0)');
db.prepare('INSERT INTO usuarios (nome) VALUES (?)').run('Neto');
const todos = db.prepare('SELECT * FROM usuarios').all();
const um = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(1);
```
Sempre use `?` (parâmetros) em vez de juntar texto no SQL, para evitar injeção.

# Como usar banco SQLite em Python
```python
import sqlite3
con = sqlite3.connect('dados.db')
con.execute('CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nome TEXT)')
con.execute('INSERT INTO usuarios (nome) VALUES (?)', ('Neto',))
con.commit()
for linha in con.execute('SELECT * FROM usuarios'):
    print(linha)
```

# Como criar um WebSocket em Node.js com a biblioteca ws
Instale com `npm install ws`.
```js
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 8080, host: '0.0.0.0' });
wss.on('connection', (socket) => {
  socket.on('message', (dado) => {
    for (const cliente of wss.clients) if (cliente.readyState === 1) cliente.send(String(dado));
  });
});
```
No navegador: `const ws = new WebSocket('ws://IP:8080'); ws.onmessage = (e) => console.log(e.data);`

# Como servir arquivos estáticos com Express
```js
const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.listen(3000, '0.0.0.0');
```
Tudo que estiver na pasta `public` fica acessível pelo navegador.

# Como liberar CORS no Express
```js
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

# Como usar variáveis de ambiente e guardar chaves no Node.js
```js
const chave = process.env.MINHA_CHAVE;
if (!chave) throw new Error('Defina MINHA_CHAVE antes de rodar');
```
No Termux: `export MINHA_CHAVE=valor && node app.js`. Nunca coloque chaves dentro do código nem suba o arquivo `.env` para o git.

# Como gerar id aleatório e hash em Node.js
```js
const crypto = require('crypto');
const id = crypto.randomUUID();
const hash = crypto.createHash('sha256').update('texto').digest('hex');
const token = crypto.randomBytes(16).toString('hex');
```

# Como fazer requisição com timeout em Node.js usando AbortController
```js
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 10000);
try {
  const r = await fetch('https://exemplo.com', { signal: ctrl.signal });
  console.log(await r.text());
} finally {
  clearTimeout(t);
}
```

# Como fazer retry com espera crescente em JavaScript
```js
async function comRetry(fn, tentativas = 4) {
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); } catch (err) {
      if (i === tentativas - 1) throw err;
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** i));
    }
  }
}
```

# Como usar módulos ES (import) em vez de require no Node.js
No `package.json` coloque `"type": "module"`, ou use a extensão `.mjs`.
```js
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
const texto = await fs.readFile('a.txt', 'utf8');
```
Em módulos ES não existe `__dirname`; use `import.meta.dirname` (Node 20.11+) ou `fileURLToPath(import.meta.url)`.

# Como criar um debounce em JavaScript
```js
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const buscar = debounce((texto) => console.log('buscando', texto), 300);
```

# Como ler uma linha digitada no terminal em Node.js
```js
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Seu nome? ', (nome) => { console.log('Oi,', nome); rl.close(); });
```

# Como processar arquivos grandes linha por linha em Node.js
```js
const fs = require('fs');
const readline = require('readline');
const rl = readline.createInterface({ input: fs.createReadStream('grande.txt'), crlfDelay: Infinity });
for await (const linha of rl) console.log(linha);
```

# Como trabalhar com datas e horas em JavaScript
```js
const agora = new Date();
console.log(agora.toLocaleString('pt-BR', { timeZone: 'America/Recife' }));
console.log(agora.toISOString());
const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
```

# Como usar expressões regulares em JavaScript
```js
const texto = 'Contato: neto@exemplo.com, outro@site.com.br';
const emails = texto.match(/[\w.+-]+@[\w-]+\.[\w.]+/g);
const ok = /^\d{3}-\d{4}$/.test('123-4567');
const trocado = texto.replace(/\d+/g, '#');
```
