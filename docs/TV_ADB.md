# Controlar a TV e outros aparelhos por ADB

O gemini-code fala **adb** (Android Debug Bridge), a ferramenta oficial de desenvolvedor do Android.
Com ela o agente controla **aparelhos seus** — uma Android TV (Google TV, Sony, Philips, Xiaomi, Fire
TV…), um celular ou um tablet — por cabo USB ou pela rede local. Serve para ver o que está instalado,
abrir e instalar apps, navegar na TV como se fosse o controle, ajustar configurações, tirar print e
depurar.

> **Só nos seus aparelhos.** O adb só conecta onde o dono ligou a depuração e **confiou** nesta máquina
> (o aparelho mostra um aviso e pede confirmação na primeira vez). Não dá para "invadir" a TV do vizinho
> com isto, e esse não é o objetivo.

## 1. Instalar o adb

- **Termux (Android):** `pkg install android-tools`
- **Debian/Ubuntu:** `sudo apt install adb`
- **macOS:** `brew install android-platform-tools`
- **Windows:** baixe o "SDK Platform Tools" do Android.

Se o `adb` não estiver no PATH: `gemini-code config set-adb-path /caminho/do/adb`.

## 2. Ligar a depuração na TV

1. Em **Configurações → Sobre**, clique várias vezes em **Número da versão** até aparecer "Você agora é
   um desenvolvedor".
2. Em **Configurações → Sistema → Opções do desenvolvedor**, ligue **Depuração USB** e, para controlar
   sem cabo, **Depuração por rede/Wi-Fi** (ou "ADB over network").
3. Anote o **IP** da TV (Configurações → Rede).

## 3. Conectar

```bash
gemini-code adb conectar 192.168.0.50        # a TV mostra um aviso: aceite "sempre confiar"
gemini-code adb dispositivos                 # confirme que aparece "device" (e não "unauthorized")
gemini-code adb info                         # marca, modelo, versão do Android
```

Se só tem cabo USB e quer passar para Wi-Fi: com o cabo ligado, rode `gemini-code adb tcpip 5555` e
depois `gemini-code adb conectar <ip>`.

### TVs com Android 11 ou mais novo (Google TV, Chromecast com Google TV...)

Essas usam **Depuração por Wi-Fi** com **código de pareamento** (uma vez só por máquina):

1. Na TV: Opções do desenvolvedor → **Depuração por Wi-Fi** → **Parear dispositivo com código**. A tela
   mostra um código de 6 dígitos e um `ip:porta` de pareamento.
2. No PC/celular:

```bash
gemini-code adb descobrir                         # lista o que a TV anuncia na rede (se o roteador deixar)
gemini-code adb parear 192.168.0.50:37099 482915  # ip:porta DE PAREAMENTO e o código da tela
gemini-code adb conectar 192.168.0.50:41235       # ip:porta mostrado na tela "Depuração por Wi-Fi" (outra porta)
```

A porta de pareamento e a de conexão são diferentes, e a de conexão muda quando a TV reinicia — o
`descobrir` mostra a atual. Parear pede confirmação (é dar confiança a esta máquina).

Para usar sempre o mesmo aparelho sem repetir o IP: `gemini-code config set-adb-serial 192.168.0.50:5555`.

## 4. No chat, peça em português

Com a TV conectada, abra `gemini-code chat` (ou um Aliado) e peça naturalmente — o agente usa a
ferramenta `adb`:

- "quais apps estão instalados na TV?"
- "abre o YouTube na TV"
- "desce três vezes e entra" (ele manda as teclas do controle)
- "tira um print da tela da TV"
- "por que o app X está travando? olha o logcat"
- "acha o trailer de Duna e passa na TV" (ele procura com o navegador e abre o vídeo no app da TV com `abrir_link`)

**Um aliado só para a TV** — com as ferramentas certas (adb, navegador e `web_fetch`) e o seu jeito de pedir:

```bash
gemini-code aliados criar tv --ferramentas tv --descricao "controla a TV da sala" \
  --instrucoes "Você controla a Android TV da sala (alvo 192.168.0.50:5555). Prefira abrir vídeos com abrir_link."
gemini-code aliados chat tv
```

Também dá para usar direto pela linha de comando:

```bash
gemini-code adb apps                         # apps instalados pelo usuário
gemini-code adb abrir com.google.android.youtube.tv
gemini-code adb tecla baixo                  # cima, baixo, esquerda, direita, ok, voltar, home, play, volume+/- ...
gemini-code adb tecla dormir                 # desliga a tela; "acordar" liga (o "power" ALTERNA: liga se estiver desligada)
gemini-code adb link https://www.youtube.com/watch?v=XXXX   # abre o vídeo no app do YouTube da TV
gemini-code adb digitar "crianca sabia"      # escreve no campo em foco
gemini-code adb tela                          # salva um print .png
gemini-code adb logcat 300                    # últimas 300 linhas de log
gemini-code adb shell "dumpsys battery"       # comando livre no aparelho (pede confirmação)
```

