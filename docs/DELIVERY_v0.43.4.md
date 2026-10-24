# Entrega v0.43.4 — resposta longa não cai mais no tempo limite, e CI no Node 24

- `llamacpp`, `ollama` e `openai` pedem sempre em streaming; o `onText` só decide se os pedaços aparecem. Antes, no `run`, no cowork, nos subagentes e nos workflows, o tempo limite de inatividade valia para a resposta inteira: llama.cpp falhava depois de 180 s de geração e Ollama depois de 300 s (medido: falhou aos 301 s numa geração de 330 s).
- Ollama: mensagem certa para "ficou 5 min sem responder" e para conexão que cai no meio da resposta (antes: "instale o Ollama" ou um `terminated` cru).
- Servidor que ignora o `stream` e responde JSON inteiro continua funcionando (escolha pelo `Content-Type`).
- CI: `actions/checkout` e `actions/setup-node` v7 (fim do aviso do runtime Node 20), `persist-credentials: false`, matriz Node 20, 22 e 24.
- Testes: 783 (782 passando, 1 pulado como root) no Node 20 e 22 com `ws`; no CI, 783/783 no Node 24 e os jobs 20 e 22 verdes; 7 novos com servidores HTTP reais, 6 falham no código anterior. Não testado: Ollama/llama.cpp/modelo de verdade.
