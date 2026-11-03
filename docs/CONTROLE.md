# Controlar o celular, o computador e sites (v0.47.0)

O agente usa os seus aparelhos como uma pessoa: lê a tela, toca/clica, digita, aperta teclas. **Cada ação que muda
alguma coisa pergunta antes** — e o print da tela do computador também (a tela pode mostrar qualquer coisa, e o print
vai para o modelo). Nada disso roda numa rotina (ninguém olhando) nem para um convidado do cowork.

Tudo junto numa conversa: `gemini-code aliados criar central --ferramentas central` → `gemini-code aliados chat central`
(computador, celular/TV, sites, redes sociais e desafios).

## Celular e TV (Android, por adb)

Configuração: `docs/TV_ADB.md` (depuração USB ou por Wi-Fi). Novidade: usar a **tela**.

```bash
gemini-code adb ui                    # o que está na tela: cada botão/campo com o texto e a posição
gemini-code adb tocar Enviar          # toca pelo texto do botão (ou: adb tocar 540 1210)
gemini-code adb deslizar cima         # o dedo sobe = a lista anda (ou: adb deslizar 100 1500 100 300)
gemini-code adb segurar "Maria"       # toque longo
gemini-code adb digitar "oi, tudo bem?"
```

No chat, o agente faz o mesmo com a ferramenta `adb` (ações `ui`, `tocar`, `deslizar`, `segurar`): lê a tela, acha o
botão pelo texto e toca. Campo de senha nunca mostra o conteúdo — quem digita senha é você. O texto da tela chega ao
modelo marcado como conteúdo de terceiros (uma mensagem dizendo "ignore as instruções..." não vira ordem).

**Controlar o próprio celular onde o gemini-code roda (Termux):** Android 11+ → Opções do desenvolvedor → Depuração
por Wi-Fi → "Parear com código"; no Termux: `pkg install android-tools`, `gemini-code adb parear localhost:PORTA CODIGO`
e `gemini-code adb conectar localhost:PORTA` (a porta de conexão aparece na tela da Depuração por Wi-Fi).

Para liberar ações sem perguntar: `gemini-code config permitir "adb(tocar *)"` (ou `"adb(deslizar *)"`). Tocar e
deslizar **não** entram em rotinas de TV: tocar numa tela que ninguém está vendo pode apertar qualquer coisa.

## Computador e notebook

```bash
gemini-code computador                # o que funciona aqui e o que falta instalar
gemini-code computador tela           # print da tela inteira (.png novo)
gemini-code computador clicar 640 400 [--direito] [--duplo]
gemini-code computador digitar "relatório de outubro"
gemini-code computador tecla ctrl+s   # enter, esc, tab, alt+tab, super, cmd+space, ctrl+shift+t...
gemini-code computador rolar baixo 5
gemini-code computador janelas | focar "Firefox" | abrir https://site.com | abrir relatorio.pdf | abrir Calculadora
```

| Sistema | Mouse e teclado | Print | Instalar |
|---|---|---|---|
| Linux (X11) | xdotool | import (ImageMagick), maim, scrot ou gnome-screenshot | `sudo apt install xdotool imagemagick wmctrl` |
| Linux (Wayland) | ydotool (com o serviço ydotoold) | grim | `sudo apt install grim ydotool` |
| macOS | cliclick (clique) e osascript (teclado) | screencapture | `brew install cliclick`; dar ao Terminal as permissões de Acessibilidade e Gravação de Tela |
| Windows | PowerShell (já vem) | PowerShell | nada |

No chat, a ferramenta `computador` (aliados `computador` ou `central`): ela tira o print, a ferramenta `imagem`
(ação "descrever") diz o que tem e onde, e ela clica/digita — perguntando a cada ação. Para abrir um programa em
qualquer sistema: tecla `super`, digitar o nome, tecla `enter`. "abrir" aceita site, arquivo/pasta ou app instalado,
**nunca** um comando (comando é com o `run_shell`, que tem a sandbox). Liberar sem perguntar:
`gemini-code config permitir "computador(tecla *)"`; bloquear: `gemini-code config negar "computador(digitar *)"`.

Sem tela gráfica (SSH, servidor, Termux) não dá para controlar o computador; do celular, mande a tarefa para o PC pelo
**cowork** (`gemini-code cowork ...`), que roda o agente lá.

## Sites (navegador do agente)

A ferramenta `browser` abre o Chrome/Chromium e navega: abrir, ler (com os elementos numerados), clicar, digitar,
**selecionar** (opção de uma lista), **esperar** (um texto aparecer), teclas, rolar, voltar, print.

- `gemini-code config set-navegador-visivel on` abre o Chrome **com janela**: você acompanha, entra na sua conta ou
  resolve uma verificação ali, e o agente continua dali. As regras de sempre continuam: perfil temporário (sem as suas
  contas salvas), só sites que você aprovou, sem acesso à rede local.
- **Verificação humana (CAPTCHA, "não sou um robô", "verifique que você é humano"):** o agente **não resolve nem tenta
  contornar** — a leitura da página avisa em destaque e ele para e pede para você resolver (com o navegador visível).
  Burlar essas verificações é contra as regras dos sites e é exatamente o que elas existem para impedir.

## Limites honestos

- Celular: testado com um adb falso que confere o que o aparelho executaria; não num aparelho de verdade. Jogos,
  vídeos e alguns apps não deixam o uiautomator ler a tela (aí: print + toque por posição).
- Computador: os comandos de cada sistema são conferidos um a um nos testes e a execução foi testada com programas
  falsos no Linux; **não** foi testado numa tela de verdade (este ambiente não tem uma), nem no Mac ou no Windows.
- Em tela Retina (Mac), as posições do print são o dobro das do clique.
