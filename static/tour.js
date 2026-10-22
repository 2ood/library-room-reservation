// "How to use" walkthrough: highlights one part of the page at a time with a short explanation.
// It only explains; it never clicks, books or cancels anything. The only state kept is a
// localStorage flag recording that the tour was seen, which unticks "Show tutorial after login".

const Tour = (() => {
  const SEEN_KEY = 'tourSeen';

  const STEPS = [
    {
      el: '#date-btn',
      title: 'Pick a date',
      text: 'Choose the day you want a room. The library\'s 00:00–02:00 slots count as the end of the evening before.',
    },
    {
      el: '#clock',
      title: 'Choose a time window',
      text: 'Drag around the clock to select the hours you need. The dark inner arc shows how many rooms are free each hour.',
    },
    {
      el: '#map',
      title: 'See which rooms are free',
      text: 'Rooms are coloured for your window: green is free the whole time, yellow partly free, grey taken, '
        + 'light blue yours, hatched not bookable for you. Hover a room to see its whole day.',
    },
    {
      el: '#map',
      title: 'Open a room',
      text: 'Click a room to open its panel at the bottom. Its strip pre-selects the earliest stretch you can book. '
        + 'Drag to change it, Shift+click to extend, Ctrl/⌘+click to add or remove hours, then press Reserve.',
    },
    {
      el: '.side .mine',
      title: 'Your reservations',
      text: 'Your bookings this month. Tick one or more rows and press Cancel to cancel them.',
    },
    {
      el: '#quota',
      title: 'Limits and updates',
      text: 'Your remaining hours for the day and the month are shown here. The page refreshes every minute; '
        + 'use the ⟳ button to refresh now.',
    },
  ];

  let i = 0;
  let root = null;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } };

  function place() {
    const step = STEPS[i];
    const target = document.querySelector(step.el);
    const spot = root.querySelector('.tour-spot');
    const card = root.querySelector('.tour-card');
    card.querySelector('.tour-title').textContent = step.title;
    card.querySelector('.tour-text').textContent = step.text;
    card.querySelector('.tour-count').textContent = `${i + 1} / ${STEPS.length}`;
    card.querySelector('[data-act=back]').disabled = i === 0;
    card.querySelector('[data-act=next]').textContent = i === STEPS.length - 1 ? 'Done' : 'Next';

    const pad = 6, gap = 12, m = 12;
    const r = target.getBoundingClientRect();
    Object.assign(spot.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px`,
    });

    // Put the card beside the highlight: right, left, below or above, whichever fits; clamp to the viewport.
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const vw = innerWidth, vh = innerHeight;
    let x, y;
    if (r.right + pad + gap + cw <= vw - m) { x = r.right + pad + gap; y = r.top; }
    else if (r.left - pad - gap - cw >= m) { x = r.left - pad - gap - cw; y = r.top; }
    else if (r.bottom + pad + gap + ch <= vh - m) { x = r.left; y = r.bottom + pad + gap; }
    else { x = r.left; y = r.top - pad - gap - ch; }
    card.style.left = `${Math.max(m, Math.min(x, vw - cw - m))}px`;
    card.style.top = `${Math.max(m, Math.min(y, vh - ch - m))}px`;
    card.querySelector('[data-act=next]').focus();
  }

  function go(to) {
    if (to < 0) return;
    if (to >= STEPS.length) return close();
    i = to;
    place();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', place);
  }

  function start() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
    close();
    i = 0;
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `
      <div class="tour-block"></div>
      <div class="tour-spot"></div>
      <div class="tour-card" role="dialog" aria-label="How to use">
        <button type="button" class="tour-close" data-act="close" aria-label="Close">×</button>
        <strong class="tour-title"></strong>
        <p class="tour-text"></p>
        <div class="tour-nav">
          <span class="tour-count muted"></span>
          <button type="button" data-act="back">Back</button>
          <button type="button" class="primary" data-act="next">Next</button>
        </div>
      </div>`;
    root.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'back') go(i - 1);
      else if (act === 'next') go(i + 1);
    });
    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    addEventListener('resize', place);
    place();
  }

  return { start, seen };
})();
