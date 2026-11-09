// Core: shared state, helpers, navigation, event mode (PIN lock), camera.
(function () {
  const api = window.booth;
  const App = (window.App = {
    api,
    settings: {},
    templates: [],
    frames: [],
    session: null,        // the guest's current session
    screens: {},
    current: null,
    eventActive: false,   // true while the booth is in guest mode
    pick: { type: null }, // what the guest picked on the size screen
    editTemplateId: null, // template the staff is editing (null = new)
    pinOpen: false,
  });

  App.$ = (sel, root = document) => root.querySelector(sel);
  App.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Tiny element builder: h('div', { class: 'x', onclick: fn }, child, child)
  App.h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'value') value = v;
      else if (k === 'checked') el.checked = true;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (value !== undefined) el.value = value; // after <option>s exist
    return el;
  };

  // Form helpers bound to a draft object: the inputs write straight into `d`.
  App.form = (d) => {
    const h = App.h;
    const field = (label, control, hint) =>
      h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), control, hint ? h('small', { text: hint }) : null);
    const text = (key, opts = {}) =>
      h('input', {
        class: 'input', type: opts.type || 'text', value: d[key] ?? '', placeholder: opts.placeholder || '',
        maxlength: opts.maxlength, inputmode: opts.inputmode, oninput: (e) => { d[key] = e.target.value; },
      });
    const num = (key, min = 0) =>
      h('input', { class: 'input', type: 'number', min, value: d[key], oninput: (e) => { d[key] = e.target.value; } });
    const check = (key, label) =>
      h('label', { class: 'field inline' }, h('span', { class: 'lbl', text: label }),
        h('input', { type: 'checkbox', checked: !!d[key], onchange: (e) => { d[key] = e.target.checked; } }));
    const select = (key, options) =>
      h('select', { class: 'input', value: d[key], onchange: (e) => { d[key] = e.target.value; } },
        options.map(([label, value]) => h('option', { value, text: label })));
    const card = (title, ...rows) => h('section', { class: 'card' }, h('h3', { text: title }), ...rows);
    return { field, text, num, check, select, card };
  };

  // ---------- navigation ----------
  App.show = (name) => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    App.current = name;
    const screen = App.screens[name];
    if (screen && screen.enter) screen.enter();
    App.armIdle();
  };

  App.toast = (msg) => {
    const t = App.h('div', { class: 'toast', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 2800);
  };

  // ---------- data ----------
  App.refreshData = async () => {
    App.templates = await api.listTemplates();
    App.frames = await api.listFrames();
  };

  // Templates staff ticked for this event.
  App.enabledTemplates = () => {
    const off = new Set(App.settings.disabledTemplates || []);
    return App.templates.filter((t) => !off.has(t.id));
  };

  // ---------- 4-digit PIN keypad ----------
  App.askPin = (title = 'Staff PIN') =>
    new Promise((resolve) => {
      if (App.pinOpen) return resolve(false);
      App.pinOpen = true;
      const h = App.h;
      let code = '';

      const dots = h('div', { class: 'pin-dots' }, [0, 1, 2, 3].map(() => h('span', { class: 'pin-dot' })));
      const err = h('p', { class: 'error' });
      const paint = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < code.length));

      const close = (ok) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        App.pinOpen = false;
        resolve(ok);
      };
      const press = (digit) => {
        if (code.length >= 4) return;
        code += digit;
        err.textContent = '';
        paint();
        if (code.length === 4) {
          if (code === String(App.settings.pin)) setTimeout(() => close(true), 120);
          else {
            err.textContent = 'Wrong PIN';
            code = '';
            setTimeout(paint, 250);
          }
        }
      };
      const back = () => { code = code.slice(0, -1); paint(); };
      const onKey = (e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') back();
        else if (e.key === 'Escape') close(false);
        e.preventDefault();
        e.stopPropagation();
      };

      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => h('button', { class: 'key', text: d, onclick: () => press(d) }));
      keys.push(
        h('button', { class: 'key small', text: 'Cancel', onclick: () => close(false) }),
        h('button', { class: 'key', text: '0', onclick: () => press('0') }),
        h('button', { class: 'key small', text: '⌫', onclick: back })
      );

      const overlay = h('div', { class: 'overlay' }, h('div', { class: 'dialog' }, h('h3', { text: title }), dots, err, h('div', { class: 'keypad' }, keys)));
      document.addEventListener('keydown', onKey, true);
      document.body.append(overlay);
    });

  // ---------- event mode (guest mode) ----------
  App.startEvent = async () => {
    if (!App.enabledTemplates().length) return App.toast('Tick at least one template for this event');
    await api.eventStart(); // fullscreen + lock
    App.eventActive = true;
    App.session = null;
    document.body.classList.add('event');
    App.show('scene');
  };

  App.stopEvent = async () => {
    if (App.screens.capture) App.screens.capture.token++; // stops a running capture
    if (App.screens.finish) App.screens.finish.stopTimer();
    App.session = null;
    await api.eventStop();
    App.eventActive = false;
    document.body.classList.remove('event');
    App.show('dashboard');
  };

  // F11, leaving fullscreen, closing the window, or holding the hidden corner.
  App.requestExit = async () => {
    if (!App.eventActive || App.pinOpen) return;
    if (await App.askPin('Enter staff PIN to exit')) App.stopEvent();
  };

  App.resetToScene = () => {
    if (App.screens.capture) App.screens.capture.token++;
    if (App.screens.finish) App.screens.finish.stopTimer();
    App.session = null;
    App.show('scene');
  };

  // Guest walked away: reset to the customer scene after a period of inactivity.
  const IDLE_SCREENS = new Set(['size', 'template', 'review', 'filter', 'print']);
  let idleTimer = null;
  App.armIdle = () => {
    clearTimeout(idleTimer);
    const secs = Number(App.settings.idleTimeout) || 0;
    if (!App.eventActive || secs <= 0 || !IDLE_SCREENS.has(App.current)) return;
    idleTimer = setTimeout(() => App.resetToScene(), secs * 1000);
  };
  document.addEventListener('pointerdown', () => App.armIdle());

  // Hidden staff corner (top-left): hold 1.5 s during an event to open the PIN pad.
  const hot = App.h('div', { id: 'exitHot' });
  let hold = null;
  hot.addEventListener('pointerdown', () => { hold = setTimeout(() => App.requestExit(), 1500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => hot.addEventListener(ev, () => clearTimeout(hold)));
  document.body.append(hot);

  // ---------- camera ----------
  // Live view comes from any camera device: a webcam, a DSLR webcam utility, or an HDMI capture card.
  // The final photo is either a live view frame or a full-resolution shot through digiCamControl.
  async function shrink(dataUrl, maxEdge) {
    const img = await window.Render.loadImage(dataUrl);
    const k = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  }

  App.camera = {
    stream: null,
    error: null,

    async start() {
      this.stop();
      const s = App.settings;
      const base = { width: { ideal: s.cameraWidth || 1920 }, height: { ideal: s.cameraHeight || 1080 } };
      const attempts = s.cameraId ? [{ ...base, deviceId: { exact: s.cameraId } }, base] : [base];
      for (const video of attempts) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          this.error = null;
          return true;
        } catch (e) {
          this.error = e.message || String(e);
        }
      }
      return false;
    },

    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    },

    async devices() {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.filter((d) => d.kind === 'videoinput');
    },

    attach(videoEl) {
      videoEl.muted = true;
      videoEl.classList.toggle('mirror', !!App.settings.mirrorPreview);
      if (this.stream && videoEl.srcObject !== this.stream) videoEl.srcObject = this.stream;
      videoEl.play().catch(() => {});
    },

    async ready(videoEl) {
      if (!this.stream) return false;
      for (let i = 0; i < 40; i++) {
        if (videoEl.videoWidth > 0 && videoEl.readyState >= 2) return true;
        await App.wait(100);
      }
      return false;
    },

    // Returns { url, img } for one photo. If the DSLR shot fails it falls back to the live frame.
    async captureStill(videoEl, { fallback = true } = {}) {
      if (App.settings.captureMode === 'digicam') {
        try {
          const raw = await api.dslrCapture();
          return App.makePhoto(await shrink(raw, 2400)); // 2400 px is plenty for 4R and keeps it fast
        } catch (e) {
          if (!fallback) throw e;
          console.error('DSLR capture failed, using the live view frame:', e);
          App.toast('DSLR shot failed, used the live view frame instead');
        }
      }
      if (!videoEl.videoWidth) throw new Error('Camera is not ready');
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth;
      c.height = videoEl.videoHeight;
      c.getContext('2d').drawImage(videoEl, 0, 0);
      return App.makePhoto(c.toDataURL('image/jpeg', 0.92));
    },
  };

  App.makePhoto = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ url, img });
      img.onerror = reject;
      img.src = url;
    });
})();
