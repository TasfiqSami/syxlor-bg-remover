import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { segmentImage } from './ai/segment.js';
import { requestFalMask } from './ai/fal.js';
import { makeCutout, makeCutoutFromMask } from './image.js';

const app = Fastify({ logger: true, bodyLimit: config.MAX_FILE_SIZE_BYTES + 1024 * 1024 });
await app.register(cors, { origin: config.CORS_ORIGIN ? config.CORS_ORIGIN.split(',').map(origin => origin.trim()) : false });
await app.register(multipart, { limits: { fileSize: config.MAX_FILE_SIZE_BYTES, files: 1 } });
await app.register(rateLimit, { global: false });
app.get('/api/health', async () => ({ ok: true, aiConfigured: Boolean(config.AI_PROVIDER === 'fal' ? config.FAL_KEY : config.AI_PROVIDER === 'deepseek' ? config.DEEPSEEK_API_KEY : config.AI_PROVIDER === 'openai' ? config.OPENAI_API_KEY : config.GEMINI_API_KEY), provider: config.AI_PROVIDER }));
app.get('/api/config', async () => ({ maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES, acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], provider: config.AI_PROVIDER }));
let activeJobs = 0;
app.post('/api/remove-background', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
  let acquired = false;
  try {
    if (activeJobs >= 2) return reply.code(429).send({ error: 'The image processor is busy. Try again shortly.' });
    activeJobs++;
    acquired = true;
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'Choose an image to process.' });
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(part.mimetype)) return reply.code(415).send({ error: 'Use a JPG, PNG, or WebP image.' });
    const bytes = await part.toBuffer();
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: config.MAX_IMAGE_PIXELS }).rotate().ensureAlpha().png();
    const meta = await image.metadata();
    if (!meta.width || !meta.height || !['jpeg','png','webp'].includes(meta.format || '')) return reply.code(415).send({ error: 'The image file could not be decoded.' });
    const fields = part.fields as Record<string, { value?: unknown }>;
    const keep = typeof fields.keep?.value === 'string' ? fields.keep.value.slice(0, 300) : undefined;
    const formatValue = fields.format?.value;
    const format = formatValue === 'webp' || formatValue === 'jpeg' ? formatValue : 'png';
    const backgroundValue = fields.background?.value;
    const background = typeof backgroundValue === 'string' && /^#[0-9a-fA-F]{6}$/.test(backgroundValue) ? backgroundValue : '#ffffff';
    const normalized = await image.toBuffer();
    const analysis = await sharp(normalized).flatten({ background: '#f1f3f8' }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const output = config.AI_PROVIDER === 'fal'
      ? await makeCutoutFromMask(normalized, await requestFalMask(normalized), format, background)
      : await makeCutout(normalized, await segmentImage(analysis, 'image/jpeg', keep), format, background);
    const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    reply.header('Content-Type', mimeType).header('Content-Disposition', `attachment; filename="syxlor-cutout.${format === 'jpeg' ? 'jpg' : format}"`).header('Cache-Control', 'no-store');
    return reply.send(output);
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    request.log.error(err);
    return reply.code(err.statusCode || 500).send({ error: err.message || 'Background removal failed.' });
  } finally {
    if (acquired) activeJobs--;
  }
});
if (process.env.NODE_ENV === 'production') {
  await app.register(fastifyStatic, { root: path.resolve('dist/client'), wildcard: true });
  app.setNotFoundHandler((request, reply) => request.method === 'GET' && !request.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found.' }));
}
const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
