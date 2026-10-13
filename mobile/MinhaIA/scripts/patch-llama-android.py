#!/usr/bin/env python3
"""Apply narrow, idempotent compatibility patches to llama.cpp's Android example."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("Uso: patch-llama-android.py /caminho/para/llama.cpp")
repo = Path(sys.argv[1]).resolve()
impl = repo / "examples/llama.android/lib/src/main/java/com/arm/aichat/internal/InferenceEngineImpl.kt"
if not impl.is_file():
    raise SystemExit(f"ERRO: wrapper Android não encontrado: {impl}")
source = impl.read_text(encoding="utf-8")

patches = [
    (
        '            _state.value = InferenceEngine.State.ModelReady\n        } catch (e: CancellationException) {',
        '            _readyForSystemPrompt = true\n            _state.value = InferenceEngine.State.ModelReady\n        } catch (e: CancellationException) {',
        "rearmar prompt após geração normal",
    ),
    (
        '        } catch (e: CancellationException) {\n'
        '            Log.i(TAG, "Assistant generation\'s flow collection cancelled.")\n'
        '            _state.value = InferenceEngine.State.ModelReady\n'
        '            throw e',
        '        } catch (e: CancellationException) {\n'
        '            Log.i(TAG, "Assistant generation\'s flow collection cancelled.")\n'
        '            _readyForSystemPrompt = true\n'
        '            _state.value = InferenceEngine.State.ModelReady\n'
        '            throw e',
        "rearmar prompt após cancelamento",
    ),
    (
        '                if (result != 0) {\n'
        '                    Log.e(TAG, "Failed to process user prompt: $result")\n'
        '                    return@flow\n'
        '                }',
        '                if (result != 0) {\n'
        '                    Log.e(TAG, "Failed to process user prompt: $result")\n'
        '                    _readyForSystemPrompt = true\n'
        '                    _state.value = InferenceEngine.State.ModelReady\n'
        '                    return@flow\n'
        '                }',
        "restaurar estado quando o prompt do usuário falhar",
    ),
]

for old, new, label in patches:
    if source.count(new) == 1:
        continue
    if source.count(old) != 1:
        raise SystemExit(
            f"ERRO: não apliquei patch '{label}': esperado exatamente um trecho original "
            f"ou o patch já aplicado; original={source.count(old)}, patch={source.count(new)}."
        )
    source = source.replace(old, new, 1)

impl.write_text(source, encoding="utf-8")
print("OK: wrapper llama.android preparado para reconstruir o prompt por turno.")
