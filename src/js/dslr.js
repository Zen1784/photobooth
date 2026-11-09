// DSLR / Camera tab (inside the staff dashboard).
(function () {
  const { h, api } = App;

  const KEYS = ['cameraId', 'cameraWidth', 'cameraHeight', 'mirrorPreview', 'captureMode', 'digicamPath', 'digicamAf'];
  const RESOLUTIONS = [
    ['1280 × 720', '1280x720'],
    ['1920 × 1080', '1920x1080'],
    ['3840 × 2160', '3840x2160'],
  ];

  App.screens.dslr = {
    async render(pane) {
      const d = Object.fromEntries(KEYS.map((k) => [k, App.settings[k]]));
      const f = App.form(d);
      const devices = await App.camera.devices().catch(() => []);

      const video = h('video', { autoplay: true, playsinline: true });
      const camStatus = h('p', { class: 'hint' });
      const pathStatus = h('small', { class: 'hint' });
      const shotInfo = h('p', { class: 'hint' });
      const shotImg = h('img', { alt: '' });
      shotImg.style.display = 'none';

      const showCamStatus = () => {
        camStatus.textContent = App.camera.stream ? '' : 'No camera found: ' + (App.camera.error || 'check the connection');
        camStatus.className = App.camera.stream ? 'hint' : 'hint warn';
      };

      const apply = async () => {
        const prev = App.settings;
        d.cameraWidth = Number(d.cameraWidth);
        d.cameraHeight = Number(d.cameraHeight);
        App.settings = await api.setSettings(Object.fromEntries(KEYS.map((k) => [k, d[k]])));
        const changed =
          prev.cameraId !== App.settings.cameraId ||
          prev.cameraWidth !== App.settings.cameraWidth ||
          prev.cameraHeight !== App.settings.cameraHeight;
        if (changed || !App.camera.stream) await App.camera.start();
        App.camera.attach(video);
        showCamStatus();
      };

      const pathInput = f.text('digicamPath', { placeholder: 'C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe' });

      const detect = async () => {
        const found = await api.dslrFind(d.digicamPath);
        if (found) {
          d.digicamPath = found;
          pathInput.value = found;
        }
        pathStatus.textContent = found ? 'digiCamControl found.' : 'digiCamControl not found. Install it or browse to CameraControlCmd.exe.';
      };

      const testShot = async () => {
        shotInfo.className = 'hint';
        shotInfo.textContent = 'Taking a test shot…';
        shotImg.style.display = 'none';
        try {
          await apply(); // the test uses the settings as shown on screen
          const t0 = performance.now();
          const photo = await App.camera.captureStill(video, { fallback: false });
          shotImg.src = photo.url;
          shotImg.style.display = 'block';
          shotInfo.textContent = `${photo.img.width} × ${photo.img.height} px · ${Math.round(performance.now() - t0)} ms`;
        } catch (e) {
          shotInfo.className = 'hint warn';
          shotInfo.textContent = 'Test shot failed: ' + (e.message || e);
        }
      };

      pane.append(
        h('div', { class: 'dslr' },
          h('div', { class: 'col' },
            f.card('Live view', video, camStatus),
            f.card('Test shot',
              h('div', { class: 'row' }, h('button', { class: 'btn-primary small', text: 'Take test shot', onclick: testShot })),
              shotInfo,
              h('div', { class: 'shot' }, shotImg))),
          h('div', { class: 'col' },
            f.card('Camera source',
              f.field('Camera', f.select('cameraId', [['Default camera', ''], ...devices.map((dv) => [dv.label || 'Camera', dv.deviceId])]),
                'A DSLR appears here when its webcam utility or an HDMI capture card is running.'),
              f.field('Resolution', h('select', {
                class: 'input',
                value: `${d.cameraWidth}x${d.cameraHeight}`,
                onchange: (e) => {
                  const [w, hh] = e.target.value.split('x').map(Number);
                  d.cameraWidth = w;
                  d.cameraHeight = hh;
                },
              }, RESOLUTIONS.map(([label, value]) => h('option', { value, text: label })))),
              f.check('mirrorPreview', 'Mirror the live view (like a mirror)')),
            f.card('Photo capture',
              f.field('Capture method', f.select('captureMode', [
                ['Live view frame (webcam or capture card)', 'live'],
                ['digiCamControl (full DSLR resolution)', 'digicam'],
              ]), 'The live view frame is video resolution. digiCamControl takes a real full-resolution shot.'),
              f.field('digiCamControl program', h('div', { class: 'row' },
                pathInput,
                h('button', {
                  class: 'btn-ghost',
                  text: 'Browse',
                  onclick: async () => {
                    const p = await api.dslrBrowse();
                    if (p) { d.digicamPath = p; pathInput.value = p; detect(); }
                  },
                }),
                h('button', { class: 'btn-ghost', text: 'Detect', onclick: detect }))),
              pathStatus,
              f.check('digicamAf', 'Autofocus before every shot (slower)')),
            h('div', { class: 'row' }, h('button', { class: 'btn-primary small', text: 'Save & apply', onclick: async () => { await apply(); App.toast('Camera settings saved'); } })),
            f.card('Tips',
              h('ul', null,
                h('li', { text: 'Best quality: HDMI capture card for live view, digiCamControl for the shot over USB.' }),
                h('li', { text: 'A webcam utility can keep the camera USB connection busy, which may stop digiCamControl from firing the shutter.' }),
                h('li', { text: 'Set the camera to JPEG (Large, Fine), manual focus and exposure, and switch off auto power-off.' }),
                h('li', { text: 'Use a dummy battery or AC adapter for long events.' }))))
        )
      );

      App.camera.attach(video);
      showCamStatus();
      detect();
    },
  };
})();
