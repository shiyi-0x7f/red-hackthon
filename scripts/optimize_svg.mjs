import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, 'data', 'model.svg');
const outputPath = path.join(rootDir, 'public', 'images', 'model.svg');

async function optimizeSvg() {
  let svg = fs.readFileSync(inputPath, 'utf-8');
  const originalSize = Buffer.byteLength(svg, 'utf-8');
  console.log(`Original: ${(originalSize / 1024 / 1024).toFixed(1)} MB`);

  // 1. 移除 <metadata> 块（包含 C2PA AI 签名，约22KB）
  svg = svg.replace(/<metadata>[\s\S]*?<\/metadata>/g, '');
  console.log('Removed metadata block');

  // 2. 压缩所有嵌入的 base64 PNG 图片
  //    匹配 data:image/png;base64,... 格式
  const base64Regex = /data:image\/png;base64,([A-Za-z0-9+/=]+)/g;
  let match;
  const replacements = [];
  
  while ((match = base64Regex.exec(svg)) !== null) {
    const fullMatch = match[0];
    const b64Data = match[1];
    const buf = Buffer.from(b64Data, 'base64');
    
    // 只处理大于 10KB 的图片
    if (buf.length > 10 * 1024) {
      replacements.push({ fullMatch, buf, offset: match.index });
    }
  }

  console.log(`Found ${replacements.length} large embedded images to compress`);

  // 逆序替换，避免偏移量问题
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { fullMatch, buf } = replacements[i];
    try {
      // 获取原始图片尺寸
      const metadata = await sharp(buf).metadata();
      const w = metadata.width;
      const h = metadata.height;
      
      // 如果图片很大，缩小到合理尺寸（最大 512px）
      let pipeline = sharp(buf);
      if (w > 512 || h > 512) {
        pipeline = pipeline.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
      }
      
      // 转成高质量 WebP（比 PNG 小很多），再转回 PNG（SVG 兼容性更好）
      const compressed = await pipeline
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();
      
      const newB64 = `data:image/png;base64,${compressed.toString('base64')}`;
      svg = svg.replace(fullMatch, newB64);
      
      console.log(`  Image ${i + 1}: ${(buf.length / 1024).toFixed(0)}KB -> ${(compressed.length / 1024).toFixed(0)}KB (${w}x${h})`);
    } catch (e) {
      console.log(`  Image ${i + 1}: skipped (${e.message})`);
    }
  }

  // 3. 移除多余空白和注释
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/\s{2,}/g, ' ');

  const finalSize = Buffer.byteLength(svg, 'utf-8');
  console.log(`\nOptimized: ${(finalSize / 1024 / 1024).toFixed(1)} MB (${((1 - finalSize / originalSize) * 100).toFixed(0)}% smaller)`);

  fs.writeFileSync(outputPath, svg);
  console.log(`Saved to: public/images/model.svg`);
}

optimizeSvg().catch(console.error);
