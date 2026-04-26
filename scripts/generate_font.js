#!/usr/bin/env node
/**
 * Generates images/fonts/gradle-kotlin.woff2 from the Gradle elephant icon.
 *
 * Source SVG: https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/gradle.svg
 *   (fill-based, fill-rule=evenodd — required for icon font rendering)
 *
 * Usage: node scripts/generate_font.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const FONT_SRC = path.join(__dirname, '.font-src');
const SVG_URL = 'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/gradle.svg';
const SVG_DEST = path.join(FONT_SRC, 'gradle-kotlin.svg');
const FONT_OUT = path.join(ROOT, 'images', 'fonts');

fs.mkdirSync(FONT_SRC, { recursive: true });
fs.mkdirSync(FONT_OUT, { recursive: true });

// Download SVG
console.log('Downloading Gradle icon SVG...');
https.get(SVG_URL, (res) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => {
    fs.writeFileSync(SVG_DEST, Buffer.concat(chunks));
    console.log(`Saved ${SVG_DEST}`);

    // Generate font
    const fantasticon = path.join(ROOT, 'node_modules', '.bin', 'fantasticon');
    console.log('Generating WOFF2 font...');
    execSync(`${fantasticon} "${FONT_SRC}" -n gradle-kotlin -o "${FONT_OUT}" -t woff2`, {
      stdio: 'inherit',
    });

    // Remove generated files we don't need
    for (const ext of ['css', 'html', 'json', 'ts']) {
      const f = path.join(FONT_OUT, `gradle-kotlin.${ext}`);
      if (fs.existsSync(f)) {
        fs.rmSync(f);
        console.log(`Removed ${f}`);
      }
    }

    console.log('Done. Font character: \\uF101');
  });
}).on('error', (e) => {
  console.error('Download failed:', e.message);
  process.exit(1);
});
