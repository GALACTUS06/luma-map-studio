import { sources, clamp, validShape, containsPoint, moveShape, shapePoints, makeZone, makeMask, demoShow,
  normalizeShow, classifyMedia, relinkMedia, cueStarts, cueAt, timelineLength, fallbackNeeded, defaultRoi } from './show.js';
import { WIDTH, HEIGHT, createRenderer } from './render.js';
import { createLiveInputs } from './live.js';
import { releaseAsset, loadAsset, prepareAudio, syncAssets, readBundle, writeBundle } from './media.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const assets = new Map();
const state = {
  show: demoShow(), mapping: 'zone:west', cue: 'opening', time: 0, playing: false,
  blackout: false, grid: false, guides: true, audioInput: 'demo', audition: false,
};
let projection;
let drag;
let draft;
const pinDefaults = new WeakMap();
const dancerSources = ['demo-dancer', 'webcam', 'file-dancer'];
let relinkId;
let busy = false;
let closing = false;
let prevTime;
let drawnAt = -Infinity;
let nextUi = 0;
let mode = 'program';
let programOrigin = performance.now();

const inputs = createLiveInputs((source, message) => {
  const isCamera = source === 'camera';
  $(isCamera ? 'camera-status' : 'mic-status').textContent = message;
  const connected = isCamera ? inputs.cameraConnected() : inputs.microphoneConnected();
  const pending = message.startsWith('Waiting');
  const button = $(isCamera ? 'enable-camera' : 'enable-microphone');
  const noun = isCamera ? 'camera' : 'microphone';
  button.textContent = pending ? 'Cancel ' + noun : (connected ? 'Disconnect ' : 'Connect ') + noun;
  button.dataset.pending = String(pending);
  if (isCamera) {
    $('capture-background').disabled = !connected || pending;
    $('clear-background').disabled = !connected || pending;
  }
  drawnAt = -Infinity;
  tick();
});
const renderer = createRenderer(stage, assets, inputs);
const cornerNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const cueColors = ['#91dbc8', '#e9bb82', '#b6a7f0', '#9dbbd0'];
const shapeGroups = [['zone', 'Zone', 'zones'], ['mask', 'Mask', 'masks']];
const statement = message => { $('feedback').textContent = message; };
const press = (button, value) => $(button).setAttribute('aria-pressed', String(value));
const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
const selectedCue = () => state.show.cues.find(cue => cue.id === state.cue);
const selection = () => {
  const [kind, ...parts] = (state.mapping ?? '').split(':');
  const group = state.show[kind === 'zone' ? 'zones' : 'masks'];
  return { kind, group, item: group.find(item => item.id === parts.join(':')) };
};
const duration = () => timelineLength(state.show.cues, state.show.timelineDuration);
const layersAt = (fade = state.show.fade) => {
  const cue = state.manual ? selectedCue() : undefined;
  return cue ? [{ cue, index: state.show.cues.indexOf(cue), opacity: 1, local: 0 }]
    : cueAt(state.show.cues, state.time, fade, state.show.loop, state.show.timelineDuration);
};
const assetTitle = (id, item) => (assets.get(id)?.failed ? 'Unreadable · ' : assets.has(id) ? '' : 'Missing · ') + item.name;
const sourceOptions = () => [...sources, ...state.show.media.map(item => [item.id, assetTitle(item.id, item)])];

function options(select, entries, current) {
  select.replaceChildren(...entries.map(([id, title]) => new Option(title, id)));
  if (current !== undefined) select.value = current;
}

function refreshShapeList() {
  const entries = shapeGroups.flatMap(([key, label, group]) =>
    state.show[group].map(item => [key + ':' + item.id, label + ' · ' + item.name]));
  if (!entries.some(([key]) => key === state.mapping)) state.mapping = entries[0]?.[0];
  options($('mapping-select'), entries.length ? entries : [['', 'No shapes']], state.mapping);
  $('mapping-select').disabled = !entries.length;
}

function refreshMapping() {
  const { kind, item } = selection();
  $('mapping-fields').hidden = !item;
  if (!item) return;
  $('shape-name').value = item.name;
  $('shape-enabled').checked = item.enabled;
  $('shape-locked').checked = item.locked;
  $('reset-pins').disabled = item.locked;
  for (const element of document.querySelectorAll('.zone-only')) element.hidden = kind !== 'zone';
  if (kind === 'zone') {
    options($('zone-source'), [['cue', 'Follow cue timeline'], ...sourceOptions()], item.source);
    for (const key of ['opacity', 'blend', 'feather', 'stroke', 'color']) $('zone-' + key).value = item[key];
    $('zone-follow').checked = item.follow;
  }
  buildCorners(item);
  syncCorners();
}

