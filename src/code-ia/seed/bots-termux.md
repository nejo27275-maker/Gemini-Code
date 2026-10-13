# Como guardar placar e partidas de um bot de Discord no SQLite
Cria as tabelas na primeira vez e usa `?` nos valores (nunca junte texto do usuário no SQL).
```js
const Database = require('better-sqlite3');
const db = new Database('bot.db');
db.exec(`CREATE TABLE IF NOT EXISTS jogadores (id TEXT PRIMARY KEY, nome TEXT, vitorias INTEGER DEFAULT 0, derrotas INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS partidas (id INTEGER PRIMARY KEY AUTOINCREMENT, modo TEXT, vencedor TEXT, criada_em TEXT DEFAULT CURRENT_TIMESTAMP);`);

const registrar = db.transaction((vencedor, perdedor, modo) => {
  db.prepare('INSERT OR IGNORE INTO jogadores (id, nome) VALUES (?, ?)').run(vencedor.id, vencedor.nome);
  db.prepare('INSERT OR IGNORE INTO jogadores (id, nome) VALUES (?, ?)').run(perdedor.id, perdedor.nome);
  db.prepare('UPDATE jogadores SET vitorias = vitorias + 1 WHERE id = ?').run(vencedor.id);
  db.prepare('UPDATE jogadores SET derrotas = derrotas + 1 WHERE id = ?').run(perdedor.id);
  db.prepare('INSERT INTO partidas (modo, vencedor) VALUES (?, ?)').run(modo, vencedor.id);
});
const ranking = db.prepare('SELECT nome, vitorias FROM jogadores ORDER BY vitorias DESC LIMIT 10').all();
```

# Como receber o aviso de pagamento (webhook) do Mercado Pago em um bot
O Mercado Pago chama uma URL sua quando o pagamento muda. Responda 200 rápido e confira o status consultando a API (não confie só no corpo recebido).
```js
const express = require('express');
const app = express();
app.use(express.json());
app.post('/webhook/mp', async (req, res) => {
  res.sendStatus(200);
  const id = req.body && req.body.data && req.body.data.id;
  if (!id) return;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } });
  const pagamento = await r.json();
  if (pagamento.status === 'approved') console.log('pago:', id); // libere a partida/produto aqui, uma única vez
});
app.listen(3000);
```
Guarde o id já processado no banco pra não liberar duas vezes se o aviso repetir. A URL precisa ser pública (https), por exemplo com um túnel.

# Como criar um canal privado para cada partida no Discord com discord.js
```js
const { ChannelType, PermissionFlagsBits } = require('discord.js');
async function criarSala(guild, jogadores, nome) {
  return guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...jogadores.map((j) => ({ id: j.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
    ],
  });
}
// no fim da partida: await canal.delete();
```

# Como dar e tirar cargo de um membro no Discord com discord.js
O cargo do bot precisa estar ACIMA do cargo que ele vai dar, e o bot precisa da permissão Gerenciar Cargos.
```js
const membro = await interaction.guild.members.fetch(userId);
await membro.roles.add('ID_DO_CARGO');
await membro.roles.remove('ID_DO_CARGO');
```

# Como usar embed e menu de seleção no discord.js
```js
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const embed = new EmbedBuilder().setTitle('Escolha o modo').setDescription('1v1, 2v2 ou 4v4').setColor(0x00aa88);
const menu = new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId('modo').setPlaceholder('Modo de jogo')
    .addOptions({ label: '1v1', value: '1v1' }, { label: '2v2', value: '2v2' }, { label: '4v4', value: '4v4' }),
);
await interaction.reply({ embeds: [embed], components: [menu] });
// depois: if (interaction.isStringSelectMenu() && interaction.customId === 'modo') interaction.values[0]
```

# Como instalar o better-sqlite3 e pacotes que compilam no Termux
Pacotes nativos precisam das ferramentas de compilação.
```bash
pkg update && pkg upgrade
pkg install python make clang binutils
npm install better-sqlite3
```
Se falhar, rode `npm install` de novo vendo o erro; muitas vezes falta `python`, `make` ou `clang`.

# Como atualizar os pacotes do Termux e resolver erro de repositório
```bash
pkg update && pkg upgrade -y
termux-change-repo      # escolhe outro espelho se der erro de download
pkg install nome-do-pacote
pkg search palavra
```

# Como pegar o tamanho e a bateria do celular pelo Termux
```bash
termux-battery-status
df -h $HOME
free -h
```

# Como expor um servidor do Termux na internet com túnel
Para receber webhook de fora da sua rede sem abrir porta no roteador.
```bash
pkg install cloudflared
cloudflared tunnel --url http://localhost:3000
```
Ele mostra uma URL https pública que aponta para o seu servidor local. A URL muda cada vez que reinicia.

# Como evitar que o Termux feche sozinho com tarefa longa usando wake lock
```bash
termux-wake-lock
pm2 start index.js --name bot
```
Tire a otimização de bateria do Termux nas configurações do Android e mantenha a notificação dele ativa.
