# Entrega v0.44.1 — a TV no dia a dia

- Rotinas de TV sem IA (`routines create --tv "tecla dormir" --cron ...`): só ações que não destroem nada (revalidadas na hora de rodar), passos sem perguntar (aprovados na criação), reconexão por Wi-Fi antes, nunca repete, regras "negar" valem.
- `abrir_link` (`gemini-code adb link URL`): vídeo/site aberto no app certo da TV; só http/https, chega literal ao shell da TV.
- Teclas `dormir`/`acordar` (não alternam como o `power`); `liga` agora acorda (antes alternava).
- Aliado da TV: preset `tv` (adb + navegador + web_fetch).
- Corrigido: regras do adb comparavam com JSON e os exemplos da documentação nunca batiam; agora `config permitir "adb(tecla *)"` funciona.
- Navegador: checagem de site com erro barra a navegação (não fica pendurada); evento mal tratado não derruba o processo.
- Testes: 813 (812 passando, 1 pulado como root) no Node 20 e 22 com `ws`. Não testado numa TV de verdade.