function syncCorners() {
  const { item } = selection();
  item?.points.forEach((point, index) => {
    for (const axis of ['x', 'y']) $('corner-' + index + '-' + axis).value = +(point[axis] * 100).toFixed(3);
  });
}

function cornerEdit(index, axis, input) {
  const { item } = selection();
  if (!item || item.locked) return;
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) { syncCorners(); return; }
  const points = item.points.map((point, i) => index === i ? { ...point, [axis]: clamp(value / 100) } : point);
  if (!validShape(points, item.kind)) statement('Pins must form a non-intersecting shape. Quads must stay convex.');
  else item.points = points;
  syncCorners();
  redraw();
}

function buildCorners(item) {
  $('corners').replaceChildren();
  for (let index = 0; index < item.points.length; index++) {
    const name = item.kind === 'quad' ? cornerNames[index] : 'Pin ' + (index + 1);
    const row = document.createElement('div');
    row.className = 'corner-row';
    const caption = document.createElement('span');
    caption.textContent = name;
    row.append(caption);
    for (const axis of ['x', 'y']) {
      const input = document.createElement('input');
      input.id = 'corner-' + index + '-' + axis;
      input.type = 'number';
      input.min = 0;
      input.max = 100;
      input.step = '.1';
      input.disabled = item.locked;
      const title = name + ' ' + axis.toUpperCase() + ' (%)';
      input.setAttribute('aria-label', title);
      input.title = title;
      input.addEventListener('change', () => cornerEdit(index, axis, input));
      row.append(input);
    }
    $('corners').append(row);
  }
}

function refreshCues() {
  const { cues } = state.show;
  const starts = cueStarts(cues);
  const focus = document.activeElement?.dataset.cue;
  $('cue-lane').replaceChildren(...cues.map((cue, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cue = cue.id;
    button.style.flex = cue.duration + ' 0 0';
    button.style.setProperty('--cue-color', cueColors[i % cueColors.length]);
    button.textContent = cue.name;
    const time = document.createElement('span');
    time.textContent = clock(starts[i]) + ' · ' + cue.duration + 's';
    button.append(time);
    button.addEventListener('click', () => selectCue(i));
    return button;
  }));
  if (focus) [...$('cue-lane').children].find(button => button.dataset.cue === focus)?.focus();
  $('seek').max = duration();
  $('seek').disabled = !cues.length;
  $('play').disabled = !cues.length;
  $('stop').disabled = !cues.length;
  $('previous-cue').disabled = !cues.length;
  $('next-cue').disabled = !cues.length;
  let cue = selectedCue();
  if (!cue) {
    cue = cues[0];
    state.cue = cue?.id;
  }
  refreshCueFields();
  refreshTransport();
}

function refreshCueFields() {
  const cue = selectedCue();
  const index = state.show.cues.indexOf(cue);
  $('cue-name').value = cue?.name ?? '';
  $('cue-duration').value = cue?.duration ?? '';
  $('cue-start').value = cue?.startTime ?? '';
  options($('cue-source'), sourceOptions(), cue?.source);
  for (const id of ['cue-name', 'cue-duration', 'cue-start', 'cue-source', 'remove-cue']) $(id).disabled = !cue;
  $('move-cue-earlier').disabled = index < 1;
  $('move-cue-later').disabled = index === -1 || index >= state.show.cues.length - 1;
}

function refreshMedia() {
  const media = state.show.media.filter(item => item.type !== 'audio' || !item.type)
    .map(item => [item.id, assetTitle(item.id, item)]);
  options($('sil-file'), [['', 'Select an image or video'], ...media], state.show.silhouette.file);
  const builtInFills = sources.filter(([id]) => !dancerSources.includes(id) && id !== 'audio');
  options($('sil-fill'), [['', 'Solid gold'], ...builtInFills, ...media], state.show.silhouette.fill);
  options($('fallback-source'), [['static', 'Built-in still'], ...state.show.media
    .filter(item => item.type === 'image').map(item => [item.id, assetTitle(item.id, item)])], state.show.fallback);
  const list = $('media-list');
  list.replaceChildren();
  if (!state.show.media.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No imported media. The built-in show is ready.';
    list.append(empty);
  }
  for (const item of state.show.media) {
    const entry = document.createElement('li');
    const title = document.createElement('span');
    const asset = assets.get(item.id);
    title.textContent = assetTitle(item.id, item) + (asset && !asset.failed && !asset.ready ? ' · Loading' : '');
    const relink = document.createElement('button');
    relink.textContent = 'Relink';
    relink.setAttribute('aria-label', 'Relink ' + item.name);
    relink.addEventListener('click', () => {
      relinkId = item.id;
      $('relink-file').click();
    });
    entry.append(title, relink);
    list.append(entry);
  }
}

