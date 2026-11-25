import { projectiveTransform, clamp, moveShape } from './show.js';

export const WIDTH = 1280;
export const HEIGHT = 720;
const TEXTURE_W = 384;
const TEXTURE_H = 288;

export function makeCanvas(width = WIDTH, height = HEIGHT) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function path(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const { x, y } of points.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
}

const pixelsOf = points => points.map(({ x, y }) => ({ x: x * WIDTH, y: y * HEIGHT }));
const meshes = new WeakMap();

function mesh(points) {
  if (meshes.has(points)) return meshes.get(points);
  const anchored = pixelsOf(points);
  const project = projectiveTransform(anchored);
  const [a, b, c, d] = anchored;
  if (Math.abs(a.x - b.x + c.x - d.x) < .015 && Math.abs(a.y - b.y + c.y - d.y) < .015) {
    const matrix = [(b.x - a.x) / TEXTURE_W, (b.y - a.y) / TEXTURE_W,
      (d.x - a.x) / TEXTURE_H, (d.y - a.y) / TEXTURE_H, a.x, a.y];
    const value = { anchored, triangles: [{ clip: anchored, matrix }], affine: true };
    meshes.set(points, value);
    return value;
  }
  const divider = 6;
  const vertices = Array.from({ length: divider + 1 }, (_, row) =>
    Array.from({ length: divider + 1 }, (_, col) => project(col / divider, row / divider)));
  const triangles = [];
  const stepX = TEXTURE_W / divider;
  const stepY = TEXTURE_H / divider;
  for (let row = 0; row < divider; row++) {
    for (let col = 0; col < divider; col++) {
      const a = vertices[row][col];
      const b = vertices[row][col + 1];
      const c = vertices[row + 1][col + 1];
      const d = vertices[row + 1][col];
      // Both triangles have horizontal and vertical source edges. Expand the clip
      // by a fraction of a pixel to cover antialiasing at shared edges.
      triangles.push(triangle(a, b, c, a, col * stepX, row * stepY, (b.x - a.x) / stepX, (b.y - a.y) / stepX,
        (c.x - b.x) / stepY, (c.y - b.y) / stepY));
      triangles.push(triangle(a, c, d, a, col * stepX, row * stepY, (c.x - d.x) / stepX, (c.y - d.y) / stepX,
        (d.x - a.x) / stepY, (d.y - a.y) / stepY));
    }
  }
  const value = { anchored, triangles };
  meshes.set(points, value);
  return value;
}

function triangle(a, b, c, anchor, x, y, dxdu, dydu, dxdv, dydv) {
  const center = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
  const clip = [a, b, c].map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + .7 * dx / length, y: point.y + .7 * dy / length };
  });
  return { clip, matrix: [dxdu, dydu, dxdv, dydv, anchor.x - dxdu * x - dxdv * y, anchor.y - dydu * x - dydv * y] };
}

function warp(ctx, image, points) {
  const { anchored, triangles, affine } = mesh(points);
  ctx.save();
  path(ctx, anchored);
  ctx.clip();
  for (const { clip, matrix } of triangles) {
    ctx.save();
    if (!affine) {
      path(ctx, clip);
      ctx.clip();
    }
    ctx.setTransform(...matrix);
    ctx.drawImage(image, 0, 0, TEXTURE_W, TEXTURE_H);
    ctx.restore();
  }
  ctx.restore();
}

function paintBlack(ctx) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function line(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.stroke();
}

function grid(ctx, w, h, color, spacing = 12) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 1; i < spacing; i++) line(ctx, [i * w / spacing, 0, i * w / spacing, h]);
  for (let i = 1; i < spacing * 3 / 4; i++) line(ctx, [0, i * h / (spacing * 3 / 4), w, i * h / (spacing * 3 / 4)]);
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

