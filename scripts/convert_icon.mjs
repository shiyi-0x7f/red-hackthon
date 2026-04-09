import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const svgPath = path.join(rootDir, 'data', 'learning_companion.svg');
const outputDir = path.join(rootDir, 'data');

async function convert() {
  console.log('Converting SVG to PNG icons...');
  
  // 1024x1024 for tauri icon tool
  await sharp(svgPath, { density: 300 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_1024.png'));
  console.log('Created icon_1024.png');

  // 512x512 for general use
  await sharp(svgPath, { density: 300 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_512.png'));
  console.log('Created icon_512.png');

  // 256x256 for sidebar/login logos
  await sharp(svgPath, { density: 150 })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_256.png'));
  console.log('Created icon_256.png');

  // 128x128 for small logos
  await sharp(svgPath, { density: 150 })
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_128.png'));
  console.log('Created icon_128.png');

  // 64x64 for favicon
  await sharp(svgPath, { density: 150 })
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_64.png'));
  console.log('Created icon_64.png');

  // 32x32 for favicon
  await sharp(svgPath, { density: 100 })
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, 'icon_32.png'));
  console.log('Created icon_32.png');

  console.log('All icons generated successfully!');
}

convert().catch(console.error);