function refreshShow() {
  const { show } = state;
  $('show-name').value = show.name;
  $('fade').value = show.fade;
  $('loop').checked = show.loop;
  $('threshold').value = show.threshold;
  $('sensitivity').value = show.sensitivity;
  $('master-opacity').value = show.master;
  $('snap-grid').checked = show.snap;
  for (const key of ['source', 'opacity', 'feather', 'outline', 'color']) $('sil-' + key).value = show.silhouette[key];
  $('camera-key').value = show.silhouette.cameraKey;
  for (const key of ['overlay', 'invert']) $('sil-' + key).checked = show.silhouette[key];
  refreshRoi();
  refreshShapeList();
  refreshMapping();
  refreshMedia();
  refreshCues();
  redraw();
}

function refreshSources() {
  const { kind, item } = selection();
  if (kind === 'zone' && item) {
    options($('zone-source'), [['cue', 'Follow cue timeline'], ...sourceOptions()], item.source);
  }
  if (selectedCue()) options($('cue-source'), sourceOptions(), selectedCue().source);
  refreshMedia();
  redraw();
}

function listen(id, event, handler) { $(id).addEventListener(event, handler); }
listen('show-name', 'change', event => {
  state.show.name = event.target.value.trim() || 'Untitled show';
  event.target.value = state.show.name;
});
listen('mapping-select', 'change', event => { state.mapping = event.target.value; refreshMapping(); redraw(); });
listen('shape-name', 'change', event => {
  const { item } = selection();
  if (!item) return;
  item.name = event.target.value.trim() || item.name;
  event.target.value = item.name;
  refreshShapeList();
});
listen('shape-enabled', 'change', event => { selection().item.enabled = event.target.checked; redraw(); });
listen('zone-source', 'change', event => { selection().item.source = event.target.value; prepareProgramAudio(); redraw(); });
for (const key of ['opacity', 'blend', 'feather', 'stroke', 'color', 'follow']) {
  listen('zone-' + key, 'input', event => {
    const field = event.target;
    const value = field.type === 'checkbox' ? field.checked : field.type === 'range' || field.type === 'number'
      ? field.valueAsNumber : field.value;
    if (Number.isNaN(value)) return;
    selection().item[key] = key === 'stroke' ? clamp(value, 0, 12) : value;
    redraw();
  });
}
listen('master-opacity', 'input', event => { state.show.master = event.target.valueAsNumber; redraw(); });
listen('snap-grid', 'change', event => { state.show.snap = event.target.checked; });
listen('shape-locked', 'change', event => { selection().item.locked = event.target.checked; refreshMapping(); redraw(); });
listen('reset-pins', 'click', () => {
  const { item } = selection();
  if (!item || item.locked) return;
  item.points = structuredClone(pinDefaults.get(item) ?? item.points);
  syncCorners();
  redraw();
});
listen('remove-shape', 'click', () => {
  const { group, item } = selection();
  if (!item) return;
  group.splice(group.indexOf(item), 1);
  refreshShapeList();
  refreshMapping();
  redraw();
});

function addShape(kind, points, shape) {
  const [, name, group] = shapeGroups.find(entry => entry[0] === kind);
  const items = state.show[group];
  const item = (kind === 'zone' ? makeZone : makeMask)(crypto.randomUUID(), name + ' ' + (items.length + 1), points);
  item.kind = shape === 'quad' ? 'quad' : 'polygon';
  pinDefaults.set(item, structuredClone(points));
  items.push(item);
  state.mapping = kind + ':' + item.id;
  state.guides = true;
  press('guides', true);
  refreshShapeList();
  refreshMapping();
  redraw();
}

function updateDraft() {
  $('draft-toolbar').hidden = !draft;
  if (draft) {
    $('draft-status').textContent = draft.points.length + ' pins. Click the canvas to plot points.';
    $('finish-polygon').disabled = !validShape(draft.points, 'polygon');
  }
  redraw();
}

function finishDraft() {
  if (!draft || !validShape(draft.points, 'polygon')) return;
  const { kind, points } = draft;
  draft = undefined;
  addShape(kind, points, 'polygon');
  updateDraft();
}

