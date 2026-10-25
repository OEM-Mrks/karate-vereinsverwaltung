// Vereinslogo: wird beim Hochladen als PNG verkleinert und in den Einstellungen (Datenbank) gespeichert.

import { getSetting, setSetting } from '../db/db';

const MAX = 512;

export function getLogo(): string | null {
  return getSetting('verein_logo') || null;
}

export function removeLogo() {
  setSetting('verein_logo', '');
}

/** Liest PNG/JPEG/SVG/WebP, skaliert auf max. 512 px und speichert als PNG-Data-URL. */
export async function saveLogo(file: File): Promise<void> {
  if (!/^image\//.test(file.type)) throw new Error('Bitte eine Bilddatei (PNG, JPG, SVG) wählen.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Das Bild ist größer als 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
      i.src = url;
    });
    const w = img.naturalWidth || MAX;
    const h = img.naturalHeight || MAX;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    setSetting('verein_logo', canvas.toDataURL('image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
