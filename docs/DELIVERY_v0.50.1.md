# Entrega v0.50.1 — acabamento para vídeo de celular e a edição posta à prova

- **Vídeo HDR** (iPhone, celular top de linha):
  - **antes:** saía em 8 bits ainda marcado como HDR, com as cores desbotadas nas redes;
  - **agora:** `editar`, `juntar` e `capa` convertem para SDR BT.709 (`zscale` + `tonemap`, HLG e PQ);
  - o `info` mostra quando o vídeo é HDR;
  - sem `zscale`, o resultado avisa.
- **Edição tolerante:** o espaço do fim da linha vai junto com o trecho. Antes, sobrava um tab colado.
- **Prévia do `/passo`:** o diff de verdade, com números de linha. Num segredo do gemini-code, nunca o conteúdo.
- **Medido, sem bug achado:**
  - 100.000 edições sorteadas no motor;
  - 20.000 textos no `-print` do ImageMagick;
  - caminhos com `'`, `:`, `,`, `[`, `]` no ffmpeg;
  - vídeo de celular gravado em pé.
- **Testes:** +8 (3 de código, 4 de vídeo, 1 de foto). Os de HDR, do espaço e da prévia falham no código anterior.
- **Teste das redes que dependia da carga da máquina:**
  - **Antes:** provava o paralelismo pelo tempo de relógio, e falhou uma vez com os testes de vídeo pesados rodando ao
    lado.
  - **Agora:** prova pelo servidor falso: as 7 redes com o pedido aberto ao mesmo tempo. Medido igual com a máquina
    folgada e sobrecarregada. Com a publicação em sequência, o teste falha.
