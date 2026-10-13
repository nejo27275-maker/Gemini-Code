# Licenças e atribuições

## Código deste projeto

O código específico do aplicativo Minha IA é disponibilizado sob MIT; veja `LICENSE`.

## Motor de inferência

O projeto `ggml-org/llama.cpp` e seus arquivos têm licença MIT conforme o arquivo `LICENSE` do repositório upstream. A preparação baixa a versão upstream em separado e aplica um patch local às constantes de contexto e lote. Preserve o arquivo de licença e os avisos presentes no clone em `external/llama.cpp`.

Fonte: https://github.com/ggml-org/llama.cpp

## Modelo de linguagem

Os pesos do modelo não são distribuídos com este projeto. O modelo inicial sugerido é `Qwen/Qwen3-1.7B-GGUF`; a página do repositório informa licença Apache-2.0 e fornece seu arquivo de licença. Leia e preserve os termos e avisos da versão exata que você baixar:
https://huggingface.co/Qwen/Qwen3-1.7B-GGUF

A licença do modelo é separada da licença do app e do motor. Ao importar qualquer outro modelo, verifique a licença, a origem, a arquitetura e a permissão de uso pretendido.