for (const [kind] of shapeGroups) {
  listen('add-' + kind, 'click', () => {
    const shape = $('shape-tool').value;
    if (shape === 'polygon') {
      draft = { kind, points: [] };
      state.guides = true;
      press('guides', true);
      updateDraft();
    } else {
      draft = undefined;
      addShape(kind, shapePoints(shape, kind === 'mask'), shape);
      updateDraft();
    }
  });
}
listen('finish-polygon', 'click', finishDraft);
listen('cancel-polygon', 'click', () => { draft = undefined; updateDraft(); });

function pointerPoint(event) {
  const bounds = stage.getBoundingClientRect();
  const x = clamp((event.clientX - bounds.left) / bounds.width);
  const y = clamp((event.clientY - bounds.top) / bounds.height);
  return { x, y, bounds };
}

const snapped = ({ x, y }) => state.show.snap ? { x: Math.round(x * 16) / 16, y: Math.round(y * 12) / 12 } : { x, y };
const pixelDistance = (a, b, bounds) => Math.hypot((a.x - b.x) * bounds.width, (a.y - b.y) * bounds.height);

stage.addEventListener('pointerdown', event => {
  if (!state.guides || state.blackout || event.button !== 0) return;
  const position = pointerPoint(event);
  if (draft) {
    const first = draft.points[0];
    if (first && draft.points.length >= 3 && pixelDistance(first, position, position.bounds) <= 12) finishDraft();
    else if (draft.points.length < 64) {
      const pin = snapped(position);
      const last = draft.points.at(-1);
      if (!last || last.x !== pin.x || last.y !== pin.y) draft.points.push(pin);
      updateDraft();
    }
    return;
  }
  let { item } = selection();
  let index = item?.points.findIndex(point => pixelDistance(point, position, position.bounds) <= 12) ?? -1;
  if (index === -1 && (!item || !containsPoint(item.points, position))) {
    const layers = [...state.show.masks].reverse().map(shape => ['mask', shape])
      .concat([...state.show.zones].reverse().map(shape => ['zone', shape]));
    const hit = layers.find(([, shape]) => shape.enabled && containsPoint(shape.points, position));
    if (!hit) return;
    item = hit[1];
    state.mapping = hit[0] + ':' + item.id;
    $('mapping-select').value = state.mapping;
    refreshMapping();
    redraw();
  }
  if (!item || item.locked) return;
  stage.setPointerCapture(event.pointerId);
  drag = { item, index, origin: position, points: item.points, pointer: event.pointerId };
});
stage.addEventListener('pointermove', event => {
  const position = pointerPoint(event);
  if (draft) { draft.cursor = snapped(position); redraw(); return; }
  if (!drag || drag.pointer !== event.pointerId) return;
  const { item, index, origin } = drag;
  const at = snapped(position);
  const distance = snapped({ x: position.x - origin.x, y: position.y - origin.y });
  const points = index < 0 ? moveShape(drag.points, distance.x, distance.y)
    : item.points.map((point, i) => index === i ? at : point);
  if (!validShape(points, item.kind)) return;
  item.points = points;
  syncCorners();
  redraw();
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stage.addEventListener(eventName, event => { if (drag?.pointer === event.pointerId) drag = undefined; });
}

function prepareProgramAudio() {
  for (const asset of assets.values()) {
    asset.blocked = false;
    if (asset.type === 'audio') {
      try { prepareAudio(asset, inputs.audioEngine()); }
      catch { statement('Web Audio is unavailable. Imported audio response may be inactive.'); }
    }
  }
}

function setPlaying(playing) {
  state.playing = playing;
  prevTime = performance.now();
  programOrigin = prevTime;
  if (playing) {
    state.manual = false;
    if (!state.show.loop && state.time >= duration()) state.time = 0;
    prepareProgramAudio();
  }
  refreshTransport();
  redraw();
}

function selectCue(index) {
  const { cues } = state.show;
  if (!cues.length) return;
  const target = (index + cues.length) % cues.length;
  state.cue = cues[target].id;
  state.manual = true;
  state.time = cueStarts(cues)[target];
  programOrigin = performance.now();
  refreshCueFields();
  setPlaying(false);
}

function currentIndex() {
  return layersAt(0)[0]?.index ?? state.show.cues.indexOf(selectedCue());
}

function refreshTransport() {
  const layers = layersAt();
  const current = layers[0]?.cue;
  if (current && current.id !== state.cue && !state.manual) {
    state.cue = current.id;
    refreshCueFields();
  }
  for (const element of $('cue-lane').children) {
    element.setAttribute('aria-pressed', String(element.dataset.cue === state.cue));
  }
  $('seek').value = state.time;
  setText('time', clock(state.time) + ' / ' + clock(duration()));
  setText('cue-status', layers.length > 1 ? current.name + ' → ' + layers[1].cue.name : current?.name ?? (state.show.cues.length ? 'Timeline gap' : 'No cues'));
  press('play', state.playing);
  setText('play', state.playing ? 'Pause' : 'Play');
}

function clock(seconds) {
  const total = Math.floor(seconds);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

listen('play', 'click', () => setPlaying(!state.playing));
listen('stop', 'click', () => { state.manual = false; state.time = 0; setPlaying(false); });
listen('previous-cue', 'click', () => selectCue(currentIndex() - 1));
listen('next-cue', 'click', () => selectCue(currentIndex() + 1));
listen('seek', 'input', event => {
  state.manual = false;
  state.time = event.target.valueAsNumber;
  setPlaying(false);
});
listen('loop', 'change', event => { state.show.loop = event.target.checked; refreshTransport(); redraw(); });
listen('fade', 'change', event => {
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) state.show.fade = clamp(value, 0, 12);
  event.target.value = state.show.fade;
  refreshTransport();
  redraw();
});
listen('cue-name', 'change', event => {
  const cue = selectedCue();
  cue.name = event.target.value.trim() || cue.name;
  refreshCues();
});
listen('cue-source', 'change', event => {
  selectedCue().source = event.target.value;
  prepareProgramAudio();
  redraw();
});
listen('cue-start', 'change', event => {
  const cue = selectedCue();
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) cue.startTime = clamp(value, 0, 86400);
  else delete cue.startTime;
  selectCue(state.show.cues.indexOf(cue));
  refreshCues();
});
listen('cue-duration', 'change', event => {
  const cue = selectedCue();
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) cue.duration = clamp(value, .1, 7200);
  selectCue(state.show.cues.indexOf(cue));
  refreshCues();
});
listen('add-cue', 'click', () => {
  const { cues } = state.show;
  cues.push({ id: crypto.randomUUID(), name: 'Cue ' + (cues.length + 1), source: 'static', duration: 8 });
  selectCue(cues.length - 1);
  refreshCues();
});
listen('remove-cue', 'click', () => {
  const { cues } = state.show;
  const index = cues.indexOf(selectedCue());
  if (index === -1) return;
  cues.splice(index, 1);
  if (cues.length) selectCue(Math.min(index, cues.length - 1));
  else { state.time = 0; state.cue = undefined; setPlaying(false); }
  refreshCues();
});
for (const [button, direction] of [['move-cue-earlier', -1], ['move-cue-later', 1]]) {
  listen(button, 'click', () => {
    const { cues } = state.show;
    const index = cues.indexOf(selectedCue());
    const target = index + direction;
    if (index < 0 || target < 0 || target >= cues.length) return;
    const [cue] = cues.splice(index, 1);
    cues.splice(target, 0, cue);
    selectCue(target);
    refreshCues();
  });
}

