# Sandbox do `run_shell` (v0.45.0)

O agente roda comandos de shell (`run_shell`). Até a v0.44 a única barreira era a **confirmação**: você via o
comando e respondia `s`/`n`. Sem confirmação — `confirmShell` desligado, uma regra `permitir`, uma rotina
agendada — o comando rodava com todos os seus poderes. Se uma página da web ou um arquivo convencesse o modelo
(prompt injection), ele podia ler `~/.ssh`, mandar a chave para fora ou deixar algo no `~/.bashrc`.

Agora esses comandos rodam numa **sandbox do sistema operacional** (Linux, com o
[bubblewrap](https://github.com/containers/bubblewrap), o mesmo isolamento usado pelo Flatpak).

## O que a sandbox faz

| Dentro da sandbox | |
|---|---|
| Disco | **só leitura**, menos a pasta do projeto (e as que você liberar) |
| `/tmp` e `/run` | vazios e descartáveis — somem quando o comando acaba |
| `~/.gemini-code` (API key, tokens, regras) | **invisível** |
| Credenciais comuns (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.docker`, `~/.config/gh`, `~/.netrc`, `~/.npmrc`, perfis de navegador...) | **invisíveis** |
| Variáveis de ambiente com cara de segredo (`*_KEY`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`...) | não passam |
| Rede | **desligada** (nem a própria máquina); ligue com `config set-sandbox-rede on` |
| `.git` do projeto | **só leitura** (commit e checkout pedem para sair da sandbox) |
| Sockets do sistema (Docker, D-Bus, X11, ssh-agent) | bloqueados (filtro seccomp: nada de socket `AF_UNIX`) |
| Processos | isolados (não vê os seus), sem capabilities, nova sessão de terminal |

Por que o `.git` inteiro só leitura: um hook (`.git/hooks`), o `core.fsmonitor` no `.git/config` ou um
`.git/commondir` apontando para outra config fazem o **próximo `git` que você rodar** (ou as fotos automáticas do
gemini-code) executar um comando escolhido por quem gravou ali — fora da sandbox.

## Quando um comando vai para a sandbox

Regra simples: **se o gemini-code não te perguntou, o comando roda na sandbox.**

| Modo (`config set-sandbox ...`) | Vai para a sandbox |
|---|---|
| `auto` (padrão) | comandos que rodam sem você aprovar na hora: `confirmShell` desligado, regra `permitir`, rotinas. Numa rotina, o comando que pediria confirmação **roda na sandbox** em vez de ser recusado. O que você aprova no terminal roda normal. |
| `sempre` | todos os comandos, mesmo os que você aprova |
| `off` | nenhum (como antes da v0.45.0) |

Se um comando falha por causa da sandbox (precisava de rede, ou gravar fora do projeto), o agente pode pedir para
rodá-lo **fora** dela (`fora_da_sandbox`). Isso **sempre** pergunta, mesmo com `confirmShell` desligado:

```
[gemini-code] O agente quer rodar FORA da sandbox (com rede e acesso aos seus arquivos):
  npm install
Confirmar? (s/n)
```

Comandos destrutivos (`rm -rf`, `git reset --hard`...) e que mexem na config do gemini-code continuam pedindo
confirmação dentro ou fora da sandbox.

## Instalar e conferir

```bash
sudo apt install bubblewrap        # Debian/Ubuntu (Fedora: dnf install bubblewrap; Arch: pacman -S bubblewrap)
gemini-code sandbox                # funciona aqui? o que ela libera e esconde
gemini-code sandbox testar "ls ~/.ssh; curl -sI https://example.com; touch /etc/x"   # veja por você
```

No **Ubuntu 24.04** o AppArmor restringe os namespaces que o bwrap usa; o pacote `bubblewrap` traz um perfil
que o libera. Se `gemini-code sandbox` disser que não funciona, o motivo aparece ali.

O gemini-code só usa um `bwrap` das pastas do sistema (`/usr/bin`, `/usr/local/bin`, `/bin`) ou de uma pasta do
`PATH` que **não** seja uma das que o agente grava (projeto, temporária, pastas liberadas) — senão um `bwrap`
falso plantado pelo próprio modelo seria executado.

## Configuração

```bash
gemini-code config set-sandbox auto|sempre|off
gemini-code config set-sandbox-rede on|off        # internet dentro da sandbox (menos isolado)
gemini-code config add-pasta-gravavel ~/dados     # outra pasta onde o agente grava sem perguntar
gemini-code config rm-pasta-gravavel ~/dados
```

Uma pasta que contém a sua HOME (ou a raiz `/`) não pode ser liberada: o agente poderia gravar no `~/.bashrc`.
Se você abrir o gemini-code **na própria HOME**, a sandbox não deixa gravar nada ali — abra na pasta do projeto.

## Gravar arquivos fora do projeto (`write_file`, `edit_file`, `edit_files`)

Mesmo sem shell, o modelo grava arquivos. Desde a v0.45.0:

- gravar **fora da pasta do projeto** (e fora da temporária e das pastas liberadas) **pergunta antes** — uma
  pergunta só, para todos os arquivos de uma edição. Numa rotina, é recusado. Desligue com
  `config set-confirmar-fora off` (não recomendado).
- aberto na HOME, os arquivos "ponto" dela (`~/.bashrc`, `~/.profile`, `~/.config/...`) contam como fora.
- **nada dentro do `.git`** (hooks, config, `commondir`...) nem um arquivo `.git` (`gitdir: ...`) é gravado pelo
  modelo; para mexer no repositório ele usa o `git` pelo `run_shell`, que pergunta (ou roda na sandbox, com o
  `.git` só leitura).

As fotos automáticas do projeto (`autoGit`) rodam o git com `core.fsmonitor`, `core.hooksPath` e
`commit.gpgSign` anulados, e não tiram foto se a config do repositório definir um filtro (`filter.*.clean`).

## Limites honestos

- **Só Linux.** No Android/Termux o sistema não deixa um app comum criar os namespaces que a sandbox usa; no
  macOS ainda não é suportada; no Windows, não existe. Nesses casos `auto` funciona como antes (a confirmação
  continua valendo) e `sempre` recusa os comandos até haver sandbox.
- Arquiteturas com filtro: x86_64 e arm64.
- A sandbox protege a sua máquina do **comando**; o que o comando grava **no projeto** é responsabilidade do
  projeto (um `package.json` ou `Makefile` alterado roda quando você rodar `npm`/`make` fora dela). O
  `/rewind`, os backups e as fotos do `autoGit` ajudam a desfazer.
- Projeto que ainda não é repositório: dentro da sandbox o agente consegue criar um `.git` novo. O autoGit roda
  blindado (veja acima), mas um `git` seu ali dentro lê a config que o agente escreveu — confira antes.
- Com a rede ligada, um comando ainda pode mandar para fora o que ele **consegue ler** (o projeto e o resto do
  disco que não está escondido).
