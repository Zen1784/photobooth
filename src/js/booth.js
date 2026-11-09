// Guest flow after the template is picked:
// capture -> review (tap a photo to retake) -> filter (optional) -> print option -> finish -> customer scene
(function () {
  const { $, h, api, wait } = App;
  const Render = window.Render;

  // ---------- start taking photos with the chosen template ----------
  App.beginCapture = async (template) => {
    const slots = template.elements.filter((e) => e.type === 'photo').length;
    if (!slots) return App.toast('This template has no photo slots');

    App.session = {
      id: 's' + Date.now().toString(36),
      template,
      photos: Array(slots).fill(null), // one entry per photo slot
      filter: 'none',
      retakes: 0,
      print: true,
      copies: 1,
      frameImg: await Render.frameImage(template),
    };
    App.screens.capture.run(Array.from({ length: slots }, (_, i) => i));
  };

  // ---------- CAPTURE ----------
  const capture = (App.screens.capture = {
    token: 0,

    init() {
      $('#captureCancel').onclick = () => this.cancel();
    },

    enter() {
      App.camera.attach($('#cam'));
    },

    // indexes = which slots to shoot, in order. A retake passes a single index.
    async run(indexes) {
      const s = App.session;
      const token = ++this.token;
      const alive = () => token === this.token;
      const video = $('#cam');
      const status = $('#captureStatus');
      const cd = $('#countdown');

      App.show('capture');
      this.buildRail(null);
      cd.textContent = '';

      if (!(await App.camera.ready(video))) {
        status.textContent = 'Camera not available. Please call a staff member.';
        await wait(3500);
        if (alive()) App.resetToScene();
        return;
      }

      for (const i of indexes) {
        if (!alive()) return;
        this.buildRail(i);
        status.textContent = indexes.length > 1 ? `Photo ${i + 1} of ${s.photos.length}` : `Retaking photo ${i + 1}`;
        await wait(indexes.length > 1 && i > 0 ? 400 : 1000);
        if (!alive()) return;

        for (let n = App.settings.countdown || 3; n > 0; n--) {
          cd.textContent = n;
          cd.classList.remove('pop');
          void cd.offsetWidth; // restart the animation
          cd.classList.add('pop');
          await wait(1000);
          if (!alive()) return;
        }
        cd.textContent = '';
        status.textContent = 'Hold still…';

        let photo = null;
        for (let attempt = 0; attempt < 2 && !photo; attempt++) {
          try { photo = await App.camera.captureStill(video); } catch (e) { console.error(e); await wait(500); }
        }
        if (!alive()) return;
        if (!photo) {
          status.textContent = 'Could not take the photo. Please try again.';
          await wait(2500);
          if (alive()) App.resetToScene();
          return;
        }

        this.flash();
        s.photos[i] = photo; // only THIS slot changes
        this.buildRail(null);
        await wait(500);
      }

      if (alive()) {
        status.textContent = '';
        App.show('review');
      }
    },

    cancel() {
      this.token++; // stops a running capture loop
      $('#countdown').textContent = '';
      const s = App.session;
      if (s && s.photos.every(Boolean)) App.show('review'); // cancelled a retake: keep what we have
      else App.resetToScene();
    },

    flash() {
      const f = $('#flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 80);
    },

    buildRail(activeIndex) {
      const rail = $('#slotRail');
      rail.replaceChildren();
      App.session.photos.forEach((p, i) => {
        rail.append(
          h('div', { class: 'slot' + (i === activeIndex ? ' current' : '') },
            p ? h('img', { src: p.url, alt: '' }) : null,
            h('span', { class: 'num', text: String(i + 1) }))
        );
      });
    },
  });

  // Draws the session's layout onto a canvas element.
  function drawSession(canvasEl) {
    const s = App.session;
    const c = Render.renderTemplate(s.template, {
      photos: s.photos,
      filter: s.filter,
      frameImg: s.frameImg,
      event: App.settings.eventName,
      placeholders: true,
    });
    canvasEl.width = c.width;
    canvasEl.height = c.height;
    canvasEl.getContext('2d').drawImage(c, 0, 0);
  }

  // ---------- REVIEW: tap a photo to retake exactly that one ----------
  App.screens.review = {
    init() {
      $('#reviewNext').onclick = () => App.show('filter');
      $('#reviewRestart').onclick = () => App.beginCapture(App.session.template);
    },

    enter() {
      this.draw();
    },

    draw() {
      const s = App.session;
      const t = s.template;
      drawSession($('#previewCanvas'));

      // One clickable region per photo slot.
      const layer = $('#hitLayer');
      layer.replaceChildren();
      let slot = 0;
      for (const el of t.elements) {
        if (el.type !== 'photo') continue;
        const index = slot++;
        const hit = h('div', { class: 'hit', onclick: () => this.retake(index) }, h('span', { text: '↻ Retake' }));
        hit.style.left = (el.x / t.width) * 100 + '%';
        hit.style.top = (el.y / t.height) * 100 + '%';
        hit.style.width = (el.w / t.width) * 100 + '%';
        hit.style.height = (el.h / t.height) * 100 + '%';
        layer.append(hit);
      }

      const max = App.settings.maxRetakes;
      $('#retakeInfo').textContent = max > 0 ? `${Math.max(0, max - s.retakes)} retakes left` : 'Retake as many times as you like.';
    },

    retake(index) {
      const s = App.session;
      const max = App.settings.maxRetakes;
      if (max > 0 && s.retakes >= max) return App.toast('No retakes left');
      s.retakes++;
      App.screens.capture.run([index]);
    },
  };

  // ---------- FILTER (optional) ----------
  const afterFilter = () => {
    if (App.settings.printEnabled) App.show('print');
    else App.screens.finish.run();
  };

  App.screens.filter = {
    init() {
      $('#filterNext').onclick = afterFilter;
      $('#filterSkip').onclick = () => { App.session.filter = 'none'; afterFilter(); };
    },

    enter() {
      this.buildChips();
      drawSession($('#filterCanvas'));
    },

    buildChips() {
      const box = $('#filterChips');
      box.replaceChildren();
      Render.FILTER_LIST.forEach(([id, label]) => {
        box.append(
          h('button', {
            class: 'chip' + (App.session.filter === id ? ' on' : ''),
            text: label,
            onclick: () => {
              App.session.filter = id;
              this.buildChips();
              drawSession($('#filterCanvas'));
            },
          })
        );
      });
    },
  };

  // ---------- PRINT OPTION ----------
  App.screens.print = {
    init() {
      $('#optPrint').onclick = () => { App.session.print = true; this.sync(); };
      $('#optDigital').onclick = () => { App.session.print = false; this.sync(); };
      $('#copiesMinus').onclick = () => { App.session.copies = Math.max(1, App.session.copies - 1); this.sync(); };
      $('#copiesPlus').onclick = () => {
        App.session.copies = Math.min(App.settings.maxCopies || 3, App.session.copies + 1);
        this.sync();
      };
      $('#printDone').onclick = () => App.screens.finish.run();
    },

    enter() {
      const s = App.session;
      s.print = true;
      s.copies = 1;
      drawSession($('#printCanvas'));
      this.sync();
    },

    sync() {
      const s = App.session;
      const max = App.settings.maxCopies || 3;
      const strip = s.template.type === 'strip';
      $('#optPrint').classList.toggle('on', s.print);
      $('#optDigital').classList.toggle('on', !s.print);
      $('#copiesRow').style.display = s.print ? 'flex' : 'none';
      $('#copiesNum').textContent = s.copies;
      $('#copiesLbl').textContent = strip ? 'sheet(s), 2 strips per sheet' : 'photocard(s)';
      $('#printCap').textContent = strip ? 'Printed 2 strips per 4R sheet' : 'Printed on a full 4R sheet';
      $('#copiesMinus').disabled = s.copies <= 1;
      $('#copiesPlus').disabled = s.copies >= max;
    },
  };

  // ---------- FINISH ----------
  let resetTimer = null;

  function addStep(label) {
    const text = h('span', { text: label });
    const li = h('li', { class: 'run' }, h('span', { class: 'dot' }), text);
    $('#finishSteps').append(li);
    return {
      ok: () => { li.className = 'ok'; },
      fail: (msg) => { li.className = 'bad'; text.textContent = `${label}: ${msg}`; },
    };
  }

  App.screens.finish = {
    init() {
      $('#finishDone').onclick = () => this.done();
    },

    async run() {
      const s = App.session;
      const set = App.settings;
      App.show('finish');

      $('#finishTitle').textContent = 'Making your photos…';
      $('#finishSteps').replaceChildren();
      $('#qrRow').replaceChildren();
      $('#resetNote').textContent = '';
      $('#finalImg').removeAttribute('src');
      $('#finishDone').disabled = true;

      try {
        // 1) share links + QR codes
        const stLinks = addStep('Creating share links');
        const base = String(set.galleryUrl || '').replace(/\/+$/, '');
        // TODO: upload the photos/GIF to your cloud storage and use the real URLs here.
        const links = { photos: `${base}/${s.id}`, gif: `${base}/${s.id}/animation.gif` };
        const qr = { photos: await Render.qrImage(links.photos), gif: await Render.qrImage(links.gif) };
        stLinks.ok();

        // 2) render the final layout (QR codes are drawn into the template)
        const stRender = addStep('Building your layout');
        const canvas = Render.renderTemplate(s.template, {
          photos: s.photos,
          filter: s.filter,
          frameImg: s.frameImg,
          qr,
          event: set.eventName,
        });
        const finalUrl = canvas.toDataURL('image/png');
        $('#finalImg').src = finalUrl;
        stRender.ok();

        $('#qrRow').append(
          h('figure', null, h('img', { src: qr.gif.src, alt: '' }), 'GIF'),
          h('figure', null, h('img', { src: qr.photos.src, alt: '' }), 'Soft copies')
        );

        // 3) save to disk
        const stSave = addStep('Saving');
        await api.saveSession({ id: s.id, event: set.eventName, final: finalUrl, photos: s.photos.map((p) => p.url) });
        stSave.ok();

        // 4) print if the guest asked for it (strip: 2 per 4R sheet, photocard: 1 per sheet)
        if (set.printEnabled && s.print) {
          const stPrint = addStep('Printing');
          const sheet = Render.composeSheet(canvas, s.template.type, set.cutGuide).toDataURL('image/png');
          const res = await api.printSheet({ dataUrl: sheet, copies: s.copies, printerName: set.printer });
          if (res.success) stPrint.ok();
          else stPrint.fail(res.reason || 'failed');
        }

        $('#finishTitle').textContent = 'All done!';
      } catch (err) {
        console.error(err);
        $('#finishTitle').textContent = 'Something went wrong';
        addStep('Error').fail(err.message || String(err));
      }

      $('#finishDone').disabled = false;
      this.startAutoReset();
    },

    startAutoReset() {
      clearInterval(resetTimer);
      let left = Number(App.settings.autoReset) || 0;
      if (left <= 0) return;
      const tick = () => {
        $('#resetNote').textContent = `Back to the start in ${left}s`;
        if (left-- <= 0) this.done();
      };
      tick();
      resetTimer = setInterval(tick, 1000);
    },

    stopTimer() {
      clearInterval(resetTimer);
    },

    // Done: back to the customer scene.
    done() {
      this.stopTimer();
      App.session = null;
      App.show('scene');
    },
  };
})();
