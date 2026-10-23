import sharp from 'sharp';
import { config } from './config.js';
import type { Segmentation } from './ai/segment.js';

export async function makeCutout(input: Buffer, segmentation: Segmentation, format: 'png' | 'webp' | 'jpeg' = 'png', background = '#ffffff'): Promise<Buffer> {
  const normalized = await sharp(input, { failOn: 'error', limitInputPixels: config.MAX_IMAGE_PIXELS }).rotate().ensureAlpha().png().toBuffer();
  const meta = await sharp(normalized).metadata();
  if (!meta.width || !meta.height) throw new Error('Could not read image dimensions.');
  const w = meta.width, h = meta.height;
  const polygons = segmentation.subjects.map(({ polygon }) => `<polygon points="${polygon.map(([x,y]) => `${(x*w).toFixed(2)},${(y*h).toFixed(2)}`).join(' ')}" fill="white"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${polygons}</svg>`);
  const mask = await sharp(svg).png().toBuffer();
  const layered = sharp(normalized).composite([{ input: mask, blend: 'dest-in' }]);
  const output = format === 'png'
    ? await layered.png({ compressionLevel: 6 }).toBuffer()
    : format === 'webp'
      ? await layered.webp({ quality: 92, alphaQuality: 100 }).toBuffer()
      : await layered.flatten({ background }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const check = await sharp(output).metadata();
  if (!check.width || !check.height || (format !== 'jpeg' && !check.hasAlpha) || (format === 'jpeg' && check.hasAlpha)) throw new Error('Output validation failed.');
  return output;
}

export async function makeCutoutFromMask(input: Buffer, maskInput: Buffer, format: 'png' | 'webp' | 'jpeg' = 'png', background = '#ffffff'): Promise<Buffer> {
  const normalized = await sharp(input, { failOn: 'error', limitInputPixels: config.MAX_IMAGE_PIXELS }).rotate().ensureAlpha().png().toBuffer();
  const { width, height } = await sharp(normalized).metadata();
  if (!width || !height) throw new Error('Could not read image dimensions.');
  const alpha = await sharp(maskInput, { failOn: 'error' }).resize(width, height, { fit: 'fill' }).greyscale().raw().toBuffer();
  if (alpha.length !== width * height) throw new Error('The AI returned an invalid segmentation mask.');
  const layered = sharp(normalized).removeAlpha().joinChannel(alpha, { raw: { width, height, channels: 1 } });
  const output = format === 'png'
    ? await layered.png({ compressionLevel: 6 }).toBuffer()
    : format === 'webp'
      ? await layered.webp({ quality: 92, alphaQuality: 100 }).toBuffer()
      : await layered.flatten({ background }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const check = await sharp(output).metadata();
  if (check.width !== width || check.height !== height || (format !== 'jpeg' && !check.hasAlpha) || (format === 'jpeg' && check.hasAlpha)) throw new Error('Output validation failed.');
  return output;
}
