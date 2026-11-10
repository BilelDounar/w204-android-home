// « Réglages » panel: everything adjustable without adb. Persisted in localStorage (per unit).
const KEY = 'w204.settings.v1';
export const settings = (() => {
  const d = { theme: 'auto', dim: true, dimLevel: 35 };
  try { Object.assign(d, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
  return d;
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} };

export function createSettingsPanel({ apply, getPaint, setPaint, resetStats, version }) {
  const el = document.createElement('section');
  el.id = 'settings'; el.hidden = true; el.setAttribute('aria-label', 'Réglages');
  el.innerHTML = `
    <header><h1>Réglages</h1><button id="s-close" aria-label="Fermer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></header>
    <div class="sgrid">
      <article class="card">
        <span class="lbl">Affichage</span>
        <div class="row"><b>Thème</b><div class="seg" id="s-theme"><button data-v="auto">Auto</button><button data-v="day">Jour</button><button data-v="night">Nuit</button></div></div>
        <small class="hint">Auto : nuit dès que les phares sont allumés.</small>
        <label class="tog"><input type="checkbox" id="s-dim"><span><b>Écran atténué la nuit</b><small>Baisse la luminosité avec les phares</small></span></label>
        <div class="row"><span class="m">Intensité la nuit</span><input type="range" id="s-dimlvl" min="10" max="80" step="5"><em id="s-dimv"></em></div>
      </article>
      <article class="card">
        <span class="lbl">Véhicule 3D</span>
        <div class="row"><b>Modèle</b><div class="seg" id="s-paint"><button data-v="black">Noir</button><button data-v="white">Blanc</button></div></div>
        <span class="lbl">Données</span>
        <button id="s-reset" class="ghost">Remettre à zéro trajets et records</button>
        <small class="hint" id="s-reset-hint">Le kilométrage et la vidange sont conservés.</small>
      </article>
      <article class="card">
        <span class="lbl">Système</span>
        <dl class="kv"><div><dt>Version</dt><dd>${version}</dd></div><div><dt>Données</dt><dd>Décodeur CAN</dd></div></dl>
        <small class="hint">Mises à jour et retour à l'origine : voir docs/restauration.md sur le Mac.</small>
      </article>
    </div>`;
  document.body.appendChild(el);
  const $ = id => el.querySelector('#' + id);
  let armed = 0;
  function paint() {
    el.querySelectorAll('#s-theme button').forEach(b => b.classList.toggle('sel', b.dataset.v === settings.theme));
    el.querySelectorAll('#s-paint button').forEach(b => b.classList.toggle('sel', b.dataset.v === getPaint()));
    $('s-dim').checked = settings.dim; $('s-dimlvl').value = settings.dimLevel; $('s-dimv').textContent = settings.dimLevel + ' %';
    $('s-dimlvl').disabled = !settings.dim;
  }
  const set = (k, v) => { settings[k] = v; save(); apply(); paint(); };
  el.querySelectorAll('#s-theme button').forEach(b => b.onclick = () => set('theme', b.dataset.v));
  el.querySelectorAll('#s-paint button').forEach(b => b.onclick = () => { setPaint(b.dataset.v); paint(); });
  $('s-dim').onchange = e => set('dim', e.target.checked);
  $('s-dimlvl').oninput = e => set('dimLevel', +e.target.value);
  $('s-reset').onclick = () => {                     // two taps: no accidental reset while driving
    if (Date.now() - armed < 4000) { resetStats(); armed = 0; $('s-reset').textContent = 'Trajets et records remis à zéro'; return; }
    armed = Date.now(); $('s-reset').textContent = 'Toucher encore pour confirmer';
    setTimeout(() => { if (armed) { armed = 0; $('s-reset').textContent = 'Remettre à zéro trajets et records'; } }, 4000);
  };
  $('s-close').onclick = () => close();
  function open() { el.hidden = false; paint(); }
  function close() { el.hidden = true; }
  return { open, close };
}
