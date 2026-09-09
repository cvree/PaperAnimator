/**
 * The live layer — the things you do with your hands while you are talking.
 *
 * A slide deck plays. A talk is performed: you point at the thing, you circle
 * the number, you push in on the corner of the figure somebody asked about, you
 * black out the room to make them look at you instead. None of that can be
 * authored in advance, because none of it is known in advance — it is a
 * response to the room. So it lives here, entirely at run time, and it never
 * touches the project: ink drawn over a slide is a gesture, not an edit, and it
 * goes away when the talk does.
 *
 * This file is plain JavaScript on purpose. It is imported as a module by the
 * presenter and inlined verbatim as source into the published page, so there is
 * exactly one implementation of every gesture rather than two that drift — the
 * same reason `realmShims.js` is written this way for the pdf worker.
 *
 * Everything it draws is in world coordinates and re-projected through the
 * camera on every frame, so a circle you drew round a number stays round that
 * number when you push in on it.
 */

/**
 * @param {object} options
 * @param {HTMLElement} options.host        the `.bx-root` element
 * @param {() => {x:number,y:number,zoom:number}} options.getCamera
 * @param {(camera:{x:number,y:number,zoom:number}) => void} options.setCamera
 * @param {() => void} options.refit        re-frame the stop the talk is on
 * @param {boolean} options.dark            whether the board's lights are off
 * @param {boolean} [options.reduced]       the reader asked for less movement
 */
