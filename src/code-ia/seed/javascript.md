# Como ler um arquivo em Node.js
Use o módulo `fs`. Leitura simples e síncrona:
```js
const fs = require('fs');
const texto = fs.readFileSync('arquivo.txt', 'utf8');
console.log(texto);
```
Versão assíncrona (não trava o programa):
```js
const fs = require('fs/promises');
const texto = await fs.readFile('arquivo.txt', 'utf8');
```

# Como escrever ou salvar um arquivo em Node.js
```js
const fs = require('fs');
fs.writeFileSync('saida.txt', 'conteúdo aqui', 'utf8');
fs.appendFileSync('saida.txt', '\nmais uma linha');
```

# Como ler e salvar JSON em Node.js
```js
const fs = require('fs');
const dados = JSON.parse(fs.readFileSync('dados.json', 'utf8'));
dados.contador = (dados.contador || 0) + 1;
fs.writeFileSync('dados.json', JSON.stringify(dados, null, 2));
```

# Como criar um servidor web com Express
Instale com `npm install express`.
```js
const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('Olá!'));
app.post('/dados', (req, res) => res.json({ recebido: req.body }));
app.listen(3000, '0.0.0.0', () => console.log('Rodando na porta 3000'));
```
Com `0.0.0.0` outros aparelhos da mesma rede Wi-Fi conseguem acessar.

# Como criar um servidor HTTP sem nenhuma biblioteca
```js
const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Olá do Node puro');
}).listen(3000);
```

# Como fazer uma requisição HTTP com fetch
Node 18 ou mais novo já tem `fetch`.
```js
const res = await fetch('https://api.exemplo.com/dados', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nome: 'Neto' }),
});
if (!res.ok) throw new Error('Erro HTTP ' + res.status);
const json = await res.json();
```

# Como usar async await e tratar erros
```js
async function carregar() {
  try {
    const r = await fetch('https://exemplo.com');
    return await r.text();
  } catch (err) {
    console.error('Falhou:', err.message);
    return null;
  }
}
```

# Como esperar um tempo (sleep) em JavaScript
```js
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
await esperar(1000);
```

# Como criar uma classe em JavaScript
```js
class Jogador {
  constructor(nome) {
    this.nome = nome;
    this.vida = 100;
  }
  levarDano(valor) {
    this.vida = Math.max(0, this.vida - valor);
    return this.vida;
  }
}
const j = new Jogador('Neto');
j.levarDano(30);
```

# Como ordenar, filtrar e transformar listas em JavaScript
```js
const nums = [5, 2, 9, 1];
const ordenado = [...nums].sort((a, b) => a - b);
const pares = nums.filter((n) => n % 2 === 0);
const dobro = nums.map((n) => n * 2);
const soma = nums.reduce((a, n) => a + n, 0);
```

# Como rodar um comando do terminal pelo Node.js
```js
const { execSync, spawn } = require('child_process');
const saida = execSync('ls -la', { encoding: 'utf8' });
console.log(saida);
const p = spawn('ping', ['-c', '3', 'google.com']);
p.stdout.on('data', (d) => process.stdout.write(d));
```

# Como ler argumentos da linha de comando em Node.js
```js
const [, , comando, ...resto] = process.argv;
if (comando === 'ola') console.log('Olá,', resto.join(' '));
```

# Como criar um bot de Discord com discord.js
Instale com `npm install discord.js`.
```js
const { Client, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
client.once('ready', () => console.log('Online como', client.user.tag));
client.on('messageCreate', (msg) => {
  if (msg.author.bot) return;
  if (msg.content === '!ping') msg.reply('pong');
});
client.login(process.env.DISCORD_TOKEN);
```

# Como criar um temporizador que repete
```js
const id = setInterval(() => console.log('tick'), 1000);
setTimeout(() => clearInterval(id), 5000);
```