function calibration(ctx) {
  grid(ctx, WIDTH, HEIGHT, '#e5f3ff', 16);
  ctx.strokeStyle = '#61ffd1';
  ctx.lineWidth = 3;
  line(ctx, [WIDTH / 2, 0, WIDTH / 2, HEIGHT]);
  line(ctx, [0, HEIGHT / 2, WIDTH, HEIGHT / 2]);
  ctx.strokeRect(8, 8, WIDTH - 16, HEIGHT - 16);
  ctx.font = '18px system-ui';
  ctx.fillStyle = '#fff';
  ctx.fillText('TL', 20, 34);
  ctx.fillText('TR', WIDTH - 45, 34);
  ctx.fillText('BL', 20, HEIGHT - 20);
  ctx.fillText('BR', WIDTH - 45, HEIGHT - 20);
}

function dancer(ctx, t, w, h) {
  const shift = Math.sin(t * 2.05) * w * .16;
  const sway = Math.sin(t * 3) * .20;
  const knee = Math.sin(t * 4) * .11;
  const arms = Math.sin(t * 3.5) * .19;
  const x = w * .5 + shift;
  const y = h * .47 + Math.sin(t * 6) * h * .04;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  ctx.fillStyle = '#ffe593';
  ctx.strokeStyle = '#ffe593';
  ctx.shadowColor = '#ffbc63';
  ctx.shadowBlur = 15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(0, -h * .21, h * .064, 0, 2 * Math.PI);
  ctx.fill();
  ctx.lineWidth = h * .11;
  line(ctx, [0, -h * .10, 0, h * .15]);
  ctx.lineWidth = h * .055;
  line(ctx, [0, -h * .10, -w * .15, h * (.01 + arms), -w * .27, -h * (.19 - arms)]);
  line(ctx, [0, -h * .10, w * .15, h * (.01 - arms), w * .27, -h * (.19 + arms)]);
  ctx.lineWidth = h * .072;
  line(ctx, [0, h * .12, -w * (.085 + knee / 2), h * (.23 - knee), -w * (.12 + knee), h * .45]);
  line(ctx, [0, h * .12, w * (.085 - knee / 2), h * (.23 + knee), w * (.12 - knee), h * .45]);
  ctx.restore();
}