listen('enable-camera', 'click', event => {
  if (inputs.cameraConnected() || event.currentTarget.dataset.pending === 'true') inputs.stopCamera();
  else void inputs.connectCamera();
});
listen('capture-background', 'click', () => {
  if (!inputs.captureBackground()) statement('Wait for a camera frame before capturing the empty stage.');
  else statement('Empty stage captured. Select Live camera as a cue or zone source.');
});
listen('clear-background', 'click', () => inputs.clearBackground());

function refreshRoi() {
  for (const [key, value] of Object.entries(state.show.silhouette.roi)) $('roi-' + key).value = value;
}

for (const key of ['x', 'y', 'width', 'height']) {
  listen('roi-' + key, 'change', event => {
    const { roi } = state.show.silhouette;
    const value = event.target.valueAsNumber;
    if (Number.isFinite(value)) roi[key] = ['x', 'y'].includes(key) ? clamp(value, 0, 95) : clamp(value, 5, 100);
    roi.width = Math.min(roi.width, 100 - roi.x);
    roi.height = Math.min(roi.height, 100 - roi.y);
    refreshRoi();
    redraw();
  });
}
listen('reset-roi', 'click', () => { state.show.silhouette.roi = { ...defaultRoi }; refreshRoi(); redraw(); });
listen('show-monitor', 'change', event => { $('monitor-panel').hidden = !event.target.checked; redraw(); });
listen('monitor-view', 'change', redraw);
listen('camera-key', 'change', event => { state.show.silhouette.cameraKey = event.target.value; redraw(); });
for (const key of ['source', 'opacity', 'feather', 'outline', 'color', 'overlay', 'invert', 'file', 'fill']) {
  listen('sil-' + key, 'input', event => {
    const field = event.target;
    const value = field.type === 'checkbox' ? field.checked : field.type === 'range' || field.type === 'number'
      ? field.valueAsNumber : field.value;
    if (Number.isNaN(value)) return;
    state.show.silhouette[key] = key === 'outline' ? clamp(value, 0, 12) : value;
    redraw();
  });
}
listen('enable-microphone', 'click', event => {
  if (inputs.microphoneConnected() || event.currentTarget.dataset.pending === 'true') inputs.stopMic();
  else {
    state.audioInput = 'microphone';
    $('audio-input').value = 'microphone';
    void inputs.connectMic();
  }
});
listen('audio-input', 'change', event => { state.audioInput = event.target.value; redraw(); });
listen('demo-audio', 'click', async () => {
  try {
    await inputs.setAudition(!state.audition);
    state.audition = !state.audition;
    press('demo-audio', state.audition);
  } catch { statement('The demo audio file could not be played.'); }
});
listen('threshold', 'input', event => { state.show.threshold = event.target.valueAsNumber; redraw(); });
listen('sensitivity', 'input', event => { state.show.sensitivity = event.target.valueAsNumber; redraw(); });
listen('fallback-source', 'change', event => { state.show.fallback = event.target.value; redraw(); });

