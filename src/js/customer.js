// Guest screens: 1) customer scene  2) pick size  3) pick template + Start
(function () {
  const { $, h } = App;
  const Render = window.Render;

  const TYPE_INFO = {
    strip: { label: 'Photo strip', cap: '2×6 in · printed 2 per sheet' },
    photocard: { label: 'Photocard', cap: '4×6 in · full 4R sheet' },
  };

  // Sizes that still have at least one template switched on for this event.
  const availableTypes = () => {
    const on = App.enabledTemplates();
    return ['strip', 'photocard'].filter((ty) => on.some((t) => t.type === ty));
  };

  // ---------- 1. customer scene ----------
  App.screens.scene = {
    init() {
      $('#sceneStart').onclick = () => this.start();
    },

    enter() {
      App.camera.attach($('#sceneCam'));
      $('#sceneEvent').textContent = App.settings.eventName || '';
      App.session = null;
    },

    start() {
      const types = availableTypes();
      if (!types.length) return App.toast('No templates are switched on for this event');
      if (types.length === 1) {
        App.pick.type = types[0]; // only one size available: skip the size screen
        App.show('template');
      } else {
        App.pick.type = null;
        App.show('size');
      }
    },
  };

  // ---------- 2. size: strip or photocard ----------
  App.screens.size = {
    init() {
      $('#sizeBack').onclick = () => App.show('scene');
    },

    enter() {
      const box = $('#sizeCards');
      box.replaceChildren();
      availableTypes().forEach((ty) => {
        box.append(
          h('button', {
            class: 'size-card',
            onclick: () => { App.pick.type = ty; App.show('template'); },
          },
            h('div', { class: 'shape ' + ty }),
            h('span', { class: 'big', text: TYPE_INFO[ty].label }),
            h('span', { class: 'cap12', text: TYPE_INFO[ty].cap }))
        );
      });
    },
  };

  // ---------- 3. template picker (+ Start in the template area) ----------
  App.screens.template = {
    list: [],
    sel: null,
    buttons: [],

    init() {
      $('#tplBack').onclick = () => App.show(availableTypes().length > 1 ? 'size' : 'scene');
      $('#tplStart').onclick = () => { if (this.sel) App.beginCapture(this.sel); };
    },

    async enter() {
      const type = App.pick.type;
      this.list = App.enabledTemplates().filter((t) => t.type === type);
      if (!this.list.length) return App.show('scene');

      $('#tplTitle').textContent = `Pick your ${TYPE_INFO[type].label.toLowerCase()} design`;
      this.sel = this.list[0];

      const box = $('#tplList');
      box.replaceChildren();
      this.buttons = [];
      for (const t of this.list) {
        const canvas = await Render.thumb(t, 200);
        const btn = h('button', { class: 'tpl-item' + (t === this.sel ? ' on' : ''), onclick: () => this.select(t) },
          canvas, h('span', { text: t.name }));
        this.buttons.push(btn);
        box.append(btn);
      }
      this.drawPreview();
    },

    select(t) {
      this.sel = t;
      this.buttons.forEach((b, i) => b.classList.toggle('on', this.list[i] === t));
      this.drawPreview();
    },

    async drawPreview() {
      const t = this.sel;
      const frameImg = await Render.frameImage(t).catch(() => null);
      if (t !== this.sel) return; // the guest picked another one while this was loading
      const c = Render.renderTemplate(t, { frameImg, placeholders: true, event: App.settings.eventName });
      const cv = $('#tplPreview');
      cv.width = c.width;
      cv.height = c.height;
      cv.getContext('2d').drawImage(c, 0, 0);
    },
  };
})();
