// Text aus PDF-Dateien auslesen – mit pdf.js, vollständig im Browser (keine Übertragung, kein Server).

import * as pdfjs from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

let workerUrl: string | null = null;

function ensureWorker() {
  if (workerUrl) return;
  // Der Worker ist in die App eingebettet und wird aus einer lokalen Blob-Adresse gestartet
  workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
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
    void task.destroy();
  }
}
