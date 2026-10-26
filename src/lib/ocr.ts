// Texterkennung (OCR) für gescannte Dokumente – mit Tesseract.js, vollständig im Browser.
// Programm (WebAssembly), Worker und deutsches Sprachmodell sind in die App eingebettet: kein CDN, keine Übertragung.

import { createWorker, type Worker } from 'tesseract.js';
import workerSource from 'tesseract.js/dist/worker.min.js?raw';
import coreSource from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?raw';
import deuUrl from '@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz?inline';
import { pdfPageImages, pdfText } from './pdftext';

export type OcrProgress = { status: string; progress: number };

let worker: Promise<Worker> | null = null;
let listener: ((p: OcrProgress) => void) | null = null;

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Texterkennung wird geladen',
  'initializing tesseract': 'Texterkennung wird gestartet',
  'loading language traineddata': 'Sprachmodell wird geladen',
  'initializing api': 'Texterkennung wird gestartet',
  'recognizing text': 'Text wird erkannt',
};

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    // Kern und Worker-Skript liegen in einer Blob-Datei: Der Worker braucht so kein importScripts
    // (die CSP lässt keine nachgeladenen Skripte zu) und findet TesseractCore bereits vor.
    // Das Sprachmodell liefert ein vorgeschalteter fetch aus der eingebetteten data:-Adresse.
    const shim = `const __deu = ${JSON.stringify(deuUrl)}; const __fetch = self.fetch.bind(self);
self.fetch = (u, o) => String(u).endsWith('/deu.traineddata.gz') ? __fetch(__deu) : __fetch(u, o);\n`;
    const url = URL.createObjectURL(new Blob([shim, coreSource, '\n', workerSource], { type: 'text/javascript' }));
    try {
      return await createWorker('deu', 1, {
        workerPath: url,
        workerBlobURL: false,
        langPath: 'eingebettet',
        cacheMethod: 'none',
        logger: (m: { status: string; progress: number }) => listener?.({ status: STATUS[m.status] ?? m.status, progress: m.progress }),
        errorHandler: (e: unknown) => console.error(e),
      });
    } catch (e) {
      worker = null;
      throw e;
    }
  })();
  return worker;
}

/** Erkennt den Text eines Bildes (PNG, JPEG …) oder einer Canvas. */
async function recognize(image: Blob | HTMLCanvasElement, onProgress?: (p: OcrProgress) => void): Promise<string> {
  listener = onProgress ?? null;
  try {
    const w = await getWorker();
    const { data } = await w.recognize(image);
    return data.text;
  } finally {
    listener = null;
  }
}

/**
 * Text eines Dokuments: PDFs mit Textebene werden direkt ausgelesen, gescannte PDFs und Fotos per OCR.
 * Liefert den erkannten Text und ob OCR nötig war.
 */
export async function documentText(
  file: { bytes: Uint8Array; mime: string },
  onProgress?: (p: OcrProgress) => void,
  maxPages = 3,
): Promise<{ text: string; ocr: boolean }> {
  if (file.mime === 'application/pdf') {
    const text = await pdfText(file.bytes, maxPages);
    if (text.replace(/\s/g, '').length > 80) return { text, ocr: false };
    const pages = await pdfPageImages(file.bytes, maxPages);
    const parts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      parts.push(await recognize(pages[i], onProgress && ((p) => onProgress({
        status: pages.length > 1 ? `${p.status} (Seite ${i + 1} von ${pages.length})` : p.status,
        progress: p.progress,
      }))));
    }
    return { text: parts.join('\n'), ocr: true };
  }
  if (file.mime.startsWith('image/')) {
    return { text: await recognize(new Blob([file.bytes as BlobPart], { type: file.mime }), onProgress), ocr: true };
  }
  throw new Error('Texterkennung ist nur für PDF-Dateien und Bilder möglich.');
}
