import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  AI_PROVIDER: z.enum(['gemini', 'deepseek', 'fal', 'openai']).default('fal'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_FALLBACK_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(90000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
  GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32768).default(8192),
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_MODEL: z.string().min(1).default('deepseek-flash'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  FAL_KEY: z.string().default(''),
  FAL_MODEL: z.string().min(1).default('fal-ai/birefnet/v2'),
  FAL_OPERATING_RESOLUTION: z.enum(['1024x1024', '2048x2048', '2304x2304']).default('1024x1024'),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().min(1024).max(200 * 1024 * 1024).default(20 * 1024 * 1024),
  MAX_IMAGE_PIXELS: z.coerce.number().int().min(1_000_000).max(200_000_000).default(100_000_000),
  CORS_ORIGIN: z.string().optional(),
});

export const config = envSchema.parse(process.env);
