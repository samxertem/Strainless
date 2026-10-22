// Copies pdf.js runtime assets (fonts, CMaps, image decoders, colour profiles)
// into public/ so the in-app PDF viewer can load them. Runs before dev/build.
import { cpSync, existsSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist';
const dest = 'public/pdfjs';

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(`${src}/${dir}`)) cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
