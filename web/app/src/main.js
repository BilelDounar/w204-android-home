// W204 Home — entry point: 3D scene (three.js), vehicle signals, Android bridge, panels (Véhicule, Éclairage, Réglages),
// responsive layout (full screen / split screen beside Waze). Bundled by esbuild into dist/app.js (`npm run build`).
import { CarScene } from './scene.js';
import { Signals } from './signals.js';
import { createBridge } from './bridge.js';
import { createUI } from './ui.js';
import { startDemo, devPanel } from './mock.js';
import { Trips } from './trip.js';
import { createVehiclePanel } from './vehicle.js';
import { createLedPanel } from './led.js';
import { createKnob } from './knob.js';
import { settings, createSettingsPanel } from './settings.js';
const VERSION = '0.2';
const knob = createKnob();

const params = new URLSearchParams(location.search);
// low-end GPU guess (before creating the renderer: MSAA is decided at creation)
const gpu = (() => { try { const g = document.createElement('canvas').getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { return ''; } })();
const lowEnd = /Adreno \(TM\) [1-4]\d\d|Mali-[34]\d\d|Mali-T[67]|PowerVR SGX|PowerVR Rogue G6|GC\d{3,4}/i.test(gpu);
const opts = {
  maxFps: +(params.get('fps') || 60),
  pixelRatio: +(params.get('pr') || (lowEnd ? 1 : 1.5)),            // low-end: native resolution (sharp), still frames refined
  antialias: params.get('aa') ? params.get('aa') === '1' : !lowEnd,
  dequantize: params.get('dq') ? params.get('dq') === '1' : lowEnd,
  zone: +(params.get('zone') || 0.24),       // horizontal centre of the car area (left column of the home screen)
};

let bridgeRef = null;
// night: dim the screen (native window brightness) while the app is in front
let lastDim = null;
function dimFor(night) {
  const on = !!(settings.dim && night), key = on + ':' + settings.dimLevel;
  if (key === lastDim || !bridgeRef) return; lastDim = key;
  bridgeRef.send({ type: 'dim', on, level: settings.dimLevel / 100 });
}
const scene = new CarScene(document.getElementById('c'), { assetBase: 'assets/', maxFps: opts.maxFps, pixelRatio: opts.pixelRatio, antialias: opts.antialias, dequantize: opts.dequantize,
  onLog: msg => bridgeRef && bridgeRef.send({ type: 'log', msg }) });
const signals = new Signals();
let ui = null, ledPanel = null;
const bridge = createBridge({
  signals,
  onVehicle: v => { scene.setVehicle(v); scene.setNight(v.night); dimFor(v.night); },
  onMedia: m => ui && ui.media(m),
  onKey: k => knob.key(k),
  onLed: s => { ledPanel && ledPanel.status(s); ui && ui.led(s); },
  onConfig: c => { if (c.paint) scene.load(c.paint); if (c.maxFps) scene.minFrame = 1000 / c.maxFps; },
});
bridgeRef = bridge;
const trips = new Trips();
setInterval(() => trips.tick(signals.state), 1000);
const PAINT_KEY = 'w204.paint';
let paint = params.get('paint') || (() => { try { return localStorage.getItem(PAINT_KEY); } catch (e) { return null; } })() || 'black';
const vehiclePanel = createVehiclePanel({ getState: () => signals.state, trips, getPaint: () => paint, openSettings: () => settingsPanel.open(),
  setPaint: p => { paint = p; try { localStorage.setItem(PAINT_KEY, p); } catch (e) {} scene.load(p); } });
const applySettings = () => { bridge.config({ themeSource: settings.theme === 'auto' ? 'auto' : settings.theme }); lastDim = null; dimFor(signals.state.night); };
const settingsPanel = createSettingsPanel({ apply: applySettings, getPaint: () => paint, version: VERSION, resetStats: () => trips.resetStats(),
  setPaint: p => { paint = p; try { localStorage.setItem(PAINT_KEY, p); } catch (e) {} scene.load(p); } });
ledPanel = createLedPanel({ send: bridge.send, getState: () => signals.state, onColor: rgb => scene.setUnderglow(rgb) });
ui = createUI({ openSettings: () => settingsPanel.open(), send: bridge.send, openVehicle: () => vehiclePanel.open(), openLed: () => ledPanel.open() });
scene.onFrame(s => { ui.frame(s); applyZone(); });

// compact: the car sits above the music card; in drive view (camera behind) it is framed higher
let isCompact = false, lastZone = '';
const applyZone = () => {
  if (!isCompact) return;
  const drive = scene.S && scene.S.camK > 0.5, z = drive ? 'drive' : 'park';
  if (z === lastZone) return; lastZone = z;
  if (drive) scene.setZoneCenter(0.5, 0.17, 1.25); else scene.setZoneCenter(0.5, 0.29, 1.25);
};
const layout = () => {
  // split screen (head unit: our app 1/3 or 1/2, Waze beside) -> compact column: clock, car (top), music, dock
  const compact = params.get('compact') === '1' || (innerWidth < 1000 && innerWidth >= 300);
  const full = !compact && (params.get('full') === '1' || innerWidth < 300);
  document.body.classList.toggle('full', full);
  document.body.classList.toggle('compact', compact);
  const nb = document.querySelector('#btn-nav span'); if (nb) nb.textContent = compact ? 'Plein écran' : 'Waze';
  isCompact = compact; lastZone = '';
  applyZone();
  // layout B (Tesla / Polestar style): car centred above the bottom bar
  if (!compact) scene.setZoneCenter(0.5, full ? 0.5 : 0.39, full ? 1 : 0.8, full ? 1 : 1.3);
  scene.resize(innerWidth, innerHeight);
};
addEventListener('resize', layout);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => scene.setNight(signals.state.night));
layout();

applySettings();
scene.load(paint).then(() => {
  ui.ready();
  scene.setNight(null);
  bridge.send({ type: 'ready', gpu, lowEnd, antialias: opts.antialias, envOk: scene.envOk, logs: scene.logs });
  if (params.get('mock') === 'demo') startDemo(bridge);
  if (params.get('dev') === '1') devPanel(bridge);
});

window.__scene = scene;     // test hook (step/snapshot)
