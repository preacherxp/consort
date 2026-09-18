import { findModel, type RouteResult } from '../shared/contracts';
import { introductionLabel, type Introduction } from '../shared/matches';

// Deliberate 16:9 composition rather than a screenshot of browser controls.
export async function saveCard(task: string, result: RouteResult, introduction: Introduction) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const model = findModel(introduction.modelId);
  ctx.fillStyle = '#1b151a'; ctx.fillRect(0, 0, 1600, 900);
  ctx.fillStyle = '#ffa0b3'; ctx.font = '48px Georgia'; ctx.fillText('♡ consort.', 85, 97);
  ctx.fillStyle = '#ddb5c8'; ctx.font = '16px "Plex Mono"'; ctx.textAlign = 'right';
  ctx.fillText('A LITTLE CHEMISTRY. A BETTER MODEL.', 1515, 91);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#74455f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(85, 139); ctx.lineTo(1515, 139); ctx.stroke();
  ctx.fillStyle = '#ddb5c8'; ctx.font = '15px "Plex Mono"'; ctx.fillText('MY TYPE', 85, 211);
  ctx.fillStyle = '#f4e0e9'; ctx.font = '400 31px Manrope';
  wrap(ctx, task.replace(/\s+/g, ' '), 85, 263, 1300, 46, 3);
  ctx.fillStyle = '#f7eadf'; ctx.beginPath(); ctx.roundRect(85, 414, 1430, 310, 20); ctx.fill();
  ctx.strokeStyle = '#ffccd5'; ctx.stroke();
  ctx.fillStyle = '#805066'; ctx.font = '15px "Plex Mono"'; ctx.fillText(`IT’S A MATCH     ·     ${model.provider.toUpperCase()}`, 125, 468);
  ctx.fillStyle = '#382431'; ctx.font = '500 64px Manrope'; ctx.fillText(model.name, 125, 557, 1100);
  ctx.fillStyle = '#923b5b'; ctx.font = '19px "Plex Mono"'; ctx.fillText(`${result.effort.toUpperCase()} EFFORT`, 126, 617);
  const filled = { low: 1, medium: 2, high: 3 }[result.effort];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < filled ? '#a53658' : '#d6b5c3';
    ctx.fillRect(1370 + i * 27, 620 - (i + 1) * 33, 15, (i + 1) * 33);
  }
  ctx.fillStyle = '#795365'; ctx.font = '20px Manrope'; ctx.fillText(`${introductionLabel(introduction)}. My choice.`, 126, 669);
  ctx.fillStyle = '#dfb6ce'; ctx.font = '14px "Plex Mono"'; ctx.fillText(`INTRODUCED BY ${result.router.toUpperCase()}`, 85, 798);
  ctx.fillStyle = '#c9a5ba'; ctx.font = '13px Manrope'; ctx.fillText('Chosen by me. Not executed. Thinking effort is advisory.', 85, 832);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Export failed')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `consort-${model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  let line = '';
  let row = 0;
  const characters = Array.from(text);
  for (let i = 0; i < characters.length; i++) {
    const next = line + characters[i];
    if (ctx.measureText(next + '…').width > width) {
      if (row === maxLines - 1) { ctx.fillText(line.trimEnd() + '…', x, y + row * lineHeight); return; }
      const space = line.lastIndexOf(' ');
      const split = space > 0 ? space : line.length;
      ctx.fillText(line.slice(0, split), x, y + row * lineHeight);
      line = line.slice(split).trimStart() + characters[i];
      row++;
    } else line = next;
  }
  ctx.fillText(line, x, y + row * lineHeight);
}
