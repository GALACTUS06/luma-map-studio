const screen = document.getElementById('projection');
const ctx = screen.getContext('2d', { alpha: false });
const blank = () => {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, screen.width, screen.height);
};
window.lumaProjectionBlank = blank;

function update() {
  try {
    const frame = window.opener && !window.opener.closed && window.opener.lumaMapOutput?.frame();
    if (frame) ctx.drawImage(frame, 0, 0);
    else blank();
  } catch { blank(); }
  requestAnimationFrame(update);
}

async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* A display or browser policy may limit fullscreen. */ }
}

screen.addEventListener('click', fullscreen);
window.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() === 'f') void fullscreen();
  if (event.key.toLowerCase() === 'b') {
    try {
      if (window.opener?.lumaMapOutput) window.opener.lumaMapOutput.blackout();
      else blank();
    } catch { blank(); }
  }
});
blank();
requestAnimationFrame(update);
