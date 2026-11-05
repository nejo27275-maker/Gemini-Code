/* modo voz do gemini-code (v0.48.0) — a esfera, a voz do navegador e a conversa com o agente local.
 * Tudo que vem do servidor/modelo entra na página como texto (textContent): nada vira HTML. A chave, a API, os eventos e
 * o Markdown das respostas vêm de comum.js (v0.49.0, o mesmo da versão chat). */
(function () {
  'use strict';

  const G = window.GeminiSite;
  const token = G.lerToken();
  const api = G.criarApi(token);

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const elEstado = $('estado');
  const elOuvido = $('ouvido');
  const elPainel = $('painel');
  const elResposta = $('resposta');
  const elAlerta = $('alerta');
  const elPergunta = $('pergunta');
  const elPerguntaTexto = $('pergunta-texto');
  const elTexto = $('texto');
  const elLista = $('historico-lista');
  const elMidias = $('midias'); // v0.51.0: o que o agente criar (foto editada, vídeo) aparece embaixo da resposta
  const urls = new Set();
  const reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ROTULOS = {
    ocioso: 'Toque no microfone para falar',
    ouvindo: 'Ouvindo…',
    pensando: 'Pensando…',
    falando: 'Falando…',
    alerta: 'Preciso da sua permissão',
    erro: 'Algo deu errado',
  };
  let estadoAtual = 'ocioso';
  function estado(novo, rotulo) {
    estadoAtual = novo;
    app.dataset.estado = novo;
    elEstado.textContent = rotulo || ROTULOS[novo] || '';
    orbe.mudarEstado(novo);
  }

  // ---------------------------------------------------------------------------
  // A esfera: núcleo, anéis, arcos que giram e o círculo de "risquinhos" que reage ao som
  // ---------------------------------------------------------------------------
  const orbe = (() => {
    const canvas = $('orbe');
    const ctx = canvas.getContext('2d');
    const N = 120;
    const niveis = new Float32Array(N);
    const alvos = new Float32Array(N);
    const CORES = { ocioso: 190, ouvindo: 186, pensando: 255, falando: 192, alerta: 38, erro: 352 };
    let w = 0;
    let h = 0;
    let dpr = 1;
    let matiz = CORES.ocioso;
    let matizAlvo = matiz;
    let estadoOrbe = 'ocioso';
    let energia = 0;
    let pulso = 0; // batidas vindas da voz (palavras faladas, trechos reconhecidos)
    let analisador = null;
    let bins = null;
    let t = 0;
    let ultimo = performance.now();
    const particulas = Array.from({ length: reduzido ? 0 : 48 }, () => ({
      raio: 1.25 + Math.random() * 0.95, ang: Math.random() * Math.PI * 2, vel: (0.08 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1),
      tam: 0.6 + Math.random() * 1.6, fase: Math.random() * Math.PI * 2,
    }));

    function redimensionar() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', redimensionar);

    const cor = (l, a, desloc = 0) => `hsla(${matiz + desloc}, 100%, ${l}%, ${a})`;

    function atualizar(dt) {
      t += dt * (reduzido ? 0.25 : 1);
      matiz += (matizAlvo - matiz) * Math.min(1, dt * 3);
      pulso = Math.max(0, pulso - dt * 1.8);
      if (analisador && estadoOrbe === 'ouvindo') {
        analisador.getByteFrequencyData(bins);
        const util = Math.floor(bins.length * 0.55); // a voz mora nas frequências de baixo
        for (let i = 0; i < N; i++) {
          const espelho = i < N / 2 ? i : N - 1 - i; // simétrico: os dois lados da esfera iguais
          const k = Math.floor(Math.pow(espelho / (N / 2), 1.6) * util);
          alvos[i] = Math.min(1, (bins[k] / 255) * 1.25);
        }
      } else {
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          let v;
          if (estadoOrbe === 'ouvindo') v = 0.1 + pulso * (0.35 + 0.35 * Math.abs(Math.sin(t * 9 + i * 0.7)));
          else if (estadoOrbe === 'falando') v = 0.14 + (0.3 + pulso * 0.45) * Math.abs(Math.sin(t * 7.5 + i * 0.42)) * (0.6 + 0.4 * Math.sin(t * 3.1 + i * 0.13));
          else if (estadoOrbe === 'pensando') v = 0.08 + 0.72 * Math.pow(Math.max(0, Math.cos(a - t * 3.2)), 6) + 0.35 * Math.pow(Math.max(0, Math.cos(a + t * 2.1 + 2)), 10);
          else if (estadoOrbe === 'alerta') v = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * 5));
          else if (estadoOrbe === 'erro') v = 0.1;
          else v = 0.05 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.25));
          alvos[i] = v;
        }
      }
      let soma = 0;
      const suav = Math.min(1, dt * 14);
      for (let i = 0; i < N; i++) { niveis[i] += (alvos[i] - niveis[i]) * suav; soma += niveis[i]; }
      energia += (soma / N - energia) * Math.min(1, dt * 8);
    }

    function arco(cx, cy, r, ini, fim, largura, estilo) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, ini, fim);
      ctx.lineWidth = largura;
      ctx.strokeStyle = estilo;
      ctx.stroke();
    }

    function desenhar() {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.44;
      // a esfera inteira (até a moldura de fora) cabe acima do texto de status, em pé ou deitado
      const R = Math.max(42, Math.min(w * 0.205, h * 0.155));
      const e = energia;
      const giro = t * (estadoOrbe === 'pensando' ? 0.9 : 0.18);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 3.3);
      halo.addColorStop(0, cor(60, 0.22 + e * 0.35));
      halo.addColorStop(0.45, cor(50, 0.06 + e * 0.08));
      halo.addColorStop(1, cor(40, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 3.3, 0, Math.PI * 2);
      ctx.fill();

      // moldura de fora: risquinhos finos, um mais longo a cada 15
      ctx.lineCap = 'round';
      const rMold = R * 2.15;
      for (let i = 0; i < 180; i++) {
        const a = (i / 180) * Math.PI * 2 - giro * 0.25;
        const maior = i % 15 === 0;
        const l = maior ? R * 0.11 : R * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rMold, cy + Math.sin(a) * rMold);
        ctx.lineTo(cx + Math.cos(a) * (rMold + l), cy + Math.sin(a) * (rMold + l));
        ctx.lineWidth = maior ? 1.6 : 1;
        ctx.strokeStyle = cor(70, maior ? 0.55 : 0.22);
        ctx.stroke();
      }
      arco(cx, cy, rMold - R * 0.05, 0, Math.PI * 2, 1, cor(60, 0.12));

      // arcos segmentados que giram (no "pensando", rápido)
      const rArco = R * 1.82;
      const seg = [[0, 0.9], [1.25, 1.7], [2.2, 3.5], [3.9, 4.2], [4.6, 5.8]];
      for (const [a0, a1] of seg) arco(cx, cy, rArco, a0 + giro, a1 + giro, 3, cor(62, 0.5 + e * 0.4));
      for (const [a0, a1] of seg) arco(cx, cy, rArco + R * 0.1, a0 - giro * 1.6 + 0.4, a0 - giro * 1.6 + 0.4 + (a1 - a0) * 0.45, 1.4, cor(75, 0.4));
      // varredura de radar
      const varre = t * 1.4;
      const gv = ctx.createConicGradient ? ctx.createConicGradient(varre, cx, cy) : null;
      if (gv) {
        gv.addColorStop(0, cor(70, 0.16 + e * 0.2));
        gv.addColorStop(0.08, cor(70, 0));
        gv.addColorStop(1, cor(70, 0));
        ctx.fillStyle = gv;
        ctx.beginPath();
        ctx.arc(cx, cy, rArco - R * 0.06, 0, Math.PI * 2);
        ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2, true);
        ctx.fill();
      }

      // o círculo de RISQUINHOS que reage à voz
      const rRisco = R * 1.3;
      for (let i = 0; i < N; i++) {
        const v = niveis[i];
        const a = (i / N) * Math.PI * 2 - Math.PI / 2 + giro * 0.35;
        const l = R * (0.05 + v * 0.62);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rRisco, cy + Math.sin(a) * rRisco);
        ctx.lineTo(cx + Math.cos(a) * (rRisco + l), cy + Math.sin(a) * (rRisco + l));
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = cor(55 + v * 35, 0.3 + v * 0.7);
        ctx.stroke();
      }
      // anel interno e o tracejado que gira ao contrário
      arco(cx, cy, R * 1.17, 0, Math.PI * 2, 1.4, cor(65, 0.45));
      ctx.setLineDash([2, 7]);
      arco(cx, cy, R * 1.23, -giro * 0.7, -giro * 0.7 + Math.PI * 2, 2, cor(70, 0.5));
      ctx.setLineDash([]);

      // núcleo: a esfera
      const rc = R * (0.9 + e * 0.16 + pulso * 0.04);
      const nucleo = ctx.createRadialGradient(cx - rc * 0.25, cy - rc * 0.3, rc * 0.05, cx, cy, rc);
      nucleo.addColorStop(0, 'rgba(255,255,255,0.95)');
      nucleo.addColorStop(0.22, cor(80, 0.9));
      nucleo.addColorStop(0.62, cor(48, 0.55));
      nucleo.addColorStop(1, cor(32, 0));
      ctx.fillStyle = nucleo;
      ctx.beginPath();
      ctx.arc(cx, cy, rc, 0, Math.PI * 2);
      ctx.fill();
      // "latitudes" girando: dá volume à esfera
      ctx.save();
      ctx.translate(cx, cy);
      for (let k = 0; k < 3; k++) {
        ctx.rotate(giro * 0.5 + k * (Math.PI / 3));
        ctx.beginPath();
        ctx.ellipse(0, 0, rc * 0.82, rc * (0.22 + 0.12 * Math.sin(t * 0.7 + k)), 0, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = cor(85, 0.18 + e * 0.25);
        ctx.stroke();
      }
      ctx.restore();
      // reator: três arcos dentro do núcleo
      for (let k = 0; k < 3; k++) {
        const a0 = -giro * 2.2 + (k * Math.PI * 2) / 3;
        arco(cx, cy, rc * 0.5, a0, a0 + 1.4, 2.5, cor(90, 0.55 + e * 0.35));
      }

      // partículas em órbita
      for (const p of particulas) {
        p.ang += p.vel * 0.016 * (estadoOrbe === 'pensando' ? 3 : 1);
        const rr = R * p.raio * (1 + 0.04 * Math.sin(t * 2 + p.fase));
        const x = cx + Math.cos(p.ang) * rr;
        const y = cy + Math.sin(p.ang) * rr;
        ctx.beginPath();
        ctx.arc(x, y, p.tam, 0, Math.PI * 2);
        ctx.fillStyle = cor(78, 0.35 + 0.35 * Math.sin(t * 3 + p.fase) ** 2);
        ctx.fill();
      }
      ctx.restore();

      // rótulos de painel, discretos
      ctx.fillStyle = cor(80, 0.55);
      ctx.font = `${Math.max(9, Math.round(R * 0.085))}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`NÍVEL ${String(Math.round(Math.min(1, e * 1.6) * 100)).padStart(3, '0')}`, cx, cy - rMold - R * 0.22);
    }

    function quadro(agora) {
      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;
      if (w !== canvas.getBoundingClientRect().width) redimensionar();
      atualizar(dt);
      desenhar();
      requestAnimationFrame(quadro);
    }

    redimensionar();
    requestAnimationFrame(quadro);
    return {
      mudarEstado(novo) { estadoOrbe = novo; matizAlvo = CORES[novo] != null ? CORES[novo] : CORES.ocioso; },
      bater(forca = 1) { pulso = Math.min(1, Math.max(pulso, forca)); },
      ligarAnalisador(a) { analisador = a; bins = a ? new Uint8Array(a.frequencyBinCount) : null; },
    };
  })();

  // ---------------------------------------------------------------------------
  // Microfone para os risquinhos (no PC; no celular o reconhecimento de voz já usa o microfone)
  // ---------------------------------------------------------------------------
  const ehCelular = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  let audio = null;
  async function ligarMicrofone() {
    if (ehCelular || audio || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const contexto = new Ctx();
      const analisador = contexto.createAnalyser();
      analisador.fftSize = 512;
      analisador.smoothingTimeConstant = 0.72;
      contexto.createMediaStreamSource(stream).connect(analisador);
      audio = { stream, contexto };
      orbe.ligarAnalisador(analisador);
    } catch { /* sem permissão: os risquinhos seguem o reconhecimento */ }
  }
  function desligarMicrofone() {
    if (!audio) return;
    audio.stream.getTracks().forEach((tr) => tr.stop());
    audio.contexto.close().catch(() => {});
    audio = null;
    orbe.ligarAnalisador(null);
  }

  // ---------------------------------------------------------------------------
  // Voz: ouvir (reconhecimento do navegador) e falar (síntese do navegador)
  // ---------------------------------------------------------------------------
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let continuo = false;
  let falarRespostas = true;
  let ocupado = false;

  function ouvir() {
    if (ocupado) return;
    if (!Reconhecimento) {
      estado('erro', 'Este navegador não ouve voz');
      mostrarResposta('O reconhecimento de voz precisa do Chrome (no PC ou no Android) ou do Edge. Você pode digitar aqui embaixo.');
      return;
    }
    pararFala();
    let final = '';
    rec = new Reconhecimento();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { estado('ouvindo'); elOuvido.textContent = ''; ligarMicrofone(); };
    rec.onsoundstart = () => orbe.bater(0.6);
    rec.onresult = (ev) => {
      let parcial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const tr = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) final += tr; else parcial += tr;
      }
      elOuvido.textContent = (final + parcial).trim();
      orbe.bater(0.9);
    };
    rec.onerror = (ev) => {
      // v0.53.1: cada erro com o seu caminho (o "service-not-allowed" não é o microfone: permitir não resolvia)
      const m = G.mensagemDeErroDeVoz(ev.error);
      if (!m || !m.grave) return; // "não ouvi nada" no modo contínuo só volta a ouvir
      if (ev.error !== 'network') { continuo = false; marcar('btn-continuo', false); }
      estado('erro', m.titulo);
      mostrarResposta(m.texto);
    };
    rec.onend = () => {
      rec = null;
      desligarMicrofone();
      const texto = final.trim();
      if (texto) enviar(texto);
      else if (estadoAtual === 'ouvindo') {
        estado('ocioso');
        if (continuo) setTimeout(() => { if (continuo && !ocupado && estadoAtual === 'ocioso') ouvir(); }, 400);
      }
    };
    try { rec.start(); } catch { rec = null; }
  }

  function pararDeOuvir() { if (rec) { try { rec.abort(); } catch { /* já parou */ } rec = null; } desligarMicrofone(); }

  let vozEscolhida = null;
  function escolherVoz() {
    if (!('speechSynthesis' in window)) return null;
    const vozes = window.speechSynthesis.getVoices();
    return vozes.find((v) => /pt[-_]BR/i.test(v.lang) && /Google/i.test(v.name))
      || vozes.find((v) => /pt[-_]BR/i.test(v.lang)) || vozes.find((v) => /^pt/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) {
    vozEscolhida = escolherVoz();
    window.speechSynthesis.onvoiceschanged = () => { vozEscolhida = escolherVoz(); };
  }

  // texto para a fala e em pedaços: os mesmos do chat (comum.js, v0.53.0)
  const { paraFala, frases } = G;

  function falar(texto) {
    const limpo = paraFala(texto);
    if (!falarRespostas || !limpo || !('speechSynthesis' in window)) return depoisDeFalar();
    window.speechSynthesis.cancel();
    const partes = frases(limpo);
    estado('falando');
    partes.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'pt-BR';
      if (vozEscolhida) u.voice = vozEscolhida;
      u.rate = 1.04;
      u.onstart = () => orbe.bater(0.8);
      u.onboundary = () => orbe.bater(1);
      if (i === partes.length - 1) { u.onend = depoisDeFalar; u.onerror = depoisDeFalar; }
      window.speechSynthesis.speak(u);
    });
  }
  function pararFala() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }
  function depoisDeFalar() {
    if (estadoAtual === 'falando' || estadoAtual === 'pensando') estado('ocioso');
    if (continuo && !ocupado) setTimeout(() => { if (continuo && !ocupado && estadoAtual === 'ocioso') ouvir(); }, 450);
  }

  // ---------------------------------------------------------------------------
  // Conversa com o agente (o servidor manda os eventos linha a linha: G.eventos)
  // ---------------------------------------------------------------------------
  function mostrarResposta(texto) {
    elPainel.hidden = !texto && elAlerta.hidden && elMidias.hidden; // sem nada para mostrar, sem a faixa vazia
    // v0.49.0: listas, código e negrito formatados (o Markdown de comum.js monta tudo como texto)
    elResposta.replaceChildren(G.montarMarkdown(G.analisarMarkdown(texto), document));
    elPainel.scrollTop = elPainel.scrollHeight;
  }

  function registrar(quem, texto) {
    const li = document.createElement('li');
    li.className = quem;
    const r = document.createElement('span');
    r.className = 'rotulo';
    r.textContent = quem === 'voce' ? 'Você' : 'Agente';
    li.append(r, document.createTextNode(texto));
    elLista.append(li);
    li.scrollIntoView({ block: 'end' });
  }

  // enquanto o agente trabalha, o botão do microfone é o "Parar"
  function marcarOcupado(sim) {
    ocupado = sim;
    if (sim) app.dataset.ocupado = 'true'; else delete app.dataset.ocupado;
    const b = $('btn-mic');
    b.setAttribute('aria-label', sim ? 'Parar (Esc)' : 'Falar (espaço)');
    b.title = sim ? 'Parar o agente (Esc)' : 'Falar (tecla espaço) · Esc para parar';
  }

  // Parar de verdade: o servidor para o agente no próximo ponto seguro (não chama o modelo de novo, não roda a
  // próxima ferramenta) e conta a pergunta aberta como "não". A conversa termina pelo caminho normal ("fim").
  let parando = false;
  async function parar() {
    if (!ocupado || parando) return;
    parando = true;
    continuo = false;
    marcar('btn-continuo', false);
    fecharPergunta();
    pararFala();
    estado('pensando', 'Parando…');
    try { await api('/api/parar', {}); } catch { /* sem conexão: a conversa termina do mesmo jeito */ }
  }

  async function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || ocupado) return;
    if (!token) {
      estado('erro', 'Falta a chave da página');
      mostrarResposta('Abra o endereço completo que o terminal mostrou (com #t=...). A chave muda a cada vez que o modo site é aberto.');
      return;
    }
    marcarOcupado(true);
    // o histórico entra primeiro: se a mensagem fosse antes, ela voltaria junto com o histórico e apareceria duas vezes
    await pronto;
    pararDeOuvir();
    pararFala();
    elOuvido.textContent = texto;
    elAlerta.hidden = true;
    registrar('voce', texto);
    elMidias.replaceChildren();
    elMidias.hidden = true;
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    mostrarResposta('');
    estado('pensando');
    let resposta = '';
    let parcial = '';
    let interrompida = false;
    try {
      const res = await api('/api/conversa', { texto, ...(ateTerminar ? { ateTerminar: true } : {}) });
      if (!res.ok) {
        const erro = await res.json().catch(() => ({}));
        throw new Error(erro.erro || `HTTP ${res.status}`);
      }
      for await (const ev of G.eventos(res)) {
        if (ev.tipo === 'parcial') { parcial += ev.texto; mostrarResposta(parcial); }
        else if (ev.tipo === 'ferramenta') { if (!parando) estado('pensando', `Usando: ${ev.nome}`); }
        else if (ev.tipo === 'alerta') { elAlerta.textContent = ev.texto; elAlerta.hidden = false; elPainel.hidden = false; }
        else if (ev.tipo === 'pergunta') { if (!parando) await perguntar(ev); }
        else if (ev.tipo === 'pergunta-expirou') fecharPergunta();
        else if (ev.tipo === 'continuando') { if (!parando) estado('pensando', `Continuando sozinho (${ev.n})…`); }
        else if (ev.tipo === 'midia') {
          elMidias.append(G.cartaoMidia(api, ev, { urls }));
          elMidias.hidden = false;
          elPainel.hidden = false;
        }
        else if (ev.tipo === 'resposta') {
          resposta = ev.texto;
          interrompida = Boolean(ev.interrompido);
          if (!interrompida) mostrarResposta(resposta);
          const selo = G.seloDoFim(ev.fim);
          if (selo && !interrompida) { const p = document.createElement('p'); p.className = 'selo'; p.textContent = selo; elResposta.append(p); }
        }
        else if (ev.tipo === 'erro') { resposta = ev.texto; mostrarResposta(resposta); if (ev.chave) pedirChave('O Gemini recusou a chave (ou ela falta): cole a sua'); }
      }
    } catch (e) {
      resposta = `Não consegui falar com o agente: ${e.message}`;
      mostrarResposta(resposta);
      estado('erro');
    } finally {
      // quem pediu para parar não quer ouvir a resposta, mesmo que ela tenha chegado junto com o "Parar"
      if (parando) interrompida = true;
      parando = false;
      marcarOcupado(false);
      fecharPergunta();
    }
    if (resposta) registrar('agente', resposta);
    if (interrompida && estadoAtual !== 'erro') {
      if (!parcial && /^\(interrompido/.test(resposta)) mostrarResposta('');
      estado('ocioso', 'Parado');
      return;
    }
    if (estadoAtual !== 'erro') falar(resposta);
    else if (continuo) { continuo = false; marcar('btn-continuo', false); }
  }

  // confirmação de uma ferramenta: aparece aqui; sem resposta em 2 min, o servidor conta como "não"
  let perguntaAtual = null;
  function perguntar(ev) {
    return new Promise((resolve) => {
      pararDeOuvir();
      pararFala();
      perguntaAtual = { id: ev.id, resolve };
      elPerguntaTexto.textContent = ev.texto;
      elPergunta.hidden = false;
      estado('alerta');
      $('btn-sim').focus();
      resolve(); // os eventos seguem chegando; a resposta vai por /api/confirmar
    });
  }
  async function responder(resposta) {
    if (!perguntaAtual) return;
    const { id } = perguntaAtual;
    fecharPergunta();
    estado('pensando');
    try { await api('/api/confirmar', { id, resposta }); } catch { /* expirou: o servidor já contou como "não" */ }
  }
  function fecharPergunta() { perguntaAtual = null; elPergunta.hidden = true; $('outra').value = ''; }

  // ---------------------------------------------------------------------------
  // Botões e teclas
  // ---------------------------------------------------------------------------
  function marcar(id, ligado) { $(id).setAttribute(id === 'btn-historico' ? 'aria-expanded' : 'aria-pressed', String(ligado)); }

  $('btn-mic').addEventListener('click', () => {
    if (ocupado) { parar(); return; }
    if (estadoAtual === 'ouvindo' || estadoAtual === 'falando') { pararDeOuvir(); pararFala(); continuo = false; marcar('btn-continuo', false); estado('ocioso'); return; }
    ouvir();
  });
  $('form').addEventListener('submit', (ev) => { ev.preventDefault(); const t = elTexto.value; elTexto.value = ''; enviar(t); });
  $('btn-continuo').addEventListener('click', () => { continuo = !continuo; marcar('btn-continuo', continuo); if (continuo && estadoAtual === 'ocioso' && !ocupado) ouvir(); });
  // v0.52.0: modo até terminar (o agente continua sozinho até a tarefa estar feita); lembrado nesta aba
  let ateTerminar = false;
  const marcarAte = (ligado, lembrar = true) => {
    ateTerminar = Boolean(ligado);
    marcar('btn-ate', ateTerminar);
    if (lembrar) { try { sessionStorage.setItem('gc-ate-terminar', ateTerminar ? '1' : '0'); } catch { /* sem armazenamento */ } }
  };
  $('btn-ate').addEventListener('click', () => marcarAte(!ateTerminar));
  $('btn-voz').addEventListener('click', () => { falarRespostas = !falarRespostas; marcar('btn-voz', falarRespostas); if (!falarRespostas) pararFala(); });
  $('btn-historico').addEventListener('click', () => { const el = $('historico'); el.hidden = !el.hidden; marcar('btn-historico', !el.hidden); });
  // v0.53.0: um site só — o chat é a mesma conversa (a chave vai pelo fragmento, nunca para o servidor)
  $('btn-chat').addEventListener('click', (ev) => {
    if (!token) return;
    ev.preventDefault();
    pararDeOuvir();
    pararFala();
    location.href = `/chat#t=${encodeURIComponent(token)}`;
  });
  $('btn-limpar').addEventListener('click', async () => {
    if (ocupado) return;
    try { await api('/api/limpar', {}); } catch { /* segue limpando a tela */ }
    elLista.textContent = '';
    elPainel.hidden = true;
    elOuvido.textContent = '';
  });
  $('btn-sim').addEventListener('click', () => responder('s'));
  $('btn-nao').addEventListener('click', () => responder('n'));
  $('form-outra').addEventListener('submit', (ev) => { ev.preventDefault(); responder($('outra').value.trim() || 'n'); });

  document.addEventListener('keydown', (ev) => {
    // num botão ou campo, o espaço é dele (senão o botão e o atalho disparariam juntos)
    const digitando = ev.target instanceof Element && Boolean(ev.target.closest('input, textarea, button, select'));
    if (ev.key === 'Escape') {
      // Esc para tudo: com o agente trabalhando, para o agente (a pergunta aberta vira "não")
      if (ocupado) { parar(); return; }
      pararDeOuvir(); pararFala(); continuo = false; marcar('btn-continuo', false);
      estado('ocioso');
    } else if (ev.code === 'Space' && !digitando && !perguntaAtual) {
      ev.preventDefault();
      // o espaço é "falar": enquanto o agente trabalha, não vira "Parar" sem querer (para isso: Esc ou o botão)
      if (!ocupado) $('btn-mic').click();
    }
  });

  // v0.49.0: a conversa volta para o histórico ao recarregar a página (e mostra com qual aliado você fala)
  async function carregarHistorico() {
    try {
      const r = await api('/api/historico', {});
      if (!r.ok) return;
      const d = await r.json();
      // o que a pessoa já mandou enquanto o histórico chegava continua depois dele
      const depois = elLista.firstChild;
      const inicio = elLista.childElementCount;
      for (const m of d.mensagens || []) {
        const t = m.texto || (m.interrompido ? '(interrompido por você)' : '');
        if (t && (m.quem === 'voce' || m.quem === 'agente')) registrar(m.quem, t);
      }
      if (depois) for (const n of [...elLista.children].slice(inicio)) elLista.insertBefore(n, depois);
      if (d.aliado) $('marca-modo').textContent = `aliado ${d.aliado}`;
      let lembrado = null;
      try { lembrado = sessionStorage.getItem('gc-ate-terminar'); } catch { /* sem armazenamento */ }
      marcarAte(lembrado === null ? d.ateTerminarPadrao === true : lembrado === '1', false);
      if (d.chave && d.chave.precisa) pedirChave();
      // v0.52.0: no modo até terminar, a tarefa anterior segue mesmo com a página fechada: espera ela acabar
      if (d.ocupado && d.andamento && d.andamento.ateTerminar) {
        estado('pensando', 'Terminando a tarefa anterior (modo até terminar)…');
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          try { const r2 = await api('/api/historico', {}); if (r2.ok && !(await r2.json()).ocupado) break; } catch { /* tenta de novo */ }
        }
        elLista.replaceChildren();
        estado('ocioso', 'A tarefa anterior terminou: veja em "Conversa"');
        const r3 = await api('/api/historico', {});
        const d3 = r3.ok ? await r3.json() : { mensagens: [] };
        for (const m of d3.mensagens || []) {
          const t = m.texto || (m.interrompido ? '(interrompido por você)' : '');
          if (t && (m.quem === 'voce' || m.quem === 'agente')) registrar(m.quem, t);
        }
      }
    } catch { /* sem histórico: segue vazio */ }
  }

  // v0.52.0: o pedido da chave do Gemini (o site só precisa dela), no painel
  let cartaoDaChave = null;
  function pedirChave(motivo) {
    if (cartaoDaChave) return;
    cartaoDaChave = G.cartaoChave(api, {
      motivo,
      aoSalvar: () => { setTimeout(() => { if (cartaoDaChave) cartaoDaChave.remove(); cartaoDaChave = null; mostrarResposta(''); }, 2500); estado('ocioso', 'Chave salva. Pode falar.'); },
    });
    elPainel.hidden = false;
    elPainel.prepend(cartaoDaChave);
  }

  let pronto = Promise.resolve();
  if (!token) {
    estado('erro', 'Falta a chave da página');
    mostrarResposta('Abra o endereço completo que o terminal mostrou (com #t=...).');
  } else {
    estado('ocioso');
    pronto = carregarHistorico();
  }
})();
