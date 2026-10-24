# Entrega v0.43.1 — ADB: controlar a TV e outros aparelhos

- Novo: ferramenta `adb` (`src/tools/adbTools.js`) e comando `gemini-code adb`. Controla Android TV/celular/tablet do usuário por USB ou Wi-Fi: apps, navegação por teclas, digitar, settings, print, logcat, reiniciar, shell. Guia em `docs/TV_ADB.md`.
- Segurança: comandos como lista de argumentos via execFile (sem shell/injeção); ações que mudam o aparelho pedem confirmação (irreversíveis sempre); regras negar/permitir valem; config adbPath/adbSerial/adbPorta/adbConfirm.
- Só funciona em aparelho onde o dono ligou a depuração e confiou na máquina — não é invasão.
- Testes: 20 novos (adb falso que confere os argumentos). Não testado contra TV real (sem adb nem aparelho aqui). ESLint 10 limpo.
