// Raw signals (decoder box + MCU of the unit) -> stable vehicle state for the scene.
// No OBD: everything comes from the decoder / harness wires (see docs/donnees-decodeur.md).
//
// Accepted raw fields (all optional except acc, any subset per update):
//   acc        bool    ACC wire (contact on)
//   engine     bool    "engine running" bit if the decoder provides it
//   rpm        number  engine speed if the decoder provides it
//   voltage    number  battery voltage if the MCU exposes it (V)
//   speed      number  km/h (decoder or speed-pulse wire)
//   reverse    bool    reverse wire / decoder
//   handbrake  bool
//   brake      bool    brake pedal (rarely available)
//   doors      {FL, FR, RL, RR, trunk, hood: bool}
//   position, lowbeam, highbeam, fog   bool  (lights)
//   illumination bool  lighting wire (dash illumination) -> night theme
//   signal_L, signal_R, hazard          bool  steady or blinking: both are handled

export const DEFAULT_CONFIG = {
  accOffDelay: 1.5,          // s: ACC must stay low this long before we call it "off" (wiring glitches, cranking dips)
  engineSource: 'auto',      // auto | engine | rpm | voltage | speed
  rpmOn: 400,
  voltageOn: 13.2, voltageOff: 12.9, voltageHold: 2.0,
  speedOn: 3,                // km/h: if nothing else, moving means the engine runs
  blinkHold: 1.0,            // s: a blinker input stays "active" this long after its last 1 (raw blinking -> steady)
  themeSource: 'auto',       // auto (illumination if ever received, else system) | illumination | system | day | night
};

export class Signals {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.raw = { acc: false, doors: {} };
    this.seen = new Set();                    // which fields the source actually provides
    this.t = { accLow: null, vHigh: null, vLow: null, sigL: -1e9, sigR: -1e9, haz: -1e9 };
    this.engineLatched = false;
    this.state = this._empty();
  }
  _empty() {
    return { acc: false, engine: false, speed: 0, reverse: false, handbrake: false, brake: null,
      doors: { FL: false, FR: false, RL: false, RR: false, trunk: false, hood: false },
      lights: { position: null, lowbeam: null, highbeam: null, fog: null }, signal_L: false, signal_R: false, hazard: false,
      night: null, provided: [] };
  }
  configure(cfg) { Object.assign(this.cfg, cfg); }

  ingest(p, now = performance.now() / 1000) {
    for (const k of Object.keys(p)) this.seen.add(k);
    if (p.doors) { this.raw.doors = { ...this.raw.doors, ...p.doors }; }
    for (const k of Object.keys(p)) if (k !== 'doors') this.raw[k] = p[k];
    const r = this.raw;
    if (r.signal_L) this.t.sigL = now;
    if (r.signal_R) this.t.sigR = now;
    if (r.hazard) this.t.haz = now;
    return this.update(now);
  }

  // call regularly (every frame or every 100 ms) so time-based debounces resolve without new data
  update(now = performance.now() / 1000) {
    const c = this.cfg, r = this.raw, s = this.state;

    // ACC with off-delay
    if (r.acc) { this.t.accLow = null; s.acc = true; }
    else if (s.acc) { this.t.accLow ??= now; if (now - this.t.accLow >= c.accOffDelay) s.acc = false; }
    if (!s.acc) this.engineLatched = false;

    // engine running: best available source
    const src = c.engineSource === 'auto'
      ? (this.seen.has('engine') ? 'engine' : this.seen.has('rpm') ? 'rpm' : this.seen.has('voltage') ? 'voltage' : 'speed')
      : c.engineSource;
    let eng = false;
    if (src === 'engine') eng = !!r.engine;
    else if (src === 'rpm') eng = (r.rpm || 0) > c.rpmOn;
    else if (src === 'voltage') {
      const v = r.voltage || 0;
      if (v > c.voltageOn) { this.t.vLow = null; this.t.vHigh ??= now; if (now - this.t.vHigh >= c.voltageHold) this.engineLatched = true; }
      else if (v < c.voltageOff) { this.t.vHigh = null; this.t.vLow ??= now; if (now - this.t.vLow >= 3) this.engineLatched = false; }
      eng = this.engineLatched;
    } else {                                    // speed fallback: latch on first movement, until ACC off
      if ((r.speed || 0) > c.speedOn) this.engineLatched = true;
      eng = this.engineLatched;
    }
    s.engine = s.acc && eng;
    s.engineSource = src;

    // a long crawl at <= 5 km/h is a standstill with GPS noise (car parked, weak signal): report 0 until > 7 km/h
    const raw = Math.max(0, r.speed || 0);
    if (raw > 7) this.t.slow = null; else if (raw <= 5) this.t.slow ??= now;
    s.speed = this.t.slow != null && now - this.t.slow > 4 && raw <= 7 ? 0 : raw;
    s.outTemp = this.seen.has('outTemp') && r.outTemp != null ? +r.outTemp : null;   // °C, if the decoder provides it
    s.rpm = r.rpm || 0; s.odometer = r.odometer || null; s.seatbelt = this.seen.has('seatbelt') ? !!r.seatbelt : null;
    s.reverse = !!r.reverse; s.handbrake = !!r.handbrake;
    s.brake = this.seen.has('brake') ? !!r.brake : null;          // null = unknown -> scene uses deceleration
    for (const d of ['FL', 'FR', 'RL', 'RR', 'trunk', 'hood']) s.doors[d] = !!r.doors[d];
    for (const l of ['position', 'lowbeam', 'highbeam', 'fog']) s.lights[l] = this.seen.has(l) ? !!r[l] : null;

    // blinkers: steady "active" flags (the scene draws its own blink)
    const hz = this.seen.has('hazard') ? now - this.t.haz < c.blinkHold : false;
    const L = now - this.t.sigL < c.blinkHold, R = now - this.t.sigR < c.blinkHold;
    s.hazard = hz || (L && R);
    s.signal_L = L && !s.hazard; s.signal_R = R && !s.hazard;

    // theme
    const ts = c.themeSource === 'auto' ? (this.seen.has('illumination') ? 'illumination' : 'system') : c.themeSource;
    s.night = ts === 'illumination' ? !!r.illumination : ts === 'day' ? false : ts === 'night' ? true : null;  // null = system
    s.provided = [...this.seen];
    return s;
  }
}
