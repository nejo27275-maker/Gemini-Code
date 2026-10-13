#!/usr/bin/env python3
"""Static checks that can run without Android SDK/Gradle/device."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
required = [
    "settings.gradle.kts", "build.gradle.kts", "gradle.properties", "gradle/libs.versions.toml",
    "app/build.gradle.kts", "app/src/main/AndroidManifest.xml", "app/src/main/java/br/com/minhaia/MainActivity.kt",
    "app/src/main/java/br/com/minhaia/ChatStore.kt", "app/src/main/java/br/com/minhaia/AiProfile.kt",
    "app/src/main/java/br/com/minhaia/PromptComposer.kt", "app/src/test/java/br/com/minhaia/PromptComposerTest.kt",
    "scripts/bootstrap-llama.sh", "scripts/patch-llama-android.py", "scripts/build-apk.sh", "scripts/install-apk.sh", "scripts/check-environment.sh",
    "docs/ARQUITETURA.md", "docs/INSTALACAO.md", "docs/OFFLINE.md", "docs/MODELOS.md", "docs/PRIVACIDADE.md", "docs/TESTES.md", "docs/TREINAMENTO_FUTURO.md", "LICENSE", "LICENSES.md", "README.md"
]
errors = []
for rel in required:
    if not (ROOT / rel).is_file(): errors.append(f"Arquivo obrigatório ausente: {rel}")

manifest_path = ROOT / "app/src/main/AndroidManifest.xml"
try:
    manifest = ET.parse(manifest_path).getroot()
    android_ns = "{http://schemas.android.com/apk/res/android}"
    app = manifest.find("application")
    if app is None: errors.append("Manifesto sem elemento application")
    if any(node.tag.endswith("uses-permission") and node.attrib.get(android_ns + "name") == "android.permission.INTERNET" for node in manifest):
        errors.append("A permissão INTERNET está presente, contrariando o requisito offline")
    if app is not None:
        acts = app.findall("activity")
        if not any(a.attrib.get(android_ns + "name") == ".MainActivity" for a in acts):
            errors.append("MainActivity não está declarada no manifesto")
except Exception as exc:
    errors.append(f"Manifesto XML inválido: {exc}")

for xml in (ROOT / "app/src/main/res/values/styles.xml",):
    try: ET.parse(xml)
    except Exception as exc: errors.append(f"XML inválido {xml.relative_to(ROOT)}: {exc}")

main = (ROOT / "app/src/main/java/br/com/minhaia/MainActivity.kt").read_text(encoding="utf-8")
for phrase in ("AiChat.getInferenceEngine", "loadModel", "sendUserPrompt", "setSystemPrompt", "copyAndValidateModel", "ChatStore"):
    if phrase not in main: errors.append(f"Ponto de integração ausente: {phrase}")

prompt = (ROOT / "app/src/main/java/br/com/minhaia/PromptComposer.kt").read_text(encoding="utf-8")
if "MAX_SYSTEM_PROMPT_CHARS" not in prompt: errors.append("Limite de contexto não está configurado")

patcher = (ROOT / "scripts/patch-llama-android.py").read_text(encoding="utf-8")
if "_readyForSystemPrompt" not in patcher or "CancellationException" not in patcher: errors.append("Patch de contexto por turno não está presente")

if errors:
    print("FALHA na validação estática:")
    for err in errors: print(" -", err)
    sys.exit(1)
print(f"OK: {len(required)} arquivos obrigatórios presentes.")
print("OK: manifesto e recursos XML bem formados.")
print("OK: nenhuma permissão INTERNET declarada no manifesto.")
print("OK: integração JNI/llama.android e limites básicos de contexto presentes.")
print("NOTA: validação estática não substitui compilação, testes do motor ou teste no dispositivo.")
