// Rotary knob (centre console): rotate = move the selection, press = activate. Ring shown only while the knob is used.
export function createKnob() {
  let idx = -1, timer = 0;
  const scope = () => {
    const panel = ['settings', 'led', 'vehicle'].map(id => document.getElementById(id)).find(p => p && !p.hidden);
    const root = panel || document;
    return [...root.querySelectorAll('button, label.sw2, label.tog')].filter(b => b.offsetParent !== null && !b.disabled
      && !(panel === undefined && b.closest('#led, #vehicle, #settings')));
  };
  function show(list) {
    document.querySelectorAll('.kfocus').forEach(e => e.classList.remove('kfocus'));
    const el = list[idx]; if (!el) return;
    el.classList.add('kfocus'); el.scrollIntoView && el.scrollIntoView({ block: 'nearest' });
    document.body.classList.add('knob');
    clearTimeout(timer); timer = setTimeout(() => { document.body.classList.remove('knob'); document.querySelectorAll('.kfocus').forEach(e => e.classList.remove('kfocus')); idx = -1; }, 8000);
  }
  return {
    key(k) {
      const list = scope(); if (!list.length) return;
      const cur = document.querySelector('.kfocus'); idx = cur ? list.indexOf(cur) : -1;
      if (k === 'ok') { if (cur) { (cur.querySelector('input') || cur).click(); show(scope()); } else { idx = 0; show(list); } return; }
      idx = idx < 0 ? 0 : (idx + (k === 'next' ? 1 : -1) + list.length) % list.length;
      show(list);
    },
  };
}
