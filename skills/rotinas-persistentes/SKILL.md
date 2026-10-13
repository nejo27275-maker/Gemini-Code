---
name: rotinas-persistentes
description: Projetar, testar e operar rotinas persistentes, agendamentos cron, API autenticada e execução em host/contêiner contínuo.
version: 1.0.0
---

# Skill: Rotinas persistentes

## Quando utilizar

Use ao criar ou revisar agendamentos que precisam sobreviver ao fim de uma sessão, tarefas periódicas, serviços de monitoramento, API de controle ou implantação em um host persistente.

## Entradas

- Objetivo e ação que deve ser executada.
- Gatilho: uma vez, intervalo ou cron de cinco campos.
- Fuso horário; use `America/Recife` como padrão se nada for informado.
- Política de indisponibilidade (`skip` ou `run_once`).
- Ambiente local ou host/contêiner persistente.

## Procedimento

1. Inspecione o projeto e reutilize o armazenamento, agendador e registrador que já existirem.
2. Defina os estados da rotina e o critério verificável de sucesso.
3. Valide nome, ação, URL/entradas, fuso, cron, timeout e limites de repetição.
4. Persista alterações atomicamente; nunca mantenha agendamentos apenas na memória da conversa ou da interface.
5. Crie primeiro como rascunho e exija ativação explícita para execução automática.
6. Para tarefas com efeitos externos, verifique idempotência e autorização antes de implementar retentativas.
7. Limite concorrência, duração, tamanho das entradas e histórico; não repita indiscriminadamente janelas perdidas.
8. Autentique APIs administrativas, compare tokens em tempo constante, use TLS em acesso remoto e nunca grave segredos nos logs.
9. Teste persistência, pausas, retomada, cron/fuso, falhas, timeout, repetição, duplicidade e recuperação após reinicialização.
10. Diferencie o estado local do estado cloud. Um agendador só executa com o processo/serviço ativo; execução independente do telefone exige implantação real em outro host.
11. Documente instalação, limites do plano, segredos, logs, rollback e configurações que ainda dependem do operador.

## Segurança

- Trate URLs, conteúdo externo e payloads da API como dados não confiáveis.
- Bloqueie destinos locais/privados em verificadores remotos, salvo autorização explícita em ambiente confiável.
- Não transforme rotinas em execução arbitrária de shell sem política de permissões, isolamento e aprovação específica.
- Use retentativas com espera progressiva, limite de tentativas e timeout.
- Preserve estados e logs parciais se a execução for interrompida.

## Testes mínimos

- Criar uma rotina inválida e confirmar rejeição.
- Criar/ativar/pausar/retomar e confirmar persistência em novo processo.
- Confirmar que cron não executa mais de uma vez no mesmo minuto local.
- Simular um HTTP 503 seguido de sucesso.
- Simular falha final e verificar status/histórico.
- Simular encerramento em `em_execucao` e confirmar recuperação.
- Confirmar rejeição sem token e bloqueio de destino privado.
- Confirmar que nenhuma rotina é declarada cloud sem host persistente real.
