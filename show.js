export const sources = [
  ['grid', 'Architectural grid'], ['film', 'Facade animation'], ['demo-dancer', 'Demo dancer'],
  ['file-dancer', 'File silhouette'], ['webcam', 'Live camera'], ['audio', 'Audio response'], ['static', 'Static fallback'],
  ['gold', 'Liquid gold'], ['stars', 'Nebula'], ['tunnel', 'Neon tunnel'], ['pulse-wave', 'Kinetic pulse wave'],
];
const stock = new Set(sources.map(([id]) => id));
const legacySources = new Map([
  ['proc_neon_tunnel', 'tunnel'], ['proc_liquid_gold', 'gold'], ['proc_cyber_grid', 'grid'],
  ['proc_starfield', 'stars'], ['proc_strobe', 'pulse-wave'],
]);
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const number = (value, fallback, min, max) =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
const label = (value, fallback) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : fallback;
const corners = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom },
];

export function isConvexQuad(points) {
  return points.length === 4 && points.every((a, index) => {
    const b = points[(index + 1) % 4];
    const c = points[(index + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0.00002;
  });
}

export function projectiveTransform([a, b, c, d]) {
  const x1 = b.x - c.x;
  const x2 = d.x - c.x;
  const y1 = b.y - c.y;
  const y2 = d.y - c.y;
  const x3 = a.x - b.x + c.x - d.x;
  const y3 = a.y - b.y + c.y - d.y;
  const determinant = x1 * y2 - x2 * y1;
  const g = (x3 * y2 - x2 * y3) / determinant;
  const h = (x1 * y3 - x3 * y1) / determinant;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return {
      x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / w,
      y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / w,
    };
  };
}

export const blendModes = ['source-over', 'screen', 'lighter', 'multiply', 'overlay', 'difference', 'darken', 'lighten', 'hard-light', 'soft-light', 'exclusion'];
export const defaultRoi = { x: 0, y: 0, width: 100, height: 100 };
export const defaultSilhouette = {
  overlay: false, source: 'demo-dancer', file: '', fill: '', opacity: 1, feather: 3,
  invert: false, outline: 0, color: '#72f3dc', cameraKey: 'difference', roi: defaultRoi,
};
const color = (value, fallback) => /^#[a-f0-9]{6}$/i.test(value ?? '') ? value : fallback;
const turn = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export function isSimplePolygon(points) {
  if (points.length < 3 || points.length > 64) return false;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < .0001) return false;
    twiceArea += a.x * b.y - b.x * a.y;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      const overlap = (axis) => Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
        >= Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
      if (overlap('x') && overlap('y') && turn(a, b, c) * turn(a, b, d) <= 0
        && turn(c, d, a) * turn(c, d, b) <= 0) return false;
    }
  }
  return Math.abs(twiceArea) > .00004;
}

export function shapePoints(shape, mask = false) {
  if (shape === 'triangle') return [{ x: .50, y: .30 }, { x: .69, y: .66 }, { x: .31, y: .66 }];
  if (shape === 'circle') return Array.from({ length: 24 }, (_, i) => ({
    x: .5 + Math.cos(i * Math.PI / 12) * .105, y: .5 + Math.sin(i * Math.PI / 12) * .187,
  }));
  return mask ? corners(.40, .38, .60, .62) : corners(.18, .20, .82, .80);
}

export const validShape = (points, kind) => kind === 'quad' ? isConvexQuad(points) : isSimplePolygon(points);

export function moveShape(points, dx, dy) {
  const x = clamp(dx, -Math.min(...points.map(p => p.x)), 1 - Math.max(...points.map(p => p.x)));
  const y = clamp(dy, -Math.min(...points.map(p => p.y)), 1 - Math.max(...points.map(p => p.y)));
  return points.map(point => ({ x: point.x + x, y: point.y + y }));
}