function createLive(options) {
  const host = options.host;
  const getCamera = options.getCamera;
  const setCamera = options.setCamera;
  const refit = options.refit;
  const dark = !!options.dark;
  const reduced = !!options.reduced;

  /* ---- the surfaces it draws on ---------------------------------------- */

  const layer = el('div', 'bx-live');
  const markCanvas = el('canvas', 'bx-slate bx-slate-mark');
  const penCanvas = el('canvas', 'bx-slate bx-slate-pen');
  const catcher = el('div', 'bx-catch');
  const laserEl = el('div', 'bx-laser');
  const spotEl = el('div', 'bx-spot');
  const timerEl = el('div', 'bx-timer');
  const tools = el('div', 'bx-tools');
  const help = el('div', 'bx-help');

  markCanvas.style.mixBlendMode = dark ? 'screen' : 'multiply';
  laserEl.hidden = true;
  spotEl.hidden = true;
  timerEl.hidden = true;
  help.hidden = true;
  catcher.hidden = true;

  layer.appendChild(markCanvas);
  layer.appendChild(penCanvas);
  layer.appendChild(catcher);
  layer.appendChild(spotEl);
  layer.appendChild(laserEl);
  host.appendChild(layer);
  host.appendChild(timerEl);
  host.appendChild(tools);
  host.appendChild(help);

  /* ---- what is in your hand -------------------------------------------- */

  const INKS = ['var(--bx-accent)', '#ff4d4f', '#ffc531', '#3ddc84', dark ? '#ffffff' : '#141210'];

  const state = {
    tool: null,        // 'pen' | 'mark' | 'erase' | null
    colour: 0,
    laser: false,
    spot: false,
    magnify: false,
    timer: false,
    help: false,
    solo: null,        // the card everything else is dimmed for
  };

  /** Strokes, per slide, in world units. A gesture belongs to the slide it was made on. */
  const slides = new Map();
  let slideKey = '0';
  let drawing = null;
  let pointer = { x: 0, y: 0 };
  let hasPointer = false;
  let started = 0;
  let elapsed = 0;
  let tick = 0;
  let raf = 0;
  let magnifyTarget = null;
  let chromeVisible = true;

  const strokes = () => {
    let list = slides.get(slideKey);
    if (!list) {
      list = [];
      slides.set(slideKey, list);
    }
    return list;
  };

  /* ---- geometry --------------------------------------------------------- */

  function size() {
    return { w: host.clientWidth, h: host.clientHeight };
  }

  function toWorldWith(cam, p) {
    const v = size();
    return { x: (p.x - v.w / 2) / cam.zoom + cam.x, y: (p.y - v.h / 2) / cam.zoom + cam.y };
  }

  function toWorld(p) {
    return toWorldWith(getCamera(), p);
  }

  function toScreen(p, cam, v) {
    return { x: (p.x - cam.x) * cam.zoom + v.w / 2, y: (p.y - cam.y) * cam.zoom + v.h / 2 };
  }

  /* ---- ink -------------------------------------------------------------- */

  function fit() {
    const v = size();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    for (const canvas of [markCanvas, penCanvas]) {
      canvas.width = Math.max(1, Math.round(v.w * dpr));
      canvas.height = Math.max(1, Math.round(v.h * dpr));
      canvas.style.width = v.w + 'px';
      canvas.style.height = v.h + 'px';
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redraw();
  }

  /** Every stroke, re-projected. Called whenever the camera or the slide moves. */
  function redraw() {
    const cam = getCamera();
    const v = size();
    for (const canvas of [markCanvas, penCanvas]) {
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    for (const stroke of strokes()) paint(stroke, cam, v);
    if (drawing) paint(drawing, cam, v);
  }

  function paint(stroke, cam, v) {
    const pts = stroke.pts;
    if (pts.length < 2) return;
    const ctx = (stroke.tool === 'mark' ? markCanvas : penCanvas).getContext('2d');
    ctx.save();
    ctx.strokeStyle = stroke.colour;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (stroke.tool === 'mark') {
      /* One path for the whole stroke. Drawn segment by segment, a translucent
         line darkens everywhere two segments overlap — which is every join, so
         a highlighter would come out as a row of blocks. */
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(2, pts[0].w * cam.zoom);
      ctx.beginPath();
      const first = toScreen(pts[0], cam, v);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const a = toScreen(pts[i], cam, v);
        const b = toScreen(pts[i + 1], cam, v);
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = toScreen(pts[pts.length - 1], cam, v);
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    /* The pen's width comes off the pointer's own speed, so a stroke thins
       where the hand moved quickly — which is what makes ink read as
       handwriting rather than as a line a computer drew. Varying width means
       one path per segment, which is only safe because the pen is opaque. */
    for (let i = 1; i < pts.length; i++) {
      const a = toScreen(pts[i - 1], cam, v);
      const b = toScreen(pts[i], cam, v);
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.6, pts[i].w * cam.zoom);
      ctx.moveTo(a.x, a.y);
      if (i + 1 < pts.length) {
        const c = toScreen(pts[i + 1], cam, v);
        ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      } else {
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function beginStroke(p) {
    const cam = getCamera();
    const world = toWorld(p);
    const base = (state.tool === 'mark' ? 26 : 4.5) / cam.zoom;
    drawing = {
      tool: state.tool,
      colour: ink(state.colour),
      pts: [{ x: world.x, y: world.y, w: base, t: performance.now() }],
    };
  }

  function extendStroke(p) {
    if (!drawing) return;
    const cam = getCamera();
    const world = toWorld(p);
    const last = drawing.pts[drawing.pts.length - 1];
    const now = performance.now();
    const dist = Math.hypot(world.x - last.x, world.y - last.y) * cam.zoom;
    if (dist < 1.2) return;
    let w = last.w;
    if (drawing.tool === 'pen') {
      const speed = dist / Math.max(8, now - last.t);
      const wanted = (5.4 - Math.min(3.2, speed * 1.5)) / cam.zoom;
      w = last.w + (wanted - last.w) * 0.35;
    }
    drawing.pts.push({ x: world.x, y: world.y, w: w, t: now });
    /* A highlighter has to be redrawn whole for the same reason it is one path. */
    if (drawing.tool === 'mark') redraw();
    else paint({ tool: drawing.tool, colour: drawing.colour, pts: drawing.pts.slice(-3) }, cam, size());
  }

  function endStroke() {
    if (drawing && drawing.pts.length > 1) strokes().push(drawing);
    drawing = null;
    redraw();
  }

  function erase(p) {
    const cam = getCamera();
    const world = toWorld(p);
    const reach = 22 / cam.zoom;
    const list = strokes();
    const kept = list.filter(
      (stroke) => !stroke.pts.some((q) => Math.hypot(q.x - world.x, q.y - world.y) < reach),
    );
    if (kept.length !== list.length) {
      slides.set(slideKey, kept);
      redraw();
    }
  }

  function ink(i) {
    const value = INKS[i] || INKS[0];
    if (value.indexOf('var(') !== 0) return value;
    const name = value.slice(4, -1).trim();
    return getComputedStyle(host).getPropertyValue(name).trim() || '#3b82f6';
  }

  /* ---- momentary effects ------------------------------------------------ */

  /** A ring where you pointed. The gesture for "this, here, now". */
  function ping(x, y) {
    if (reduced) return;
    const ring = el('div', 'bx-ping');
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 1200);
  }

  /** A card told to make itself known, for the sentence that is about it. */
  function hit(card) {
    if (!card) return;
    card.removeAttribute('data-hit');
    void card.offsetWidth;
    card.setAttribute('data-hit', '1');
    setTimeout(() => card.removeAttribute('data-hit'), 1000);
  }

  /** Everything except one card steps back, so a question can be answered. */
  function solo(card) {
    if (state.solo) state.solo.removeAttribute('data-solo');
    if (state.solo === card || !card) {
      state.solo = null;
      host.removeAttribute('data-solo');
    } else {
      state.solo = card;
      card.setAttribute('data-solo', '1');
      host.setAttribute('data-solo', '1');
    }
    render();
  }

  /* ---- the camera in your hands ----------------------------------------- */

  function zoomAt(factor) {
    const cam = getCamera();
    const v = size();
    const at = hasPointer ? pointer : { x: v.w / 2, y: v.h / 2 };
    const before = toWorld(at);
    const zoom = Math.max(0.02, Math.min(8, cam.zoom * factor));
    const after = {
      x: (at.x - v.w / 2) / zoom + cam.x,
      y: (at.y - v.h / 2) / zoom + cam.y,
    };
    setCamera({ x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), zoom: zoom });
  }

  /**
   * Push in on whatever you are pointing at and keep pointing.
   *
   * Not a magnifying glass over a picture of the board — the real camera, so
   * type is type at any magnification and the ink you drew scales with it.
   */
  function setMagnify(on) {
    state.magnify = on;
    if (on) {
      magnifyTarget = getCamera();
      loop();
    } else {
      magnifyTarget = null;
      refit();
    }
    render();
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!state.magnify) return;
    const cam = getCamera();
    if (magnifyTarget) {
      /* Where the pointer is aiming has to be read off the camera we started
         from, not off the one we are moving. Reading it off the live camera
         makes the answer depend on the answer: the frame moves, so the world
         point under a stationary cursor moves too, and the push-in walks away
         from the thing it was asked to push in on. */
      const at = hasPointer ? pointer : { x: size().w / 2, y: size().h / 2 };
      const want = toWorldWith(magnifyTarget, at);
      const zoom = Math.min(8, magnifyTarget.zoom * 2.4);
      const k = reduced ? 1 : 0.18;
      setCamera({
        x: cam.x + (want.x - cam.x) * k,
        y: cam.y + (want.y - cam.y) * k,
        zoom: cam.zoom + (zoom - cam.zoom) * k,
      });
    }
    raf = requestAnimationFrame(loop);
  }

  /* ---- the clock -------------------------------------------------------- */

  function setTimer(on) {
    state.timer = on;
    timerEl.hidden = !on;
    if (on && !started) started = performance.now() - elapsed;
    render();
  }

  function resetTimer() {
    started = performance.now();
    elapsed = 0;
    paintTimer();
  }

  function paintTimer() {
    if (!state.timer) return;
    elapsed = performance.now() - (started || performance.now());
    const total = Math.max(0, Math.floor(elapsed / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---- what the hands are holding, drawn ------------------------------- */

  /* Glyphs are drawn here rather than taken from a font: the published file has
     no network, so anything it does not carry itself is a missing square. */
  const svg = (body) =>
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" ' +
    'stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' +
    body +
    '</svg>';

  const TOOLS = [
    { id: 'pen', title: 'Pen · D', glyph: svg('<path d="M2.6 13.4l1.1-3 6-6 1.9 1.9-6 6-3 1.1z"/><path d="M10.7 2.9l1.1-1.1a.9.9 0 0 1 1.3 0l1.1 1.1a.9.9 0 0 1 0 1.3l-1.1 1.1"/>') },
    { id: 'mark', title: 'Highlighter · H', glyph: svg('<path d="M4 10.4l5.6-5.6 2.6 2.6-5.6 5.6H4v-2.6z"/><path d="M2.4 14.6h11.2" stroke-width="2"/>') },
    { id: 'erase', title: 'Rub out · E', glyph: svg('<path d="M6.4 13.2H13"/><path d="M9.6 3.1l3.3 3.3a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0L3.1 9.6a1 1 0 0 1 0-1.4l5.1-5.1a1 1 0 0 1 1.4 0z"/>') },
    { id: 'clear', title: 'Wipe this slide · X', glyph: svg('<path d="M4 4l8 8M12 4l-8 8"/>') },
    { id: 'laser', title: 'Pointer · L', glyph: svg('<circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="5.4"/>') },
    { id: 'spot', title: 'Spotlight · S', glyph: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>') },
    { id: 'magnify', title: 'Push in · Z', glyph: svg('<circle cx="7.2" cy="7.2" r="4.6"/><path d="M10.6 10.6l3.2 3.2M5.2 7.2h4M7.2 5.2v4"/>') },
    { id: 'timer', title: 'Talk timer · T', glyph: svg('<circle cx="8" cy="8.6" r="5.4"/><path d="M8 5.6v3.2l2 1.4M6.2 1.6h3.6"/>') },
    { id: 'help', title: 'Every key · ?', glyph: svg('<path d="M6.1 6a2 2 0 1 1 2.6 2.2c-.5.2-.8.7-.8 1.2v.4"/><circle cx="8" cy="12.3" r="0.85" fill="currentColor" stroke="none"/>') },
  ];

  const buttons = {};
  for (const t of TOOLS) {
    const b = el('button', 'bx-tool');
    b.type = 'button';
    b.title = t.title;
    b.setAttribute('aria-label', t.title);
    b.innerHTML = t.glyph;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      act(t.id);
    });
    buttons[t.id] = b;
    tools.appendChild(b);
  }

  const swatches = el('div', 'bx-swatches');
  for (let i = 0; i < INKS.length; i++) {
    const s = el('button', 'bx-swatch');
    s.type = 'button';
    s.title = 'Ink ' + (i + 1);
    s.setAttribute('aria-label', 'Ink ' + (i + 1));
    s.style.background = INKS[i];
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      state.colour = i;
      if (state.tool !== 'pen' && state.tool !== 'mark') setTool('pen');
      render();
    });
    swatches.appendChild(s);
  }
  tools.appendChild(swatches);

  help.innerHTML =
    '<h2>While you are talking</h2><dl>' +
    row('D', 'Draw on the slide') +
    row('H', 'Highlighter') +
    row('E', 'Rub out a stroke') +
    row('X', 'Wipe this slide clean') +
    row('1 – 5', 'Change the ink') +
    row('L', 'Laser pointer') +
    row('S', 'Spotlight the cursor') +
    row('Z', 'Push in on what you point at') +
    row('+ − 0', 'Zoom in, out, back to the slide') +
    row('. or ⌥click', 'Ring where you point') +
    row('⌥click a card', 'Make it jump') +
    row('⇧click a card', 'Everything else steps back') +
    row('T', 'Talk timer  (⇧T resets it)') +
    row('B', 'Black the screen') +
    row('O', 'The whole board') +
    row('N', 'Your notes') +
    row('F', 'Full screen') +
    row('→ ←', 'Forward, back') +
    '</dl><p>Ink belongs to the slide you drew it on and is never saved.</p>';

  function row(keys, what) {
    return '<div><dt>' + keys + '</dt><dd>' + what + '</dd></div>';
  }

  function render() {
    for (const t of TOOLS) {
      const on =
        t.id === 'pen' || t.id === 'mark' || t.id === 'erase'
          ? state.tool === t.id
          : t.id === 'laser'
            ? state.laser
            : t.id === 'spot'
              ? state.spot
              : t.id === 'magnify'
                ? state.magnify
                : t.id === 'timer'
                  ? state.timer
                  : t.id === 'help'
                    ? state.help
                    : false;
      if (on) buttons[t.id].setAttribute('data-on', '1');
      else buttons[t.id].removeAttribute('data-on');
    }
    const kids = swatches.children;
    for (let i = 0; i < kids.length; i++) {
      if (i === state.colour) kids[i].setAttribute('data-on', '1');
      else kids[i].removeAttribute('data-on');
    }
    const drawingNow = state.tool !== null;
    catcher.hidden = !drawingNow;
    host.setAttribute('data-tool', state.tool || '');
    laserEl.hidden = !state.laser || !hasPointer;
    spotEl.hidden = !state.spot;
    help.hidden = !state.help;
    tools.setAttribute('data-show', chromeVisible || drawingNow ? '1' : '0');
    paintSpot();
  }

  function setTool(tool) {
    state.tool = state.tool === tool ? null : tool;
    if (state.tool) {
      state.laser = false;
      laserEl.hidden = true;
    }
    render();
  }

  function act(id) {
    if (id === 'pen' || id === 'mark' || id === 'erase') setTool(id);
    else if (id === 'clear') {
      slides.set(slideKey, []);
      redraw();
    } else if (id === 'laser') {
      state.laser = !state.laser;
      if (state.laser) state.tool = null;
      render();
    } else if (id === 'spot') {
      state.spot = !state.spot;
      render();
    } else if (id === 'magnify') setMagnify(!state.magnify);
    else if (id === 'timer') setTimer(!state.timer);
    else if (id === 'help') {
      state.help = !state.help;
      render();
    }
  }

  function paintSpot() {
    if (!state.spot) return;
    const v = size();
    const r = Math.round(Math.min(v.w, v.h) * 0.22);
    spotEl.style.background =
      'radial-gradient(circle ' + r + 'px at ' + pointer.x + 'px ' + pointer.y + 'px,' +
      'rgba(0,0,0,0) 0%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.66) 100%)';
  }

  /* ---- events ----------------------------------------------------------- */

  function onPointerMove(e) {
    const rect = host.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    hasPointer = true;
    if (state.laser) {
      laserEl.hidden = false;
      laserEl.style.left = pointer.x + 'px';
      laserEl.style.top = pointer.y + 'px';
    }
    if (state.spot) paintSpot();
    if (drawing) extendStroke(pointer);
    else if (state.tool === 'erase' && e.buttons === 1) erase(pointer);
  }

  function onCatchDown(e) {
    e.stopPropagation();
    e.preventDefault();
    catcher.setPointerCapture(e.pointerId);
    const rect = host.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    hasPointer = true;
    if (state.tool === 'erase') erase(pointer);
    else beginStroke(pointer);
  }

  function onCatchUp(e) {
    e.stopPropagation();
    if (drawing) endStroke();
  }

  /**
   * The topmost card under a point, found by geometry rather than by asking the
   * browser what was clicked. A card that does nothing when clicked is given no
   * pointer events by the presenter — quite right, since clicking it should
   * advance the talk — but it is still a thing you can point at and talk about.
   */
  function cardAt(x, y) {
    const rect = host.getBoundingClientRect();
    const cx = rect.left + x;
    const cy = rect.top + y;
    const all = host.querySelectorAll('.bx-card');
    let best = null;
    let bestZ = -Infinity;
    for (let i = 0; i < all.length; i++) {
      const card = all[i];
      if (card.style.opacity === '0') continue;
      const b = card.getBoundingClientRect();
      if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) continue;
      const z = Number(card.style.zIndex || 0);
      if (z >= bestZ) {
        bestZ = z;
        best = card;
      }
    }
    return best;
  }

  /* Emphasis and isolation are modifier-clicks so they need no mode: you are
     already pointing at the thing you are talking about. */
  function onHostDown(e) {
    if (state.tool) return;
    if (!e.altKey && !e.shiftKey) return;
    seize(e);
    const rect = host.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    hasPointer = true;
    const card = cardAt(pointer.x, pointer.y);
    if (e.shiftKey) solo(card);
    else if (card) hit(card);
    else ping(pointer.x, pointer.y);
  }

  function onHostClick(e) {
    // The press was ours; the click that follows it must not also advance.
    if (!state.tool && (e.altKey || e.shiftKey)) seize(e);
  }

  /**
   * Nothing else gets this event.
   *
   * The talk's own click handler sits on the same element we do, and listeners
   * on one element run in the order they were added rather than by phase — so
   * stopping propagation is not enough to keep a gesture from also turning the
   * page.
   */
  function seize(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey) return;
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const k = e.key;

    if (k === 'Escape') {
      if (state.help) {
        state.help = false;
        render();
        stop(e);
        return;
      }
      if (state.tool || state.solo || state.magnify) {
        state.tool = null;
        if (state.solo) solo(state.solo);
        if (state.magnify) setMagnify(false);
        render();
        stop(e);
        return;
      }
      return;
    }

    const lower = k.length === 1 ? k.toLowerCase() : k;
    if (lower === 'd') return own(e, () => act('pen'));
    if (lower === 'h') return own(e, () => act('mark'));
    if (lower === 'e') return own(e, () => act('erase'));
    if (lower === 'x') return own(e, () => act('clear'));
    if (lower === 'l') return own(e, () => act('laser'));
    if (lower === 's') return own(e, () => act('spot'));
    if (lower === 'z') return own(e, () => act('magnify'));
    if (lower === 't') return own(e, () => (e.shiftKey ? resetTimer() : act('timer')));
    if (k === '?' || k === '/') return own(e, () => act('help'));
    if (k === '.') return own(e, () => ping(pointer.x, pointer.y));
    if (k === '+' || k === '=') return own(e, () => zoomAt(1.3));
    if (k === '-' || k === '_') return own(e, () => zoomAt(1 / 1.3));
    if (k === '0') return own(e, () => refit());
    if (k >= '1' && k <= '5') {
      return own(e, () => {
        state.colour = Number(k) - 1;
        if (state.tool !== 'pen' && state.tool !== 'mark') setTool('pen');
        render();
      });
    }
  }

  function own(e, run) {
    stop(e);
    run();
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (observer) observer.observe(host);

  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerdown', onHostDown, true);
  host.addEventListener('click', onHostClick, true);
  catcher.addEventListener('pointerdown', onCatchDown);
  catcher.addEventListener('pointerup', onCatchUp);
  catcher.addEventListener('pointercancel', onCatchUp);
  catcher.addEventListener('click', (e) => e.stopPropagation());
  help.addEventListener('click', (e) => e.stopPropagation());
  tools.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKey, true);
  tick = setInterval(paintTimer, 500);

  fit();
  render();

  return {
    /** Ink belongs to the slide it was drawn on. */
    slide(key) {
      slideKey = String(key);
      redraw();
    },
    /** The camera moved, so every stroke has to be re-projected. */
    moved() {
      redraw();
    },
    /** The presenter's chrome came or went; the tools travel with it. */
    chrome(visible) {
      chromeVisible = visible;
      render();
    },
    /** True while something here owns the pointer, so the host leaves clicks alone. */
    busy() {
      return state.tool !== null;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(tick);
      if (observer) observer.disconnect();
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerdown', onHostDown, true);
      host.removeEventListener('click', onHostClick, true);
      window.removeEventListener('keydown', onKey, true);
      host.removeAttribute('data-solo');
      host.removeAttribute('data-tool');
      layer.remove();
      tools.remove();
      timerEl.remove();
      help.remove();
    },
  };
}

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export { createLive };
