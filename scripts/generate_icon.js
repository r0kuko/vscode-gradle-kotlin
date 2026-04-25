/**
 * Generate the extension icon by rasterising the JetBrains-supplied
 * "Kotlin Gradle Script (dark)" SVG to a 256×256 PNG.
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

    await sharp(sourceSvg, { density: 384 })
        .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
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
