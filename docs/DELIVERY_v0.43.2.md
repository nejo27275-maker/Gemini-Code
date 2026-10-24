# Entrega v0.43.2 — revisão completa

- P1 corrigido: injeção de comando no aparelho pelo adb (`adb shell` junta os argumentos sem escapar e o shell da TV interpreta; `digitar "a;reboot"` reiniciava a TV). Argumentos agora vão entre aspas (`noAparelho`). A v0.43.1 dizia "sem injeção" — errado para o lado do aparelho.
- P2 corrigidos: `shell` livre e gravações em `secure`/`global` do adb rodavam sem confirmação com `adbConfirm:false`/"permitir"; `adb tela` gravava em qualquer caminho; perguntas de confirmação enganáveis por `\r`/ESC/caracteres de direção; resposta do modelo chegava ao terminal com OSC 52 (área de transferência), limpar tela, links disfarçados.
- Novo `src/ui/textoSeguro.js` (`paraExibir` nas confirmações, `paraTerminal` na saída do modelo).
- ESLint 10 recomendado: 0 apontamentos no projeto inteiro (eram 31). Um teste que não chamava o que prometia testar foi consertado.
- Testes: 767 (766 passando, 1 pulado como root). Cada correção tem teste que falha no código anterior.
