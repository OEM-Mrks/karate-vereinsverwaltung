// Text aus PDF-Dateien auslesen – mit pdf.js, vollständig im Browser (keine Übertragung, kein Server).

import * as pdfjs from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

let workerReady = false;

function ensureWorker() {
  if (workerReady) return;
  workerReady = true;
  // Der Worker ist in die App eingebettet und wird aus einer lokalen Blob-Adresse gestartet – als klassischer Worker,
  // weil Modul-Worker in der Offline-Datei (file://) nicht starten. Dafür wird das ES-Modul zum Skript umgeschrieben.
  const classic = workerSource.replaceAll('import.meta.url', 'self.location.href').replace(/export\s*\{[^}]*\};?\s*(\/\/[^\n]*\s*)?$/, '');
  const url = URL.createObjectURL(new Blob([classic], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(url);
}

/** Liefert den Text der ersten Seiten (Zeilenumbrüche bleiben erhalten). Gescannte PDFs ohne Textebene ergeben ''. */
export async function pdfText(bytes: Uint8Array, maxPages = 6): Promise<string> {
  ensureWorker();
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const parts: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          parts.push(line);
          line = '';
        } else line += ' ';
      }
      if (line.trim()) parts.push(line);
    }
    return parts.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  } finally {
    await task.destroy();
  }
}

/** Rendert die ersten Seiten als Bild (für die Texterkennung gescannter PDFs). Auflösung ca. 300 dpi, höchstens 3000 px breit. */
export async function pdfPageImages(bytes: Uint8Array, maxPages = 3): Promise<HTMLCanvasElement[]> {
  ensureWorker();
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  try {
    const out: HTMLCanvasElement[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(300 / 72, 3000 / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      out.push(canvas);
    }
    return out;
  } finally {
    await task.destroy();
  }
}
