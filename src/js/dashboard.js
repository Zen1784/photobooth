// Staff dashboard (first page): templates, DSLR / camera, event settings, Start event.
(function () {
  const { $, h, api } = App;
  const Render = window.Render;

  const EVENT_KEYS = [
    'eventName', 'countdown', 'maxRetakes', 'autoReset', 'idleTimeout',
    'printEnabled', 'printer', 'maxCopies', 'cutGuide',
    'galleryUrl', 'saveDir', 'pin',
  ];

  const toNum = (v, min, fallback) => {
    const n = v === '' || v === null || v === undefined ? NaN : Number(v);
    return Math.max(min, Number.isFinite(n) ? n : fallback);
  };

  const dashboard = (App.screens.dashboard = {
    tab: 'templates',

    init() {
      $('#startEvent').onclick = () => App.startEvent();
      $('#dashTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        this.tab = b.dataset.tab;
        this.render();
      });
    },

    enter() {
      this.render();
    },

    updateSub() {
      const ready = App.enabledTemplates().length;
      let text = `${ready} of ${App.templates.length} templates ready for the event`;
      if (App.settings.pin === '1234') text += ' · the staff PIN is still 1234, change it in Event settings';
      $('#dashSub').textContent = text;
      $('#startEvent').disabled = ready === 0;
    },

    render() {
      document.querySelectorAll('#dashTabs .tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
      this.updateSub();
      const body = $('#dashBody');
      body.replaceChildren();
      const pane = h('div', { class: 'pane' });
      body.append(pane); // if the tab changes mid-load, this pane is simply discarded
      if (this.tab === 'templates') this.renderTemplates(pane);
      else if (this.tab === 'dslr') App.screens.dslr.render(pane);
      else this.renderEvent(pane);
    },

    // ---------- Templates tab ----------
    edit(id) {
      App.editTemplateId = id;
      App.show('editor');
    },

    async duplicate(t) {
      const copy = structuredClone(t);
      copy.id = 'layout-' + Date.now().toString(36);
      copy.name = t.name + ' copy';
      App.templates = await api.saveTemplate(copy);
      this.render();
    },

    async remove(t) {
      if (App.templates.length <= 1) return App.toast('Keep at least one template');
      if (!confirm(`Delete template "${t.name}"?`)) return;
      App.templates = await api.deleteTemplate(t.id);
      this.render();
    },

    async toggle(t, on, card) {
      const off = new Set(App.settings.disabledTemplates || []);
      if (on) off.delete(t.id);
      else off.add(t.id);
      App.settings = await api.setSettings({ disabledTemplates: [...off] });
      card.classList.toggle('off', !on);
      this.updateSub();
    },

    async renderTemplates(pane) {
      const toolbar = h('div', { class: 'row' },
        h('button', { class: 'btn-primary small', text: '+ New template', onclick: () => this.edit(null) }),
        h('button', {
          class: 'btn-ghost',
          text: 'Import frames…',
          onclick: async () => { App.frames = await api.importFrames(); this.render(); },
        }),
        h('span', { class: 'hint', text: 'Tick the templates guests can choose at this event.' })
      );
      const grid = h('div', { class: 'tpl-grid' });
      pane.append(toolbar, grid);

      const off = new Set(App.settings.disabledTemplates || []);
      for (const t of App.templates) {
        const canvas = await Render.thumb(t, 300);
        canvas.className = 'tpl-thumb';
        const on = !off.has(t.id);
        const card = h('div', { class: 'tpl-card' + (on ? '' : ' off') });
        const check = h('input', { type: 'checkbox', checked: on, onchange: (e) => this.toggle(t, e.target.checked, card) });
        card.append(
          canvas,
          h('div', { class: 'tpl-meta' },
            h('strong', { text: t.name }),
            h('span', { class: 'badge', text: t.type === 'strip' ? 'Strip 2×6' : 'Photocard 4×6' })),
          h('label', { class: 'field inline' }, h('span', { class: 'lbl', text: 'Use in event' }), check),
          h('div', { class: 'row' },
            h('button', { class: 'btn-ghost', text: 'Edit', onclick: () => this.edit(t.id) }),
            h('button', { class: 'btn-ghost', text: 'Duplicate', onclick: () => this.duplicate(t) }),
            h('button', { class: 'btn-ghost', text: 'Delete', onclick: () => this.remove(t) }))
        );
        grid.append(card);
      }
    },

    // ---------- Event settings tab ----------
    async renderEvent(pane) {
      const d = { ...App.settings };
      const f = App.form(d);
      const printers = await api.listPrinters().catch(() => []);

      const saveDirInput = h('input', {
        class: 'input', value: d.saveDir || '', oninput: (e) => { d.saveDir = e.target.value; },
      });

      const save = async () => {
        if (!/^\d{4}$/.test(String(d.pin))) return App.toast('The PIN must be exactly 4 digits');
        d.countdown = toNum(d.countdown, 1, 3);
        d.maxRetakes = toNum(d.maxRetakes, 0, 0);
        d.autoReset = toNum(d.autoReset, 0, 30);
        d.idleTimeout = toNum(d.idleTimeout, 0, 60);
        d.maxCopies = toNum(d.maxCopies, 1, 3);
        const patch = Object.fromEntries(EVENT_KEYS.map((k) => [k, d[k]]));
        App.settings = await api.setSettings(patch);
        App.toast('Settings saved');
        this.render();
      };

      pane.append(
        h('div', { class: 'cards' },
          f.card('Event',
            f.field('Event name', f.text('eventName'), 'Shown on the customer scene and in {event} text.'),
            f.field('Countdown (seconds)', f.num('countdown', 1)),
            f.field('Retake limit', f.num('maxRetakes', 0), '0 = unlimited'),
            f.field('Back to the customer scene after Done (seconds)', f.num('autoReset', 0), '0 = wait for the guest to press Done'),
            f.field('Reset a guest screen after inactivity (seconds)', f.num('idleTimeout', 0), '0 = never')),
          f.card('Printing (4R paper)',
            f.check('printEnabled', 'Offer printing to guests'),
            f.field('Printer', f.select('printer', [['Default printer', ''], ...printers.map((p) => [p.name + (p.isDefault ? ' (default)' : ''), p.name])]),
              'Set the printer driver to 4x6 in, borderless.'),
            f.field('Most copies a guest can pick', f.num('maxCopies', 1), 'A strip sheet holds 2 strips; a photocard fills the whole sheet.'),
            f.check('cutGuide', 'Cut guide marks on strip sheets')),
          f.card('Sharing & storage',
            f.field('Gallery base URL', f.text('galleryUrl', { placeholder: 'https://your-site.com/g' }),
              'QR codes point to <base>/<session id>. Connect your upload service here later.'),
            f.field('Save folder', h('div', { class: 'row' },
              saveDirInput,
              h('button', {
                class: 'btn-ghost',
                text: 'Browse',
                onclick: async () => {
                  const dir = await api.chooseFolder();
                  if (dir) { d.saveDir = dir; saveDirInput.value = dir; }
                },
              })))),
          f.card('Security',
            f.field('Staff PIN (4 digits)', f.text('pin', { type: 'password', maxlength: 4, inputmode: 'numeric', placeholder: '4 digits' }),
              'Needed to exit the event: F11, leaving fullscreen, closing the window, or holding the top-left corner.'))
        ),
        h('div', { class: 'row' }, h('button', { class: 'btn-primary small', text: 'Save settings', onclick: save }))
      );
    },
  });
})();
