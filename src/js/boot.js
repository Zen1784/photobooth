(async function () {
  try {
    App.settings = await App.api.getSettings();
    await App.refreshData();
    await App.camera.start();
  } catch (err) {
    console.error('Startup error:', err);
  }

  Object.values(App.screens).forEach((s) => s.init && s.init());

  // F11 / leaving fullscreen / closing the window during an event asks for the PIN.
  App.api.onExitRequest(() => App.requestExit());

  App.show('dashboard'); // the staff side is the first page
})();
