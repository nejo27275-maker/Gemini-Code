# Como chamar a API do Gemini com fetch
Pegue a chave em https://aistudio.google.com/apikey e guarde em variável de ambiente.
```js
const modelo = 'gemini-3.6-flash';
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
  body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Explique recursão em 2 frases' }] }] }),
});
const data = await r.json();
console.log(data.candidates?.[0]?.content?.parts?.[0]?.text);
```
Erro 429 significa cota esgotada: espere o tempo que a resposta indicar e envie de novo.

# Como conversar com o Ollama local pela API
Rode `ollama serve` em outra sessão do Termux e baixe um modelo com `ollama pull qwen2.5-coder:3b`.
```js
const r = await fetch('http://127.0.0.1:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'qwen2.5-coder:3b', stream: false, messages: [{ role: 'user', content: 'Oi' }] }),
});
const data = await r.json();
console.log(data.message.content);
```

# Como receber a resposta de uma IA em streaming no Node.js
```js
const res = await fetch(url, opcoes);
const reader = res.body.getReader();
const dec = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(dec.decode(value, { stream: true }));
}
```

# Como fazer comandos com barra (slash commands) no discord.js
```js
const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const comandos = [new SlashCommandBuilder().setName('ping').setDescription('Responde pong').toJSON()];
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: comandos });

client.on('interactionCreate', async (i) => {
  if (i.isChatInputCommand() && i.commandName === 'ping') await i.reply('pong');
});
```

# Como criar botões no discord.js
```js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const linha = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('aceitar').setLabel('Aceitar').setStyle(ButtonStyle.Success)
);
await interaction.reply({ content: 'Confirma?', components: [linha] });
client.on('interactionCreate', (i) => { if (i.isButton() && i.customId === 'aceitar') i.update({ content: 'Aceito!', components: [] }); });
```
