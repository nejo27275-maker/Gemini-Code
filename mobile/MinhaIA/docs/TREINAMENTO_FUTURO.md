# Evolução e treinamento futuro

Esta versão não treina nem altera os pesos do modelo. Personalidade vem de instruções de sistema; histórico vem do SQLite; memórias/documentos são texto recuperado e enviado no prompt. Quantização é uma representação numérica reduzida dos pesos de um modelo já treinado, não treinamento adicional.

Uma futura rotina de LoRA/QLoRA deve ser executada em hardware com RAM/VRAM e armazenamento compatíveis, com dados de uso autorizado. Requisitos mínimos para uma avaliação séria:

1. Preservar pesos de origem e registrar hash/licença.
2. Separar treino, validação e teste antes de iniciar o ajuste, evitando exemplos duplicados entre divisões.
3. Registrar dataset, limpeza, parâmetros, duração e equipamento.
4. Definir métricas e casos de teste antes/depois; não declarar melhoria sem evidência.
5. Exportar adapter, documentar compatibilidade e disponibilizar reversão para o modelo original.

Treinar do zero um modelo de bilhões de parâmetros não é uma tarefa realista num telefone com 8 GB de RAM. Não se deve prometer isso nem confundir armazenamento de memórias com treinamento.
