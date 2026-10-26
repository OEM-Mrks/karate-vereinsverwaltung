# Credits – verwendete Software anderer Anbieter

Die Vereinsverwaltung bündelt die folgenden Bibliotheken, Programme und Daten in die ausgelieferte HTML-Datei.
Ihre Lizenzen gelten für den jeweiligen Bestandteil unverändert weiter; die Lizenz der Vereinsverwaltung selbst steht in [LICENSE](LICENSE).

## Texterkennung (OCR)

| Bestandteil | Version | Lizenz | Quelle |
|---|---|---|---|
| Tesseract.js | 7.0.0 | Apache License 2.0 | https://github.com/naptha/tesseract.js |
| tesseract.js-core (Tesseract OCR und Leptonica als WebAssembly) | 7.0.0 | Apache License 2.0 | https://github.com/naptha/tesseract.js-core |
| Tesseract OCR | – | Apache License 2.0 | https://github.com/tesseract-ocr/tesseract |
| Leptonica | – | Leptonica-Lizenz (BSD-2-Clause-ähnlich) | http://www.leptonica.org |
| Deutsches Sprachmodell `deu.traineddata` (tessdata_best, ganzzahlig) | 4.0.0 | Apache License 2.0 (Paket @tesseract.js-data/deu: MIT) | https://github.com/tesseract-ocr/tessdata_best |

Tesseract.js, tesseract.js-core und das Sprachmodell werden unverändert eingebettet. Angepasst wird nur, wie die App sie lädt:
Kern und Worker-Skript liegen gemeinsam in einer Blob-Datei, das Sprachmodell wird aus einer eingebetteten `data:`-Adresse geladen.

## Weitere Bestandteile

| Bestandteil | Version | Lizenz | Quelle |
|---|---|---|---|
| React, React DOM | 18.3.1 | MIT | https://github.com/facebook/react |
| sql.js (SQLite als WebAssembly) | 1.15.1 | MIT (SQLite: Public Domain) | https://github.com/sql-js/sql.js |
| PDF.js (pdfjs-dist) | 6.4.299 | Apache License 2.0 | https://github.com/mozilla/pdf.js |
| pdfmake | 0.3.11 | MIT | https://github.com/bpampuch/pdfmake |
| Schrift Roboto (über pdfmake) | – | Apache License 2.0 | https://github.com/googlefonts/roboto |
| docx | 9.8.1 | MIT | https://github.com/dolanmiu/docx |

## Lizenztexte

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- MIT-Lizenz: https://opensource.org/license/mit
- Leptonica-Lizenz: http://www.leptonica.org/about-the-license.html

Musik und Stimmen des Demo-Videos: siehe [docs/demo/CREDITS.md](docs/demo/CREDITS.md).
