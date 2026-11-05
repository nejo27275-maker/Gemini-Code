# Entrega v0.45.1 — caça aos bugs nas ferramentas

- Estresse: 1.248 chamadas às ferramentas com argumentos ruins e 672 comandos do terminal com argumentos vazios/errados; depois, revisão do código de cada ferramenta.
- Corrigido (segurança): um pedido HTTP malformado, sem token, derrubava o serviço de rotinas; agora 400.
- Corrigido: servidor MCP com nome comprido ou com ponto, ou com esquema JSON completo (zod/pydantic), fazia a API recusar o pedido inteiro; nomes expostos seguem a regra e o esquema é traduzido para o Gemini (`src/schemaGemini.js`).
- Corrigido: `browser` declarava tipos em maiúsculas (inválido para llama.cpp/OpenAI).
- `search_files`: arquivo como path, `\r\n`, `file_glob` com glob, `.gitignore`, regex do modelo numa thread com prazo (antes podia travar o processo), trecho centrado.
- `run_checks` segue a regra da sandbox; convidado só na sandbox; prazo maior; `cwd` no `/tmp` visível só leitura na sandbox.
- `web_fetch` respeita "permitir"; argumentos nulos/ruins e JSON quebrado de modelo local viram erro claro; falha ao gravar vira mensagem com o motivo; `read_skill` por pasta e por nome; `glob_files` nos perfis só leitura.
- Testes: 871 (870 passando, 1 pulado como root) no Node 20 e 22 com a sandbox real; no CI, 871/871 nos Node 20, 22 e 24. A tradução do esquema não foi testada contra a API do Google (sem chave aqui).
