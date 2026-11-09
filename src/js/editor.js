// Layout editor: drag and resize photo slots, text and QR codes on a strip or photocard.
(function () {
  const { $, h, api } = App;
  const Render = window.Render;

  const SIZES = { strip: [600, 1800], photocard: [1200, 1800] };
  const FONTS = [
    ['Sans', 'sans-serif'],
    ['Serif', 'Georgia, serif'],
    ['Script', "'Brush Script MT', cursive"],
    ['Bold', 'Impact, sans-serif'],
    ['Mono', "'Courier New', monospace"],
  ];

  let t = null;       // template being edited (a copy)
  let sel = -1;       // selected element index
  let frameImg = null;
  let inputs = {};    // numeric inputs of the selected element
  let raf = 0;

  const clone = (o) => structuredClone(o);

  function blankTemplate() {
    return {
      id: 'layout-' + Date.now().toString(36),
      name: 'New layout',
      type: 'strip',
      width: 600,
      height: 1800,
      frame: null,
      background: '#ffffff',
      elements: [
        { type: 'photo', x: 40, y: 40, w: 520, h: 390 },
        { type: 'photo', x: 40, y: 460, w: 520, h: 390 },
        { type: 'photo', x: 40, y: 880, w: 520, h: 390 },
      ],
    };
  }

  async function load(template) {
    t = clone(template);
    sel = -1;
    frameImg = await Render.frameImage(t);
    renderSide();
    buildBoxes();
    redraw();
  }

  // ---------- canvas ----------
  function redraw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const c = Render.renderTemplate(t, { frameImg, placeholders: true, event: App.settings.eventName });
      const cv = $('#edCanvas');
      cv.width = c.width;
      cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
    });
  }

  function buildBoxes() {
    const layer = $('#edBoxes');
    layer.replaceChildren();
    t.elements.forEach((el, i) => {
      const grip = h('div', { class: 'grip', onpointerdown: (e) => startDrag(e, i, 'resize') });
      layer.append(h('div', { class: 'box ' + el.type, onpointerdown: (e) => startDrag(e, i, 'move') }, grip));
    });
    layoutBoxes();
  }

  function layoutBoxes() {
    [...$('#edBoxes').children].forEach((b, i) => {
      const el = t.elements[i];
      if (!el) return;
      b.style.left = (el.x / t.width) * 100 + '%';
      b.style.top = (el.y / t.height) * 100 + '%';
      b.style.width = (el.w / t.width) * 100 + '%';
      b.style.height = (el.h / t.height) * 100 + '%';
      b.classList.toggle('sel', i === sel);
    });
  }

  function startDrag(e, i, mode) {
    e.preventDefault();
    e.stopPropagation();
    select(i);
    const el = t.elements[i];
    const k = t.width / $('#edCanvas').getBoundingClientRect().width; // screen px -> template px
    const start = { x: e.clientX, y: e.clientY, ex: el.x, ey: el.y, ew: el.w, eh: el.h };
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const move = (ev) => {
      const dx = (ev.clientX - start.x) * k;
      const dy = (ev.clientY - start.y) * k;
      if (mode === 'move') {
        el.x = Math.round(start.ex + dx);
        el.y = Math.round(start.ey + dy);
      } else {
        el.w = Math.max(40, Math.round(start.ew + dx));
        if (el.type === 'qr') el.h = el.w;                       // QR stays square
        else if (el.type === 'photo') el.h = Math.max(40, Math.round(start.eh + dy));
      }
      layoutBoxes();
      syncProps();
      redraw();
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }

  // ---------- selection + element panels ----------
  function select(i) {
    sel = i;
    layoutBoxes();
    renderList();
    renderProps();
  }

  function renderList() {
    const list = $('#edList');
    if (!list) return;
    list.replaceChildren();
    let p = 0;
    t.elements.forEach((el, i) => {
      let label;
      if (el.type === 'photo') label = `Photo ${++p}`;
      else if (el.type === 'text') label = 'Text: ' + String(el.text || '').slice(0, 14);
      else label = `QR (${el.source === 'gif' ? 'GIF' : 'photos'})`;
      list.append(h('button', { class: 'chip' + (i === sel ? ' on' : ''), text: label, onclick: () => select(i) }));
    });
  }

  function syncProps() {
    const el = t.elements[sel];
    if (!el) return;
    for (const [key, input] of Object.entries(inputs)) {
      if (document.activeElement !== input) input.value = el[key] ?? '';
    }
  }

  function renderProps() {
    const box = $('#edProps');
    if (!box) return;
    box.replaceChildren();
    inputs = {};
    const el = t.elements[sel];
    if (!el) {
      box.append(h('p', { class: 'hint wide', text: 'Tap an element on the layout (or in the list) to edit it. Drag to move, drag the corner to resize.' }));
      return;
    }

    const num = (key, label) => {
      const input = h('input', {
        class: 'input',
        type: 'number',
        value: el[key],
        oninput: () => {
          el[key] = Number(input.value) || 0;
          if (el.type === 'qr' && key === 'w') el.h = el.w;
          if (el.type === 'text' && key === 'size') el.h = Math.round(el.size * 1.4);
          layoutBoxes();
          redraw();
        },
      });
      inputs[key] = input;
      return h('label', { class: 'f' }, h('span', { text: label }), input);
    };

    box.append(num('x', 'X'), num('y', 'Y'), num('w', 'Width'));
    if (el.type === 'photo') box.append(num('h', 'Height'));
    if (el.type === 'text') box.append(num('size', 'Font size'));

    if (el.type === 'qr') {
      box.append(
        h('label', { class: 'f wide' }, h('span', { text: 'Links to' }),
          h('select', {
            class: 'input',
            value: el.source,
            onchange: (e) => { el.source = e.target.value; renderList(); redraw(); },
          }, h('option', { value: 'gif', text: 'GIF' }), h('option', { value: 'photos', text: 'Soft copies (photos)' })))
      );
    }

    if (el.type === 'text') {
      box.append(
        h('label', { class: 'f wide' }, h('span', { text: 'Text ({event} and {date} are filled in)' }),
          h('input', {
            class: 'input',
            value: el.text || '',
            oninput: (e) => { el.text = e.target.value; renderList(); redraw(); },
          })),
        h('label', { class: 'f' }, h('span', { text: 'Color' }),
          h('input', { class: 'input', type: 'color', value: el.color || '#222222', oninput: (e) => { el.color = e.target.value; redraw(); } })),
        h('label', { class: 'f' }, h('span', { text: 'Align' }),
          h('select', { class: 'input', value: el.align || 'center', onchange: (e) => { el.align = e.target.value; redraw(); } },
            ['left', 'center', 'right'].map((a) => h('option', { value: a, text: a })))),
        h('label', { class: 'f wide' }, h('span', { text: 'Font' }),
          h('select', { class: 'input', value: el.font || FONTS[0][1], onchange: (e) => { el.font = e.target.value; redraw(); } },
            FONTS.map(([label, value]) => h('option', { value, text: label }))))
      );
    }

    box.append(
      h('button', {
        class: 'btn-ghost wide',
        text: 'Delete element',
        onclick: () => {
          t.elements.splice(sel, 1);
          sel = -1;
          buildBoxes();
          renderList();
          renderProps();
          redraw();
        },
      })
    );
  }

  function add(el) {
    t.elements.push(el);
    sel = t.elements.length - 1;
    buildBoxes();
    renderList();
    renderProps();
    redraw();
  }

  // ---------- sidebar ----------
  function setType(type) {
    t.type = type;
    [t.width, t.height] = SIZES[type];
    renderSide();
    redraw();
  }

  function renderSide() {
    const side = $('#edSide');
    side.replaceChildren();
    const known = App.templates.some((x) => x.id === t.id);

    side.append(
      h('label', { class: 'f' }, h('span', { text: 'Template' }),
        h('select', {
          class: 'input',
          value: t.id,
          onchange: (e) => {
            const found = App.templates.find((x) => x.id === e.target.value);
            if (found) load(found);
          },
        },
          !known ? h('option', { value: t.id, text: '(unsaved) ' + t.name }) : null,
          App.templates.map((x) => h('option', { value: x.id, text: x.name })))),

      h('div', { class: 'row' },
        h('button', { class: 'btn-ghost', text: 'New', onclick: () => { t = blankTemplate(); sel = -1; frameImg = null; renderSide(); buildBoxes(); redraw(); } }),
        h('button', { class: 'btn-ghost', text: 'Duplicate', onclick: () => { t = clone(t); t.id = 'layout-' + Date.now().toString(36); t.name += ' copy'; renderSide(); } }),
        h('button', { class: 'btn-ghost', text: 'Delete', onclick: removeTemplate })
      ),

      h('label', { class: 'f' }, h('span', { text: 'Name' }),
        h('input', { class: 'input', value: t.name, oninput: (e) => { t.name = e.target.value; } })),

      h('label', { class: 'f' }, h('span', { text: 'Type' }),
        h('select', { class: 'input', value: t.type, onchange: (e) => setType(e.target.value) },
          h('option', { value: 'strip', text: 'Photo strip (2×6 in, printed 2 per 4R)' }),
          h('option', { value: 'photocard', text: 'Photocard (full 4R, 4×6 in)' }))),

      h('label', { class: 'f' }, h('span', { text: `Frame (${t.width} × ${t.height} px, transparent photo windows)` }),
        h('select', {
          class: 'input',
          value: t.frame || '',
          onchange: async (e) => { t.frame = e.target.value || null; frameImg = await Render.frameImage(t); redraw(); },
        }, h('option', { value: '', text: 'No frame' }), App.frames.map((f) => h('option', { value: f.name, text: f.name })))),

      h('button', {
        class: 'btn-ghost',
        text: 'Import frame…',
        onclick: async () => { App.frames = await api.importFrames(); renderSide(); },
      }),

      h('div', { class: 'row', style: 'flex-wrap:wrap' },
        h('button', { class: 'chip', text: '+ Photo', onclick: () => add({ type: 'photo', x: 40, y: 40, w: Math.round(t.width * 0.6), h: Math.round(t.width * 0.45) }) }),
        h('button', { class: 'chip', text: '+ Text', onclick: () => add({ type: 'text', text: 'Your text', x: 40, y: 100, w: t.width - 80, h: 90, size: 64, color: '#222222', font: 'Georgia, serif', align: 'center', weight: '700' }) }),
        h('button', { class: 'chip', text: '+ QR (GIF)', onclick: () => add({ type: 'qr', source: 'gif', x: 40, y: t.height - 260, w: 200, h: 200 }) }),
        h('button', { class: 'chip', text: '+ QR (photos)', onclick: () => add({ type: 'qr', source: 'photos', x: 300, y: t.height - 260, w: 200, h: 200 }) })
      ),

      h('div', { id: 'edList', class: 'ed-list' }),
      h('div', { id: 'edProps', class: 'ed-props' })
    );
    renderList();
    renderProps();
  }

  async function removeTemplate() {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const saved = App.templates.some((x) => x.id === t.id);
    if (saved) {
      if (App.templates.length <= 1) return App.toast('Keep at least one template');
      App.templates = await api.deleteTemplate(t.id);
    }
    load(App.templates[0]);
  }

  async function save() {
    if (!t.elements.some((e) => e.type === 'photo')) return App.toast('Add at least one photo slot');
    t.name = (t.name || '').trim() || 'Untitled';
    App.templates = await api.saveTemplate(t);
    App.toast('Template saved');
    App.show('dashboard');
  }

  App.screens.editor = {
    init() {
      $('#edBack').onclick = () => App.show('dashboard');
      $('#edSave').onclick = save;
    },
    enter() {
      const existing = App.editTemplateId && App.templates.find((x) => x.id === App.editTemplateId);
      load(existing || blankTemplate());
    },
  };
})();
