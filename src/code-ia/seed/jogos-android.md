# Como criar uma cena 3D básica com Three.js
```html
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }</script>
<script type="module">
import * as THREE from 'three';
const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
camera.position.z = 3;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const cubo = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
cena.add(cubo);
renderer.setAnimationLoop(() => { cubo.rotation.y += 0.01; renderer.render(cena, camera); });
</script>
```

# Como criar controle por toque (joystick) em jogo HTML5 no celular
```js
const canvas = document.querySelector('canvas');
let toque = null;
canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; toque = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 }; });
canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; toque.dx = t.clientX - toque.x0; toque.dy = t.clientY - toque.y0; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchend', () => { toque = null; });
```
No loop do jogo, mova o jogador usando `toque.dx` e `toque.dy`.

# Como detectar colisão entre retângulos em jogo
```js
function colide(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
```

# Como fazer um evento de script no Minecraft Bedrock com @minecraft/server
```js
import { world, system } from '@minecraft/server';

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (initialSpawn) player.sendMessage('Bem-vindo ao mundo!');
});

system.runInterval(() => {
  for (const jogador of world.getAllPlayers()) {
    jogador.onScreenDisplay.setActionBar(`Vida: ${jogador.getComponent('health').currentValue}`);
  }
}, 20);
```
Adicione `@minecraft/server` em `dependencies` do `manifest.json` do addon, com a versão que sua edição do jogo aceita.

# Como criar um overlay flutuante em app Android com Kotlin
```kotlin
val wm = getSystemService(WINDOW_SERVICE) as WindowManager
val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
    PixelFormat.TRANSLUCENT
)
params.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
wm.addView(minhaView, params)
```
Precisa da permissão "Exibir sobre outros apps" (`Settings.canDrawOverlays(context)`) e de um serviço em primeiro plano para não ser morto pelo Android.

# Como usar animação CSS
```css
.pulsa { animation: pulsa 1s ease-in-out infinite; }
@keyframes pulsa { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
```
