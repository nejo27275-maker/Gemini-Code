# Como instalar Node.js e Python no Termux
```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts python git
node -v && python --version
```

# Como dar acesso ao armazenamento do celular no Termux
```bash
termux-setup-storage
ls ~/storage/shared
```
Aceite a permissão que o Android mostrar.

# Como manter o Termux rodando com a tela apagada
Use o wake lock para o Android não matar o processo:
```bash
termux-wake-lock
```
Para liberar depois: `termux-wake-unlock`. Também desative a otimização de bateria do Termux nas configurações do Android.

# Como descobrir o IP do celular na rede Wi-Fi
```bash
ifconfig 2>/dev/null | grep 'inet ' || ip addr show wlan0
```
Use esse IP, com a porta do servidor, em outro aparelho da mesma rede.

# Como rodar um programa em segundo plano no Termux
```bash
nohup node servidor.js > log.txt 2>&1 &
echo $!
```
O número mostrado é o PID. Para parar: `kill PID`.

# Como descompactar e compactar zip no Termux
```bash
pkg install -y unzip zip
unzip projeto.zip -d projeto
zip -r projeto.zip projeto
```

# Como criar um script bash que roda sozinho
```bash
#!/data/data/com.termux/files/usr/bin/bash
set -e
echo "Iniciando..."
cd "$(dirname "$0")"
node index.js
```
Depois torne executável: `chmod +x iniciar.sh` e rode com `./iniciar.sh`.

# Como instalar dependências de um projeto Node
```bash
npm install
npm install nome-do-pacote
npm link
```
`npm link` deixa o comando disponível globalmente.

# Como usar o git no básico
```bash
git init
git add .
git commit -m "primeira versão"
git log --oneline
git status
```

# Como usar loop e condição no bash
```bash
for arq in *.txt; do
  if [ -s "$arq" ]; then echo "$arq tem conteúdo"; else echo "$arq está vazio"; fi
done
```

# Como agendar uma tarefa que roda sozinha no Termux
```bash
pkg install -y cronie termux-services
sv-enable crond
crontab -e
```
Exemplo de linha no crontab, roda todo dia às 8h: `0 8 * * * node /data/data/com.termux/files/home/bot/rotina.js`.

# Como criar branch e juntar mudanças no git
```bash
git checkout -b minha-ideia
git add . && git commit -m "mudança"
git checkout main
git merge minha-ideia
```

# Como procurar texto em arquivos pelo terminal
```bash
grep -rn "texto" src/
find . -name "*.js" -not -path "./node_modules/*"
```
