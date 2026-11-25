import { clamp } from './show.js';
import { makeCanvas, silhouetteFromPixels } from './render.js';

const width = 256;
const height = 192;

export function demoEnvelope(time) {
  const beat = ((time * 2) % 1 + 1) % 1;
  const offbeat = (((time + .25) * 2) % 1 + 1) % 1;
  return [.86 * Math.exp(-6 * beat), .56 * Math.exp(-6 * offbeat), .42 * Math.exp(-13 * offbeat)];
}

export function createLiveInputs(report) {
  const camera = document.createElement('video');
  Object.assign(camera, { playsInline: true, muted: true, autoplay: true });
  camera.setAttribute('aria-hidden', 'true');
  camera.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(camera);
  const demoAudio = new Audio(new URL('./assets/facade-beat.wav', import.meta.url));
  demoAudio.loop = true;
  demoAudio.volume = .32;
  const image = makeCanvas(width, height).getContext('2d', { willReadFrequently: true });
  const matte = makeCanvas(width, height);
  const matteCtx = matte.getContext('2d');
  const silhouette = matteCtx.createImageData(width, height);
  let cleanPlate;
  let cameraStream;
  let micStream;
  let cameraTime;
  let framesAt = 0;
  let audioContext;
  let microphone;
  let micAnalyser;
  let micData;
  let cameraRequest = 0;
  let micRequest = 0;

  function stopCamera(message = 'Camera disconnected') {
    cameraRequest++;
    const tracks = cameraStream?.getTracks();
    cameraStream = undefined;
    tracks?.forEach(track => track.stop());
    camera.pause();
    camera.srcObject = null;
    cameraTime = undefined;
    framesAt = 0;
    cleanPlate = undefined;
    matteCtx.clearRect(0, 0, width, height);
    report('camera', message);
  }

  function stopMic(message = 'Microphone disconnected') {
    micRequest++;
    const tracks = micStream?.getTracks();
    micStream = undefined;
    tracks?.forEach(track => track.stop());
    microphone?.disconnect();
    microphone = undefined;
    micAnalyser = undefined;
    micData = undefined;
    report('microphone', message);
  }

  function audioEngine() {
    audioContext ??= new window.AudioContext();
    if (audioContext.state !== 'running') void audioContext.resume().catch(() => {});
    return audioContext;
  }

  async function connectCamera() {
    const request = ++cameraRequest;
    report('camera', 'Waiting for camera permission…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs a secure HTTPS or localhost page in a browser with camera support.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
      if (request !== cameraRequest) { stream.getTracks().forEach(track => track.stop()); return; }
      cameraStream = stream;
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (cameraStream === stream) stopCamera('Camera connection lost');
      });
      track.addEventListener('mute', () => {
        if (cameraStream === stream) report('camera', 'Camera feed interrupted');
      });
      track.addEventListener('unmute', () => {
        if (cameraStream === stream) report('camera', cleanPlate ? 'Camera matte ready' : 'Camera ready · capture the empty stage');
      });
      camera.srcObject = stream;
      await camera.play();
      if (request !== cameraRequest) return;
      report('camera', 'Camera ready · capture the empty stage');
    } catch (error) {
      if (request === cameraRequest) stopCamera(deviceError(error, 'Camera'));
    }
  }

  async function connectMic() {
    const request = ++micRequest;
    report('microphone', 'Waiting for microphone permission…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs a secure HTTPS or localhost page in a browser with microphone support.');
      const context = audioEngine();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      });
      if (request !== micRequest) { stream.getTracks().forEach(track => track.stop()); return; }
      micStream = stream;
      microphone = context.createMediaStreamSource(stream);
      micAnalyser = newAnalyser(context, microphone);
      micData = new Uint8Array(micAnalyser.frequencyBinCount);
      const track = stream.getAudioTracks()[0];
      track.addEventListener('ended', () => {
        if (micStream === stream) stopMic('Microphone connection lost');
      });
      track.addEventListener('mute', () => {
        if (micStream === stream) report('microphone', 'Microphone feed interrupted');
      });
      track.addEventListener('unmute', () => {
        if (micStream === stream) report('microphone', 'Microphone ready');
      });
      report('microphone', 'Microphone ready');
    } catch (error) {
      if (request === micRequest) stopMic(deviceError(error, 'Microphone'));
    }
  }

  const sampleCamera = () => {
    image.save();
    image.translate(width, 0);
    image.scale(-1, 1);
    image.drawImage(camera, 0, 0, width, height);
    image.restore();
    return image.getImageData(0, 0, width, height).data;
  };

  function captureBackground() {
    if (!cameraStream || camera.readyState < 2 || !camera.videoWidth) return false;
    cleanPlate = sampleCamera();
    report('camera', 'Camera matte ready');
    return true;
  }

  function clearBackground() {
    cleanPlate = undefined;
    matteCtx.clearRect(0, 0, width, height);
    report('camera', 'Camera ready · capture the empty stage');
  }

  function updateCamera(now, threshold, used, roi, cameraKey) {
    if (!cameraStream || camera.readyState < 2 || !camera.videoWidth) return;
    const decodedFrames = camera.getVideoPlaybackQuality?.().totalVideoFrames;
    const marker = decodedFrames ? 'frame:' + decodedFrames : camera.currentTime;
    if (marker !== cameraTime) {
      cameraTime = marker;
      framesAt = now;
    }
    if ((cleanPlate || cameraKey === 'luma') && used && now - framesAt < 1500) {
      silhouetteFromPixels(sampleCamera(), cameraKey === 'luma' ? null : cleanPlate, threshold, silhouette.data, width, roi);
      matteCtx.putImageData(silhouette, 0, 0);
    }
  }

  async function setAudition(enabled) {
    if (enabled) {
      demoAudio.currentTime = 0;
      await demoAudio.play();
    } else demoAudio.pause();
  }

  return {
    matte, camera, stopCamera, stopMic, connectCamera, connectMic, captureBackground, clearBackground, updateCamera, setAudition, audioEngine,
    cameraConnected: () => Boolean(cameraStream),
    microphoneConnected: () => Boolean(micStream),
    cameraReady: (now, key) => Boolean((cleanPlate || key === 'luma') && framesAt && now - framesAt < 1500 && usable(cameraStream?.getVideoTracks()[0])),
    microphoneReady: () => audioContext?.state === 'running' && Boolean(micAnalyser && usable(micStream?.getAudioTracks()[0])),
    levels: (mode, now) => mode === 'microphone' ? readBands(micAnalyser, micData, audioContext?.sampleRate)
      : demoEnvelope(demoAudio.paused ? now / 1000 : demoAudio.currentTime),
    bandsForAsset: asset => readBands(asset.analyser, asset.frequencyData, audioContext?.sampleRate)
      .map(value => clamp(value * asset.sensitivity)),
    close() {
      stopCamera();
      stopMic();
      demoAudio.pause();
      if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => {});
    },
  };
}

const usable = track => track && track.readyState === 'live' && !track.muted && track.enabled;

function deviceError(error, device) {
  const reason = {
    NotAllowedError: 'permission denied',
    NotFoundError: 'device unavailable',
    NotReadableError: 'device is busy or unavailable',
  }[error.name] ?? error.message;
  return device + ' · ' + reason;
}

export function newAnalyser(context, source) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = .68;
  source.connect(analyser);
  return analyser;
}

function readBands(analyser, data, sampleRate) {
  if (!analyser || !data || !sampleRate) return [0, 0, 0];
  analyser.getByteFrequencyData(data);
  const width = sampleRate / analyser.fftSize;
  return [[38, 180], [180, 2300], [2300, 8000]].map(([from, to]) => {
    const start = Math.max(1, Math.floor(from / width));
    const end = Math.min(data.length, Math.ceil(to / width));
    let peak = 0;
    for (let index = start; index < end; index++) peak = Math.max(peak, data[index]);
    return peak / 255;
  });
}
