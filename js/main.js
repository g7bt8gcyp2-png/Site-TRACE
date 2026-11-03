(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEBUG = /[?&]debug/.test(location.search);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

  /* =========================================================
     1. INTRO — a cobra rasteja no escuro, brilha em roxo,
        dá uma volta e se enrola no T, formando a marca TRACE.
     ========================================================= */
  const hero = $('.hero');
  const stage = $('.hero__stage');
  const canvas = $('#snake');
  const ctx = canvas.getContext('2d');
  const LOGO_W = 1831; // coordenadas da arte original do logo

  // Rastro final: centro do corpo da cobra no logo (cauda -> cabeça)
  const LOGO_CURVE = [
    [668, 626], [625, 618], [606, 590], [612, 550], [635, 510], [642, 470],
    [625, 430], [590, 395], [545, 360], [500, 325], [465, 290], [452, 252],
    [470, 215], [515, 190], [575, 172], [640, 152], [700, 140], [750, 145],
    [790, 170], [828, 205]
  ];
  // Caminho completo: entra rastejando pela esquerda, contorna o T e sobe pelo rastro final
  const APPROACH = [
    [-1700, 600], [-1450, 480], [-1200, 640], [-950, 480], [-700, 640], [-450, 490],
    [-200, 630], [40, 650], [260, 690],
    // volta ao redor do T
    [520, 720], [800, 700], [990, 540], [1010, 320], [880, 110], [640, 40],
    [420, 80], [300, 250], [340, 470], [470, 640], [620, 700], [700, 670]
  ];
  const CONTROL = APPROACH.concat(LOGO_CURVE);
  const GLOW_AT = APPROACH.findIndex(p => p[0] === 520); // começa a brilhar ao iniciar a volta

  // Amostragem Catmull-Rom com tabela de comprimento de arco
  function sampleSpline(pts, perSeg = 40) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let j = 0; j < perSeg; j++) {
        const t = j / perSeg, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(pts[pts.length - 1]);
    const len = [0];
    for (let i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    return { pts: out, len, total: len[len.length - 1] };
  }
  const path = sampleSpline(CONTROL);
  const bodyLen = sampleSpline(LOGO_CURVE).total;
  const glowStart = sampleSpline(CONTROL.slice(0, GLOW_AT + 1)).total;
  const curveStart = path.total - bodyLen;

  function pointAt(s) {
    s = clamp(s, 0, path.total);
    const L = path.len;
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < s) lo = m; else hi = m; }
    const a = path.pts[lo], b = path.pts[hi];
    const t = (s - L[lo]) / ((L[hi] - L[lo]) || 1);
    const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
    return { x: a[0] + dx * t, y: a[1] + dy * t, tx: dx / dl, ty: dy / dl };
  }

  // Perfil de espessura (u: 0 = cauda, 1 = cabeça) em unidades do logo
  function bodyWidth(u) {
    if (u < 0.55) return lerp(3, 40, Math.pow(u / 0.55, 0.9));
    if (u < 0.85) return lerp(40, 22, (u - 0.55) / 0.3);
    return lerp(22, 30, (u - 0.85) / 0.15);
  }

  let W = 0, H = 0, DPR = 1, scale = 1, ox = 0, oy = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const hr = hero.getBoundingClientRect();
    W = hr.width; H = hr.height;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    const sr = stage.getBoundingClientRect();
    scale = sr.width / LOGO_W;
    ox = sr.left - hr.left; oy = sr.top - hr.top;
  }

  const DURATION = 6200;
  const sparks = [];
  let start = 0, done = false, raf = 0;

  function headProgress(p) {
    // ritmo de rastejo: constante, desacelera ao se enrolar no T
    const lin = p, out = 1 - Math.pow(1 - p, 3);
    return lerp(lin, out, 0.55);
  }

  function drawSnake(headS, glow, wiggleAmp, now, alpha) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;

    const tailS = headS - bodyLen;
    const step = 5;
    const n = Math.ceil(bodyLen / step);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const s = tailS + (i / n) * bodyLen;
      const u = i / n;
      const p = pointAt(s);
      // ondulação lateral (o rastejar), mais forte no meio do corpo
      const env = Math.sin(Math.PI * clamp(u * 1.05)) * wiggleAmp;
      const off = Math.sin(s * 0.022 - now * 0.006) * env;
      pts.push({ x: ox + (p.x - p.ty * off) * scale, y: oy + (p.y + p.tx * off) * scale, w: bodyWidth(u) * scale, u });
    }

    // luz ambiente acompanhando a cabeça (na escuridão)
    const head = pts[pts.length - 1];
    const rad = 260 * scale + 60;
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, rad);
    g.addColorStop(0, `rgba(${Math.round(lerp(90, 169, glow))},${Math.round(lerp(80, 112, glow))},${Math.round(lerp(120, 255, glow))},${lerp(0.08, 0.18, glow)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(head.x - rad, head.y - rad, rad * 2, rad * 2);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // corpo: escuro -> roxo
    const body = `rgb(${Math.round(lerp(38, 140, glow))},${Math.round(lerp(35, 80, glow))},${Math.round(lerp(52, 240, glow))})`;
    const rim = `rgba(${Math.round(lerp(110, 240, glow))},${Math.round(lerp(104, 225, glow))},${Math.round(lerp(130, 255, glow))},${lerp(0.55, 0.95, glow)})`;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        ctx.beginPath();
        if (pass === 0) {
          ctx.strokeStyle = body;
          ctx.lineWidth = b.w;
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        } else {
          // brilho de escamas: linha fina deslocada
          ctx.strokeStyle = rim;
          ctx.lineWidth = Math.max(0.8, b.w * 0.22);
          const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
          const k = b.w * 0.22;
          ctx.moveTo(a.x + nx / nl * k, a.y + ny / nl * k); ctx.lineTo(b.x + nx / nl * k, b.y + ny / nl * k);
        }
        ctx.stroke();
      }
    }

    // cabeça
    const prev = pts[pts.length - 4];
    const ang = Math.atan2(head.y - prev.y, head.x - prev.x);
    const hs = 34 * scale;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(ang);
    // língua
    const flick = Math.sin(now * 0.02) > 0.3 ? 1 : 0;
    if (flick) {
      ctx.strokeStyle = glow > 0.3 ? '#e9d5ff' : '#6b6480';
      ctx.lineWidth = Math.max(1, 2.2 * scale);
      ctx.beginPath();
      ctx.moveTo(hs * 0.7, 0); ctx.lineTo(hs * 1.25, 0);
      ctx.lineTo(hs * 1.5, -hs * 0.18); ctx.moveTo(hs * 1.25, 0); ctx.lineTo(hs * 1.5, hs * 0.18);
      ctx.stroke();
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(hs * 0.1, 0, hs * 0.8, hs * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, 2 * scale); ctx.stroke();
    // olhos
    ctx.fillStyle = glow > 0.2 ? '#ffffff' : '#8f88a8';
    ctx.shadowColor = '#c4a1ff'; ctx.shadowBlur = 12 * glow;
    ctx.beginPath(); ctx.ellipse(hs * 0.35, -hs * 0.24, hs * 0.13, hs * 0.07, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hs * 0.35, hs * 0.24, hs * 0.13, hs * 0.07, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // faíscas roxas no rastro
    if (glow > 0.2 && !done && Math.random() < 0.7) {
      const t = pts[Math.floor(pts.length * (0.55 + Math.random() * 0.45))];
      sparks.push({ x: t.x, y: t.y, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8 - 0.3, life: 1 });
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.life -= 0.018;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(200,160,255,${s.life * 0.8})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.6 * s.life + 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // brilho do canvas inteiro (drop-shadow roxo)
    const blur = Math.round(lerp(0, 18, glow));
    canvas.style.filter = blur ? `drop-shadow(0 0 ${blur}px rgba(169,112,255,${0.9 * glow})) drop-shadow(0 0 ${blur * 2.5}px rgba(124,58,237,${0.6 * glow}))` : 'none';
  }

  let fadeStart = 0;
  function frame(now) {
    if (!start) start = now;
    const t = now - start;
    const p = clamp((t - 500) / DURATION);
    const headS = lerp(bodyLen, path.total, headProgress(p));
    const glow = smooth(glowStart - 120, glowStart + 260, headS);
    const wiggle = 16 * (1 - smooth(curveStart - 300, curveStart + bodyLen * 0.6, headS));

    if (p >= 1 && !done) finishIntro();
    let alpha = 1;
    if (done) {
      if (!fadeStart) fadeStart = now;
      alpha = 1 - clamp((now - fadeStart - 350) / 900);
    }
    drawSnake(headS, glow, wiggle, now, alpha);

    if (done && alpha <= 0 && !sparks.length) { ctx.clearRect(0, 0, W, H); canvas.style.filter = 'none'; return; }
    raf = requestAnimationFrame(frame);
  }

  function finishIntro() {
    if (done) return;
    done = true;
    hero.classList.add('is-lit', 'is-done');
    document.body.classList.remove('is-intro');
  }

  function skipIntro() {
    if (!done) {
      cancelAnimationFrame(raf);
      finishIntro();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.filter = 'none';
    }
  }

  function drawDebug() {
    resize();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.strokeStyle = 'red'; ctx.lineWidth = 2; ctx.beginPath();
    path.pts.forEach((p, i) => { const x = ox + p[0] * scale, y = oy + p[1] * scale; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }

  window.addEventListener('resize', () => { resize(); if (DEBUG) drawDebug(); });
  $('#skipIntro').addEventListener('click', skipIntro);
  window.addEventListener('keydown', e => { if (!done && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) skipIntro(); });

  window.scrollTo(0, 0);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  if (DEBUG) {
    finishIntro(); drawDebug();
  } else if (reduceMotion) {
    finishIntro();
  } else {
    const begin = () => { resize(); raf = requestAnimationFrame(frame); };
    const logo = $('#heroLogo');
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      if (logo.complete) begin(); else { logo.addEventListener('load', begin, { once: true }); logo.addEventListener('error', begin, { once: true }); }
    });
  }

  /* =========================================================
     NAV — fundo sólido após sair do hero
     ========================================================= */
  const nav = $('.nav');
  const onScrollNav = () => nav.classList.toggle('is-solid', window.scrollY > window.innerHeight * 0.6);

  /* =========================================================
     2. SLOGAN — palavras acendem conforme a rolagem
     ========================================================= */
  const sloganSec = $('#slogan');
  const sloganText = $('#sloganText');
  const words = sloganText.textContent.trim().split(/\s+/);
  sloganText.innerHTML = words.map((w, i) =>
    `<span class="w${i === words.length - 1 ? ' is-accent' : ''}">${w}</span>`).join(' ');
  const wordEls = $$('.w', sloganText);
  const tracePath = $('#sloganPath');
  const traceLen = tracePath.getTotalLength();
  tracePath.style.strokeDasharray = traceLen;
  tracePath.style.strokeDashoffset = traceLen;

  function onScrollSlogan() {
    const r = sloganSec.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = clamp((vh * 0.55 - r.top) / (r.height - vh * 0.45));
    wordEls.forEach((el, i) => el.classList.toggle('is-on', p > (i + 0.4) / (wordEls.length + 1)));
    tracePath.style.strokeDashoffset = traceLen * (1 - clamp(p * 1.15));
    sloganSec.classList.toggle('is-complete', p > 0.82);
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { onScrollNav(); onScrollSlogan(); ticking = false; });
  }, { passive: true });
  onScrollSlogan();

  /* =========================================================
     3. LINHAS STANDARD / SKILL + CATÁLOGO
     ========================================================= */
  const products = window.TRACE_PRODUCTS || [];
  const linesSec = $('#linhas');
  const grid = $('#grid');
  const state = { line: 'standard', cat: 'all' };
  const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  function render() {
    const list = products.filter(p => p.line === state.line && (state.cat === 'all' || p.cat === state.cat));
    grid.innerHTML = list.map((p, i) => `
      <button class="card" type="button" data-id="${p.id}" style="--i:${i}" aria-label="${p.name} — ver detalhes">
        <div class="card__media">
          <img src="${p.img}" alt="${p.name}" loading="lazy" class="${p.flat ? 'is-flat' : ''}">
        </div>
        <div class="card__body">
          <p class="card__cat">${p.catLabel}<span class="card__line"> · ${p.line === 'skill' ? 'Skill' : 'Standard'}</span></p>
          <h3 class="card__name">${p.name}</h3>
          <p class="card__lead">${p.lead}</p>
          <div class="card__foot">
            <span class="card__price"><small>preço médio</small>${brl(p.price)}</span>
            <span class="card__more">Detalhes <span aria-hidden="true">→</span></span>
          </div>
        </div>
      </button>`).join('');
  }

  function setLine(line) {
    if (state.line === line) return;
    state.line = line;
    linesSec.dataset.line = line;
    $$('.switch__btn').forEach(b => {
      const on = b.dataset.line === line;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
    render();
  }

  $$('.switch__btn').forEach(b => b.addEventListener('click', () => setLine(b.dataset.line)));
  $('.switch').addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = state.line === 'standard' ? 'skill' : 'standard';
      setLine(next); $(`#tab-${next}`).focus();
    }
  });
  $$('.chip').forEach(c => c.addEventListener('click', () => {
    state.cat = c.dataset.cat;
    $$('.chip').forEach(x => x.classList.toggle('is-active', x === c));
    render();
  }));
  $$('[data-goto]').forEach(a => a.addEventListener('click', () => setLine(a.dataset.goto)));

  // Inclinação 3D + luz seguindo o cursor
  grid.addEventListener('pointermove', e => {
    const card = e.target.closest('.card');
    if (!card || e.pointerType !== 'mouse') return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 8}deg) rotateY(${(x - 0.5) * 10}deg) translateY(-4px)`;
  });
  grid.addEventListener('pointerout', e => {
    const card = e.target.closest('.card');
    if (card && !card.contains(e.relatedTarget)) card.style.transform = '';
  });
  grid.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) openModal(card.dataset.id, card);
  });

  render();

  /* =========================================================
     MODAL — descrição do produto
     ========================================================= */
  const modal = $('#modal');
  let lastFocus = null;
  function openModal(id, from) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    lastFocus = from;
    const img = $('#mImg');
    img.src = p.img; img.alt = p.name;
    img.classList.toggle('is-flat', p.flat);
    $('#mTag').textContent = `${p.catLabel} · Linha ${p.line === 'skill' ? 'Skill' : 'Standard'}`;
    $('#mTitle').textContent = p.name;
    $('#mLead').textContent = p.lead;
    $('#mDesc').textContent = p.desc;
    $('#mSpecs').innerHTML = p.specs.map(s => `<li>${s}</li>`).join('');
    $('#mPrice').textContent = brl(p.price);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('.modal__close', modal).focus(), 50);
  }
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal(); });

  /* =========================================================
     RASTRO DO CURSOR — "TRACE = rastro"
     ========================================================= */
  const trail = $('#trail');
  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    const tctx = trail.getContext('2d');
    const pts = [];
    let tRaf = 0;
    const size = () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      trail.width = innerWidth * d; trail.height = innerHeight * d;
      tctx.setTransform(d, 0, 0, d, 0, 0);
    };
    size();
    window.addEventListener('resize', size);
    window.addEventListener('pointermove', e => {
      pts.push({ x: e.clientX, y: e.clientY, life: 1 });
      if (pts.length > 40) pts.shift();
      if (!tRaf) tRaf = requestAnimationFrame(drawTrail);
    }, { passive: true });
    function drawTrail() {
      tctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of pts) p.life -= 0.045;
      while (pts.length && pts[0].life <= 0) pts.shift();
      tctx.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        tctx.strokeStyle = `rgba(169,112,255,${b.life * 0.55})`;
        tctx.lineWidth = b.life * 3;
        tctx.beginPath(); tctx.moveTo(a.x, a.y); tctx.lineTo(b.x, b.y); tctx.stroke();
      }
      tRaf = pts.length ? requestAnimationFrame(drawTrail) : 0;
    }
  }
})();
