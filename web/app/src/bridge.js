// JS <-> Android bridge.
//
// Android -> page : webView.evaluateJavascript("w204.update({...})")   (raw decoder/MCU signals, see signals.js)
//                   webView.evaluateJavascript("w204.media({...})")    (title, artist, playing, cover)
//                   webView.evaluateJavascript("w204.config({...})")   (signals.js config, paint, maxFps…)
// page -> Android : window.W204Native.onEvent(json)  — {type:'ready'} {type:'openLauncher'} {type:'openApp', pkg}
//                                                      {type:'media', action:'prev'|'toggle'|'next'} {type:'openVehicle'}
// Outside Android (browser, tests) W204Native is absent: events are logged instead.

export function createBridge({ signals, onVehicle, onMedia, onConfig, onLed = () => {}, onKey = () => {} }) {
  const native = window.W204Native;
  const send = ev => {
    const json = JSON.stringify(ev);
    if (native && native.onEvent) native.onEvent(json); else console.info('[w204 → native]', json);
  };
  const api = {
    update(raw) { onVehicle(signals.ingest(raw || {})); },
    media(m) { onMedia(m || {}); },
    led(s) { onLed(s || {}); },
    key(k) { onKey(k); },
    config(c) { if (c) { signals.configure(c); onConfig(c); onVehicle(signals.update()); } },
    state() { return JSON.parse(JSON.stringify(signals.state)); },
    send,
    isAndroid: !!native,
  };
  window.w204 = api;
  // time-based debounces (ACC off delay, blinker hold, voltage hold) must resolve even without new data
  setInterval(() => onVehicle(signals.update()), 200);
  return api;
}
