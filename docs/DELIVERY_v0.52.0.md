# Entrega v0.52.0 — o site só com a chave do Gemini, criar imagem, o modo até terminar e o treinador de futebol

- **O site só com a chave do Gemini:**
  - **Sem chave:** a página pede a chave, confere com o Google numa chamada que não gasta cota (a lista de modelos) e
    salva. A chave nunca volta para a página nem vai para o log.
  - **Com chave:** a conversa vai direto para a nuvem, sem depender do modelo local do modo híbrido.
  - **Com um aliado:** as sugestões da tela inicial são as dele.
- **Criar imagem:**
  - o formato das redes (`--formato feed|stories|youtube|...`) vai para a API como proporção;
  - um formato desconhecido é recusado antes de gastar cota;
  - o erro `limit: 0` fala do modelo de imagem e do comando certo;
  - "sempre" libera nesta execução.
- **Modo até terminar:**
  - **Como funciona:** o agente marca o fim, e sem a marca o gemini-code manda continuar.
  - **Limites:** 25 continuações e 400 passos. Para também com duas respostas iguais seguidas (ou vazias), sem
    ferramenta no meio. O Parar e as permissões continuam valendo.
  - **Onde ligar:** no terminal (`/ate-terminar`, `run --ate-terminar`, `config set-ate-terminar`) e no site (o botão).
  - **No site:** a página fechada não para o agente, e ao voltar você vê o andamento.
- **Treinador de futebol** (`docs/FUTEBOL.md`):
  - **O aliado "treinador":** instruções de treinador de elite, sem fingir ser uma pessoa real.
  - **A ferramenta `futebol`:** sob demanda e sem IA. Faz o treino (25 exercícios, 12 temas, sub-7 a veterano), a
    semana (MD-4 a MD-1, também com 2 jogos), a carga (sRPE, ACWR, monotonia) e a prancheta (PNG e SVG).
- **Corrigido na revisão** (cada um com teste):
  - **Treino:** o sub-11 repetia o exercício principal, e os goleiros entravam nos grupos do aquecimento.
  - **Prancheta:** nomes encostavam no do lado, emoji virava buraco e o título era cortado em 18 letras.
  - **Carga:**
    - o "hoje" era o dia em UTC (em São Paulo, depois das 21h, já era amanhã);
    - com menos de 3 semanas de registros, dava um alarme falso de "aumento brusco".
  - **Modo até terminar:** duas respostas vazias gastavam as 25 continuações, e a mesma frase depois de uma ferramenta
    contava como "sem avançar".
- **Testes:**
  - **Novos:** +37 (11 do treinador, 12 do site, 10 do modo até terminar, 4 de criar imagem).
  - **Suíte inteira:** 1119 testes no Node 22, no 20 e no fuso de São Paulo (1118 passando, 1 pulado como root).
- **Checagens:** ESLint com 0 problemas, varredura de segredos limpa e autoteste das avaliações 7/7.
- **Demonstração** (prints num Chromium com a tela de um Pixel 7):
  - **De verdade:** o servidor, a página e a ferramenta `futebol` (o treino e a prancheta com o ImageMagick).
  - **Roteiro:** o texto que liga as partes, a continuação do modo até terminar e a resposta "ok" do Google à chave,
    porque aqui não há modelo de IA nem internet.
- **Não testado:** uma chave de verdade conferida com o Google, a imagem criada pelo Gemini, um modelo de verdade
  seguindo as marcas de fim e a conversa com o aliado treinador.