function addAsset(id, file, type) {
  if (assets.has(id)) releaseAsset(assets.get(id));
  assets.set(id, loadAsset(file, type, refreshSources));
}

listen('import-media', 'click', () => $('media-files').click());
function importFiles(files) {
  const rejected = [];
  for (const file of files) {
    const type = classifyMedia(file);
    if (!type) { rejected.push(file.name); continue; }
    const id = crypto.randomUUID();
    state.show.media.push({ id, name: file.name, file: '', type });
    addAsset(id, file, type);
  }
  if (rejected.length) statement('Unsupported media skipped · ' + rejected.join(', '));
  prepareProgramAudio();
  refreshSources();
}
listen('media-files', 'change', event => {
  importFiles([...event.target.files]);
  event.target.value = '';
});
listen('media-drop', 'dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.currentTarget.dataset.active = 'true';
  event.dataTransfer.dropEffect = 'copy';
});
listen('media-drop', 'dragleave', event => { event.currentTarget.dataset.active = 'false'; });
listen('media-drop', 'drop', event => {
  event.preventDefault();
  event.currentTarget.dataset.active = 'false';
  importFiles([...event.dataTransfer.files]);
});
listen('relink-file', 'change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  const index = state.show.media.findIndex(item => item.id === relinkId);
  if (!file || index < 0) return;
  try {
    const item = relinkMedia(state.show.media[index], file);
    state.show.media[index] = item;
    addAsset(item.id, file, item.type);
    prepareProgramAudio();
    refreshSources();
    statement('Relinked ' + item.name + '. Save the show to copy this file into the bundle.');
  } catch (error) { statement(error.message); }
});

function adoptShow(show, files = new Map()) {
  state.playing = false;
  state.manual = false;
  state.time = 0;
  draft = undefined;
  drag = undefined;
  $('draft-toolbar').hidden = true;
  state.mapping = undefined;
  state.cue = show.cues[0]?.id;
  state.show = show;
  for (const item of [...show.zones, ...show.masks]) pinDefaults.set(item, structuredClone(item.points));
  state.grid = false;
  programOrigin = performance.now();
  press('calibration', false);
  for (const asset of assets.values()) releaseAsset(asset);
  assets.clear();
  renderer.clearTextures();
  for (const [id, file] of files) addAsset(id, file, show.media.find(item => item.id === id).type);
  refreshShow();
}

const nonemptyNotice = warnings => warnings.length ? ' ' + [...new Set(warnings)].join(' ') : '';
const fileOptions = ['open-show', 'save-show', 'open-json', 'download-json', 'load-example'];

async function fileTask(task) {
  if (busy) return;
  busy = true;
  fileOptions.forEach(id => { $(id).disabled = true; });
  try { await task(); }
  catch (error) { if (error.name !== 'AbortError') statement(error.message); }
  finally {
    busy = false;
    fileOptions.forEach(id => { $(id).disabled = false; });
  }
}

