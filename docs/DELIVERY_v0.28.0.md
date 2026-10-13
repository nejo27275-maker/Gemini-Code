# Entrega v0.28.0 — IA local generativa como padrão

- Alterado: `src/config.js` (Ollama como padrão, `qwen3:4b-instruct`), `src/provider.js` (sem chave de nuvem usa modelo generalista local), `src/providers/ollama.js` (mensagem de configuração mais clara), `bin/gemini-code.js` (code-ia limitada só quando selecionada), README e arquitetura.
- Atualizado: versão do pacote para `0.28.0`; instruções para baixar o modelo e operar offline.
- Testes: `npm test` (425 passando). `npm run lint` (verificação sintática aprovada em 116 arquivos; ESLint não está instalado).
- Limites: pesos de `qwen3:4b-instruct` não são incluídos no ZIP; é necessário instalar Ollama e baixar o modelo uma vez. Não testado contra uma instalação Ollama real nem em Termux/Android.
