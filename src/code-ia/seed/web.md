# Como criar uma página HTML básica
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Minha página</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 16px; background: #111; color: #eee; }
    button { padding: 10px 16px; border: 0; border-radius: 8px; background: #4f8cff; color: #fff; }
  </style>
</head>
<body>
  <h1>Olá!</h1>
  <button id="btn">Clique</button>
  <script>
    document.getElementById('btn').addEventListener('click', () => alert('Funcionou'));
  </script>
</body>
</html>
```

# Como desenhar em um canvas HTML5 com loop de jogo
```html
<canvas id="c" width="480" height="320"></canvas>
<script>
const ctx = document.getElementById('c').getContext('2d');
let x = 20;
function loop() {
  ctx.clearRect(0, 0, 480, 320);
  ctx.fillStyle = '#4f8cff';
  ctx.fillRect(x, 140, 40, 40);
  x = (x + 2) % 480;
  requestAnimationFrame(loop);
}
loop();
</script>
```

# Como guardar dados no navegador com localStorage
```js
localStorage.setItem('config', JSON.stringify({ tema: 'escuro' }));
const config = JSON.parse(localStorage.getItem('config') || '{}');
```

# Como centralizar um elemento com CSS flexbox
```css
.centro {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
```

# Como buscar dados de uma API e mostrar na página
```js
async function carregar() {
  const r = await fetch('https://api.exemplo.com/lista');
  const itens = await r.json();
  document.querySelector('#lista').innerHTML = itens.map((i) => `<li>${i.nome}</li>`).join('');
}
carregar();
```
Sempre escape texto vindo de fora antes de usar em innerHTML, ou use textContent.