## Automatizar a TV (rotinas, sem IA)

Comandos para a TV num horário, sem gastar nada de IA e sem precisar de internet (só a rede local):

```bash
# todo dia às 23h: desliga a tela da TV
gemini-code routines create --name "Dormir" --tv "tecla dormir" --cron '0 23 * * *' --alvo 192.168.0.50

# sábado às 9h: acorda a TV, espera ela ligar e abre os desenhos
gemini-code routines create --name "Desenhos" --tv "tecla acordar" --tv "esperar 5" \
  --tv "link https://www.youtube.com/watch?v=XXXX com.google.android.youtube.tv" --cron '0 9 * * 6' --alvo 192.168.0.50

gemini-code routines activate ID     # a rotina nasce como rascunho
gemini-code routines service         # o agendador (precisa ficar rodando, ex.: no PC ou no Termux)
gemini-code routines run ID          # testar agora
```

- Um `--tv` por passo, na ordem: `tecla`, `abrir`/`abrir_app`, `fechar`, `link`, `digitar`, `esperar N` (1–60 s), `estado`, `info`.
- **Nunca** numa rotina: reiniciar, desinstalar, limpar dados, instalar, configurações e o shell livre (a rotina recusa).
- Os passos rodam sem perguntar — você os aprovou ao criar. As regras `negar` continuam valendo.
- TV por Wi-Fi: a rotina reconecta antes (a conexão do adb cai quando a TV dorme). Se não conectar, a execução falha e conta o motivo (`routines logs`); `--notificar` avisa no celular/PC.
- Não repete sozinha se falhar: repetir um "power" desfaria o primeiro. Use `dormir`/`acordar`, que não alternam.

Também dá para agendar o **agente** mexendo na TV (`--prompt "..." --ferramentas adb`), mas sem ninguém olhando ele só faz o que não pede confirmação — libere ações específicas com regras, ex.: `gemini-code config permitir "adb(tecla *)"`.

## Segurança

- Toda ação que **muda** o aparelho (conectar, instalar, abrir/fechar app, abrir link, digitar, tecla, configuração,
  `shell`, reiniciar) pede **confirmação** no terminal. Leitura (listar, info, apps, estado, print, log)
  não pede. Para liberar ações específicas sem perguntar, use regras escritas como o comando, ex.:
  `gemini-code config permitir "adb(tecla *)"` (todas as teclas) ou
  `gemini-code config permitir "adb(abrir_app com.netflix*)"`; bloqueie o que não quiser com
  `gemini-code config negar "adb(desinstalar *)"` ou `config negar "adb"` (tudo; vale para o agente em qualquer modo).
- Reiniciar, desinstalar, limpar dados, gravar em configurações `secure`/`global` e o `shell` livre
  avisam em destaque e pedem confirmação **sempre** — mesmo com `adbConfirm:false` ou uma regra
  "permitir". (Um comando livre não dá para classificar com segurança: `pm uninstall` e `reboot` não
  parecem perigosos para uma heurística feita para comandos de PC.)
- Nesta máquina o `adb` roda sem shell (lista de argumentos). **No aparelho**, o `adb shell` junta os
  argumentos com espaço sem escapar e o shell da TV os interpreta; por isso cada argumento (texto
  digitado, valor de configuração, nome de app) vai entre aspas simples e chega literal — `a;reboot`
  é digitado, não executado. Só o `shell` livre é interpretado, de propósito, e por isso sempre pergunta.
- O texto da pergunta de confirmação aparece sem o terminal interpretar caracteres de controle (um
  `\r` ou uma sequência ESC não conseguem "apagar" parte do que você está aprovando).
- O print (`tela`) só cria um `.png` novo e nunca dentro das pastas protegidas do gemini-code.

## Rodar o gemini-code DENTRO da TV

Android TV é Android, então dá para rodar o próprio agente na TV via **Termux** (instale o Termux por
sideload — `adb install termux.apk` — já que a Play Store da TV não o traz). Dentro do Termux da TV o
gemini-code funciona como em qualquer Android (veja `ANDROID_TERMUX.md`): modelo local por `llama.cpp`
ou nuvem. Lembre que a TV costuma ter pouca RAM e não tem teclado — na prática é mais confortável deixar
o agente rodando no PC/celular e **controlar a TV por adb** (este guia) do que digitar na própria TV.

## Limites honestos

- Não foi testado aqui contra uma TV de verdade (este ambiente não tem adb nem aparelho): os testes
  usam um `adb` falso que confere os comandos montados. Marcas diferentes têm nomes de app e caminhos de
  configuração diferentes; o agente descobre com `apps`/`estado`, mas pode errar o pacote.
- Controlar por adb não "deixa a TV mais rápida" por mágica. O que dá para fazer de concreto: fechar e
  limpar apps pesados, desinstalar o que não se usa, e ajustar configurações de desenvolvedor (por ex.
  as escalas de animação) — tudo com a sua confirmação. Nada disso altera o sistema de fábrica nem burla
  bloqueios do aparelho.
