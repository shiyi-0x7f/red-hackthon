import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const svgPath = path.join(rootDir, 'data', 'model.svg');

async function convert() {
  // 512x512 高质量 PNG 用于 live2d 展示区域（原始 220x220 CSS 容器，2x 清晰度足够）
  await sharp(svgPath, { density: 300 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 90 })
    .toFile(path.join(rootDir, 'public', 'images', 'model_512.png'));

  const info = (await import('fs')).statSync(path.join(rootDir, 'public', 'images', 'model_512.png'));
  console.log(`Created model_512.png: ${(info.size / 1024).toFixed(1)} KB`);
}

convert().catch(console.error);
