/** Low-resolution synthetic image with text, oblique lines and fine detail. */
export function makeTestPattern(width = 480, height = 270): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#1d3557');
  bg.addColorStop(1, '#457b9d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Text at various sizes
  ctx.fillStyle = '#f1faee';
  ctx.textBaseline = 'top';
  let y = 8;
  for (const size of [7, 9, 11, 14, 18, 24]) {
    ctx.font = `${size}px sans-serif`;
    ctx.fillText('Upscaling FSR1 · 0123456789 · AaBbGg', 8, y);
    y += size + 5;
  }

  // Fan of lines: aliasing on oblique edges
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  const cx = 380, cy = 70;
  for (let a = 0; a < Math.PI; a += Math.PI / 24) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 60, cy + Math.sin(a) * 60);
    ctx.stroke();
  }

  // Concentric circles
  ctx.strokeStyle = '#e63946';
  for (let r = 4; r < 50; r += 4) {
    ctx.beginPath();
    ctx.arc(70, 200, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Checkerboard and 1 px lines
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#000' : '#fff';
      ctx.fillRect(150 + i * 4, 160 + j * 4, 4, 4);
    }
  }
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? '#000' : '#fff';
    ctx.fillRect(220 + i, 160, 1, 48);
  }

  // Color bars and gradient
  const bars = ['#fff', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f', '#000'];
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(260 + i * 25, 160, 25, 30);
  });
  const ramp = ctx.createLinearGradient(260, 0, 460, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  ctx.fillStyle = ramp;
  ctx.fillRect(260, 195, 200, 15);

  // Filled circle with a sharp edge
  ctx.fillStyle = '#a8dadc';
  ctx.beginPath();
  ctx.arc(360, 240, 22, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}
