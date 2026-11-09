const { app, BrowserWindow, Menu, session, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const QRCode = require('qrcode');

let win;
let eventActive = false; // true while guests use the booth: fullscreen + locked behind the PIN

// ---------- helpers ----------
const userPath = (...p) => path.join(app.getPath('userData'), ...p);
const ensureDir = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));
const safeName = (s) => String(s || 'untitled').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'untitled';
const toBuffer = (dataUrl) => Buffer.from(String(dataUrl).split(',')[1], 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  // event
  eventName: 'My Event',
  disabledTemplates: [],   // template ids staff switched off for this event
  countdown: 3,
  maxRetakes: 0,           // 0 = unlimited
  autoReset: 30,           // seconds on the final screen before returning to the customer scene
  idleTimeout: 60,         // seconds of inactivity before a guest screen resets, 0 = off
  // camera / DSLR
  cameraId: '',
  cameraWidth: 1920,
  cameraHeight: 1080,
  mirrorPreview: true,
  captureMode: 'live',     // 'live' = frame from the live view, 'digicam' = full-res shot via digiCamControl
  digicamPath: '',
  digicamAf: false,        // autofocus before every shot
  // printing
  printEnabled: false,
  printer: '',
  maxCopies: 3,
  cutGuide: false,
  // sharing / storage / security
  galleryUrl: 'https://example.com/g',
  saveDir: '',
  pin: '1234',
};

function getSettings() {
  const s = { ...DEFAULT_SETTINGS, ...readJson(userPath('settings.json'), {}) };
  if (!s.saveDir) s.saveDir = path.join(app.getPath('pictures'), 'PhotoBooth');
  if (!/^\d{4}$/.test(String(s.pin))) s.pin = '1234';
  if (!Array.isArray(s.disabledTemplates)) s.disabledTemplates = [];
  return s;
}

// ---------- templates ----------
function labelText(text, x, w, y) {
  return { type: 'text', text, x, y, w, h: 42, size: 30, color: '#666666', font: 'sans-serif', align: 'center', weight: '600' };
}

function defaultTemplates() {
  return [
    {
      id: 'classic-strip', name: 'Classic Strip', type: 'strip',
      width: 600, height: 1800, frame: null, background: '#ffffff',
      elements: [
        { type: 'photo', x: 40, y: 40, w: 520, h: 390 },
        { type: 'photo', x: 40, y: 460, w: 520, h: 390 },
        { type: 'photo', x: 40, y: 880, w: 520, h: 390 },
        { type: 'text', text: '{event}', x: 40, y: 1295, w: 520, h: 90, size: 64, color: '#222222', font: 'Georgia, serif', align: 'center', weight: '700' },
        { type: 'text', text: '{date}', x: 40, y: 1400, w: 520, h: 46, size: 32, color: '#777777', font: 'sans-serif', align: 'center', weight: '500' },
        { type: 'qr', source: 'gif', x: 60, y: 1520, w: 200, h: 200 },
        { type: 'qr', source: 'photos', x: 340, y: 1520, w: 200, h: 200 },
        labelText('GIF', 60, 200, 1725),
        labelText('Photos', 340, 200, 1725),
      ],
    },
    {
      id: 'classic-card', name: 'Classic Photocard', type: 'photocard',
      width: 1200, height: 1800, frame: null, background: '#ffffff',
      elements: [
        { type: 'photo', x: 40, y: 60, w: 540, h: 540 },
        { type: 'photo', x: 620, y: 60, w: 540, h: 540 },
        { type: 'photo', x: 40, y: 640, w: 540, h: 540 },
        { type: 'photo', x: 620, y: 640, w: 540, h: 540 },
        { type: 'text', text: '{event}', x: 40, y: 1230, w: 1120, h: 126, size: 90, color: '#222222', font: 'Georgia, serif', align: 'center', weight: '700' },
        { type: 'text', text: '{date}', x: 40, y: 1370, w: 1120, h: 62, size: 44, color: '#777777', font: 'sans-serif', align: 'center', weight: '500' },
        { type: 'qr', source: 'gif', x: 330, y: 1460, w: 240, h: 240 },
        { type: 'qr', source: 'photos', x: 630, y: 1460, w: 240, h: 240 },
        labelText('GIF', 330, 240, 1710),
        labelText('Photos', 630, 240, 1710),
      ],
    },
  ];
}

function listTemplates() {
  const dir = ensureDir(userPath('templates'));
  let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    defaultTemplates().forEach((t) => writeJson(path.join(dir, t.id + '.json'), t));
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  }
  return files
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ---------- frames ----------
const FRAME_EXT = /\.(png|webp|jpe?g)$/i;

function listFrames() {
  const dir = ensureDir(userPath('frames'));
  return fs.readdirSync(dir)
    .filter((f) => FRAME_EXT.test(f))
    .map((name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      return { name, dataUrl: `data:image/${ext};base64,` + fs.readFileSync(path.join(dir, name)).toString('base64') };
    });
}

// ---------- digiCamControl (DSLR full-resolution capture) ----------
const DIGICAM_DEFAULTS = [
  'C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe',
  'C:\\Program Files\\digiCamControl\\CameraControlCmd.exe',
];