function procedural(ctx, id, t, bands, staticImage) {
  const w = TEXTURE_W;
  const h = TEXTURE_H;
  if (id === 'static' || id === 'film') {
    if (staticImage.complete && staticImage.naturalWidth) ctx.drawImage(staticImage, 0, 0, w, h);
    else {
      ctx.fillStyle = '#1f454a';
      ctx.fillRect(0, 0, w, h);
      grid(ctx, w, h, '#77cac2', 8);
    }
    if (id === 'film') {
      const center = (t * 46) % (w + 130) - 65;
      const glow = ctx.createLinearGradient(center - 65, 0, center + 65, 0);
      glow.addColorStop(0, '#b3e5b400');
      glow.addColorStop(.5, '#b3e5b459');
      glow.addColorStop(1, '#b3e5b400');
      ctx.fillStyle = glow;
      ctx.fillRect(center - 65, 0, 130, h);
    }
    return;
  }
  ctx.fillStyle = '#061522';
  ctx.fillRect(0, 0, w, h);
  if (id === 'grid') {
    grid(ctx, w, h, '#397f91', 16);
    ctx.fillStyle = '#85f3dc';
    const x = (t * 55) % w;
    ctx.fillRect(x, 0, 4, h);
    ctx.fillRect(0, (x * .7) % h, w, 3);
  } else if (id === 'audio') {
    const [bass, mid, high] = bands;
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * .7);
    glow.addColorStop(0, 'hsl(160 75% ' + (18 + bass * 55) + '%)');
    glow.addColorStop(1, '#12102d');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 21; i++) {
      const amplitude = .1 + (bass * .45 + mid * .38 + high * .18) * (.4 + .6 * Math.abs(Math.sin(i * .62 + t * 4)));
      ctx.fillStyle = 'hsl(' + (160 + i * 5) + ' 85% ' + (40 + high * 36) + '% / .82)';
      ctx.fillRect(i * w / 21 + 2, h * (.5 - amplitude / 2), w / 21 - 4, h * amplitude);
    }
  } else if (id === 'stars') {
    const sky = ctx.createRadialGradient(w / 2, h / 2, 14, w / 2, h / 2, w * .7);
    sky.addColorStop(0, '#240b36');
    sky.addColorStop(.6, '#0d061c');
    sky.addColorStop(1, '#04050a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 65; i++) {
      const x = (i * 97 + t * (15 + i % 5 * 8)) % w;
      const y = (i * 53 + Math.sin(t + i) * 10 + h) % h;
      ctx.fillStyle = i % 4 === 0 ? '#00f0ff' : '#fff';
      ctx.beginPath();
      ctx.arc(x, y, .7 + i % 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 'gold') {
    const liquid = ctx.createLinearGradient(0, 0, w, h);
    liquid.addColorStop(0, '#1a0f00');
    liquid.addColorStop(.5, '#ff8800');
    liquid.addColorStop(1, '#ffe600');
    ctx.fillStyle = liquid;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#fffac859';
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += 12) {
      const points = [];
      for (let x = 0; x <= w; x += 16) points.push(x, y + Math.sin(x * .022 + t * 2.5 + y * .04) * 12);
      line(ctx, points);
    }
  } else if (id === 'tunnel') {
    for (let i = 0; i < 14; i++) {
      const p = (i / 14 + t * .35) % 1;
      const size = p * w * .72;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(t * .4 + p * 1.2);
      ctx.globalAlpha = 1 - p * .7;
      ctx.strokeStyle = i % 2 === 0 ? '#00f0ff' : '#ff2a85';
      ctx.lineWidth = 2 + p * 4;
      ctx.strokeRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  } else if (id === 'pulse-wave') {
    for (let i = 0; i < 12; i++) {
      const amp = (Math.sin(t * 5 + i * .65) * .5 + .5) * h * .85;
      ctx.fillStyle = i % 2 === 0 ? '#10b981' : '#00f0ff';
      ctx.fillRect(i * w / 12 + 3, (h - amp) / 2, w / 12 - 6, amp);
    }
  }
}

const dancerSources = ['demo-dancer', 'webcam', 'file-dancer'];

export function createRenderer(preview, assets, inputs) {
  const output = makeCanvas();
  const ctx = output.getContext('2d', { alpha: false });
  const previewCtx = preview.getContext('2d', { alpha: false });
  const zoneCanvas = makeCanvas(TEXTURE_W, TEXTURE_H);
  const zoneCtx = zoneCanvas.getContext('2d');
  const translucentZone = makeCanvas().getContext('2d');
  const textures = new Map();
  const matteBuffers = new Map(dancerSources.map(id => [id, makeCanvas(256, 192).getContext('2d', { willReadFrequently: true })]));
  const styledDancer = makeCanvas(TEXTURE_W, TEXTURE_H).getContext('2d');
  const performer = makeCanvas(TEXTURE_W, TEXTURE_H).getContext('2d');
  let centroid = { x: .5, y: .5, present: false };
  const still = new Image();
  still.src = new URL('./assets/facade-still.png', import.meta.url).href;

  function rawMatte(id, time, threshold, settings) {
    const ctx = matteBuffers.get(id);
    const { width, height } = ctx.canvas;
    ctx.clearRect(0, 0, width, height);
    if (id === 'demo-dancer') dancer(ctx, time, width, height);
    if (id === 'webcam') ctx.drawImage(inputs.matte, 0, 0, width, height);
    if (id === 'file-dancer') {
      const asset = assets.get(settings.file);
      if (asset?.ready && !asset.failed && asset.type !== 'audio') {
        ctx.drawImage(asset.element, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const luminance = .2126 * pixels.data[i] + .7152 * pixels.data[i + 1] + .0722 * pixels.data[i + 2];
          pixels.data[i + 3] *= clamp((luminance - threshold) / 18);
        }
        ctx.putImageData(pixels, 0, 0);
      }
    }
    return ctx;
  }

  function updateCentroid(ctx) {
    const { width, height } = ctx.canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    let total = 0;
    let x = 0;
    let y = 0;
    for (let row = 0; row < height; row += 2) {
      for (let col = 0; col < width; col += 2) {
        const alpha = data[(row * width + col) * 4 + 3];
        if (alpha < 120) continue;
        total++;
        x += col / width;
        y += row / height;
      }
    }
    const present = total >= 5;
    centroid = {
      x: centroid.x + ((present ? x / total : .5) - centroid.x) * .22,
      y: centroid.y + ((present ? y / total : .5) - centroid.y) * .22,
      present,
    };
  }

  function composeDancer(target, id, time, settings, matte, fill, background = true) {
    const w = TEXTURE_W;
    const h = TEXTURE_H;
    styledDancer.clearRect(0, 0, w, h);
    styledDancer.filter = settings.feather ? 'blur(' + settings.feather / 2 + 'px)' : 'none';
    styledDancer.drawImage(matte.canvas, 0, 0, w, h);
    styledDancer.filter = 'none';
    if (settings.invert) {
      performer.clearRect(0, 0, w, h);
      performer.fillStyle = '#fff';
      performer.fillRect(0, 0, w, h);
      performer.globalCompositeOperation = 'destination-out';
      performer.drawImage(styledDancer.canvas, 0, 0);
      performer.globalCompositeOperation = 'source-over';
      styledDancer.clearRect(0, 0, w, h);
      styledDancer.drawImage(performer.canvas, 0, 0);
    }
    if (id === 'webcam') {
      const { x, y, width, height } = settings.roi;
      styledDancer.clearRect(0, 0, w * x / 100, h);
      styledDancer.clearRect(w * (x + width) / 100, 0, w, h);
      styledDancer.clearRect(0, 0, w, h * y / 100);
      styledDancer.clearRect(0, h * (y + height) / 100, w, h);
    }
    if (background) {
      target.fillStyle = '#1b152c';
      target.fillRect(0, 0, w, h);
      grid(target, w, h, '#352956');
    }
    target.save();
    target.globalAlpha = settings.opacity;
    if (settings.outline) {
      const radius = settings.outline;
      performer.clearRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        performer.drawImage(styledDancer.canvas, Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      performer.globalCompositeOperation = 'source-in';
      performer.fillStyle = settings.color;
      performer.fillRect(0, 0, w, h);
      performer.globalCompositeOperation = 'destination-out';
      performer.drawImage(styledDancer.canvas, 0, 0);
      performer.globalCompositeOperation = 'source-over';
      target.drawImage(performer.canvas, 0, 0);
    }
    performer.clearRect(0, 0, w, h);
    performer.drawImage(styledDancer.canvas, 0, 0);
    performer.globalCompositeOperation = 'source-in';
    if (fill) performer.drawImage(fill, 0, 0, w, h);
    else {
      performer.fillStyle = '#ffe593';
      performer.fillRect(0, 0, w, h);
    }
    performer.globalCompositeOperation = 'source-over';
    target.drawImage(performer.canvas, 0, 0);
    target.restore();
  }

  function texture(id, time, bands, frameCache, show) {
    let frames = frameCache.get(id);
    if (!frames) {
      frames = new Map();
      frameCache.set(id, frames);
    }
    if (frames.has(time)) return frames.get(time);
    let buffers = textures.get(id);
    if (!buffers) {
      buffers = [];
      textures.set(id, buffers);
    }
    const image = buffers[frames.size] ?? (buffers[frames.size] = makeCanvas(TEXTURE_W, TEXTURE_H));
    const tile = image.getContext('2d');
    paintBlack(tile);
    const asset = assets.get(id);
    if (dancerSources.includes(id)) {
      const { silhouette } = show;
      const matte = rawMatte(id, time, show.threshold, silhouette);
      const fill = !dancerSources.includes(silhouette.fill) && silhouette.fill
        ? texture(silhouette.fill, time, bands, frameCache, show) : undefined;
      composeDancer(tile, id, time, silhouette, matte, fill);
    } else if (asset && asset.ready && !asset.failed) {
      if (asset.type === 'audio') procedural(tile, 'audio', time, inputs.bandsForAsset(asset), still);
      else tile.drawImage(asset.element, 0, 0, TEXTURE_W, TEXTURE_H);
    } else procedural(tile, id, time, bands, still);
    frames.set(time, image);
    return image;
  }

  function drawZone(zone, texture, mode) {
    const points = zone.follow && mode === 'program'
      ? moveShape(zone.points, (centroid.x - .5) * .65, (centroid.y - .5) * .65) : zone.points;
    const draw = target => {
      if (zone.kind === 'quad') warp(target, texture, points);
      else {
        const pixels = pixelsOf(points);
        const x = pixels.map(p => p.x), y = pixels.map(p => p.y);
        const left = Math.min(...x), top = Math.min(...y);
        target.save();
        path(target, pixels);
        target.clip();
        target.drawImage(texture, left, top, Math.max(...x) - left, Math.max(...y) - top);
        target.restore();
      }
    };
    if (zone.opacity === 1 && !zone.feather && zone.blend === 'source-over') draw(ctx);
    else {
      translucentZone.clearRect(0, 0, WIDTH, HEIGHT);
      draw(translucentZone);
      ctx.save();
      ctx.globalAlpha = zone.opacity;
      ctx.globalCompositeOperation = zone.blend;
      if (zone.feather) ctx.filter = 'blur(' + zone.feather / 2 + 'px)';
      path(ctx, pixelsOf(points));
      ctx.clip();
      ctx.drawImage(translucentZone.canvas, 0, 0);
      ctx.restore();
    }
    if (zone.stroke) {
      ctx.save();
      ctx.globalAlpha = zone.opacity;
      path(ctx, pixelsOf(points));
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = zone.stroke;
      ctx.stroke();
      ctx.restore();
    }
  }

  function clean(show, layers, mode, bands, dancerTime, trackingSource) {
    paintBlack(ctx);
    if (mode === 'blackout') return;
    if (mode === 'grid') {
      calibration(ctx);
      for (const zone of show.zones) {
        if (!zone.enabled) continue;
        const pts = pixelsOf(zone.points);
        path(ctx, pts);
        ctx.strokeStyle = '#ffd97a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      const cache = new Map();
      if (mode === 'program' && show.zones.some(zone => zone.follow && zone.enabled)) {
        updateCentroid(rawMatte(trackingSource, dancerTime, show.threshold, show.silhouette));
      }
      for (const zone of show.zones) {
        if (!zone.enabled || !zone.opacity) continue;
        if (!layers.length || (layers.length === 1 && layers[0].opacity === 1) || zone.source !== 'cue' || mode === 'fallback') {
          const layer = layers[0];
          const id = mode === 'fallback' ? show.fallback : zone.source === 'cue' ? (layer?.cue.source ?? zone.baseSource) : zone.source;
          if (id) drawZone(zone, texture(id, zone.source === 'cue' ? (layer?.local ?? dancerTime) : dancerTime, bands, cache, show), mode);
        } else {
          paintBlack(zoneCtx);
          const remainder = Math.max(0, 1 - layers.reduce((sum, layer) => sum + layer.opacity, 0));
          if (remainder && zone.baseSource) {
            zoneCtx.globalAlpha = remainder;
            zoneCtx.drawImage(texture(zone.baseSource, dancerTime, bands, cache, show), 0, 0);
          }
          zoneCtx.globalCompositeOperation = 'lighter';
          for (const { cue, opacity, local } of layers) {
            zoneCtx.globalAlpha = opacity;
            zoneCtx.drawImage(texture(cue.source, local, bands, cache, show), 0, 0);
          }
          zoneCtx.globalCompositeOperation = 'source-over';
          zoneCtx.globalAlpha = 1;
          drawZone(zone, zoneCanvas, mode);
        }
      }
      if (mode === 'program' && show.silhouette.overlay) {
        const { silhouette } = show;
        const matte = rawMatte(silhouette.source, dancerTime, show.threshold, silhouette);
        const fill = !dancerSources.includes(silhouette.fill) && silhouette.fill
          ? texture(silhouette.fill, dancerTime, bands, cache, show) : undefined;
        zoneCtx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
        composeDancer(zoneCtx, silhouette.source, dancerTime, silhouette, matte, fill, false);
        ctx.drawImage(zoneCanvas, 0, 0, WIDTH, HEIGHT);
      }
      if (show.master < 1) {
        ctx.fillStyle = 'rgba(0,0,0,' + (1 - show.master) + ')';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    }
    ctx.fillStyle = '#000';
    for (const mask of show.masks) {
      if (mask.enabled) {
        path(ctx, pixelsOf(mask.points));
        ctx.fill();
      }
    }
  }

  function operator(show, selected, guides, mode, draft) {
    previewCtx.drawImage(output, 0, 0);
    if (!guides || mode === 'blackout') return;
    for (const [shapes, color] of [[show.zones, '#99efd8'], [show.masks, '#ffc286']]) {
      for (const item of shapes) {
        const pts = pixelsOf(item.points);
        const active = item === selected;
        path(previewCtx, pts);
        previewCtx.save();
        previewCtx.strokeStyle = item.enabled ? color : '#889399';
        previewCtx.lineWidth = active ? 3 : 1.25;
        if (shapes === show.masks || !item.enabled) previewCtx.setLineDash([8, 5]);
        previewCtx.stroke();
        previewCtx.restore();
        if (active) {
          for (const point of pts) {
            previewCtx.fillStyle = '#121b25';
            previewCtx.fillRect(point.x - 7, point.y - 7, 14, 14);
            previewCtx.strokeStyle = color;
            previewCtx.lineWidth = 2;
            previewCtx.strokeRect(point.x - 7, point.y - 7, 14, 14);
          }
        }
      }
    }
    if (draft?.points.length) {
      const pts = pixelsOf(draft.cursor ? [...draft.points, draft.cursor] : draft.points);
      previewCtx.save();
      previewCtx.lineWidth = 2;
      previewCtx.strokeStyle = '#ffda96';
      previewCtx.setLineDash([5, 4]);
      previewCtx.beginPath();
      previewCtx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) previewCtx.lineTo(p.x, p.y);
      previewCtx.stroke();
      previewCtx.restore();
      previewCtx.fillStyle = '#ffda96';
      for (const p of pixelsOf(draft.points)) previewCtx.fillRect(p.x - 3, p.y - 3, 6, 6);
    }
  }

  function monitor(canvas, source, time, show, view) {
    const target = canvas.getContext('2d');
    const { width, height } = canvas;
    paintBlack(target);
    const matte = rawMatte(source, time, show.threshold, show.silhouette);
    updateCentroid(matte);
    const file = assets.get(show.silhouette.file);
    if (source === 'webcam' && view !== 'matte' && inputs.camera.readyState >= 2) {
      target.save();
      target.translate(width, 0);
      target.scale(-1, 1);
      target.drawImage(inputs.camera, 0, 0, width, height);
      target.restore();
    } else if (source === 'file-dancer' && view !== 'matte' && file?.ready && !file.failed && file.type !== 'audio') {
      target.drawImage(file.element, 0, 0, width, height);
    } else target.drawImage(matte.canvas, 0, 0, width, height);
    if (view === 'chart') {
      grid(target, width, height, '#445858', 4);
      const { x, y, width: rw, height: rh } = show.silhouette.roi;
      target.strokeStyle = '#ffca89';
      target.strokeRect(x * width / 100, y * height / 100, rw * width / 100, rh * height / 100);
      if (centroid.present) {
        target.fillStyle = '#9ef2dc';
        target.fillRect(centroid.x * width - 2, centroid.y * height - 2, 4, 4);
      }
    }
  }

  return { output, clean, operator, monitor, centroid: () => centroid, clearTextures() { textures.clear(); },
    blank() { paintBlack(ctx); paintBlack(previewCtx); } };
}

export function silhouetteFromPixels(frame, background, threshold, target, width, roi) {
  const height = frame.length / 4 / width;
  for (let i = 0; i < frame.length; i += 4) {
    const value = background ? Math.max(
      Math.abs(frame[i] - background[i]), Math.abs(frame[i + 1] - background[i + 1]),
      Math.abs(frame[i + 2] - background[i + 2]),
    ) : .2126 * frame[i] + .7152 * frame[i + 1] + .0722 * frame[i + 2];
    target[i] = 255;
    target[i + 1] = 220;
    target[i + 2] = 128;
    const x = (i / 4 % width) * 100 / width;
    const y = Math.floor(i / 4 / width) * 100 / height;
    const included = x >= roi.x && y >= roi.y && x < roi.x + roi.width && y < roi.y + roi.height;
    target[i + 3] = included ? Math.round(clamp((value - threshold) / 18) * 255) : 0;
  }
}
