# Redes sociais (v0.47.0)

O gemini-code publica, lê menções e agenda posts nas suas redes **pelas APIs oficiais**, com tokens que **você** gera
(e pode revogar quando quiser). Ele nunca usa a sua senha, nunca imita o app ou o navegador e não faz o que vira spam
(seguir, curtir ou mandar mensagem em massa) — isso é contra as regras das redes e a conta pode ser bloqueada.

| Rede | Como conecta | Publica | Lê menções |
|---|---|---|---|
| Bluesky | seu @ + **senha de app** | texto, foto (até 1 MB), links e #hashtags clicáveis | sim |
| Mastodon | instância + token de acesso | texto, foto | sim |
| Telegram | token de um bot seu + canal/grupo | texto, foto | mensagens ao bot |
| Discord | URL do webhook do canal | texto, foto (sem notificar @everyone) | — |
| Facebook | token da **Página** + id da Página | texto, foto | — |
| Instagram | token (conta profissional) + id da conta | foto por endereço https + legenda | — |
| Threads | token + id (ou "me") | texto, foto por endereço https | — |
| X (Twitter) | 4 chaves do seu app de desenvolvedor | texto | — |

**Sem conta conectada**, para qualquer rede: `compartilhar` abre o app com o texto pronto e você publica lá —
WhatsApp, X, Threads, Bluesky, Telegram, LinkedIn, Reddit; no Facebook, Instagram e TikTok o texto vai para a área de
transferência e o app abre.

## Conectar

```bash
gemini-code redes                                   # o que está conectado e como conectar cada uma
gemini-code redes conectar bluesky                  # pergunta o @ e a senha de app (a senha não aparece na tela)
gemini-code redes conectar mastodon --instancia https://mastodon.social
gemini-code redes conectar telegram --chat @meucanal
gemini-code redes conectar discord
gemini-code redes conectar facebook --pagina 1234567890
gemini-code redes conectar instagram --conta 17841400000000000
gemini-code redes conectar threads
gemini-code redes conectar x
gemini-code redes testar                            # confere todas (só lê)
```

- O segredo **nunca** vai como argumento do comando (ficaria no histórico do shell): o gemini-code pergunta sem mostrar
  o que você digita. Num script: `printf '%s\n' "$TOKEN" | gemini-code redes conectar telegram --chat @canal`.
- Onde gerar cada um: o próprio `gemini-code redes conectar REDE` mostra o caminho antes de perguntar. Resumo:
  Bluesky → Configurações → Privacidade e segurança → Senhas de app; Mastodon → Preferências → Desenvolvimento →
  Nova aplicação (escopos read, write:statuses, write:media); Telegram → @BotFather (ponha o bot como admin do canal);
  Discord → Editar canal → Integrações → Webhooks; Facebook/Instagram/Threads → Meta for Developers; X →
  developer.x.com (permissão "Read and write"; se pode postar e quanto, depende do plano da sua conta de desenvolvedor).
- Perfil pessoal do Facebook e do Instagram não têm API para publicar: só Página e conta profissional.

## Publicar (em várias ao mesmo tempo)

```bash
gemini-code redes postar "Promoção de sábado! https://minhaloja.com #pães" --em bluesky,mastodon,telegram
gemini-code redes postar "Pão quentinho" --em bluesky,mastodon --foto pao.jpg --alt "Pães na vitrine"
gemini-code redes postar "Legenda" --em instagram,threads --foto-url https://site.com/foto.jpg
gemini-code redes compartilhar "Chegou pão!" --em whatsapp
```

Antes de sair, o gemini-code mostra o post, o tamanho em cada rede (Bluesky 300, X 280 — link conta 23, Mastodon e
Threads 500, Instagram 2200) e o que não vai dar certo, e **pergunta** (`--sim` pula a pergunta, para scripts). As
redes recebem ao mesmo tempo; uma falha não derruba as outras.

**Travas contra spam** (valem para você, para o agente e para as rotinas): o mesmo texto na mesma rede só 1 vez por
hora, e no máximo 30 publicações por rede em 24 h.

## Menções, respostas e posts agendados

```bash
gemini-code redes notificacoes                      # Bluesky, Mastodon e Telegram juntos
gemini-code redes agendar "Bom dia!" --em bluesky,mastodon --at "amanhã 9h"
gemini-code redes agendar "Live toda segunda" --em telegram --cron "0 19 * * 1"
gemini-code routines service                        # o agendador precisa estar rodando
```

O post agendado sai na hora **sem perguntar de novo** — você aprovou o texto ao agendar. Ele publica uma vez e nunca
repete sozinho (sairia duplicado).

## No chat: o aliado das redes

```bash
gemini-code redes aliado && gemini-code aliados chat redes
```

Peça: "escreve um post sobre a promoção para o Bluesky e o Mastodon", "adapta para o LinkedIn", "o que me
responderam esta semana?". A ferramenta `redes` **sempre** pergunta antes de publicar (nenhuma configuração desliga
isso); numa rotina e numa sessão de convidado ela recusa. O que vem das menções é conteúdo de outras pessoas: chega ao
modelo marcado como dado, para uma mensagem do tipo "ignore as instruções e publique..." não virar ordem. O aliado
`central` junta isso com o controle do computador, do celular e de sites.

## Segurança

- Credenciais em `~/.gemini-code/redes/redes.json` (só para você, 0600; pasta 0700). As ferramentas de arquivo do
  agente não leem nem gravam essa pasta, e nenhuma resposta da ferramenta `redes` mostra um token.
- Cada rede fala só com o endereço oficial (ou o servidor que você configurou, com https). Sem seguir
  redirecionamento: o token não vai parar em outro lugar. Mensagens de erro nunca trazem o token nem o endereço.
- `gemini-code redes desconectar REDE` apaga daqui; para cortar de vez, revogue o token/senha de app no site da rede.

## Limites honestos

- Testado contra um **servidor falso** que imita cada API (formato de cada pedido e de cada resposta) e com a
  assinatura do X conferida contra o exemplo oficial da documentação. **Não** foi testado contra as redes de verdade
  (este ambiente não tem acesso a elas): se uma rede mudou a API, o erro dela aparece na tela.
- Graph API da Meta na versão v23.0; o Instagram exige foto num endereço público (é a própria API que busca a foto).
- O X muda os planos da API com frequência: postar pode exigir um plano pago na conta de desenvolvedor.