function findDigicam(custom) {
  for (const p of [custom, getSettings().digicamPath, ...DIGICAM_DEFAULTS]) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#0e0f15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      if (eventActive) win.webContents.send('exit-requested'); // PIN required to leave
      else win.setFullScreen(!win.isFullScreen());
    }
    if (input.key === 'F12' && !eventActive) win.webContents.toggleDevTools();
  });

  // Leaving fullscreen by any other route during an event: go back to fullscreen and ask for the PIN.
  win.on('leave-full-screen', () => {
    if (!eventActive) return;
    setTimeout(() => {
      if (win && !win.isDestroyed() && eventActive) {
        win.setFullScreen(true);
        win.webContents.send('exit-requested');
      }
    }, 50);
  });

  // Closing the window (Alt+F4 etc.) during an event also needs the PIN.
  win.on('close', (e) => {
    if (eventActive) {
      e.preventDefault();
      win.webContents.send('exit-requested');
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // no menu shortcuts (reload, devtools) for guests
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('settings:get', () => getSettings());

  ipcMain.handle('settings:set', (_e, patch) => {
    const merged = { ...getSettings(), ...patch };
    writeJson(userPath('settings.json'), merged);
    return getSettings();
  });

  // Event mode: fullscreen + locked. Exiting is confirmed with the PIN in the renderer.
  ipcMain.handle('event:start', () => {
    eventActive = true;
    win.setFullScreen(true);
    return true;
  });

  ipcMain.handle('event:stop', () => {
    eventActive = false; // set first so the leave-full-screen handler does nothing
    win.setFullScreen(false);
    return true;
  });

  ipcMain.handle('templates:list', () => listTemplates());

  ipcMain.handle('templates:save', (_e, t) => {
    if (!t || !t.id) throw new Error('Template needs an id');
    t.id = safeName(t.id);
    writeJson(path.join(ensureDir(userPath('templates')), t.id + '.json'), t);
    return listTemplates();
  });

  ipcMain.handle('templates:delete', (_e, id) => {
    try { fs.unlinkSync(path.join(userPath('templates'), safeName(id) + '.json')); } catch { /* ignore */ }
    return listTemplates();
  });

  ipcMain.handle('frames:list', () => listFrames());

  ipcMain.handle('frames:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Import frames',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg'] }],
    });
    if (!res.canceled) {
      const dir = ensureDir(userPath('frames'));
      res.filePaths.forEach((p) => fs.copyFileSync(p, path.join(dir, safeName(path.basename(p)))));
    }
    return listFrames();
  });

  ipcMain.handle('frames:delete', (_e, name) => {
    try { fs.unlinkSync(path.join(userPath('frames'), path.basename(name))); } catch { /* ignore */ }
    return listFrames();
  });

  ipcMain.handle('dialog:folder', async () => {
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  // ----- DSLR -----
  ipcMain.handle('dslr:find', (_e, custom) => findDigicam(custom));

  ipcMain.handle('dslr:browse', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Select CameraControlCmd.exe',
      properties: ['openFile'],
      filters: [{ name: 'Program', extensions: ['exe'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // Takes one full-resolution photo through digiCamControl's command line and returns it as a data URL.
  ipcMain.handle('dslr:capture', async () => {
    const s = getSettings();
    const exe = findDigicam();
    if (!exe) throw new Error('digiCamControl was not found. Set its path in the DSLR / Camera tab.');

    const out = path.join(os.tmpdir(), `booth-shot-${Date.now()}.jpg`);
    await new Promise((resolve, reject) => {
      execFile(
        exe,
        [s.digicamAf ? '/capture' : '/capturenoaf', '/filename', out],
        { timeout: 20000, windowsHide: true },
        (err) => (err ? reject(err) : resolve())
      );
    });

    for (let i = 0; i < 50 && !fs.existsSync(out); i++) await sleep(100); // wait for the file to land
    if (!fs.existsSync(out)) throw new Error('The camera did not return a photo. Check the camera is on and set to JPEG.');
    await sleep(150);

    const buf = fs.readFileSync(out);
    fs.unlink(out, () => {});
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  });

  // ----- printing / sharing / saving -----
  ipcMain.handle('printers:list', async () => {
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, isDefault: !!p.isDefault }));
  });

  ipcMain.handle('qr:make', (_e, text) =>
    QRCode.toDataURL(String(text), { margin: 1, width: 512, errorCorrectionLevel: 'M' })
  );

  ipcMain.handle('session:save', (_e, { id, event, final, photos }) => {
    const s = getSettings();
    const dir = ensureDir(path.join(s.saveDir, safeName(event), safeName(id)));
    fs.writeFileSync(path.join(dir, 'final.png'), toBuffer(final));
    (photos || []).forEach((u, i) => fs.writeFileSync(path.join(dir, `photo-${i + 1}.jpg`), toBuffer(u)));
    return dir;
  });

  // Prints one 4R (4x6 in) sheet. The renderer sends a 1200x1800 image.
  ipcMain.handle('print:sheet', async (_e, { dataUrl, copies = 1, printerName = '' }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-'));
    fs.writeFileSync(path.join(dir, 'sheet.png'), toBuffer(dataUrl));
    fs.writeFileSync(
      path.join(dir, 'sheet.html'),
      `<html><head><style>
        @page { size: 4in 6in; margin: 0; }
        html, body { margin: 0; padding: 0; }
        img { width: 4in; height: 6in; display: block; }
      </style></head><body><img src="sheet.png"></body></html>`
    );

    const printWin = new BrowserWindow({ show: false });
    await printWin.loadFile(path.join(dir, 'sheet.html'));
    await sleep(300);

    const options = {
      silent: true,
      printBackground: true,
      copies: Math.max(1, Number(copies) || 1),
      margins: { marginType: 'none' },
      pageSize: { width: 101600, height: 152400 }, // 4x6 in in microns
    };
    if (printerName) options.deviceName = printerName;

    return new Promise((resolve) => {
      printWin.webContents.print(options, (success, reason) => {
        printWin.close();
        fs.rm(dir, { recursive: true, force: true }, () => {});
        resolve({ success, reason });
      });
    });
  });
}
