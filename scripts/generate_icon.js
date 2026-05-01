/**
 * Generate the extension icon (images/icon.png).
 *
 * Layout:
 *   - black circular tile (full canvas),
 *   - JetBrains Kotlin Gradle Script dark glyph centred at ~58% of the canvas.
 *
 * Usage:
 *   node scripts/generate_icon.js
 *
 * Also fetches the auxiliary Gradle/Kotlin-DSL/Navigate icons used by the
 * sidebar tree view into `images/icons/`.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'images');
const ICONS_DIR = path.join(OUT_DIR, 'icons');
const CACHE_DIR = path.resolve(__dirname, '.cache');
const OUT_FILE = path.join(OUT_DIR, 'icon.png');
const SIZE = 256;
const GLYPH_RATIO = 0.58;

const SVGS = [
    {
        name: 'kotlinGradleScript.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/KotlinBaseResourcesIcons/org/jetbrains/kotlin/idea/icons/expui/kotlinGradleScript.svg',
    },
    {
        name: 'kotlinGradleScript_dark.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/KotlinBaseResourcesIcons/org/jetbrains/kotlin/idea/icons/expui/kotlinGradleScript_dark.svg',
    },
    {
        name: 'gradle.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle.svg',
    },
    {
        name: 'gradle_dark.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradle_dark.svg',
    },
    {
        name: 'gradleNavigate.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleNavigate.svg',
    },
    {
        name: 'gradleNavigate_dark.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleNavigate_dark.svg',
    },
    {
        name: 'gradleLoadChanges.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleLoadChanges.svg',
    },
    {
        name: 'gradleLoadChanges_dark.svg',
        url:
            'https://intellij-icons.jetbrains.design/icons/GradleIcons/icons/expui/gradleLoadChanges_dark.svg',
    },
];

async function main() {
    let sharp;
    try {
        sharp = require('sharp');
    } catch {
        console.error(
            "Missing dependency 'sharp'. Install it first:\n" +
            '  bun install\n'
        );
        process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    for (const { name, url } of SVGS) {
        const dest = path.join(ICONS_DIR, name);
        if (!fs.existsSync(dest)) {
            console.log(`→ Downloading ${name}…`);
            await download(url, dest);
        }
    }

    const sourceSvg = path.join(ICONS_DIR, 'kotlinGradleScript_dark.svg');

    const tileSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${SIZE / 2}" fill="#1B1B1F"/>
</svg>`;
    const tile = await sharp(Buffer.from(tileSvg)).png().toBuffer();

    const glyphSize = Math.round(SIZE * GLYPH_RATIO);
    const glyphTrimmed = await sharp(sourceSvg, { density: 1024 })
        .trim()
        .png()
        .toBuffer();
    const glyph = await sharp(glyphTrimmed)
        .resize(glyphSize, glyphSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    const glyphLeft = Math.round((SIZE - glyphSize) / 2);
    const glyphTop = Math.round((SIZE - glyphSize) / 2);

    await sharp(tile)
        .composite([{ input: glyph, left: glyphLeft, top: glyphTop }])
        .png({ compressionLevel: 9 })
        .toFile(OUT_FILE);

    console.log(`✓ Wrote ${path.relative(process.cwd(), OUT_FILE)} (${SIZE}x${SIZE})`);
}

function download(url, destPath, redirects = 5) {
    return new Promise((resolve, reject) => {
        https
            .get(
                url,
                {
                    headers: {
                        'User-Agent': 'vscode-gradle-kotlin/icon-generator',
                        Accept: '*/*',
                    },
                },
                res => {
                    if (
                        res.statusCode &&
                        res.statusCode >= 300 &&
                        res.statusCode < 400 &&
                        res.headers.location
                    ) {
                        if (redirects <= 0) {
                            return reject(new Error(`Too many redirects for ${url}`));
                        }
                        const next = new URL(res.headers.location, url).toString();
                        res.resume();
                        return resolve(download(next, destPath, redirects - 1));
                    }
                    if (res.statusCode !== 200) {
                        return reject(new Error(`GET ${url} failed: HTTP ${res.statusCode}`));
                    }
                    const file = fs.createWriteStream(destPath);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve(undefined)));
                    file.on('error', reject);
                }
            )
            .on('error', reject);
    });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
