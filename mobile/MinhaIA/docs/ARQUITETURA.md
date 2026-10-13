# Arquitetura

## Fluxo de inferência

1. O usuário importa um arquivo `.gguf` pelo seletor de documentos Android.
2. O app copia o arquivo para `filesDir/models/`, limita o tamanho, confirma o cabeçalho `GGUF` e verifica o espaço disponível.
3. A biblioteca upstream `examples/llama.android/lib` inicializa `llama.cpp` via JNI e carrega um único modelo na instância de inferência.
4. A cada turno, o aplicativo compõe o prompt de sistema com perfil, histórico recente, memórias autorizadas e trechos relevantes de TXT local.
5. O motor gera tokens no aparelho; a interface recolhe o fluxo em coroutine.
6. As mensagens são registradas no SQLite privado.

## Decisões para um aparelho com 8 GB

- Arquitetura Android ARM64 (`arm64-v8a`) e execução CPU como linha de base. Nenhuma aceleração por GPU é presumida.
- Perfil inicial: Qwen3 1.7B quantizado Q4_K_M.
- Contexto nativo definido para 2.048 tokens e lote de 128 pelo script de preparação. O script também ajusta o wrapper Kotlin para permitir redefinir o prompt após concluir/cancelar um turno; assim o histórico e a memória SQLite podem ser reconstruídos sem recarregar os pesos. Os patches falham se a fonte upstream tiver mudado de modo inesperado.
- Máximo de geração configurável de 32 a 512 tokens; padrão 192.
- Somente um modelo fica carregado por vez. Outros arquivos GGUF importados ficam no armazenamento privado até serem selecionados.
- Recuperação lexical para memórias/documentos; sem banco vetorial ou execução de scripts incorporados aos documentos.

## Limites

- O contexto do motor é resetado a cada turno para reconstruir o histórico persistido como texto do prompt de sistema. O contexto enviado é limitado para reduzir risco de ultrapassar os 2.048 tokens; truncamento de caracteres não equivale a contagem exata de tokens.
- O cabeçalho GGUF é uma verificação preliminar, não uma validação completa de tensores.
- O projeto depende de uma versão específica da estrutura `examples/llama.android` no repositório upstream. A preparação falha se não encontrar os símbolos usados no patch.
- Não há inferência por GPU explicitamente habilitada, monitoramento automático de temperatura nem métrica confiável de tokens por segundo implementada na UI nesta alpha.
