/* =====================================================================
   EcoResgate: Missão Planeta Limpo
   Jogo 2D Arcade / Educativo - HTML5 Canvas + JavaScript + Web Audio API
   Todos os gráficos e sons são gerados por código (sem arquivos externos).
   ===================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------
     1. CONFIGURAÇÕES GERAIS
  ------------------------------------------------------------------ */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const HUD_H = 64;
  const FIELD_TOP = HUD_H;
  const FIELD_BOTTOM = 520; // acima das lixeiras

  // Tipos de resíduo (cores seguem o padrão de coleta seletiva)
  const TIPOS = {
    papel:    { nome: 'PAPEL',    cor: '#1e6fd9' },
    plastico: { nome: 'PLÁSTICO', cor: '#d93a3a' },
    vidro:    { nome: 'VIDRO',    cor: '#2e9e4f' },
    metal:    { nome: 'METAL',    cor: '#e8b923' }
  };

  // Lixeiras na parte inferior da tela
  const BIN_W = 200, BIN_H = 88, BIN_Y = 536;
  const BINS = ['papel', 'plastico', 'vidro', 'metal'].map((tipo, i) => ({
    tipo,
    x: 32 + i * 232,
    y: BIN_Y,
    w: BIN_W,
    h: BIN_H,
    flash: 0,
    flashCor: '#fff'
  }));

  // Fases (dificuldade progressiva)
  const FASES = [
    {
      nome: 'Parque Poluído',
      fundo: '#9ad68f', fundo2: '#8ccb82',
      meta: 8, tempo: 70, maxItens: 4, spawn: 2.4, poluicaoPorItem: 0.20,
      tipos: ['papel', 'plastico', 'vidro'],
      manchas: 0, manchasMoveis: false, dica:
        'Leve cada resíduo à lixeira da mesma cor. Nesta fase, anéis coloridos ajudam você a identificar o tipo.'
    },
    {
      nome: 'Rua Suja',
      fundo: '#cfc9a8', fundo2: '#c3bd9a',
      meta: 11, tempo: 70, maxItens: 5, spawn: 1.9, poluicaoPorItem: 0.22,
      tipos: ['papel', 'plastico', 'vidro', 'metal'],
      manchas: 3, manchasMoveis: false, dica:
        'O metal entra em jogo! Cuidado com as manchas de óleo: elas deixam você bem mais lento.'
    },
    {
      nome: 'Rio em Perigo',
      fundo: '#8fc4d6', fundo2: '#82b9cc',
      meta: 14, tempo: 75, maxItens: 7, spawn: 1.5, poluicaoPorItem: 0.22,
      tipos: ['papel', 'plastico', 'vidro', 'metal'],
      manchas: 5, manchasMoveis: true, dica:
        'As manchas de óleo agora se movem e o lixo surge mais rápido. Mantenha o combo para pontuar mais!'
    }
  ];

  const ACERTO_POLUICAO = -5;
  const ERRO_POLUICAO = 8;
  const ERRO_PONTOS = 50;

  /* ------------------------------------------------------------------
     2. ÁUDIO (Web Audio API - efeitos gerados em tempo real)
  ------------------------------------------------------------------ */
  let actx = null;
  let mudo = false;

  function iniciarAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tom(freq, dur, tipo = 'square', vol = 0.12, atraso = 0, ate = null) {
    if (!actx || mudo) return;
    const t = actx.currentTime + atraso;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t);
    if (ate) osc.frequency.exponentialRampToValueAtTime(ate, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const som = {
    coletar() { tom(520, 0.08, 'square', 0.1); tom(780, 0.1, 'square', 0.1, 0.07); },
    acerto()  { tom(660, 0.1, 'triangle', 0.16); tom(880, 0.1, 'triangle', 0.16, 0.09); tom(1175, 0.18, 'triangle', 0.16, 0.18); },
    erro()    { tom(220, 0.35, 'sawtooth', 0.14, 0, 90); },
    soltar()  { tom(320, 0.12, 'triangle', 0.12, 0, 140); },
    aviso()   { tom(900, 0.07, 'square', 0.06); },
    inicio()  { [392, 523, 659].forEach((f, i) => tom(f, 0.14, 'square', 0.1, i * 0.1)); },
    fase()    { [523, 659, 784, 1047].forEach((f, i) => tom(f, 0.18, 'square', 0.12, i * 0.12)); },
    vitoria() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tom(f, 0.2, 'triangle', 0.16, i * 0.14)); },
    derrota() { [400, 330, 262, 196].forEach((f, i) => tom(f, 0.3, 'sawtooth', 0.12, i * 0.2)); }
  };

  /* ------------------------------------------------------------------
     3. ESTADO DO JOGO
  ------------------------------------------------------------------ */
  let modo = 'menu';        // menu | intro | jogando | pausa | faseConcluida | vitoria | derrota
  let g = null;             // dados da partida
  let recorde = 0;
  try { recorde = parseInt(localStorage.getItem('ecoresgate_recorde') || '0', 10) || 0; } catch (e) { /* ignora */ }

  const teclas = { esq: false, dir: false, cima: false, baixo: false };

  function novaPartida() {
    g = {
      pontos: 0,
      fase: 0,
      combo: 0,
      maiorCombo: 0,
      entregues: 0,
      tempo: 0,
      poluicao: 0,
      itens: [],
      manchas: [],
      popups: [],
      particulas: [],
      spawnT: 0,
      acertos: 0,
      erros: 0,
      bonusFase: 0,
      motivo: '',
      ultimoSegundo: -1,
      relogio: 0,
      jogador: { x: W / 2, y: 430, r: 18, vel: 250, dir: 1, andar: 0, carga: null }
    };
  }

  function iniciarFase(n) {
    const cfg = FASES[n];
    g.fase = n;
    g.entregues = 0;
    g.tempo = cfg.tempo;
    g.poluicao = Math.min(g.poluicao, 10);
    g.itens = [];
    g.popups = [];
    g.particulas = [];
    g.spawnT = 0;
    g.ultimoSegundo = -1;
    g.jogador.x = W / 2;
    g.jogador.y = 430;
    g.jogador.carga = null;

    g.manchas = [];
    for (let i = 0; i < cfg.manchas; i++) {
      g.manchas.push({
        x: 120 + Math.random() * (W - 240),
        y: 150 + Math.random() * 280,
        r: 36 + Math.random() * 10,
        vx: cfg.manchasMoveis ? (Math.random() < 0.5 ? -1 : 1) * (35 + Math.random() * 35) : 0
      });
    }

    gerarItem();
    gerarItem();
    modo = 'jogando';
    som.inicio();
  }

  function gerarItem() {
    const cfg = FASES[g.fase];
    if (g.itens.length >= cfg.maxItens) return;
    const p = g.jogador;
    let x = 0, y = 0;
    for (let t = 0; t < 15; t++) {
      x = 50 + Math.random() * (W - 100);
      y = FIELD_TOP + 40 + Math.random() * (FIELD_BOTTOM - FIELD_TOP - 70);
      if (Math.hypot(x - p.x, y - p.y) > 120) break;
    }
    const tipo = cfg.tipos[Math.floor(Math.random() * cfg.tipos.length)];
    g.itens.push({ tipo, x, y, r: 16, idade: 0, bob: Math.random() * 6 });
  }

  /* ------------------------------------------------------------------
     4. ENTRADA DO JOGADOR
  ------------------------------------------------------------------ */
  const MAPA = {
    ArrowLeft: 'esq', KeyA: 'esq',
    ArrowRight: 'dir', KeyD: 'dir',
    ArrowUp: 'cima', KeyW: 'cima',
    ArrowDown: 'baixo', KeyS: 'baixo'
  };

  window.addEventListener('keydown', (e) => {
    if (MAPA[e.code] || e.code === 'Space' || e.code === 'Enter') e.preventDefault();
    iniciarAudio();

    if (MAPA[e.code]) { teclas[MAPA[e.code]] = true; return; }
    if (e.repeat) return;

    if (e.code === 'KeyM') { mudo = !mudo; return; }

    switch (modo) {
      case 'menu':
        if (e.code === 'Enter' || e.code === 'Space') {
          novaPartida();
          modo = 'intro';
        }
        break;
      case 'intro':
        if (e.code === 'Enter' || e.code === 'Space') iniciarFase(g.fase);
        break;
      case 'jogando':
        if (e.code === 'Space') soltarItem();
        if (e.code === 'KeyP' || e.code === 'Escape') modo = 'pausa';
        break;
      case 'pausa':
        if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Enter') modo = 'jogando';
        break;
      case 'faseConcluida':
        if (e.code === 'Enter' || e.code === 'Space') {
          g.fase++;
          modo = 'intro';
        }
        break;
      case 'vitoria':
      case 'derrota':
        if (e.code === 'Enter' || e.code === 'Space') {
          novaPartida();
          modo = 'intro';
        }
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (MAPA[e.code]) teclas[MAPA[e.code]] = false;
  });

  window.addEventListener('blur', () => {
    teclas.esq = teclas.dir = teclas.cima = teclas.baixo = false;
    if (modo === 'jogando') modo = 'pausa';
  });

  function soltarItem() {
    const p = g.jogador;
    if (!p.carga) return;
    g.itens.push({ tipo: p.carga.tipo, x: p.x, y: Math.min(p.y, FIELD_BOTTOM - 20), r: 16, idade: p.carga.idade, bob: 0 });
    p.carga = null;
    som.soltar();
  }

  /* ------------------------------------------------------------------
     5. COLISÕES
  ------------------------------------------------------------------ */
  function circuloCirculo(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
  }

  function circuloRetangulo(c, r) {
    const px = Math.max(r.x, Math.min(c.x, r.x + r.w));
    const py = Math.max(r.y, Math.min(c.y, r.y + r.h));
    return Math.hypot(c.x - px, c.y - py) < c.r;
  }

  /* ------------------------------------------------------------------
     6. LÓGICA (UPDATE)
  ------------------------------------------------------------------ */
  function popup(x, y, texto, cor) {
    g.popups.push({ x, y, texto, cor, vida: 1.1 });
  }

  function explosao(x, y, cor) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 160;
      g.particulas.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, vida: 0.7, cor });
    }
  }

  function entregar(bin) {
    const p = g.jogador;
    const item = p.carga;
    if (!item) return;
    const cx = bin.x + bin.w / 2;

    if (item.tipo === bin.tipo) {
      g.combo++;
      g.maiorCombo = Math.max(g.maiorCombo, g.combo);
      const mult = 1 + Math.min(g.combo - 1, 4) * 0.25;
      const bonusVel = Math.max(0, Math.round(50 - item.idade * 5));
      const pts = Math.round((100 + bonusVel) * mult);
      g.pontos += pts;
      g.entregues++;
      g.acertos++;
      g.poluicao = Math.max(0, g.poluicao + ACERTO_POLUICAO);
      bin.flash = 0.4;
      bin.flashCor = '#b6ffb0';
      popup(cx, bin.y - 10, '+' + pts + (mult > 1 ? '  x' + mult.toFixed(2) : ''), '#fff7a8');
      explosao(cx, bin.y, TIPOS[bin.tipo].cor);
      som.acerto();
      p.carga = null;
    } else {
      g.combo = 0;
      g.erros++;
      g.pontos = Math.max(0, g.pontos - ERRO_PONTOS);
      g.poluicao = Math.min(100, g.poluicao + ERRO_POLUICAO);
      bin.flash = 0.4;
      bin.flashCor = '#ff8a8a';
      popup(cx, bin.y - 10, 'Lixeira errada! -' + ERRO_PONTOS, '#ff9a9a');
      som.erro();
      p.carga = null;
      p.y = bin.y - p.r - 8; // afasta o jogador da lixeira
    }
  }

  function atualizar(dt) {
    const cfg = FASES[g.fase];
    const p = g.jogador;

    g.relogio += dt;

    // Tempo
    g.tempo -= dt;
    if (g.tempo <= 10 && Math.ceil(g.tempo) !== g.ultimoSegundo) {
      g.ultimoSegundo = Math.ceil(g.tempo);
      if (g.tempo > 0) som.aviso();
    }
    if (g.tempo <= 0) {
      g.tempo = 0;
      return fimDeJogo('O tempo acabou!');
    }

    // Movimento do jogador
    let dx = (teclas.dir ? 1 : 0) - (teclas.esq ? 1 : 0);
    let dy = (teclas.baixo ? 1 : 0) - (teclas.cima ? 1 : 0);
    let naMancha = false;
    for (const m of g.manchas) {
      if (circuloCirculo({ x: p.x, y: p.y, r: p.r - 6 }, m)) naMancha = true;
    }
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      let vel = p.vel * (p.carga ? 0.92 : 1);
      if (naMancha) vel *= 0.45;
      p.x += dx * vel * dt;
      p.y += dy * vel * dt;
      if (dx) p.dir = dx > 0 ? 1 : -1;
      p.andar += dt * 12;
    }
    p.x = Math.max(p.r, Math.min(W - p.r, p.x));
    p.y = Math.max(FIELD_TOP + p.r + 14, Math.min(H - 6, p.y));

    // Manchas móveis
    for (const m of g.manchas) {
      if (m.vx) {
        m.x += m.vx * dt;
        if (m.x < m.r + 10 || m.x > W - m.r - 10) m.vx *= -1;
      }
    }

    // Surgimento de resíduos
    g.spawnT += dt;
    if (g.spawnT >= cfg.spawn) {
      g.spawnT = 0;
      gerarItem();
    }
    for (const it of g.itens) it.idade += dt;
    if (p.carga) p.carga.idade += dt;

    // Coleta (colisão jogador x resíduo)
    if (!p.carga) {
      for (let i = 0; i < g.itens.length; i++) {
        const it = g.itens[i];
        if (circuloCirculo({ x: p.x, y: p.y - 4, r: p.r }, it)) {
          p.carga = { tipo: it.tipo, idade: it.idade };
          g.itens.splice(i, 1);
          som.coletar();
          break;
        }
      }
    }

    // Entrega (colisão jogador x lixeira)
    if (p.carga) {
      for (const bin of BINS) {
        if (circuloRetangulo({ x: p.x, y: p.y, r: p.r }, bin)) {
          entregar(bin);
          break;
        }
      }
    }

    // Poluição: cresce com o lixo largado no cenário
    g.poluicao += dt * g.itens.length * cfg.poluicaoPorItem;
    g.poluicao = Math.max(0, Math.min(100, g.poluicao));
    if (g.poluicao >= 100) return fimDeJogo('A poluição tomou conta do cenário!');

    // Efeitos visuais
    for (const b of BINS) if (b.flash > 0) b.flash -= dt;
    for (const t of g.popups) { t.vida -= dt; t.y -= 40 * dt; }
    g.popups = g.popups.filter(t => t.vida > 0);
    for (const q of g.particulas) {
      q.vida -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 300 * dt;
    }
    g.particulas = g.particulas.filter(q => q.vida > 0);

    // Condição de fim da fase
    if (g.entregues >= cfg.meta) concluirFase();
  }

  function concluirFase() {
    g.bonusFase = Math.round(g.tempo) * 10;
    g.pontos += g.bonusFase;
    salvarRecorde();
    if (g.fase >= FASES.length - 1) {
      modo = 'vitoria';
      som.vitoria();
    } else {
      modo = 'faseConcluida';
      som.fase();
    }
  }

  function fimDeJogo(motivo) {
    g.motivo = motivo;
    salvarRecorde();
    modo = 'derrota';
    som.derrota();
  }

  function salvarRecorde() {
    if (g.pontos > recorde) {
      recorde = g.pontos;
      try { localStorage.setItem('ecoresgate_recorde', String(recorde)); } catch (e) { /* ignora */ }
    }
  }

  /* ------------------------------------------------------------------
     7. DESENHO
  ------------------------------------------------------------------ */
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function texto(t, x, y, tam, cor, align = 'left', peso = 'bold') {
    ctx.font = `${peso} ${tam}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = cor;
    ctx.fillText(t, x, y);
  }

  function desenharFundo() {
    const cfg = FASES[g ? g.fase : 0];
    ctx.fillStyle = cfg.fundo;
    ctx.fillRect(0, FIELD_TOP, W, H - FIELD_TOP);
    // Faixas decorativas
    ctx.fillStyle = cfg.fundo2;
    for (let y = FIELD_TOP; y < H; y += 80) ctx.fillRect(0, y, W, 40);
    // Detalhes por fase
    if (g && g.fase === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let x = 20; x < W; x += 120) ctx.fillRect(x, 300, 60, 6);
    }
    if (g && g.fase === 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      for (let y = 120; y < FIELD_BOTTOM; y += 70) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 20) {
          const yy = y + Math.sin(x * 0.03 + (g ? g.relogio : 0) * 1.5 + y) * 5;
          if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
  }

  function desenharMancha(m) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,18,28,0.88)';
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, m.r * 1.15, m.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,90,200,0.35)';
    ctx.beginPath();
    ctx.ellipse(m.x - m.r * 0.25, m.y - m.r * 0.2, m.r * 0.5, m.r * 0.22, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(60,200,160,0.25)';
    ctx.beginPath();
    ctx.ellipse(m.x + m.r * 0.3, m.y + m.r * 0.2, m.r * 0.3, m.r * 0.14, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function desenharResiduo(tipo, x, y, esc = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(esc, esc);
    ctx.lineWidth = 2;
    if (tipo === 'papel') {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#7a8aa0';
      rr(-11, -14, 22, 28, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#a9b6c7';
      ctx.lineWidth = 1.5;
      for (let i = -7; i <= 7; i += 5) { ctx.beginPath(); ctx.moveTo(-6, i); ctx.lineTo(6, i); ctx.stroke(); }
    } else if (tipo === 'plastico') {
      ctx.fillStyle = '#d6eeff';
      ctx.strokeStyle = '#5a9ad6';
      rr(-8, -6, 16, 20, 5); ctx.fill(); ctx.stroke();
      rr(-4, -13, 8, 8, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d93a3a';
      ctx.fillRect(-5, -17, 10, 4);
    } else if (tipo === 'vidro') {
      ctx.fillStyle = '#2f8f45';
      ctx.strokeStyle = '#17562a';
      rr(-8, -4, 16, 18, 4); ctx.fill(); ctx.stroke();
      rr(-3.5, -16, 7, 13, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(-5, 0, 3, 10);
    } else if (tipo === 'metal') {
      ctx.fillStyle = '#c9ced4';
      ctx.strokeStyle = '#6b7480';
      rr(-9, -12, 18, 25, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8b923';
      ctx.fillRect(-9, -3, 18, 8);
      ctx.fillStyle = '#9aa2ad';
      ctx.fillRect(-9, -12, 18, 3);
    }
    ctx.restore();
  }

  function desenharLixeira(b) {
    const cor = TIPOS[b.tipo].cor;
    ctx.save();
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rr(b.x + 4, b.y + 6, b.w, b.h, 12); ctx.fill();
    // corpo
    ctx.fillStyle = cor;
    rr(b.x, b.y + 14, b.w, b.h - 14, 12); ctx.fill();
    // tampa
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rr(b.x - 6, b.y, b.w + 12, 18, 8); ctx.fill();
    ctx.fillStyle = cor;
    rr(b.x - 6, b.y, b.w + 12, 14, 8); ctx.fill();
    // brilho de feedback
    if (b.flash > 0) {
      ctx.globalAlpha = Math.min(1, b.flash / 0.4) * 0.75;
      ctx.fillStyle = b.flashCor;
      rr(b.x - 6, b.y, b.w + 12, b.h, 12); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // rótulo
    texto('♻', b.x + 34, b.y + 62, 34, 'rgba(255,255,255,0.9)', 'center');
    texto(TIPOS[b.tipo].nome, b.x + b.w / 2 + 16, b.y + 60, 22, '#ffffff', 'center');
    ctx.restore();
  }

  function desenharJogador(p) {
    const x = p.x, y = p.y;
    const bal = Math.sin(p.andar) * 4;
    ctx.save();
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 22, 15, 5, 0, 0, Math.PI * 2); ctx.fill();
    // pernas
    ctx.fillStyle = '#2d3a63';
    ctx.fillRect(x - 9, y + 10, 7, 12 + bal * 0.5);
    ctx.fillRect(x + 2, y + 10, 7, 12 - bal * 0.5);
    // corpo
    ctx.fillStyle = '#2e9e4f';
    rr(x - 12, y - 14, 24, 26, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('♻', x, y + 4);
    // braços
    ctx.fillStyle = '#f2c79b';
    if (p.carga) {
      ctx.fillRect(x - 15, y - 26, 5, 16);
      ctx.fillRect(x + 10, y - 26, 5, 16);
    } else {
      ctx.fillRect(x - 17, y - 12 + bal * 0.4, 5, 14);
      ctx.fillRect(x + 12, y - 12 - bal * 0.4, 5, 14);
    }
    // cabeça
    ctx.beginPath(); ctx.arc(x, y - 24, 11, 0, Math.PI * 2); ctx.fill();
    // boné
    ctx.fillStyle = '#1d7a3a';
    ctx.beginPath(); ctx.arc(x, y - 26, 11, Math.PI, 0); ctx.fill();
    ctx.fillRect(x + (p.dir > 0 ? 2 : -14), y - 27, 12, 3);
    // olho
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(x + p.dir * 4, y - 23, 1.8, 0, Math.PI * 2); ctx.fill();
    // item carregado
    if (p.carga) {
      desenharResiduo(p.carga.tipo, x, y - 50, 1.1);
    }
    ctx.restore();
  }

  function desenharPoluicao() {
    const nivel = g.poluicao / 100;
    if (nivel <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = nivel * 0.5;
    ctx.fillStyle = '#4a4a2a';
    ctx.fillRect(0, FIELD_TOP, W, H - FIELD_TOP);
    ctx.globalAlpha = nivel * 0.45;
    ctx.fillStyle = '#2b2b24';
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 190 + g.relogio * (14 + i * 3)) % (W + 240)) - 120;
      const cy = FIELD_TOP + 28 + (i % 3) * 14;
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.arc(cx + 40, cy + 8, 38, 0, Math.PI * 2);
      ctx.arc(cx - 40, cy + 10, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function desenharHUD() {
    const cfg = FASES[g.fase];
    ctx.fillStyle = '#173627';
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = '#0d2418';
    ctx.fillRect(0, HUD_H - 4, W, 4);

    texto('PONTOS', 20, 24, 12, '#9fd8b3');
    texto(String(g.pontos), 20, 52, 26, '#ffffff');

    texto('FASE', 170, 24, 12, '#9fd8b3');
    texto((g.fase + 1) + ' / ' + FASES.length, 170, 52, 24, '#ffffff');

    texto('META', 290, 24, 12, '#9fd8b3');
    texto(g.entregues + ' / ' + cfg.meta, 290, 52, 24, '#ffffff');
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(290, 55, 90, 4);
    ctx.fillStyle = '#7dff9c';
    ctx.fillRect(290, 55, 90 * Math.min(1, g.entregues / cfg.meta), 4);

    const urgente = g.tempo <= 10;
    texto('TEMPO', 430, 24, 12, '#9fd8b3');
    texto(Math.ceil(g.tempo) + 's', 430, 52, 26, urgente && Math.floor(g.relogio * 4) % 2 ? '#ff6b6b' : (urgente ? '#ffb0b0' : '#ffffff'));

    texto('POLUIÇÃO', 560, 24, 12, '#9fd8b3');
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(560, 32, 240, 18, 9); ctx.fill();
    const pol = g.poluicao / 100;
    const corPol = pol < 0.5 ? '#7dff9c' : pol < 0.8 ? '#ffd45e' : '#ff5e5e';
    if (pol > 0) {
      ctx.fillStyle = corPol;
      rr(560, 32, Math.max(18, 240 * pol), 18, 9); ctx.fill();
    }
    texto(Math.round(g.poluicao) + '%', 810, 48, 16, '#ffffff');

    texto('RECORDE', 890, 24, 12, '#9fd8b3', 'center');
    texto(String(recorde), 890, 50, 18, '#ffe38a', 'center');
  }

  function painel(titulo, linhas, rodape, cor = '#2e9e4f', altura = 380) {
    ctx.fillStyle = 'rgba(8,24,16,0.72)';
    ctx.fillRect(0, 0, W, H);
    const pw = 700, ph = altura;
    const px = (W - pw) / 2, py = (H - ph) / 2;
    ctx.fillStyle = '#f4fff7';
    rr(px, py, pw, ph, 18); ctx.fill();
    ctx.fillStyle = cor;
    rr(px, py, pw, 70, 18); ctx.fill();
    ctx.fillRect(px, py + 40, pw, 30);
    texto(titulo, W / 2, py + 48, 30, '#ffffff', 'center');
    let y = py + 112;
    for (const l of linhas) {
      if (typeof l === 'string') {
        texto(l, W / 2, y, 18, '#214433', 'center', 'normal');
      } else {
        texto(l.t, W / 2, y, l.tam || 18, l.cor || '#214433', 'center', l.peso || 'normal');
      }
      y += 30;
    }
    if (Math.floor(performance.now() / 500) % 2 === 0) {
      texto(rodape, W / 2, py + ph - 26, 20, cor, 'center');
    }
  }

  function desenharLegenda() {
    // pequenos ícones de cada tipo dentro do painel do menu
    const tipos = ['papel', 'plastico', 'vidro', 'metal'];
    tipos.forEach((t, i) => {
      const x = W / 2 - 150 + i * 100;
      const y = 380;
      ctx.fillStyle = TIPOS[t].cor;
      rr(x - 34, y - 28, 68, 56, 10); ctx.fill();
      desenharResiduo(t, x, y, 1.2);
    });
  }

  function desenhar() {
    ctx.clearRect(0, 0, W, H);
    desenharFundo();

    if (modo === 'menu') {
      BINS.forEach(desenharLixeira);
      painel('EcoResgate: Missão Planeta Limpo', [
        { t: 'Colete os resíduos espalhados e leve cada um à lixeira da cor certa.', tam: 17 },
        { t: 'Seja rápido: a poluição aumenta enquanto houver lixo no chão!', tam: 17 },
        { t: 'Conclua as 3 fases e junte o máximo de pontos.', tam: 17 },
        { t: '' },
        { t: '' }, { t: '' }, { t: '' },
        { t: 'Setas / WASD: mover   •   Espaço: soltar item   •   P: pausar   •   M: som', tam: 15, cor: '#4a6b5a' }
      ], 'Pressione ENTER para começar', '#2e9e4f', 440);
      desenharLegenda();
      return;
    }

    // Cenário
    g.manchas.forEach(desenharMancha);
    BINS.forEach(desenharLixeira);

    const cfg = FASES[g.fase];
    for (const it of g.itens) {
      const oy = Math.sin(g.relogio * 3 + it.bob) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(it.x, it.y + 16, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      if (g.fase === 0) {
        ctx.strokeStyle = TIPOS[it.tipo].cor;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(it.x, it.y + oy, 22, 0, Math.PI * 2); ctx.stroke();
      }
      desenharResiduo(it.tipo, it.x, it.y + oy);
    }

    desenharJogador(g.jogador);
    desenharPoluicao();

    // Partículas e textos flutuantes
    for (const q of g.particulas) {
      ctx.globalAlpha = Math.max(0, q.vida / 0.7);
      ctx.fillStyle = q.cor;
      ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
    for (const t of g.popups) {
      ctx.globalAlpha = Math.min(1, t.vida * 1.5);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.font = 'bold 22px Arial';
      ctx.textAlign = 'center';
      ctx.strokeText(t.texto, t.x, t.y);
      ctx.fillStyle = t.cor;
      ctx.fillText(t.texto, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    if (g.combo > 1 && modo === 'jogando') {
      const mult = 1 + Math.min(g.combo - 1, 4) * 0.25;
      texto('COMBO x' + mult.toFixed(2), 16, HUD_H + 28, 20, '#fff7a8');
    }
    if (g.jogador.carga && modo === 'jogando') {
      texto('Levando: ' + TIPOS[g.jogador.carga.tipo].nome, W - 16, HUD_H + 28, 18, '#ffffff', 'right');
    }

    desenharHUD();

    // Telas sobrepostas
    if (modo === 'intro') {
      painel('FASE ' + (g.fase + 1) + ' — ' + cfg.nome, [
        { t: 'Meta: entregar ' + cfg.meta + ' resíduos corretamente', tam: 20, peso: 'bold' },
        { t: 'Tempo: ' + cfg.tempo + ' segundos', tam: 20, peso: 'bold' },
        { t: '' },
        { t: 'Dica:', tam: 16, cor: '#4a6b5a', peso: 'bold' },
        { t: cfg.dica.length > 70 ? cfg.dica.slice(0, cfg.dica.lastIndexOf(' ', 70)) : cfg.dica, tam: 16 },
        { t: cfg.dica.length > 70 ? cfg.dica.slice(cfg.dica.lastIndexOf(' ', 70) + 1) : '', tam: 16 }
      ], 'Pressione ENTER para iniciar', '#2e9e4f', 360);
    } else if (modo === 'pausa') {
      painel('PAUSA', [
        { t: 'Jogo pausado.', tam: 20 },
        { t: 'Pressione P para continuar.', tam: 18 }
      ], 'Pressione P para continuar', '#3b6fb5', 260);
    } else if (modo === 'faseConcluida') {
      painel('FASE ' + (g.fase + 1) + ' CONCLUÍDA!', [
        { t: 'Bônus de tempo: +' + g.bonusFase + ' pontos', tam: 20, peso: 'bold' },
        { t: 'Pontuação total: ' + g.pontos, tam: 22, peso: 'bold', cor: '#1d7a3a' },
        { t: 'Acertos: ' + g.acertos + '   •   Erros: ' + g.erros, tam: 17 },
        { t: 'Maior combo: ' + g.maiorCombo, tam: 17 }
      ], 'Pressione ENTER para a próxima fase', '#2e9e4f', 340);
    } else if (modo === 'vitoria') {
      const estrelas = g.pontos >= 4000 ? 3 : g.pontos >= 2500 ? 2 : 1;
      painel('PLANETA LIMPO! VOCÊ VENCEU!', [
        { t: '★'.repeat(estrelas) + '☆'.repeat(3 - estrelas), tam: 44, cor: '#e8a817' },
        { t: 'Pontuação final: ' + g.pontos, tam: 24, peso: 'bold', cor: '#1d7a3a' },
        { t: 'Acertos: ' + g.acertos + '   •   Erros: ' + g.erros + '   •   Maior combo: ' + g.maiorCombo, tam: 16 },
        { t: g.pontos >= recorde ? 'Novo recorde!' : 'Recorde: ' + recorde, tam: 18, peso: 'bold', cor: '#c77d00' },
        { t: 'Reciclar é cuidar do futuro. Obrigado, herói ambiental!', tam: 16 }
      ], 'Pressione ENTER para jogar novamente', '#2e9e4f', 400);
    } else if (modo === 'derrota') {
      painel('FIM DE JOGO', [
        { t: g.motivo, tam: 20, peso: 'bold', cor: '#a62d2d' },
        { t: 'Pontuação: ' + g.pontos + '   (Fase ' + (g.fase + 1) + ')', tam: 20 },
        { t: 'Acertos: ' + g.acertos + '   •   Erros: ' + g.erros, tam: 17 },
        { t: 'Recorde: ' + recorde, tam: 17 }
      ], 'Pressione ENTER para tentar de novo', '#c0392b', 340);
    }
  }

  /* ------------------------------------------------------------------
     8. LOOP PRINCIPAL
  ------------------------------------------------------------------ */
  let ultimo = performance.now();
  function loop(agora) {
    const dt = Math.min(0.05, (agora - ultimo) / 1000);
    ultimo = agora;
    if (modo === 'jogando') atualizar(dt);
    else if (g) g.relogio += dt;
    desenhar();
    requestAnimationFrame(loop);
  }

  novaPartida();
  requestAnimationFrame(loop);
})();
