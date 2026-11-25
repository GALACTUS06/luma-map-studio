import { bundleFilenames, relinkMedia, safeFilename } from './show.js';
import { newAnalyser } from './live.js';

export function releaseAsset(asset) {
  asset.element.pause?.();
  asset.analyser?.disconnect();
  asset.source?.disconnect();
  asset.silence?.disconnect();
  asset.element.removeAttribute('src');
  asset.element.load?.();
  URL.revokeObjectURL(asset.url);
}

export function loadAsset(file, type, changed) {
  const element = type === 'image' ? new Image() : document.createElement(type);
  const url = URL.createObjectURL(file);
  const asset = { file, url, element, type, ready: false, failed: false, desiredTime: 0, shouldPlay: false };
  if (type !== 'image') {
    element.preload = 'auto';
    element.playsInline = true;
    element.loop = true;
    element.muted = type === 'video';
    element.addEventListener('loadedmetadata', () => positionAsset(asset));
  }
  element.addEventListener(type === 'image' ? 'load' : 'loadeddata', () => {
    asset.ready = true;
    asset.failed = false;
    changed();
  });
  element.addEventListener('error', () => {
    asset.failed = true;
    changed();
  });
  element.src = url;
  return asset;
}

export function prepareAudio(asset, context) {
  if (asset.type !== 'audio' || asset.analyser) return;
  const source = context.createMediaElementSource(asset.element);
  const analyser = newAnalyser(context, source);
  const silence = context.createGain();
  silence.gain.value = 0;
  analyser.connect(silence);
  silence.connect(context.destination);
  Object.assign(asset, { source, analyser, silence, frequencyData: new Uint8Array(analyser.frequencyBinCount) });
}

function positionAsset(asset) {
  const { element, desiredTime } = asset;
  if (!Number.isFinite(element.duration) || !element.duration) return;
  const target = ((desiredTime % element.duration) + element.duration) % element.duration;
  if (Math.abs(element.currentTime - target) > (asset.shouldPlay ? .28 : .04) && !element.seeking) element.currentTime = target;
}

export function syncAssets(assets, active, playing, sensitivity, animateWhilePaused) {
  for (const [id, asset] of assets) {
    if (asset.type === 'image' || asset.failed) continue;
    const time = active.get(id);
    asset.shouldPlay = time !== undefined && (playing || (asset.type === 'video' && animateWhilePaused?.has(id)));
    asset.sensitivity = sensitivity;
    if (time !== undefined) {
      asset.desiredTime = time;
      positionAsset(asset);
    }
    if (!asset.shouldPlay && !asset.element.paused) asset.element.pause();
    else if (asset.shouldPlay && asset.element.paused && !asset.trying && !asset.blocked) {
      asset.trying = true;
      void asset.element.play().catch(error => {
        if (error.name === 'NotAllowedError') asset.blocked = true;
      }).finally(() => { asset.trying = false; });
    }
  }
}

export async function readBundle(directory, normalize) {
  const descriptor = await (await directory.getFileHandle('show.json')).getFile();
  const result = normalize(JSON.parse(await descriptor.text()));
  const files = new Map();
  let mediaDirectory;
  try {
    mediaDirectory = await directory.getDirectoryHandle('media');
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
  if (mediaDirectory) {
    for (const item of result.show.media) {
      if (!safeFilename(item.file)) continue;
      try {
        const file = await (await mediaDirectory.getFileHandle(item.file)).getFile();
        const linked = relinkMedia(item, file);
        Object.assign(item, linked);
        files.set(item.id, file);
      } catch {
        result.warnings.push('Relink ' + item.name + ' in Show media.');
      }
    }
  }
  return { ...result, files };
}

async function writeFile(directory, name, data) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(data);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

export async function writeBundle(directory, show, files) {
  const output = structuredClone(show);
  output.media = bundleFilenames(show.media, files);
  const mediaDirectory = await directory.getDirectoryHandle('media', { create: true });
  // Write new media under new names. The current manifest remains usable if a
  // copy fails partway through and is replaced only after all copies succeed.
  for (const item of output.media) {
    const file = files.get(item.id);
    if (file) {
      const stamp = crypto.randomUUID().slice(0, 8);
      item.file = stamp + '-' + item.file;
      await writeFile(mediaDirectory, item.file, file);
    } else {
      item.file = '';
    }
  }
  await writeFile(directory, 'show.json', JSON.stringify(output, null, 2));
  return output;
}
