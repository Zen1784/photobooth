const video = document.getElementById('preview');
const startBtn = document.getElementById('startBtn');
const countdownEl = document.getElementById('countdown');
const flashEl = document.getElementById('flash');
const statusEl = document.getElementById('status');
const thumbsEl = document.getElementById('thumbs');

const PHOTO_COUNT = 4;
const COUNTDOWN_SECONDS = 3;

const photos = []; // each item is a JPEG data URL

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = 'Camera error: ' + err.message;
    startBtn.disabled = true;
  }
}

async function runCountdown(seconds) {
  for (let i = seconds; i > 0; i--) {
    countdownEl.textContent = i;
    await wait(1000);
  }
  countdownEl.textContent = '';
}

function capturePhoto() {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function flash() {
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 80);
}

function renderThumbs() {
  thumbsEl.innerHTML = '';
  photos.forEach((src, i) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Photo ' + (i + 1);
    thumbsEl.appendChild(img);
  });
}

async function startSession() {
  startBtn.disabled = true;
  photos.length = 0;
  renderThumbs();

  for (let i = 0; i < PHOTO_COUNT; i++) {
    statusEl.textContent = `Photo ${i + 1} of ${PHOTO_COUNT}`;
    await runCountdown(COUNTDOWN_SECONDS);
    flash();
    photos.push(capturePhoto());
    renderThumbs();
    await wait(600);
  }

  statusEl.textContent = 'Done!';
  startBtn.disabled = false;
}

function composeSheet(templateCanvas, type) {
  const sheet = document.createElement('canvas');
  sheet.width = 1200;
  sheet.height = 1800;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1200, 1800);

  if (type === 'strip') {
    ctx.drawImage(templateCanvas, 0, 0, 600, 1800);
    ctx.drawImage(templateCanvas, 600, 0, 600, 1800);
  } else {
    ctx.drawImage(templateCanvas, 0, 0, 1200, 1800);
  }
  return sheet.toDataURL('image/png');
}

startBtn.addEventListener('click', startSession);
startCamera();