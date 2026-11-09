// Draws a template (photos + frame + text + QR codes) onto a canvas.
// The same function is used for the review preview, the editor, and the final print.
(function () {
  const FILTERS = {
    none: 'none',
    bw: 'grayscale(1) contrast(1.05)',
    sepia: 'sepia(0.85)',
    vivid: 'saturate(1.5) contrast(1.08)',
    warm: 'sepia(0.25) saturate(1.2) hue-rotate(-10deg)',
    cool: 'saturate(1.1) hue-rotate(15deg) brightness(1.03)',
    fade: 'contrast(0.85) brightness(1.1) saturate(0.85)',
  };

  const FILTER_LIST = [
    ['none', 'Original'],
    ['bw', 'B&W'],
    ['sepia', 'Sepia'],
    ['vivid', 'Vivid'],
    ['warm', 'Warm'],
    ['cool', 'Cool'],
    ['fade', 'Fade'],
  ];

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Draw an image to fill a box (crop to fit, like CSS object-fit: cover).
  function coverDraw(ctx, img, x, y, w, h) {
    const ir = img.width / img.height;
    const r = w / h;
    let sw, sh, sx, sy;
    if (ir > r) {
      sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0;
    } else {
      sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  function drawText(ctx, el, o) {
    const text = String(el.text || '')
      .replace(/\{event\}/g, o.event || '')
      .replace(/\{date\}/g, new Date().toLocaleDateString());
    ctx.save();
    ctx.fillStyle = el.color || '#222222';
    ctx.font = `${el.weight || '600'} ${el.size || 40}px ${el.font || 'sans-serif'}`;
    ctx.textBaseline = 'top';
    const align = el.align || 'center';
    ctx.textAlign = align;
    const x = align === 'left' ? el.x : align === 'right' ? el.x + el.w : el.x + el.w / 2;
    ctx.fillText(text, x, el.y, el.w);
    ctx.restore();
  }

  function drawQr(ctx, el, o) {
    const img = o.qr && o.qr[el.source];
    const size = el.w;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(el.x, el.y, size, size);
    if (img) {
      ctx.drawImage(img, el.x, el.y, size, size);
    } else if (o.placeholders) {
      ctx.strokeStyle = '#999999';
      ctx.lineWidth = 3;
      ctx.strokeRect(el.x + 1.5, el.y + 1.5, size - 3, size - 3);
      ctx.fillStyle = '#666666';
      ctx.font = `700 ${Math.round(size * 0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('QR', el.x + size / 2, el.y + size / 2 - size * 0.08);
      ctx.font = `600 ${Math.round(size * 0.12)}px sans-serif`;
      ctx.fillText(el.source === 'gif' ? 'GIF' : 'photos', el.x + size / 2, el.y + size / 2 + size * 0.16);
    }
    ctx.restore();
  }

  /**
   * options:
   *   photos       array of { img } (index = photo slot), null for empty slots
   *   filter       key of FILTERS
   *   frameImg     Image drawn over the photos (PNG with transparent photo windows)
   *   qr           { gif: Image, photos: Image }
   *   event        event name for {event} text
   *   placeholders draw gray boxes for empty slots / missing QR (editor + preview)
   */
  function renderTemplate(t, o = {}) {
    const c = document.createElement('canvas');
    c.width = t.width;
    c.height = t.height;
    const ctx = c.getContext('2d');

    ctx.fillStyle = t.background || '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);

    // 1) photos
    let slot = 0;
    for (const el of t.elements) {
      if (el.type !== 'photo') continue;
      slot++;
      const p = (o.photos || [])[slot - 1];
      ctx.save();
      ctx.beginPath();
      ctx.rect(el.x, el.y, el.w, el.h);
      ctx.clip();
      if (p && p.img) {
        ctx.filter = FILTERS[o.filter] || 'none';
        coverDraw(ctx, p.img, el.x, el.y, el.w, el.h);
        ctx.filter = 'none';
      } else if (o.placeholders) {
        ctx.fillStyle = '#e4e6ef';
        ctx.fillRect(el.x, el.y, el.w, el.h);
        ctx.fillStyle = '#8b90a8';
        ctx.font = `700 ${Math.round(Math.min(el.w, el.h) * 0.14)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Photo ' + slot, el.x + el.w / 2, el.y + el.h / 2);
      }
      ctx.restore();
    }

    // 2) frame on top of the photos
    if (o.frameImg) ctx.drawImage(o.frameImg, 0, 0, c.width, c.height);

    // 3) text and QR codes on top of the frame
    for (const el of t.elements) {
      if (el.type === 'text') drawText(ctx, el, o);
      else if (el.type === 'qr') drawQr(ctx, el, o);
    }
    return c;
  }

  // Builds the 4R sheet (1200x1800 px = 4x6 in at 300 DPI).
  // photocard: printed once, full size.
  // strip: printed twice side by side, then cut down the middle.
  function composeSheet(canvas, type, cutGuide) {
    const sheet = document.createElement('canvas');
    sheet.width = 1200;
    sheet.height = 1800;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1200, 1800);
    if (type === 'strip') {
      ctx.drawImage(canvas, 0, 0, 600, 1800);
      ctx.drawImage(canvas, 600, 0, 600, 1800);
      if (cutGuide) {
        ctx.strokeStyle = '#999999';
        ctx.lineWidth = 2;
        for (const [y1, y2] of [[0, 24], [1776, 1800]]) {
          ctx.beginPath();
          ctx.moveTo(600, y1);
          ctx.lineTo(600, y2);
          ctx.stroke();
        }
      }
    } else {
      ctx.drawImage(canvas, 0, 0, 1200, 1800);
    }
    return sheet;
  }

  async function frameImage(t) {
    const f = window.App.frames.find((x) => x.name === t.frame);
    return f ? loadImage(f.dataUrl) : null;
  }

  async function qrImage(text) {
    return loadImage(await window.App.api.makeQr(text));
  }

  // Small preview canvas of a template (used for template cards and pickers).
  async function thumb(t, maxH = 240) {
    const frameImg = await frameImage(t).catch(() => null);
    const c = renderTemplate(t, { frameImg, placeholders: true, event: window.App.settings.eventName });
    const k = Math.min(1, maxH / c.height);
    const s = document.createElement('canvas');
    s.width = Math.round(c.width * k);
    s.height = Math.round(c.height * k);
    s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
    return s;
  }

  window.Render = { FILTERS, FILTER_LIST, renderTemplate, composeSheet, frameImage, qrImage, loadImage, thumb };
})();