listen('open-show', 'click', () => {
  if (!window.showDirectoryPicker) { $('json-file').click(); return; }
  void fileTask(async () => {
    let folder;
    try { folder = await showDirectoryPicker({ mode: 'read', id: 'luma-open' }); }
    catch (error) {
      if (error.name === 'SecurityError') throw new Error('Folder access is blocked. Use Import JSON in More file options.');
      throw error;
    }
    const { show, files, warnings } = await readBundle(folder, normalizeShow);
    adoptShow(show, files);
    const missing = show.media.length - files.size;
    statement('Opened ' + show.name + '.' + (missing ? ' Relink ' + missing + ' missing media file(s).' : '') + nonemptyNotice(warnings));
  });
});
listen('save-show', 'click', () => {
  if (!window.showDirectoryPicker) {
    statement('Folder saving needs a supported desktop browser such as Chrome or Edge on HTTPS or localhost. Download JSON is available in More file options.');
    return;
  }
  void fileTask(async () => {
    const folder = await showDirectoryPicker({ mode: 'readwrite', id: 'luma-save' });
    const files = new Map([...assets].map(([id, asset]) => [id, asset.file]));
    const show = await writeBundle(folder, state.show, files);
    const missing = show.media.length - files.size;
    statement('Saved show.json and media/ to ' + folder.name + '.' + (missing ? ' Relink ' + missing + ' missing media file(s) to complete the bundle.' : ''));
  });
});
listen('open-json', 'click', () => $('json-file').click());
listen('json-file', 'change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  void fileTask(async () => {
    const { show, warnings } = normalizeShow(JSON.parse(await file.text()));
    adoptShow(show);
    statement('Imported ' + show.name + '.' + (show.media.length ? ' Use Relink to select its local media.' : '') + nonemptyNotice(warnings));
  });
});
listen('download-json', 'click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.show, null, 2)], { type: 'application/json' }));
  const download = document.createElement('a');
  download.href = url;
  download.download = 'show.json';
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  statement('Downloaded show.json. Keep the original media files for relinking.');
});
listen('load-example', 'click', () => {
  adoptShow(demoShow());
  state.audioInput = 'demo';
  $('audio-input').value = 'demo';
  statement('Loaded the offline example.');
});

function setBlackout() {
  state.blackout = !state.blackout;
  press('blackout', state.blackout);
  nextUi = 0;
  if (state.blackout) {
    renderer.blank();
    try { projection?.lumaProjectionBlank?.(); }
    catch { /* The projection window may be navigating or closing. */ }
  }
  redraw();
}

listen('blackout', 'click', setBlackout);
listen('calibration', 'click', () => {
  state.grid = !state.grid;
  press('calibration', state.grid);
  redraw();
});
listen('guides', 'click', () => {
  state.guides = !state.guides;
  press('guides', state.guides);
  redraw();
});
listen('open-projection', 'click', () => {
  if (projection && !projection.closed) { projection.focus(); return; }
  projection = window.open('projection.html', 'luma-map-projection', 'popup,width=960,height=540');
  if (!projection) statement('Allow popups for localhost, then open projection again.');
  else statement('Move the projection window to the display. Click it or press F for fullscreen.');
  redraw();
});
window.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,select,textarea,[contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key === 'b') setBlackout();
  if (key === 'g') $('calibration').click();
  if (key === 's') { state.show.snap = !state.show.snap; $('snap-grid').checked = state.show.snap; }
  if (key === 'enter' && draft && event.target.tagName !== 'BUTTON') finishDraft();
  if (key === 'escape' && draft) { draft = undefined; updateDraft(); }
});

function redraw() {
  drawnAt = -Infinity;
  tick();
}

