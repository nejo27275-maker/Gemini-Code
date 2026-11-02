# Assistente de saúde (v0.46.0)

> **Não é um médico.** O gemini-code não diagnostica, não receita, não muda dose nem manda parar remédio. Ele
> organiza o que você mede e sente, compara com faixas de referência para adultos, lembra os remédios, avisa quando
> procurar atendimento e monta um relatório para você levar à consulta.
>
> **Emergência: SAMU 192 · Bombeiros 193 · CVV (apoio emocional, 24 h) 188 · Disque-Intoxicação 0800 722 6001**

## Anotar

```bash
gemini-code saude anotar pressao 13x8          # também "13 por 8", "130/80", "130/80 72" (com o pulso)
gemini-code saude anotar glicemia 98 jejum     # ou "pos" (2 h depois de comer)
gemini-code saude anotar peso 72,5             # com a altura salva (saude altura 1,70), mostra o IMC
gemini-code saude anotar temperatura 37,9
gemini-code saude anotar saturacao 97          # oxímetro
gemini-code saude anotar batimentos 80
gemini-code saude anotar sintoma "dor de cabeça desde ontem"
gemini-code saude tomei "losartana"            # remédio tomado agora
```

Cada anotação volta com a comparação, por exemplo:

```
Anotado: Pressão 130/80 mmHg
130/80 está na faixa de pré-hipertensão (130–139/85–89). Vale acompanhar.
```

Datas passadas: `--quando "2026-11-02 08:00"`. Observação: `--nota "depois do almoço"`.

## Faixas de referência (adultos)

| Medida | Normal | Atenção | Procure atendimento |
|---|---|---|---|
| Pressão (SBC 2020) | < 130/85 | 130–139/85–89 (pré-hipertensão); ≥ 140/90 (hipertensão, se repetir) | ≥ 180/120 — com sintomas, 192 |
| Glicemia em jejum (SBD) | 70–99 | 100–125; ≥ 126 (leve à consulta) | < 54 ou ≥ 300 com sintomas |
| Glicemia 2 h após comer | < 140 | 140–199; ≥ 200 | |
| Temperatura | < 37,8 °C | 37,8 °C (febre); ≥ 39 °C (alta) | ≥ 40 °C ou < 35 °C |
| Saturação | ≥ 95% | 92–94% (meça de novo) | < 92%; < 90% → 192 |
| Batimentos em repouso | 50–100 | > 100 ou < 50 | > 130 ou < 40 com sintomas |
| IMC (OMS) | 18,5–24,9 | < 18,5; 25–29,9; ≥ 30 | |

Hipoglicemia (< 70): a orientação é a **regra dos 15** — 15 g de açúcar (meio copo de suco ou 1 colher de sopa de
açúcar), medir de novo em 15 minutos. Se o seu médico definiu outra meta para você, vale a dele.

## Triagem de emergência

Antes de a IA responder, o gemini-code procura **sinais de alerta** no que você escreveu, por regras fixas (não
depende da IA reconhecer): dor ou aperto no peito, falta de ar, sinais de AVC (boca torta, fala enrolada, fraqueza de
um lado), desmaio, convulsão, sangramento forte, pensamentos de suicídio, intoxicação, reação alérgica grave, dor de
cabeça súbita e muito forte, bebê com febre ou prostrado, gestante com sinal de alerta, acidente grave. Se achar, o
aviso aparece na hora:

```
ATENÇÃO — isto pode ser uma emergência:
  • sinais de AVC (derrame): ligue 192 (SAMU) agora e anote a hora em que começou — cada minuto conta.
```

Conferir um texto: `gemini-code saude triagem "estou com a boca torta"`. Nada encontrado **não** quer dizer que está
tudo bem — se piorar ou você estiver preocupado, procure atendimento.

## Remédios e lembretes

```bash
gemini-code saude remedio add "Losartana" --horarios 08:00,20:00 --dose 50mg
gemini-code saude remedio lista
gemini-code saude remedio remover ID
gemini-code routines service       # o agendador precisa estar rodando para as notificações chegarem
```

No celular, as notificações usam o Termux:API (`pkg install termux-api` e o app Termux:API).

## Relatório e página para a consulta

```bash
gemini-code saude resumo --dias 30
gemini-code saude pagina --dias 90 --abrir     # saude-AAAA-MM-DD.html: gráficos, médias, remédios, todos os registros
```

A página é um arquivo só (sem nada carregado da internet), com gráficos, que dá para imprimir. Ela tem dados de
saúde: cuidado ao compartilhar.

## Conversar: o aliado de saúde

```bash
gemini-code saude aliado            # cria o aliado "saude"
gemini-code aliados chat saude      # "minha pressão deu 14 por 9 agora", "como foi minha glicemia este mês?"
```

Só esse aliado tem as ferramentas `saude_registrar` e `saude_consultar`. O chat comum não vê o diário (a não ser que
você ligue com `gemini-code config ferramentas-extras saude_consultar`).

## Privacidade

- Tudo fica em `~/.gemini-code/saude/` (permissão só do seu usuário). Nada é enviado para a internet pelo gemini-code.
- As ferramentas de arquivo do agente (`read_file`, `search_files`, imagem...) **não leem nem gravam** essa pasta; a
  sandbox do shell também a esconde.
- Ao conversar com o aliado, o que você escreve vai para o modelo configurado (Gemini, por exemplo). Para máxima
  privacidade, use um modelo local (`gemini-code config set-provider llamacpp`).
