# Entrega v0.43.0 — blindagem

- Corrigido (P1): o token do cowork e todas as tarefas iam abertos pela Wi-Fi; quem capturasse o tráfego rodava o agente inteiro no PC.
- Novo: protocolo 2 do cowork (`src/cowork/canalSeguro.js`) — X25519 efêmero, provas HMAC do token nos dois sentidos, AES-256-GCM com contador estrito. O token nunca passa pela rede; PC falso não recebe tarefas; repetição/adulteração derrubam a conexão; sigilo futuro.
- Contra sobrecarga: cowork com teto de conexões, prazo de 10 s para autenticar, IP barrado após 5 falhas, teto de mensagens e uma tarefa por vez; API de rotinas com prazos anti-slowloris, teto de conexões, memória limitada e bloqueio após 10 tokens errados (`src/limitador.js`).
- `gemini-code cowork novo-token`; o recurso de agentes pessoais virou **Aliados** (`gemini-code aliados`).
- Testes: 740 (739 passando, 1 pulado como root), 18 novos com ataques simulados; transporte real conferido à mão com o `ws` embutido no Playwright; ESLint 10 limpo nos arquivos tocados.
- Limites: protocolo próprio sem auditoria externa; DDoS distribuído se barra na rede; ofuscação não foi feita (código aberto, nenhum segredo no código).
