import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { makeCutout } from '../src/server/image.js';

test('applies a segmentation mask to the source pixels and retains source dimensions', async () => {
  const source = await sharp({ create: { width: 100, height: 60, channels: 3, background: { r: 220, g: 30, b: 40 } } }).png().toBuffer();
  const result = await makeCutout(source, { subjects: [{ label: 'object', polygon: [[.2,.2],[.8,.2],[.8,.8],[.2,.8]] }] });
  const { data, info } = await sharp(result).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 100);
  assert.equal(info.height, 60);
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + info.channels)];
  assert.equal(pixel(50,30)[3], 255);
  assert.equal(pixel(50,30)[0], 220);
  assert.equal(pixel(2,2)[3], 0);
  assert.equal(info.channels, 4);
});

test('normalizes EXIF orientation before applying the mask', async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 150, b: 220 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await makeCutout(source, { subjects: [{ label: 'object', polygon: [[0,0],[1,0],[1,1],[0,1]] }] });
  const meta = await sharp(result).metadata();
  assert.equal(meta.width, 20);
  assert.equal(meta.height, 40);
});

test('exports transparent WebP and flattened JPEG with the requested background', async () => {
  const source = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 210, g: 20, b: 20 } } }).png().toBuffer();
  const shape = { subjects: [{ label: 'object', polygon: [[.25,.2],[.75,.2],[.75,.8],[.25,.8]] }] };
  const webp = await makeCutout(source, shape, 'webp');
  const webpMeta = await sharp(webp).metadata();
  assert.equal(webpMeta.format, 'webp');
  assert.equal(webpMeta.hasAlpha, true);
  const jpeg = await makeCutout(source, shape, 'jpeg', '#00ff00');
  const jpegImage = sharp(jpeg);
  const jpegMeta = await jpegImage.metadata();
  const { data, info } = await jpegImage.raw().toBuffer({ resolveWithObject: true });
  assert.equal(jpegMeta.format, 'jpeg');
  assert.equal(jpegMeta.hasAlpha, false);
  const corner = (0 * info.width + 0) * info.channels;
  assert.ok(data[corner + 1] > data[corner]);
  assert.ok(data[corner + 1] > data[corner + 2]);
});
