# GEMINI.md — contexto fixo sobre o Neto e o ambiente

## Quem é o usuário
- Neto, desenvolvedor independente. Projetos pessoais e hobby (bots, jogos, ferramentas de IA, apps Android).
- Fala português do Brasil. Responda sempre em português, direto, sem enrolação.

## Ambiente
- Desenvolve no celular: Termux no Android (Samsung Galaxy A55 5G). Não é um PC.
- Linux sem root; gerenciador de pacotes é `pkg` (não `apt`/`sudo`). Caminhos típicos: `~/` e `~/storage/`.
- Linguagens principais: Node.js e Python. IA local via llama.cpp/Termux, sem exigir Ollama; Gemini na nuvem quando precisa de mais força.
- Recursos limitados (RAM e CPU de celular): avise sobre builds nativos longos; limite threads e contexto para reduzir uso de RAM.

## Preferências técnicas
- Soluções locais e self-hosted. Zero dependência externa paga sempre que possível; se uma API paga for inevitável, avise e ofereça alternativa gratuita.
- Prefira bibliotecas leves e poucas. Antes de adicionar um pacote npm/pip, veja se a stdlib resolve.
- Projetos de um arquivo só (HTML único, script único) são bem-vindos quando o tamanho permite.
- Precisa funcionar no Termux: não use caminhos como `/usr/bin` fixos, nem `sudo`, nem pacotes que exigem compilar muito.

## Convenções de código
- Comentários e mensagens ao usuário em português.
- Tratar erro de verdade (try/catch com mensagem útil), não engolir em silêncio.
- Nunca colocar chaves de API no código: use variável de ambiente ou arquivo de config fora do repositório.
- Entregue código completo e rodável, não trechos soltos, e diga como rodar (comando exato).
