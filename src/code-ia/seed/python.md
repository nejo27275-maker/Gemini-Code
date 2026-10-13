# Como ler e escrever arquivo em Python
```python
with open('arquivo.txt', 'r', encoding='utf-8') as f:
    texto = f.read()

with open('saida.txt', 'w', encoding='utf-8') as f:
    f.write('conteúdo')
```

# Como ler e salvar JSON em Python
```python
import json
with open('dados.json', encoding='utf-8') as f:
    dados = json.load(f)
dados['contador'] = dados.get('contador', 0) + 1
with open('dados.json', 'w', encoding='utf-8') as f:
    json.dump(dados, f, ensure_ascii=False, indent=2)
```

# Como fazer requisição HTTP em Python
Instale com `pip install requests`.
```python
import requests
r = requests.get('https://api.exemplo.com/dados', timeout=15)
r.raise_for_status()
print(r.json())
```

# Como rodar um comando do terminal em Python
```python
import subprocess
r = subprocess.run(['ls', '-la'], capture_output=True, text=True)
print(r.stdout)
```

# Como criar uma classe em Python
```python
class Jogador:
    def __init__(self, nome):
        self.nome = nome
        self.vida = 100

    def levar_dano(self, valor):
        self.vida = max(0, self.vida - valor)
        return self.vida
```

# Como criar um servidor web simples com Flask
Instale com `pip install flask`.
```python
from flask import Flask, jsonify, request
app = Flask(__name__)

@app.get('/')
def inicio():
    return 'Olá!'

@app.post('/dados')
def dados():
    return jsonify(recebido=request.get_json())

app.run(host='0.0.0.0', port=3000)
```

# Como usar lista, dicionário e compreensão em Python
```python
nums = [5, 2, 9, 1]
pares = [n for n in nums if n % 2 == 0]
dobro = {n: n * 2 for n in nums}
ordenado = sorted(nums)
```

# Como ler argumentos da linha de comando em Python
```python
import argparse
p = argparse.ArgumentParser()
p.add_argument('arquivo')
p.add_argument('--vezes', type=int, default=1)
args = p.parse_args()
print(args.arquivo, args.vezes)
```

# Como usar async await em Python com asyncio
```python
import asyncio

async def tarefa(n):
    await asyncio.sleep(1)
    return n * 2

async def main():
    print(await asyncio.gather(tarefa(1), tarefa(2), tarefa(3)))

asyncio.run(main())
```

# Como tratar erros com try except em Python
```python
try:
    valor = int(input('Número: '))
except ValueError:
    print('Isso não é um número')
else:
    print(valor * 2)
finally:
    print('fim')
```

# Como criar um ambiente virtual e instalar pacotes em Python
```bash
python -m venv venv
source venv/bin/activate
pip install requests flask
pip freeze > requirements.txt
```
