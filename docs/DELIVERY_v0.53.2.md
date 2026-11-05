# Entrega v0.53.2 — o microfone de verdade, e o Termux quando o Chrome não deixa

- **O pedido de verdade:** ao tocar no microfone, o site faz o pedido padrão do navegador (`getUserMedia`) e solta o
  microfone na hora para o reconhecimento. É esse pedido que faz o Chrome perguntar "Permitir?". A 0.53.1 parava
  antes, sem pedir, quando a consulta dizia "bloqueado".
- **Cada recusa com o seu caminho** (`comum.js`, `mensagemDeErroDeVoz`), com o detalhe do navegador no fim:
  - o site bloqueado, e o Chrome inteiro (Configurações do site › Microfone);
  - o Android sem dar o microfone ao Chrome;
  - o pedido fechado sem resposta;
  - o reconhecedor do Android recusando com o microfone liberado (o app Google, outro app ouvindo, outro navegador).
- **O Termux quando o navegador não deixa:** o site ouve pelo app Termux:API (`/api/ouvir`), no chat e na esfera. Daí
  em diante, nesta aba, o microfone é o dele; tocar de novo cancela.
- **A rota `/api/ouvir`:**
  - roda o `termux-speech-to-text` sem argumentos, só um fora das pastas em que o agente grava;
  - um por vez, nunca no meio de uma resposta, com prazo de 45 s;
  - fechar o pedido ou "Parar" encerra o comando e os filhos dele;
  - só o texto ouvido volta, limpo, e ele não vai para o log.
- **O proxy do navegador:** cancela o pedido de saída quando a página desiste dele.
- **Testes:** +7. O teste de "pedir mesmo com a consulta dizendo bloqueado" e o do proxy falham no código anterior.
- **Guia:** "Se o microfone não funcionar" e "Ouvir pelo Termux" em `docs/MODO_SITE.md`.
- **Não testado:** o Chrome e o Termux:API de um celular de verdade. Aqui o pedido do microfone, o reconhecimento e o
  Termux são simulados.