function tick() {
  if (closing) return;
  const now = performance.now();
  if (now - drawnAt < 32) return;
  drawnAt = now;
  if (state.playing && prevTime !== undefined) {
    state.time += (now - prevTime) / 1000;
    const length = duration();
    if (state.time >= length) {
      state.time = state.show.loop && length ? state.time % length : length;
      if (!state.show.loop || !length) state.playing = false;
    }
  }
  prevTime = now;
  const { show } = state;
  const layers = layersAt();
  const active = new Map();
  const showDancer = show.silhouette.overlay && show.silhouette.opacity > 0;
  const monitor = $('silhouette-controls').open && !$('monitor-panel').hidden;
  const follow = show.zones.some(zone => zone.enabled && zone.follow);
  const { source, file, fill, roi, cameraKey } = show.silhouette;
  const clock = (now - programOrigin) / 1000;
  const dancerTime = state.playing ? state.time : state.time + clock;
  for (const zone of show.zones) {
    if (!zone.enabled || !zone.opacity) continue;
    if (zone.source === 'cue') {
      const covered = layers.reduce((sum, layer) => sum + layer.opacity, 0);
      if (zone.baseSource && covered < 1) active.set(zone.baseSource, state.time);
      for (const { cue, opacity, local } of layers) {
        if (opacity > 0 && !active.has(cue.source)) active.set(cue.source, local);
      }
    } else active.set(zone.source, state.time);
  }
  const visibleDancers = [...active.keys()].filter(id => dancerSources.includes(id));
  const trackingSource = showDancer ? source : visibleDancers[0] ?? source;
  if (showDancer) visibleDancers.push(source);
  const movingSilhouetteMedia = new Set();
  if (file && (visibleDancers.includes('file-dancer') || ((monitor || follow) && trackingSource === 'file-dancer')) && !active.has(file)) {
    active.set(file, dancerTime);
    movingSilhouetteMedia.add(file);
  }
  if (visibleDancers.length && fill && !active.has(fill)) {
    active.set(fill, dancerTime);
    movingSilhouetteMedia.add(fill);
  }
  inputs.updateCamera(now, show.threshold, visibleDancers.includes('webcam') || ((monitor || follow) && trackingSource === 'webcam'), roi, cameraKey);
  const assetReady = id => {
    const asset = assets.get(id);
    return asset?.ready && !asset.failed && !asset.blocked;
  };
  const sourceReady = id => {
    const fillReady = !fill || !show.media.some(item => item.id === fill) || assetReady(fill);
    if (dancerSources.includes(id) && !fillReady) return false;
    if (id === 'webcam') return inputs.cameraReady(now, cameraKey);
    if (id === 'file-dancer') return Boolean(file && assetReady(file));
    if (id === 'static') return true;
    if (id === 'audio' && state.audioInput === 'microphone') return inputs.microphoneReady();
    const entry = show.media.find(item => item.id === id);
    if (!entry) return true;
    return assetReady(id);
  };
  const fallback = (showDancer && !sourceReady(source)) || fallbackNeeded(layers.length ? layers : [{ opacity: 1 }], show.zones,
    id => !id || sourceReady(id)) || [...active.keys()].some(id => id && !sourceReady(id)
      && id !== file && id !== fill);
  mode = state.blackout ? 'blackout' : state.grid ? 'grid' : fallback ? 'fallback' : 'program';
  syncAssets(assets, active, state.playing, show.sensitivity, state.blackout ? undefined : movingSilhouetteMedia);
  const bands = inputs.levels(state.audioInput, now).map(value => clamp(value * show.sensitivity));
  const playingLayers = layers.map(layer => ({
    ...layer,
    local: !state.playing && !['film', 'static'].includes(layer.cue.source) && !assets.has(layer.cue.source)
      ? layer.local + (now - programOrigin) / 1000 : layer.local,
  }));
  const fallbackShow = mode === 'fallback' && !sourceReady(show.fallback) ? { ...show, fallback: 'static' } : show;
  renderer.clean(fallbackShow, playingLayers, mode, bands, dancerTime, trackingSource);
  renderer.operator(show, selection().item, state.guides, mode, draft);
  if (now >= nextUi) {
    nextUi = now + 100;
    refreshTransport();
    setText('projection-status', projection && !projection.closed ? 'Output open' : 'Output closed');
    $('projection-status').dataset.state = projection && !projection.closed ? 'live' : '';
    const message = { blackout: 'Blackout active', grid: 'Calibration grid', fallback: 'Static fallback · input unavailable',
      program: state.playing ? 'Playing' : 'Cue ready' }[mode];
    setText('stage-status', message);
    $('stage-status').dataset.state = mode === 'blackout' || mode === 'fallback' ? 'alert' : mode === 'program' ? 'live' : '';
    if (monitor) {
      renderer.monitor($('dancer-monitor'), trackingSource, dancerTime, show, $('monitor-view').value);
      const { x, y, present } = renderer.centroid();
      setText('centroid-status', present ? 'Centroid ' + Math.round(x * 100) + '%, ' + Math.round(y * 100) + '%' : 'No subject');
    }
    const meters = ['bass-level', 'mid-level', 'high-level'];
    meters.forEach((id, index) => { $(id).value = bands[index]; });
  }
}

window.lumaMapOutput = {
  frame() { tick(); return renderer.output; },
  blackout: setBlackout,
};
window.addEventListener('pagehide', () => {
  closing = true;
  renderer.blank();
  try { projection?.lumaProjectionBlank?.(); }
  catch { /* The window is closing. */ }
  inputs.close();
});
function animate() { tick(); requestAnimationFrame(animate); }
for (const item of [...state.show.zones, ...state.show.masks]) pinDefaults.set(item, structuredClone(item.points));
refreshShow();
$('open-projection').disabled = $('blackout').disabled = false;
requestAnimationFrame(animate);