export function containsPoint(points, p) {
  return points.reduce((inside, a, i) => {
    const b = points[(i + 1) % points.length];
    const crosses = (a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x;
    return crosses ? !inside : inside;
  }, false);
}

export function makeZone(id, name, points = corners(0.18, 0.20, 0.82, 0.80)) {
  return { id, name, points, kind: 'quad', enabled: true, locked: false, opacity: 1, source: 'cue', baseSource: '',
    blend: 'source-over', feather: 0, stroke: 0, color: '#9ef2dc', follow: false };
}

export function makeMask(id, name, points = corners(0.40, 0.38, 0.60, 0.62)) {
  return { id, name, points, kind: 'quad', enabled: true, locked: false };
}

export function demoShow() {
  return {
    version: 1, name: 'Facade Study', loop: true, fade: 1.5, fallback: 'static',
    sensitivity: 1, threshold: 34, master: 1, snap: false, silhouette: structuredClone(defaultSilhouette), media: [],
    zones: [
      makeZone('west', 'West wing', [{ x: .105, y: .355 }, { x: .341, y: .321 }, { x: .341, y: .799 }, { x: .105, y: .768 }]),
      makeZone('center', 'Central hall', corners(.346, .211, .653, .803)),
      makeZone('east', 'East wing', [{ x: .658, y: .321 }, { x: .895, y: .355 }, { x: .895, y: .768 }, { x: .658, y: .799 }]),
    ],
    masks: [
      makeMask('west-window', 'West windows', corners(.159, .466, .272, .613)),
      makeMask('east-window', 'East windows', corners(.729, .466, .842, .613)),
      makeMask('central-door', 'Central entry', corners(.463, .635, .536, .802)),
    ],
    cues: [
      { id: 'opening', name: 'Facade study', source: 'film', duration: 10 },
      { id: 'dancer', name: 'Dancer silhouette', source: 'demo-dancer', duration: 12 },
      { id: 'pulse', name: 'Audio response', source: 'audio', duration: 10 },
      { id: 'hold', name: 'Static hold', source: 'static', duration: 6 },
    ],
  };
}

function readShape(item, shape, warnings) {
  const points = item.points;
  if (Array.isArray(points) && points.length >= 3 && points.length <= 64
    && points.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) {
    const clean = points.map(({ x, y }) => ({ x: clamp(x), y: clamp(y) }));
    if (item.kind !== 'polygon' && clean.length === 4) {
      if (isConvexQuad(clean)) { shape.points = clean; return; }
      const reversed = [clean[0], clean[3], clean[2], clean[1]];
      if (isConvexQuad(reversed)) { shape.points = reversed; return; }
    }
    if (isSimplePolygon(clean)) {
      shape.kind = 'polygon';
      shape.points = clean;
      return;
    }
  }
  warnings.add('An invalid shape was replaced with a four-corner rectangle.');
}

function normalizeSource(value, fallback, media, addMissing) {
  const id = label(value, fallback);
  if (legacySources.has(id)) return legacySources.get(id);
  if (stock.has(id) || id === 'cue' || media.has(id)) return id;
  addMissing(id);
  return id;
}

export function normalizeShow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a show JSON object.');
  const legacy = Array.isArray(input.surfaces) && input.version === undefined;
  if (!legacy && (input.version !== 1 || !Array.isArray(input.zones) || !Array.isArray(input.cues))) {
    throw new Error('Unrecognized show format. Open a Luma-Map show or a legacy project export.');
  }
  const warnings = new Set();
  const media = new Map();
  for (const item of Array.isArray(input.media) ? input.media : []) {
    if (typeof item?.id !== 'string' || !item.id.trim() || item.id.length > 160
      || item.id === 'cue' || legacySources.has(item.id) || stock.has(item.id) || media.has(item.id)) continue;
    media.set(item.id, {
      id: item.id, name: label(item.name, item.id),
      file: safeFilename(item.file) ? item.file : '',
      type: ['image', 'video', 'audio'].includes(item.type) ? item.type : '',
    });
  }
  const source = (value, fallback) => normalizeSource(value, fallback, media, id => {
    media.set(id, { id, name: id, file: '', type: '' });
    warnings.add('This show references media that must be relinked.');
  });
  const unique = (value, fallback, used) => {
    let id = label(value, fallback);
    while (used.has(id)) id += '-copy';
    used.add(id);
    return id;
  };
  const zoneIds = new Set();
  const zones = (legacy ? input.surfaces : input.zones).filter(item => item && typeof item === 'object').map((item, i) => {
    const zone = makeZone(unique(item.id, 'zone-' + (i + 1), zoneIds), label(item.name, 'Zone ' + (i + 1)));
    readShape(item, zone, warnings);
    zone.source = source(legacy ? item.mediaId : item.source, 'cue');
    zone.enabled = legacy ? item.visible !== false : item.enabled !== false;
    zone.opacity = number(item.opacity, 1, 0, 1);
    zone.locked = item.locked === true;
    zone.baseSource = item.baseSource ? source(item.baseSource, 'static') : '';
    const blend = legacy ? item.blendMode : item.blend;
    zone.blend = blendModes.includes(blend) ? blend : 'source-over';
    zone.feather = number(item.feather, 0, 0, 40);
    zone.stroke = number(legacy ? item.strokeWidth : item.stroke, 0, 0, 12);
    zone.color = color(legacy ? item.strokeColor : item.color, zone.color);
    zone.follow = (legacy ? item.followDancer : item.follow) === true;
    return zone;
  });
  const maskIds = new Set();
  const masks = (Array.isArray(input.masks) ? input.masks : []).filter(item => item && typeof item === 'object').map((item, i) => {
    const mask = makeMask(unique(item.id, 'mask-' + (i + 1), maskIds), label(item.name, 'Mask ' + (i + 1)));
    readShape(item, mask, warnings);
    mask.locked = item.locked === true;
    mask.enabled = item.enabled !== false;
    return mask;
  });
  const cueIds = new Set();
  const rawCues = legacy ? input.timeline?.cues : input.cues;
  const validCues = (Array.isArray(rawCues) ? rawCues : []).filter(item => item && typeof item === 'object');
  if (legacy) {
    validCues.sort((a, b) => number(a.startTime, 0, 0, 86400) - number(b.startTime, 0, 0, 86400));

  }
  const cues = validCues.map((item, i) => {
    const cueSource = source(legacy ? item.mediaId : item.source, 'static');
    return {
      id: unique(item.id, 'cue-' + (i + 1), cueIds), name: label(item.name, 'Cue ' + (i + 1)),
      source: cueSource === 'cue' ? 'static' : cueSource, duration: number(item.duration, 8, 0.1, 7200),
      ...(Number.isFinite(item.startTime) ? { startTime: number(item.startTime, 0, 0, 86400) } : {}),
    };
  });
  if (legacy && cues.length) {
    const preferred = zones.find(zone => zone.enabled && zone.id === input.selectedSurfaceId);
    const target = preferred ?? zones.find(zone => zone.enabled);
    if (target) {
      target.baseSource = target.source === 'cue' ? '' : target.source;
      target.source = 'cue';
      if (!preferred) warnings.add('Legacy timeline assigned to the first enabled zone.');
    }
  }
  const settings = input.silhouette ?? {};
  const roi = {
    x: number(settings.roi?.x, 0, 0, 95), y: number(settings.roi?.y, 0, 0, 95),
    width: number(settings.roi?.width, 100, 5, 100), height: number(settings.roi?.height, 100, 5, 100),
  };
  roi.width = Math.min(100 - roi.x, roi.width);
  roi.height = Math.min(100 - roi.y, roi.height);
  const silhouette = {
    overlay: settings.overlay === true,
    source: ['webcam', 'demo-dancer', 'file-dancer'].includes(settings.source) ? settings.source : 'demo-dancer',
    file: settings.file ? source(settings.file, '') : '', fill: settings.fill ? source(settings.fill, '') : '',
    opacity: number(settings.opacity, 1, 0, 1), feather: number(settings.feather, 3, 0, 20),
    invert: settings.invert === true, outline: number(settings.outline, 0, 0, 12),
    color: color(settings.color, defaultSilhouette.color), cameraKey: settings.cameraKey === 'luma' ? 'luma' : 'difference', roi,
  };
  const fallback = source(input.fallback, 'static');
  const safeFallback = fallback === 'static' || media.get(fallback)?.type === 'image' ? fallback : 'static';
  if (legacy) warnings.add('Legacy project imported. Original media files need to be selected separately.');
  return { show: {
    version: 1, name: label(input.name, legacy ? 'Imported legacy show' : 'Untitled show'),
    loop: (legacy ? input.timeline?.loop : input.loop) !== false,
    fade: number(legacy ? input.timeline?.lapDissolveDuration : input.fade, 1.5, 0, 12),
    fallback: safeFallback, sensitivity: number(input.sensitivity, 1, 0.1, 4),
    threshold: number(input.threshold, 34, 5, 240), master: number(input.master, 1, 0, 1),
    snap: input.snap === true, silhouette,
    ...(legacy && Number.isFinite(input.timeline?.duration) ? { timelineDuration: number(input.timeline.duration, 0, 0, 86400) }
      : Number.isFinite(input.timelineDuration) ? { timelineDuration: number(input.timelineDuration, 0, 0, 86400) } : {}),
    zones, masks, cues, media: [...media.values()],
  }, warnings: [...warnings] };
}

