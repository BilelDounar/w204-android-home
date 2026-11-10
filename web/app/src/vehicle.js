// "Véhicule" panel (button i): live status, current trip, records, maintenance. Data = decoder + app-computed stats.
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dur = m => m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;

export function createVehiclePanel({ getState, trips, getPaint = () => 'black', setPaint = () => {}, openSettings = () => {} }) {
  const el = document.createElement('section');
  el.id = 'vehicle'; el.hidden = true; el.setAttribute('aria-label', 'Informations véhicule');
  el.innerHTML = `
    <header><h1>Véhicule</h1><button id="v-set" class="chip" aria-label="Réglages"><svg viewBox="0 0 24 24"><path d="M10.3 2.6h3.4l.5 2.5c.6.2 1.2.5 1.7.9l2.4-.9 1.7 2.9-1.9 1.7c.1.6.1 1.3 0 1.9l1.9 1.7-1.7 2.9-2.4-.9c-.5.4-1.1.7-1.7.9l-.5 2.5h-3.4l-.5-2.5c-.6-.2-1.2-.5-1.7-.9l-2.4.9-1.7-2.9 1.9-1.7a6 6 0 0 1 0-1.9L3.9 8l1.7-2.9 2.4.9c.5-.4 1.1-.7 1.7-.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" stroke-width="1.7"/></svg></button><button id="v-close" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></header>
    <div class="vgrid">
      <article class="card odo">
        <span class="lbl">Kilométrage</span>
        <div class="big"><b id="v-odo">—</b><small>km</small></div>
        <ul class="chips" id="v-chips"></ul>
      </article>
      <article class="card">
        <span class="lbl" id="v-trip-lbl">Trajet en cours</span>
        <div class="big"><b id="v-trip-km">—</b><small>km</small></div>
        <dl class="kv">
          <div><dt>Durée</dt><dd id="v-trip-min">—</dd></div>
          <div><dt>Moyenne</dt><dd id="v-trip-avg">—</dd></div>
          <div><dt>Vitesse max</dt><dd id="v-trip-vmax">—</dd></div>
          <div><dt>Régime max</dt><dd id="v-trip-rpm">—</dd></div>
        </dl>
      </article>
      <article class="card">
        <span class="lbl">Records</span>
        <div class="big"><b id="v-rec-vmax">—</b><small>km/h max</small></div>
        <dl class="kv">
          <div><dt>Trajets</dt><dd id="v-rec-trips">—</dd></div>
          <div><dt>Parcourus</dt><dd id="v-rec-km">—</dd></div>
          <div><dt>Plus long</dt><dd id="v-rec-long">—</dd></div>
          <div><dt>Régime max</dt><dd id="v-rec-rpm">—</dd></div>
        </dl>
      </article>
      <article class="card">
        <span class="lbl">Entretien</span>
        <div class="big"><b id="v-svc-left">—</b><small id="v-svc-unit">km avant vidange</small></div>
        <div class="bar"><i id="v-svc-bar"></i></div>
        <div class="svc">
          <button id="v-svc-minus" aria-label="Moins 1000 km">−1 000</button>
          <span id="v-svc-at">Prochaine : —</span>
          <button id="v-svc-plus" aria-label="Plus 1000 km">+1 000</button>
        </div>
        <button id="v-svc-reset" class="wide">Vidange faite · +15 000 km</button>
      </article>
    </div>`;
  document.body.appendChild(el);
  const $ = id => el.querySelector('#' + id);
  let timer = null;

  const chip = (on, okText, badText, warn = false) => `<li class="${on ? (warn ? 'warn' : 'on') : ''}">${on ? badText : okText}</li>`;
  function render() {
    const v = getState(), s = trips.view();
    $('v-odo').textContent = fmt(s.odometer);
    const doorOpen = v.doors && Object.entries(v.doors).filter(([k, x]) => x && k !== 'hood').map(([k]) => ({ FL: 'AVG', FR: 'AVD', RL: 'ARG', RR: 'ARD', trunk: 'coffre' }[k]));
    $('v-chips').innerHTML = [
      chip(v.engine, 'Moteur arrêté', `Moteur · ${fmt(v.rpm)} tr/min`),
      chip(v.handbrake, 'Frein à main desserré', 'Frein à main serré'),
      v.seatbelt == null ? '' : chip(!v.seatbelt, 'Ceinture bouclée', 'Ceinture non bouclée', true),
      chip(doorOpen && doorOpen.length, 'Portes fermées', `Ouvert : ${doorOpen.join(', ')}`, true),
      chip(v.lights && (v.lights.lowbeam || v.lights.highbeam), 'Phares éteints', v.lights && v.lights.highbeam ? 'Plein phare' : 'Phares allumés'),
    ].join('');
    const T = s.cur || s.last;
    $('v-trip-lbl').textContent = s.cur ? 'Trajet en cours' : s.last ? 'Dernier trajet' : 'Trajet';
    $('v-trip-km').textContent = T ? fmt(T.km, 1) : '—';
    $('v-trip-min').textContent = T ? dur(T.min) : '—';
    $('v-trip-avg').textContent = T && T.avg ? `${fmt(T.avg)} km/h` : '—';
    $('v-trip-vmax').textContent = T ? `${fmt(T.vmax)} km/h` : '—';
    $('v-trip-rpm').textContent = s.cur && s.cur.rpmMax ? `${fmt(s.cur.rpmMax)} tr/min` : '—';
    $('v-rec-vmax').textContent = fmt(s.rec.vmax);
    $('v-rec-trips').textContent = fmt(s.rec.trips);
    $('v-rec-km').textContent = `${fmt(s.rec.km)} km`;
    $('v-rec-long').textContent = `${fmt(s.rec.longestKm, 1)} km`;
    $('v-rec-rpm').textContent = s.rec.rpmMax ? `${fmt(s.rec.rpmMax)} tr/min` : '—';
    const left = s.service.left;
    $('v-svc-left').textContent = left == null ? '—' : fmt(Math.abs(left));
    $('v-svc-unit').textContent = left == null ? 'définis la prochaine vidange' : left < 0 ? 'km de dépassement' : 'km avant vidange';
    $('v-svc-at').textContent = s.service.nextKm ? `Prochaine : ${fmt(s.service.nextKm)} km` : 'Prochaine : —';
    const pct = left == null ? 0 : Math.max(0, Math.min(100, (1 - left / 15000) * 100));
    $('v-svc-bar').style.width = pct + '%';
    $('v-svc-bar').className = left != null && left < 1000 ? 'warn' : '';
  }
  $('v-set').onclick = () => { close(); openSettings(); };
  $('v-close').onclick = () => close();
  $('v-svc-minus').onclick = () => { const s = trips.view(); trips.setService((s.service.nextKm || s.odometer || 0) - 1000); render(); };
  $('v-svc-plus').onclick = () => { const s = trips.view(); trips.setService((s.service.nextKm || s.odometer || 0) + 1000); render(); };
  $('v-svc-reset').onclick = () => { const s = trips.view(); if (s.odometer) { trips.setService(s.odometer + 15000); render(); } };

  function open() { el.hidden = false; render(); timer = setInterval(render, 1000); }
  function close() { el.hidden = true; clearInterval(timer); }
  return { open, close, toggle: () => el.hidden ? open() : close() };
}
