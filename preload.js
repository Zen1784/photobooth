const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('booth', {
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),

  eventStart: call('event:start'),
  eventStop: call('event:stop'),
  // Fired when someone presses F11, leaves fullscreen or closes the window during an event.
  onExitRequest: (cb) => ipcRenderer.on('exit-requested', () => cb()),

  listTemplates: call('templates:list'),
  saveTemplate: call('templates:save'),
  deleteTemplate: call('templates:delete'),
  listFrames: call('frames:list'),
  importFrames: call('frames:import'),
  deleteFrame: call('frames:delete'),

  chooseFolder: call('dialog:folder'),
  dslrFind: call('dslr:find'),
  dslrBrowse: call('dslr:browse'),
  dslrCapture: call('dslr:capture'),

  listPrinters: call('printers:list'),
  printSheet: call('print:sheet'),
  makeQr: call('qr:make'),
  saveSession: call('session:save'),
});
