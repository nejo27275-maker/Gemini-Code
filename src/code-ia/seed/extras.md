# Como criar um Pix com a API do Mercado Pago em Node.js
Cria o pagamento e devolve o código "copia e cola" e o QR. Use o Access Token só no servidor (nunca no front).
```js
const crypto = require('crypto');
async function criarPix(valor, email, descricao) {
  const r = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ transaction_amount: valor, description: descricao, payment_method_id: 'pix', payer: { email } }),
  });
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${await r.text()}`);
  const p = await r.json();
  const dados = p.point_of_interaction.transaction_data;
  return { id: p.id, copiaECola: dados.qr_code, qrBase64: dados.qr_code_base64 };
}
```
Para saber se pagou, consulte `GET /v1/payments/{id}` e veja se `status === 'approved'` (ou receba o webhook de notificação).

# Como fazer várias tarefas ao mesmo tempo com Promise.all
Roda em paralelo e espera todas; se uma falhar, o Promise.all rejeita. Use allSettled pra ter o resultado de cada uma.
```js
const [a, b] = await Promise.all([fetch(urlA).then((r) => r.json()), fetch(urlB).then((r) => r.json())]);

const resultados = await Promise.allSettled(urls.map((u) => fetch(u)));
for (const r of resultados) {
  if (r.status === 'fulfilled') console.log('ok', r.value.status);
  else console.error('falhou', r.reason.message);
}
```

# Como capturar erro que derruba o programa no Node.js (unhandledRejection)
Registre os dois eventos no começo do programa pra registrar o erro em vez de morrer calado.
```js
process.on('unhandledRejection', (motivo) => console.error('Promise sem catch:', motivo));
process.on('uncaughtException', (erro) => {
  console.error('Erro não tratado:', erro);
  process.exit(1); // estado pode estar corrompido: saia e deixe o pm2/systemd reiniciar
});
```

# Como manter um programa Node rodando e reiniciar se cair com pm2
O pm2 reinicia o processo sozinho e guarda os logs.
```bash
npm install -g pm2
pm2 start index.js --name meu-bot
pm2 logs meu-bot
pm2 restart meu-bot
pm2 stop meu-bot
pm2 list
```

# Como validar o corpo de uma requisição POST no Express
Ative o parser de JSON e confira os campos antes de usar.
```js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/pedido', (req, res) => {
  const { nome, quantidade } = req.body || {};
  if (typeof nome !== 'string' || !nome.trim()) return res.status(400).json({ erro: 'nome é obrigatório' });
  if (!Number.isInteger(quantidade) || quantidade < 1) return res.status(400).json({ erro: 'quantidade inválida' });
  res.status(201).json({ ok: true, nome, quantidade });
});
app.listen(3000);
```

# Como proteger rotas do Express com um middleware de senha ou token
Middleware é uma função (req, res, next) que roda antes da rota.
```js
function exigirToken(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token !== process.env.API_TOKEN) return res.status(401).json({ erro: 'não autorizado' });
  next();
}
app.get('/admin', exigirToken, (req, res) => res.json({ segredo: 'só pra quem tem token' }));
```

# Como usar Map e Set em JavaScript
Map guarda pares chave/valor (qualquer tipo de chave); Set guarda valores sem repetir.
```js
const placar = new Map();
placar.set('ana', 10);
placar.set('beto', 7);
console.log(placar.get('ana'), placar.has('beto'), placar.size);
for (const [nome, pontos] of placar) console.log(nome, pontos);

const unicos = [...new Set([1, 2, 2, 3, 3])]; // [1, 2, 3]
```

# Como usar desestruturação e spread em JavaScript
```js
const { nome, idade = 18 } = usuario;       // pega campos (com valor padrão)
const [primeiro, ...resto] = lista;          // pega o 1º e junta o resto
const copia = { ...usuario, idade: 20 };     // copia objeto trocando um campo
const juntos = [...lista1, ...lista2];       // junta arrays
const profunda = structuredClone(usuario);   // cópia profunda (Node 17+)
```

# Como agendar uma tarefa em horário fixo no Node.js com node-cron
Instale com `npm install node-cron`. O formato é "minuto hora dia mês dia-da-semana".
```js
const cron = require('node-cron');
cron.schedule('0 12 * * *', () => console.log('roda todo dia às 12h'), { timezone: 'America/Sao_Paulo' });
cron.schedule('*/5 * * * *', () => console.log('a cada 5 minutos'));
```

# Como criar e rodar um container com Docker
```bash
docker build -t meu-app .
docker run -d --name meu-app -p 3000:3000 --env-file .env meu-app
docker logs -f meu-app
docker stop meu-app && docker rm meu-app
```
Dockerfile mínimo para Node:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "index.js"]
```

# Como fazer uma consulta SQL com filtro, ordem e junção
```sql
SELECT p.id, p.nome, c.nome AS categoria
FROM produtos p
JOIN categorias c ON c.id = p.categoria_id
WHERE p.preco < 50
ORDER BY p.nome
LIMIT 20;

INSERT INTO produtos (nome, preco) VALUES ('Camisa', 39.9);
UPDATE produtos SET preco = 35 WHERE id = 1;
DELETE FROM produtos WHERE id = 1;
```
Nunca monte SQL juntando texto do usuário: use parâmetros (`?`) no driver.

# Como usar f-string e formatar texto em Python
```python
nome, preco = "Ana", 12.5
print(f"Olá, {nome}! Total: R$ {preco:.2f}")
print(f"{1234567:,}".replace(",", "."))   # 1.234.567
print(f"{nome:>10}|{preco:<8}|")          # alinha à direita / esquerda
```

# Como ler e escrever arquivo CSV em Python
```python
import csv
with open("dados.csv", newline="", encoding="utf-8") as f:
    for linha in csv.DictReader(f):
        print(linha["nome"], linha["preco"])

with open("saida.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["nome", "preco"])
    w.writerow(["Camisa", 39.9])
```

# Como mostrar a imagem da câmera no navegador com Flask e OpenCV
Lê frames com OpenCV e manda como stream MJPEG numa rota do Flask.
```python
import cv2
from flask import Flask, Response

app = Flask(__name__)
camera = cv2.VideoCapture(0)

def frames():
    while True:
        ok, frame = camera.read()
        if not ok:
            break
        _, jpg = cv2.imencode(".jpg", frame)
        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpg.tobytes() + b"\r\n"

@app.route("/video")
def video():
    return Response(frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

app.run(host="0.0.0.0", port=5000)
```

# Como processar JSON no terminal com jq
```bash
pkg install jq
curl -s https://api.exemplo.com/dados | jq '.itens[] | {id, nome}'
jq -r '.nome' pessoa.json
jq 'length' lista.json
```

# Como usar o fetch com cabeçalho de autorização e enviar JSON
```js
const r = await fetch('https://api.exemplo.com/itens', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TOKEN}` },
  body: JSON.stringify({ nome: 'teste' }),
});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
const dados = await r.json();
```