export const safeFilename = name => typeof name === 'string' && name.length <= 200
  && name !== '.' && name !== '..' && !/^[.]|[. ]$|[<>:"/\\|?*\u0000-\u001f]/.test(name) && Boolean(name);

export function classifyMedia(file) {
  const kind = file.type?.split('/')[0];
  if (['audio', 'image', 'video'].includes(kind) && file.type !== 'image/svg+xml') return kind;
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(file.name)) return 'image';
  if (/\.(mp4|webm|ogv|mov)$/i.test(file.name)) return 'video';
  if (/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file.name)) return 'audio';
  return '';
}

export function relinkMedia(item, file) {
  const type = classifyMedia(file);
  if (!type || (item.type && item.type !== type)) throw new Error('Select a compatible image, video or audio file.');
  return { ...item, type, name: item.file || item.type ? item.name : file.name };
}

export function bundleFilenames(media, files) {
  const reserved = new Set();
  return media.map((item, index) => {
    const file = files.get(item.id);
    const name = file?.name ?? item.file;
    if (!name) return { ...item, file: '' };
    let clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 150);
    if (!safeFilename(clean)) clean = 'media';
    let filename = String(index + 1).padStart(3, '0') + '-' + clean;
    while (reserved.has(filename.toLowerCase())) filename = '_' + filename;
    reserved.add(filename.toLowerCase());
    return { ...item, file: filename };
  });
}

