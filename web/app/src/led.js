// "Éclairage" panel (bulb button) + ambient engine: the interior LEDs react to the car (LedBle.kt over BLE).
// One colour for the whole strip: effects play on colour, intensity and rhythm. Intensity = RGB scaling
// (hardware brightness stays at 100), so fades are smooth. Nothing is ever written to the car's CAN bus.
const KEY = 'w204.led.v2';
const PRESETS = [
  { id: 'polaire', name: 'Polaire', rgb: [200, 225, 255] },
  { id: 'ambre', name: 'Ambre', rgb: [255, 120, 20] },
  { id: 'nuit', name: 'Nuit', rgb: [30, 60, 255] },
  { id: 'sport', name: 'Sport', rgb: [255, 20, 20] },
  { id: 'jade', name: 'Jade', rgb: [20, 255, 150] },
  { id: 'orchidee', name: 'Orchidée', rgb: [190, 60, 255] },
];
const WARM = [255, 170, 90], WHITE = [255, 255, 255], RED = [255, 0, 0], AMBER = [255, 110, 0];
const hsv = h => { const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))); }; return [f(5), f(3), f(1)]; };
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

export function createLedPanel({ send, getState, onColor = () => {} }) {
  const MODES = [
    ['welcome', 'Accueil', 'Porte ou contact : blanc chaud qui monte'],
    ['start', 'Démarrage', 'Effet au lancement du moteur'],
    ['goodbye', 'Au revoir', 'Lumière douce puis extinction'],
    ['alerts', 'Alertes', 'Porte ouverte ou ceinture en roulant'],
    ['night', 'Nuit', 'Intensité réduite avec les phares'],
    ['speed', 'Couleur selon la vitesse', 'Froid en ville, très chaud au-delà de 130'],
    ['signals', 'Clignotants', 'Flash orange au rythme'],
    ['reverse', 'Marche arrière', 'Blanc net'],
  ];
  const START_FX = [['swell', 'Montée'], ['rainbow', 'Arc-en-ciel'], ['pulse', 'Double pulsation'], ['flash', 'Éclair blanc'], ['none', 'Aucun']];
  const st = { on: true, rgb: [200, 225, 255], preset: 'polaire', bright: 85, auto: true, startFx: 'swell',
    modes: { welcome: true, start: true, goodbye: true, alerts: true, night: true, speed: false, signals: false, reverse: false } };
  try { const o = JSON.parse(localStorage.getItem(KEY)) || {}; Object.assign(st, o, { modes: { ...st.modes, ...(o.modes || {}) } }); if ('speedColor' in o) st.modes.speed = o.speedColor; } catch (e) {}
  const on = m => st.auto && st.modes[m];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const led = (action, x = {}) => send({ type: 'led', action, ...x });

  /* ---------- ambient engine ---------- */
  const now = () => performance.now() / 1000;
  let prev = null, cur = [0, 0, 0], lastSent = '', lastTx = 0, released = false, connected = false;
  const fx = { welcome: -1e9, start: -1e9, goodbyeUntil: 0, doorsClosedAt: 0 };

  // speed colour: cold until 70, warming 70-100, warm 100-130, very hot above 130 (km/h)
  const SPEED_STOPS = [[0, [40, 110, 255]], [70, [70, 150, 255]], [100, [255, 165, 60]], [130, [255, 80, 10]], [160, [255, 15, 0]]];
  function speedRgb(kmh) {
    for (let i = 1; i < SPEED_STOPS.length; i++) {
      const [k1, c1] = SPEED_STOPS[i - 1], [k2, c2] = SPEED_STOPS[i];
      if (kmh <= k2) return mix(c1, c2, ease((kmh - k1) / (k2 - k1)));
    }
    return SPEED_STOPS[SPEED_STOPS.length - 1][1];
  }
  let spdSmooth = 0;
  function base(v) {                                     // the user's ambiance, night-dimmed, optionally speed-tinted
    let c = st.rgb;
    if (on('speed') && v.engine) { spdSmooth += ((v.speed || 0) - spdSmooth) * 0.02; c = speedRgb(spdSmooth); }   // slow blend
    const k = st.bright / 100 * (on('night') && v.night ? 0.45 : 1);
    return c.map(x => x * k);
  }

  // engine start effect (customisable)
  function startFx(d, b) {
    const full = st.rgb;
    switch (st.startFx) {
      case 'rainbow': return d < 2.6 ? mix(hsv((d / 2.6) * 360), b, ease((d - 2) / 0.6)) : null;
      case 'pulse': return d < 1.6 ? mix(b.map(x => x * 0.15), full, Math.abs(Math.sin(Math.PI * d / 0.8))) : null;
      case 'flash': return d < 0.25 ? WHITE : d < 1.6 ? mix(WHITE, b, ease((d - 0.25) / 1.35)) : null;
      case 'none': return null;
      default: return d < 2.2 ? mix(b, full.map(x => Math.min(255, x * 1.25)), Math.sin(Math.PI * ease(d / 2.2))) : null;
    }
  }

  function target(v, t) {
    if (!st.on) return [0, 0, 0];
    const b = base(v);
    if (!st.auto) return b;
    // alerts first (safety)
    const doorOpen = v.doors && ['FL', 'FR', 'RL', 'RR', 'trunk'].some(d => v.doors[d]);
    if (on('alerts') && ((doorOpen && v.speed > 5) || (v.seatbelt === false && v.speed > 10))) return mix([0, 0, 0], RED, 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 4)));
    if (on('reverse') && v.reverse) return WHITE.map(x => x * 0.9);
    if (on('signals') && (v.signal_L || v.signal_R || v.hazard)) { const on = (t * 1.5) % 1 < 0.5; return on ? mix(b, AMBER, 0.85) : b; }
    // engine start: short swell to full brightness
    const ds = t - fx.start;
    if (on('start') && ds < 3) { const e = startFx(ds, b); if (e) return e; }
    // welcome: warm white rising, then blending into the ambiance
    const dw = t - fx.welcome;
    if (!on('welcome')) { /* skip */ } else if (dw < 1.6) return mix([0, 0, 0], WARM, ease(dw / 1.6));
    else if (dw < 3.6) return mix(WARM, b, ease((dw - 1.6) / 2));
    // goodbye: engine off, soft light, fades out 30 s after the doors are closed
    if (on('goodbye') && !v.engine && fx.goodbyeUntil) {
      const left = fx.goodbyeUntil - t;
      if (left <= 0) return [0, 0, 0];
      return b.map(x => x * ease(left / 3));
    }
    return b;
  }

  function edges(v, t) {
    const p = prev || v;
    const doorOpen = v.doors && ['FL', 'FR', 'RL', 'RR'].some(d => v.doors[d]);
    const wasOpen = p.doors && ['FL', 'FR', 'RL', 'RR'].some(d => p.doors[d]);
    if ((v.acc && !p.acc) || (doorOpen && !wasOpen && !v.engine && !fx.goodbyeUntil)) fx.welcome = t;
    if (v.engine && !p.engine) { fx.start = t; fx.goodbyeUntil = 0; }
    if (!v.engine && p.engine) fx.goodbyeUntil = t + 600;            // armed: lit while the doors are being used
    if (!v.engine && fx.goodbyeUntil) {
      if (doorOpen) fx.goodbyeUntil = t + 600;
      else if (wasOpen) fx.goodbyeUntil = t + 30;                      // last door closed: 30 s then fade out
    }
    if (v.acc && !p.acc) fx.goodbyeUntil = 0;
    prev = JSON.parse(JSON.stringify(v));
  }

  function tick() {
    if (released) return;
    const v = getState(), t = now();
    edges(v, t);
    const goal = target(v, t);
    cur = mix(cur, goal, 0.35);                                        // smooth every transition
    const out = cur.map(x => Math.max(0, Math.min(255, Math.round(x))));
    const key = out.join(',');
    if (connected && key !== lastSent && performance.now() - lastTx > 110) {
      lastSent = key; lastTx = performance.now(); onColor(out);
      led('rgb', { r: out[0], g: out[1], b: out[2] });
    }
  }
  setInterval(tick, 60);

  /* ---------- panel ---------- */
  const el = document.createElement('section');
  el.id = 'led'; el.hidden = true; el.setAttribute('aria-label', 'Éclairage intérieur');
  el.innerHTML = `
    <header><div><h1>Éclairage</h1><span id="l-status">—</span></div>
      <button id="l-close" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></header>
    <div class="lgrid">
      <article class="card lpower">
        <span class="lbl">Ambiance</span>
        <button id="l-power" aria-label="Allumer / éteindre"><i id="l-dot"></i><b id="l-power-t">Allumé</b></button>
        <ul id="l-found"></ul>
        <button id="l-app" class="ghost">Ouvrir LED LAMP</button>
      </article>
      <article class="card">
        <span class="lbl">Ambiances</span>
        <div class="presets" id="l-presets">${PRESETS.map(p => `<button data-p="${p.id}" style="--c:rgb(${p.rgb})"><i></i>${p.name}</button>`).join('')}</div>
        <span class="lbl">Teinte libre</span>
        <input type="range" id="l-hue" min="0" max="359" step="1" aria-label="Teinte">
        <span class="lbl">Luminosité <em id="l-bv"></em></span>
        <input type="range" id="l-bright" min="5" max="100" step="1" aria-label="Luminosité">
      </article>
      <article class="card lmodes">
        <label class="tog main"><input type="checkbox" id="l-auto"><span><b>Ambiance intelligente</b><small>Les LED réagissent à la voiture</small></span></label>
        <div class="mgrid" id="l-modes">${MODES.map(([k, n, d]) => `<label class="sw2"><input type="checkbox" data-m="${k}"><span><b>${n}</b><small>${d}</small></span></label>`).join('')}</div>
        <span class="lbl">Effet de démarrage</span>
        <div class="fx" id="l-fx">${START_FX.map(([k, n]) => `<button data-fx="${k}">${n}</button>`).join('')}</div>
        <div class="row2"><button id="l-demo" class="ghost">Aperçu accueil</button><button id="l-demo2" class="ghost">Aperçu démarrage</button></div>
      </article>
    </div>`;
  document.body.appendChild(el);
  const $ = id => el.querySelector('#' + id);

  function paint() {
    const c = `rgb(${st.rgb.map(Math.round)})`;
    el.style.setProperty('--led', c);
    $('l-dot').style.background = st.on ? c : 'transparent';
    $('l-power').classList.toggle('off', !st.on);
    $('l-power-t').textContent = st.on ? 'Allumé' : 'Éteint';
    $('l-bright').value = st.bright; $('l-bv').textContent = st.bright + ' %';
    $('l-auto').checked = st.auto;
    el.querySelectorAll('#l-modes input').forEach(i => { i.checked = !!st.modes[i.dataset.m]; i.disabled = !st.auto; });
    el.querySelectorAll('#l-fx button').forEach(b => b.classList.toggle('sel', b.dataset.fx === st.startFx));
    el.querySelectorAll('#l-presets button').forEach(b => b.classList.toggle('sel', b.dataset.p === st.preset));
  }
  const setRgb = (rgb, preset = null) => { st.rgb = rgb; st.preset = preset; st.on = true; paint(); save(); };
  el.querySelectorAll('#l-presets button').forEach(b => b.onclick = () => setRgb(PRESETS.find(p => p.id === b.dataset.p).rgb, b.dataset.p));
  $('l-hue').oninput = e => setRgb(hsv(+e.target.value));
  $('l-bright').oninput = e => { st.bright = +e.target.value; paint(); save(); };
  $('l-power').onclick = () => { st.on = !st.on; paint(); save(); };
  $('l-auto').onchange = e => { st.auto = e.target.checked; paint(); save(); };
  el.querySelectorAll('#l-modes input').forEach(i => i.onchange = () => { st.modes[i.dataset.m] = i.checked; paint(); save(); });
  el.querySelectorAll('#l-fx button').forEach(b => b.onclick = () => { st.startFx = b.dataset.fx; paint(); save(); fx.start = now(); });
  $('l-demo').onclick = () => { fx.welcome = now(); };
  $('l-demo2').onclick = () => { fx.start = now(); };
  $('l-app').onclick = () => { released = true; led('release'); close(); setTimeout(() => send({ type: 'openApp', pkg: 'com.ledlamp' }), 400); };
  $('l-close').onclick = () => close();

  const label = { idle: 'Non connecté', scanning: 'Recherche des LED…', connecting: 'Connexion…', connected: 'Connecté', error: 'Erreur' };
  function status(s) {
    const was = connected; connected = s.state === 'connected';
    if (connected && !was) { led('on'); led('bright', { v: 100 }); lastSent = ''; }   // intensity is handled in RGB
    $('l-status').textContent = s.msg || (label[s.state] || s.state) + (connected && s.name ? ` · ${s.name}` : '');
    $('l-status').className = s.state;
    const list = !connected && s.found && s.found.length > 1 ? s.found : [];
    $('l-found').innerHTML = list.map(d => `<li><button data-a="${d.address}" data-n="${d.name}">${d.name}</button></li>`).join('');
    $('l-found').querySelectorAll('button').forEach(b => b.onclick = () => led('connect', { address: b.dataset.a, name: b.dataset.n }));
  }
  function open() { el.hidden = false; paint(); if (released || !connected) { released = false; led('connect'); } }
  function close() { el.hidden = true; }
  paint();
  setTimeout(() => led('connect'), 3000);               // connect at start-up so the modes work without opening the panel
  return { open, close, status };
}
