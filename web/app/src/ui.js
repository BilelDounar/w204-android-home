// DOM overlays of the home screen: speed, tell-tales, fade, alerts, right column (Waze zone, music), dock buttons.
const $ = id => document.getElementById(id);

export function createUI({ send, openVehicle, openLed, openSettings }) {
  const tells = Object.fromEntries(['lowbeam', 'highbeam', 'fog', 'signal_L', 'signal_R', 'hazard', 'reverse', 'handbrake'].map(k => [k, $('tl-' + k)]));
  const fade = $('fade'), speedo = $('speedo'), kmh = $('kmh'), alert = $('alert');
  let lastBg = '';

  $('btn-set').onclick = () => openSettings && openSettings();
  $('call-ok').onclick = () => send({ type: 'media', action: 'answer' });
  $('call-end').onclick = () => send({ type: 'media', action: 'hangup' });
  $('btn-apps').onclick = () => send({ type: 'openLauncher' });                 // 3×3 grid -> stock launcher (all apps)
  $('btn-led').onclick = () => openLed ? openLed() : send({ type: 'openApp', pkg: 'com.ledlamp' });  // native LED panel (LED LAMP as fallback)
  $('btn-info').onclick = () => openVehicle ? openVehicle() : send({ type: 'openVehicle' });
  $('waze').onclick = () => send({ type: 'openSplit', pkg: 'com.waze' });        // Waze beside the home screen (split view)
  // dock « Waze »: full screen -> split view with Waze; in split (compact) -> back to full screen
  $('btn-nav').onclick = () => send(document.body.classList.contains('compact') ? { type: 'closeSplit' } : { type: 'openSplit', pkg: 'com.waze' });
  $('m-prev').onclick = () => send({ type: 'media', action: 'prev' });
  $('m-toggle').onclick = () => send({ type: 'media', action: 'toggle' });
  $('m-next').onclick = () => send({ type: 'media', action: 'next' });

  // status bar clock
  const tick = () => { const d = new Date();
    $('t-time').textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    $('t-date').textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); };
  tick(); setInterval(tick, 10000);
  const mmss = ms => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  return {
    led(s) { $('c-led').classList.toggle('on', s.state === 'connected'); },
    // called by the scene after each drawn frame
    frame(scene) {
      const S = scene.S, v = scene.v || {};
      const drive = S.state === 'drive';
      speedo.style.opacity = drive ? 1 : 0;
      document.body.classList.toggle('driving', drive);
      const tt = $('t-temp'); if (v.outTemp != null) { tt.hidden = false; tt.textContent = `${v.outTemp.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} °C`; } else tt.hidden = true;
      if (v.odometer && v.odometer !== this._odo) { this._odo = v.odometer; $('t-odo').textContent = `${v.odometer.toLocaleString('fr-FR')} km`; }
      kmh.textContent = Math.round(S.speed);
      fade.style.opacity = S.road.toFixed(3);
      const bg = '#' + scene.scene.background.getHexString();
      if (bg !== lastBg) { lastBg = bg; document.documentElement.style.setProperty('--scene-bg', bg); document.documentElement.dataset.theme = scene.themeK > .5 ? 'light' : 'dark'; }
      const L = S.lights;
      tells.lowbeam.classList.toggle('on', !!L.lowbeam && !L.highbeam && S.state !== 'off');
      tells.highbeam.classList.toggle('on', !!L.highbeam);
      tells.fog.classList.toggle('on', !!L.fog);
      tells.signal_L.classList.toggle('on', !!L.signal_L);
      tells.signal_R.classList.toggle('on', !!L.signal_R);
      tells.hazard.classList.toggle('on', !!(v.hazard || S.flash));
      tells.reverse.classList.toggle('on', !!v.reverse);
      tells.handbrake.classList.toggle('on', !!v.handbrake);
      // alerts as a banner (doc: door open while driving, handbrake while moving)
      const doorOpen = v.doors && Object.values(v.doors).some(Boolean);
      const msg = drive && S.speed > 5 && doorOpen ? 'Porte ouverte'
        : drive && S.speed > 5 && v.handbrake ? 'Frein à main serré' : '';
      alert.textContent = msg; alert.hidden = !msg;
    },
    media(m) {
      if ('title' in m) $('m-title').textContent = m.title || 'Aucune musique';
      if ('artist' in m) $('m-artist').textContent = m.artist || (m.title ? '' : 'Lance une musique sur ton téléphone');
      if ('playing' in m) $('m-toggle').dataset.playing = m.playing ? '1' : '0';
      if ('cover' in m) { $('m-cover').style.backgroundImage = m.cover ? `url(${m.cover})` : ''; $('m-cover').classList.toggle('has-art', !!m.cover); }
      if (m.phone) $('c-bt').querySelector('em').textContent = m.phone.replace(/^iPhone de /i, 'iPhone ');
      if ('callState' in m || 'callNumber' in m || 'callTime' in m) {
        Object.assign(this._call = this._call || {}, m);
        const c = this._call, st = c.callState, on = st === 3 || st === 4 || st === 5;
        $('call').hidden = !on; document.body.classList.toggle('in-call', on);
        $('call').dataset.st = st;
        $('call-num').textContent = c.callNumber || 'Numéro masqué';
        $('call-st').textContent = st === 4 ? 'Appel entrant' : st === 3 ? 'Appel en cours…' : `En ligne · ${mmss((c.callTime || 0) * 1000)}`;
        $('call-end-l').textContent = st === 4 ? 'Refuser' : 'Raccrocher';
      }
      if ('connected' in m) $('c-bt').classList.toggle('on', !!m.connected);
      else if (m.title) $('c-bt').classList.add('on');
      if ('duration' in m) { this._dur = m.duration; $('m-dur').textContent = mmss(m.duration); }
      if ('position' in m) { $('m-pos').textContent = mmss(m.position); if (this._dur > 0) $('m-progress').firstElementChild.style.width = Math.min(100, m.position / this._dur * 100) + '%'; }
    },
    // let the intro reach "headlights on" (≈1.7 s) even if the scene is ready sooner, then crossfade
    ready() { const left = 1700 - performance.now(); setTimeout(() => $('poster').classList.add('gone'), Math.max(0, left)); },
  };
}