export function cueStarts(cues) {
  let elapsed = 0;
  return cues.map(cue => {
    const start = cue.startTime ?? elapsed;
    elapsed = Math.max(elapsed, start + cue.duration);
    return start;
  });
}

export function timelineLength(cues, minimum = 0) {
  const starts = cueStarts(cues);
  return cues.reduce((length, cue, i) => Math.max(length, starts[i] + cue.duration), minimum);
}

export function cueAt(cues, seconds, fade, loop, minimum = 0) {
  if (!cues.length) return [];
  const starts = cueStarts(cues);
  const last = cues.length - 1;
  const total = timelineLength(cues, minimum);
  const time = loop ? ((seconds % total) + total) % total : clamp(seconds, 0, total);
  if (minimum > 0 || cues.some(cue => cue.startTime !== undefined)) {
    const active = cues.map((cue, index) => ({ cue, index, local: time - starts[index], opacity: 0 }))
      .filter(layer => layer.local >= 0 && layer.local <= layer.cue.duration);
    if (active.length > 1) {
      const newest = active.reduce((a, b) => starts[a.index] > starts[b.index] ? a : b);
      const previous = active.filter(layer => layer !== newest)
        .reduce((first, layer) => starts[layer.index] >= starts[first.index] ? layer : first);
      const overlap = starts[previous.index] + previous.cue.duration - starts[newest.index];
      const ramp = Math.min(fade, Math.max(0, overlap), newest.cue.duration / 2);
      const mix = ramp > 0 ? clamp(newest.local / ramp) : 1;
      previous.opacity = 1 - mix;
      newest.opacity = mix;
      return active.filter(layer => layer.opacity > 0);
    }
    const current = active[0];
    if (!current) {
      const upcoming = cues.map((cue, index) => ({ cue, index, distance: starts[index] - time }))
        .filter(layer => fade > 0 && layer.distance > 0 && layer.distance < fade)
        .sort((a, b) => a.distance - b.distance)[0];
      return upcoming ? [{ cue: upcoming.cue, index: upcoming.index, local: 0, opacity: 1 - upcoming.distance / fade }] : [];
    }
    const incoming = cues.map((cue, index) => ({ cue, index, distance: starts[index] - time }))
      .filter(layer => layer.index !== current.index && fade > 0 && layer.distance > 0 && layer.distance < fade
        && Math.abs(starts[layer.index] - starts[current.index] - current.cue.duration) < .000001)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!incoming) return [{ ...current, opacity: 1 }];
    const ramp = Math.min(fade, current.cue.duration / 2, incoming.cue.duration / 2);
    if (incoming.distance >= ramp) return [{ ...current, opacity: 1 }];
    const mix = 1 - incoming.distance / ramp;
    return [{ ...current, opacity: 1 - mix }, { cue: incoming.cue, index: incoming.index, local: 0, opacity: mix }];
  }
  const index = starts.findLastIndex(start => time >= start);
  const cue = cues[index];
  const nextIndex = index < last ? index + 1 : 0;
  const next = cues[nextIndex];
  const local = time - starts[index];
  const window = nextIndex === index || (index === last && !loop) ? 0
    : Math.min(fade, cue.duration / 2, next.duration / 2);
  const intoFade = local - cue.duration + window;
  if (!window || intoFade <= 0) return [{ cue, opacity: 1, local, index }];
  const mix = clamp(intoFade / window);
  return [
    { cue, opacity: 1 - mix, local, index },
    { cue: next, opacity: mix, local: 0, index: nextIndex },
  ];
}

export function fallbackNeeded(layers, zones, isReady) {
  for (const zone of zones) {
    if (!zone.enabled || zone.opacity <= 0) continue;
    for (const layer of layers) {
      if (layer.opacity > 0 && !isReady(zone.source === 'cue' ? (layer.cue?.source ?? zone.baseSource) : zone.source)) return true;
    }
  }
  return false;
}
