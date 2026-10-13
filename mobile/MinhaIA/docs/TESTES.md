# Testes e critérios de aceite

## Checagens executadas neste ambiente de criação

| Checagem | Resultado | Observação |
|---|---|---|
| Estrutura/configuração fonte criada | PASSOU | Projeto Android, Gradle, Kotlin, scripts e documentação presentes. |
| XML do manifesto/recursos | PASSOU | `scripts/validate-source.py` analisou os XML disponíveis. |
| Sintaxe dos scripts Bash | PASSOU | `bash -n` executado nos quatro scripts do projeto. |
| `INTERNET` no manifesto | PASSOU | Nenhuma permissão `INTERNET` no manifesto app. |
| Integração Android com llama.cpp | PARCIAL | APIs esperadas conferidas contra a fonte upstream atual; não foi possível baixar/compilar a dependência neste ambiente. |
| Testes unitários Kotlin | Pendente | Exigem Gradle, SDK e dependências; ainda não executados. |
| Compilação Android/NDK | Pendente | Este ambiente não dispõe de Android SDK, NDK, Gradle ou ADB; a rede deste contêiner não conseguiu resolver a origem GitHub. |
| APK gerado | NÃO GERADO | Não existe APK declarado como concluído. |
| Instalação e abertura no Galaxy A55 | Pendente | Nenhum dispositivo físico está conectado. |
| Inferência com modelo GGUF | Pendente | Requer build nativo, APK e modelo instalado. |
| Modo avião após setup | Pendente | Requer teste físico com rádio desligado. |
| Persistência após reabrir | Pendente | Requer teste físico do app. |
| Cancelamento de geração | Pendente | A UI cancela a coroutine; a interrupção nativa precisa de validação no aparelho. |
| RAM / tempo de carregamento / tokens por segundo / aquecimento | Pendente | Medidas reais só podem ser produzidas no Galaxy A55. |

## Validação estática

```bash
bash -n scripts/bootstrap-llama.sh scripts/check-environment.sh scripts/build-apk.sh scripts/install-apk.sh
python3 -m py_compile scripts/validate-source.py scripts/patch-llama-android.py
python3 scripts/validate-source.py
```

## Testes de aceitação no aparelho

Registre os resultados em uma cópia desta tabela ao testar: build e instalação; importar GGUF suportado; enviar/perguntar e receber tokens; cancelar geração; reiniciar app; apagar histórico e memórias separadamente; importar TXT e confirmar recuperação; exportar/importar backup; repetir em modo avião; medir RAM/tempo/temperatura.
