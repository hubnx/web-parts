// A picture of what the visitor sees, for a report (feedback-dialog.ts), and the boxes they draw painted
// into it. The only module that knows modern-screenshot, which has the browser draw the page itself (an
// SVG foreignObject), so what the browser can paint, it captures. Its settings follow hubnx.com's own
// report-a-problem, whose findings they carry.

import {PictureMaxChars} from './feedback-report.ts';

/** A box drawn on the picture, in fractions of its width and height: red round what is meant, or solid over what is private. */
export interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  tool: 'highlight' | 'hide';
}

/** The screen itself, up to 2,400px wide and 2.4 million pixels: text stays readable without a huge file. */
const MaxWidth = 2400;
const MaxPixels = 2_400_000;
/** A transparent 1×1 GIF, in place of every picture off screen, which nobody would see. */
const EmptyPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The visible part of the page, without `leaveOut` (the report's own pop-up); null when it can't be taken. */
export async function takePagePicture(leaveOut: Element): Promise<string | null> {
  try {
    // Loaded when a report opens: a visitor who never sends one never downloads it.
    const {domToPng} = await import('modern-screenshot');
    const width = innerWidth;
    const height = innerHeight;
    // The library inlines every picture in the page; a guide page's screenshots far below took seconds.
    const onScreen = new Set<string>();
    for (const image of document.images) {
      const box = image.getBoundingClientRect();
      if (box.bottom > 0 && box.right > 0 && box.top < height && box.left < width) onScreen.add(image.currentSrc || image.src);
    }
    return await domToPng(document.body, {
      width,
      height,
      scale: Math.min(1, MaxWidth / width, Math.sqrt(MaxPixels / (width * height))),
      // The body carries the page's colour; without it the PNG is transparent wherever the page shows through.
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      // The copy of <body> is drawn from its top: moved up by the scroll, it shows what is on screen.
      style: {margin: '0', ...(scrollX || scrollY ? {transform: `translate(${-scrollX}px, ${-scrollY}px)`} : {})},
      // A <noscript>'s words came out as text in the copy, as if the page had said them.
      filter: node => node !== leaveOut && node.nodeName !== 'NOSCRIPT',
      // What the page marks private (a line of your own text) keeps its place in the picture, blank. Called once, with
      // the whole copy of the page (a check of the copy's top alone hid nothing: fresh review's fix, 2026-11-11).
      onCloneNode: copy => {
        if (copy.nodeType !== Node.ELEMENT_NODE) return;
        for (const element of (copy as Element).querySelectorAll<HTMLElement>('[data-private]')) element.style.visibility = 'hidden';
      },
      timeout: 5000,
      fetchFn: async url => (onScreen.has(url) || url.startsWith('data:') ? false : EmptyPixel),
    });
  } catch (error) {
    // No picture is not a failure: the words are the report.
    console.error('PAGE_PICTURE_FAILED', error);
    return null;
  }
}

/**
 * The picture with its marks painted in, the only copy that is sent, shrunk until the route takes it.
 * Undefined when the marks can't be painted: a black-out must never be skipped, so the words go alone.
 */
export async function paintMarks(picture: string, marks: readonly Mark[]): Promise<string | undefined> {
  const image = new Image();
  image.src = picture;
  try {
    await image.decode();
  } catch (error) {
    // Drawing a broken image throws: the words go alone.
    console.error('PAGE_PICTURE_UNREADABLE', error);
    return undefined;
  }
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || 1;
  canvas.height = image.naturalHeight || 1;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.drawImage(image, 0, 0);
  context.lineWidth = Math.max(2, canvas.width / 300);
  for (const mark of marks) {
    const x = (mark.w < 0 ? mark.x + mark.w : mark.x) * canvas.width;
    const y = (mark.h < 0 ? mark.y + mark.h : mark.y) * canvas.height;
    const w = Math.abs(mark.w) * canvas.width;
    const h = Math.abs(mark.h) * canvas.height;
    if (mark.tool === 'hide') {
      // Solid, not blurred: a blur can be undone. Outlined in grey, or on a dark page it can't be told apart.
      context.fillStyle = '#111827';
      context.fillRect(x, y, w, h);
      context.strokeStyle = '#9ca3af';
    } else {
      context.strokeStyle = '#ef4444';
    }
    context.strokeRect(x, y, w, h);
  }
  let png = canvas.toDataURL('image/png');
  for (let step = 1; png.length > PictureMaxChars && step <= 4; step++) {
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(canvas.width * 0.75 ** step));
    smaller.height = Math.max(1, Math.round(canvas.height * 0.75 ** step));
    smaller.getContext('2d')?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    png = smaller.toDataURL('image/png');
  }
  if (png.length > PictureMaxChars) {
    console.warn('PAGE_PICTURE_TOO_LARGE', png.length);
    return undefined;
  }
  return png;
}
