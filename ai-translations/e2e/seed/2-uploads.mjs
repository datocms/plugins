/**
 * Stage 2 — Assets.
 *
 * Generates four solid-colour PNGs locally (no external host) and uploads them
 * with per-locale `default_field_metadata` (alt + title in `en`). File / gallery
 * field translation reads these defaults when a record references an upload
 * without field-level overrides, so they must carry real text to translate.
 *
 * Writes uploads.json (logical key -> upload id) for stage 3.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { client, section, step } from './lib/config.mjs';
import { solidPng } from './lib/png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, 'assets');

/** Each asset: a colour, a filename, and English alt/title to be translated later. */
const ASSETS = [
  { key: 'mountain', rgb: [58, 102, 160], alt: 'Snow-capped mountain range at sunrise', title: 'Mountain Sunrise' },
  { key: 'city', rgb: [44, 52, 64], alt: 'A glowing city skyline at night', title: 'City Skyline at Night' },
  { key: 'forest', rgb: [46, 120, 76], alt: 'A dense green forest seen from above', title: 'Forest Canopy' },
  { key: 'ocean', rgb: [32, 140, 150], alt: 'Turquoise ocean waves breaking on a sandy beach', title: 'Ocean Waves' },
];

async function main() {
  section('STAGE 2 — Assets');
  const manifest = {};

  for (const a of ASSETS) {
    const localPath = join(assetsDir, `${a.key}.png`);
    writeFileSync(localPath, solidPng(640, 420, a.rgb));

    // default_field_metadata can't be set on create (Dato auto-inits it per-locale);
    // its real shape is field-first: { alt: {locale: val}, title: {...}, ... }.
    const upload = await step(`upload ${a.key}.png`, () =>
      client.uploads.createFromLocalFile({ localPath, skipCreationIfAlreadyExists: true }),
    );
    await step(`  set en alt/title for ${a.key}`, () =>
      client.uploads.update(upload.id, {
        default_field_metadata: {
          alt: { ...upload.default_field_metadata.alt, en: a.alt },
          title: { ...upload.default_field_metadata.title, en: a.title },
        },
      }),
    );
    manifest[a.key] = upload.id;
  }

  const out = join(here, 'uploads.json');
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  section('STAGE 2 complete');
  console.log(manifest);
}

main().catch((e) => {
  console.error('\nFATAL:', e?.message || e);
  process.exit(1);
});
