# Funcionamento offline

O manifesto Android não declara a permissão `INTERNET`. O chat invoca o motor local; não envia mensagens para servidores. SQLite, perfil, memórias, documentos TXT e modelo ficam no armazenamento privado do aplicativo.

A internet é necessária antes ou durante a preparação inicial para: obter o código-fonte de `llama.cpp`, baixar ferramentas de build/dependências se ainda não estiverem em cache e baixar o peso do modelo escolhido. O app não baixa modelos automaticamente em segundo plano.

## Teste do usuário

1. Confirme que um modelo foi carregado e que uma pergunta simples recebeu resposta.
2. Ative o modo avião e confirme que Wi-Fi e dados móveis continuam desligados.
3. Force o fechamento do aplicativo e reabra-o.
4. Faça nova pergunta, confirme que o histórico anterior aparece e que a geração continua funcionando.
5. Anote modelo/quantização, versão de Android/One UI, tempo de carregamento, duração de resposta, temperatura antes/depois e memória disponível.
6. Desative modo avião somente depois de terminar os testes.

Uma checagem estática da ausência de `INTERNET` é útil, mas não substitui o teste no aparelho. O resultado do teste offline físico permanece pendente nesta entrega.
