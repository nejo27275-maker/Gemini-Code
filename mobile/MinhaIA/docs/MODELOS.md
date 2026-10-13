# Modelos locais

## Primeiro teste sugerido

- Repositório: `Qwen/Qwen3-1.7B-GGUF`
- Arquivo: `Qwen3-1.7B-Q4_K_M.gguf`
- Tamanho listado no repositório quando consultado: cerca de 1,11 GB.
- Licença indicada pelo repositório: Apache-2.0; verifique a licença e o README na página antes de usar.
- Página: https://huggingface.co/Qwen/Qwen3-1.7B-GGUF

Essa escolha fica abaixo da faixa solicitada de 2B–3B, mas é deliberada como primeiro ponto de estabilidade em um celular com 8 GB. Depois de confirmar carregamento, resposta e estabilidade térmica, teste outros modelos de 2B–4B com arquivo GGUF compatível e quantização Q4. Peso em disco não é igual ao pico de RAM: KV cache, estruturas do modelo, buffers nativos, UI e Android também consomem memória.

Não há promessa de português perfeito, raciocínio sem erros ou velocidade mínima. Compare os resultados no aparelho e anote quantização e versão exatas do motor.

## Importação

1. Obtenha o arquivo diretamente da página do repositório do modelo, ou de outra fonte confiável com licença permissiva verificada.
2. Aguarde o download completo e confira tamanho/hash, se o repositório fornecer um hash oficial.
3. No app, use `Modelo GGUF` → `Importar outro GGUF` e escolha o arquivo `.gguf`.
4. O app copia para armazenamento privado e checa a assinatura inicial. O motor faz validações adicionais ao carregar.

Não renomeie arquivos de outros formatos para `.gguf`; extensão não converte o formato.
