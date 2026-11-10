// Fake decoder for development: replays scenarios through the same w204.update() the Android side will use.
// ?mock=demo  -> loops a full drive (contact, start, doors, indicators, reverse…)
// ?dev=1      -> shows the manual simulation panel

export function startDemo(api) {
  const steps = [
    [1.5, { acc: true }],
    [6.0, { engine: true, voltage: 14.1 }],
    [9.5, { speed: 50 }],
    [12.0, { signal_L: true }], [12.4, { signal_L: false }], [12.8, { signal_L: true }], [13.2, { signal_L: false }],
    [13.6, { signal_L: true }], [14.0, { signal_L: false }],                          // raw blinking input
    [15.0, { speed: 90, highbeam: true }],
    [19.0, { speed: 30, highbeam: false, brake: true }], [20.5, { brake: false }],
    [22.0, { speed: 0 }],
    [24.0, { doors: { FL: true } }], [26.5, { doors: { FL: false } }],
    [27.5, { reverse: true, speed: 6 }], [30.0, { reverse: false, speed: 0 }],
    [31.0, { hazard: true }], [33.5, { hazard: false }],
    [35.0, { doors: { trunk: true } }], [37.5, { doors: { trunk: false } }],
    [39.0, { engine: false, voltage: 12.5 }],
    [42.5, { acc: false }],
  ];
  const timers = [];
  const run = () => {
    for (const [t, p] of steps) timers.push(setTimeout(() => api.update(p), t * 1000));
    timers.push(setTimeout(run, 48000));
  };
  run();
  api.media({ title: 'Nightcall', artist: 'Kavinsky', playing: true });
  return () => timers.forEach(clearTimeout);
}

export function devPanel(api) {
  const el = document.createElement('div');
  el.id = 'dev';
  el.innerHTML = `
    <div class="row"><b>Simulation décodeur</b><span id="dev-src"></span></div>
    <div class="row">
      <button data-k="acc">Contact</button><button data-k="engine">Moteur</button><button data-k="reverse">Recul</button><button data-k="handbrake">Frein à main</button>
    </div>
    <div class="row"><label for="dev-spd">Vitesse</label><input id="dev-spd" type="range" min="0" max="130" value="0"><span id="dev-spdv">0</span></div>
    <div class="row">
      <button data-d="FL">Porte AVG</button><button data-d="FR">Porte AVD</button><button data-d="RL">ARG</button><button data-d="RR">ARD</button><button data-d="trunk">Coffre</button><button data-d="hood">Capot</button>
    </div>
    <div class="row">
      <button data-k="lowbeam">Croisement</button><button data-k="highbeam">Plein phare</button><button data-k="fog">Antibrouillard</button>
      <button data-k="signal_L">Cligno G</button><button data-k="signal_R">Cligno D</button><button data-k="hazard">Warning</button>
    </div>
    <div class="row"><button data-k="illumination">Éclairage (nuit)</button><button data-k="brake">Frein</button><button data-p="paint">Peinture</button></div>`;
  document.body.appendChild(el);
  const st = { acc: false, engine: false, doors: {} };
  el.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k; st[k] = !st[k]; b.setAttribute('aria-pressed', st[k]); api.update({ [k]: st[k] });
  });
  el.querySelectorAll('button[data-d]').forEach(b => b.onclick = () => {
    const d = b.dataset.d; st.doors[d] = !st.doors[d]; b.setAttribute('aria-pressed', st.doors[d]); api.update({ doors: { [d]: st.doors[d] } });
  });
  let paint = 'black';
  el.querySelector('[data-p]').onclick = () => { paint = paint === 'black' ? 'white' : 'black'; api.config({ paint }); };
  const spd = el.querySelector('#dev-spd');
  spd.oninput = () => { el.querySelector('#dev-spdv').textContent = spd.value; api.update({ speed: +spd.value }); };
  setInterval(() => { const s = api.state(); el.querySelector('#dev-src').textContent = `moteur via : ${s.engineSource}`; }, 500);
}
