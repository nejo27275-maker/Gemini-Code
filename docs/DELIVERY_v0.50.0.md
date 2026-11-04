# Entrega v0.50.0 — editar como um profissional: código, vídeo e foto

- **Código:**
  - o `write_file` não sobrescreve o que o agente não leu, nem o que mudou depois da leitura;
  - cada edição volta com o diff e os números de linha;
  - a sintaxe (JS, JSON, Python, shell) é conferida depois da edição, só analisando;
  - o CRLF e o BOM são mantidos;
  - o trecho é achado mesmo com espaço sobrando no fim da linha; quando não acha, mostra o trecho mais parecido;
  - o `edit_file` usa o núcleo do `edit_files`: ganhou o `replace_all` e recusa Latin-1.
- **Vídeo** (`gemini-code video editar|juntar|capa|audio|info`, e a ferramenta `video`):
  - a receita: corte, velocidade, cor, formato de cada rede com fundo desfocado, legenda, textos, fade, marca d'água,
    música que abaixa na fala e volume de -14 LUFS;
  - tudo no ffmpeg do aparelho, sem IA.
- **Foto** (`gemini-code imagem ajustar`, e a ação "ajustar" da ferramenta `imagem`):
  - formato de cada rede, cor, ajustes, textos, marca d'água, lote e tamanho leve;
  - tira o EXIF/GPS por padrão, depois de endireitar.
- **Segurança:**
  - o texto nunca entra no filtro do ffmpeg;
  - o texto do ImageMagick é escapado (`@`, `%`, `\`);
  - o conferidor de sintaxe nunca roda o código, nem um `python3`/`bash` plantado.
- **Testes:**
  - 3 arquivos novos, com 41 testes, rodando com ffmpeg e ImageMagick de verdade;
  - 13 testes de código falham no código anterior.
- **Suíte inteira:** 1049 no Node 22 (1048 passando, 1 pulado como root). ESLint 0 problemas.
- **Guia:** `docs/EDICAO.md`.
