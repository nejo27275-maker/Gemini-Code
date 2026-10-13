# Como cortar, converter e juntar vídeos com ffmpeg
```bash
pkg install -y ffmpeg
ffmpeg -i entrada.mp4 -ss 00:00:05 -t 10 -c copy corte.mp4
ffmpeg -i entrada.mov -c:v libx264 -crf 23 -c:a aac saida.mp4
ffmpeg -i video.mp4 -vn -c:a libmp3lame audio.mp3
printf "file 'a.mp4'\nfile 'b.mp4'\n" > lista.txt && ffmpeg -f concat -safe 0 -i lista.txt -c copy junto.mp4
```

# Como mudar o tamanho de um vídeo ou extrair frames com ffmpeg
```bash
ffmpeg -i entrada.mp4 -vf scale=1280:-2 saida.mp4
ffmpeg -i video.mp4 -vf fps=1 frame_%03d.png
```

# Como usar a API do Termux para notificação, fala e vibração
Instale o app Termux:API e rode `pkg install termux-api`.
```bash
termux-notification --title "Pronto" --content "O processo terminou"
termux-tts-speak "Olá, tudo bem?"
termux-vibrate -d 300
termux-clipboard-set "texto copiado"
```

# Como tirar foto e pegar localização pelo Termux
```bash
termux-camera-photo -c 0 foto.jpg
termux-location -p gps
```

# Como compartilhar um site do Termux com a TV ou outro aparelho
Rode o servidor escutando em `0.0.0.0` e abra no outro aparelho `http://IP-DO-CELULAR:PORTA`. Os dois precisam estar no mesmo Wi-Fi.
```bash
python -m http.server 8080 --bind 0.0.0.0
```
