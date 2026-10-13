# Entrega v0.30.0 — espera opcional do 429

- Nova opção `esperarCotaSegundos` (padrão 0) e comando `config set-wait-quota SEGUNDOS`.
- Espera o tempo pedido pelo Google (até o teto) e repete uma vez; ignora `limit: 0` e 429 sem tempo.
- Testes: 435 passando; lint de sintaxe ok. Não testado com a API real nem em Termux real.
