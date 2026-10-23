import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import { segmentationPrompt } from './prompt.js';
import { config } from '../config.js';

const subjectSchema = z.object({
  label: z.string().min(1).max(80),
  polygon: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(300),
});
const resultSchema = z.object({ subjects: z.array(subjectSchema).min(1).max(30) });
export type Segmentation = z.infer<typeof resultSchema>;

function isTemporaryAvailabilityError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: number | string; code?: number | string; message?: string };
  const status = String(candidate.status ?? candidate.code ?? '').toUpperCase();
  const message = (candidate.message || '').toUpperCase();
  return ['429', '500', '502', '503', '504', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED'].includes(status)
    || /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|HIGH DEMAND|RATE LIMIT|TEMPORARILY UNAVAILABLE/.test(message);
}

async function generateWithDeepSeek(bytes: Buffer, mimeType: string, timeoutMs: number, keepDescription?: string): Promise<string> {
  if (!config.DEEPSEEK_API_KEY) throw Object.assign(new Error('Background removal is unavailable: configure DEEPSEEK_API_KEY on the server.'), { statusCode: 503 });
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${segmentationPrompt}${keepDescription ? `\nThe user specifically wants to keep: ${keepDescription}` : ''}\nReturn only a JSON object matching this shape: {"subjects":[{"label":"subject","polygon":[[0.1,0.2],[0.2,0.3],[0.3,0.2]]}]}.` },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'high' } },
      ] }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: config.GEMINI_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
    }),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string | null } }> } | null;
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `DeepSeek request failed with HTTP ${response.status}.`;
    const message = response.status === 402
      ? 'DeepSeek API balance is insufficient. Add credit to the DeepSeek API account or configure a funded key, then retry.'
      : apiMessage;
    const statusCode = response.status === 402 ? 402 : response.status === 429 || response.status >= 500 ? 503 : 502;
    throw Object.assign(new Error(message), { status: response.status, statusCode });
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('DeepSeek returned an empty segmentation response.');
  return text;
}

async function generateWithOpenAI(bytes: Buffer, mimeType: string, timeoutMs: number, keepDescription?: string): Promise<string> {
  if (!config.OPENAI_API_KEY) throw Object.assign(new Error('Background removal is unavailable: configure OPENAI_API_KEY on the server.'), { statusCode: 503 });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${segmentationPrompt}${keepDescription ? `\nThe user specifically wants to keep: ${keepDescription}` : ''}\nReturn only a JSON object matching this shape: {"subjects":[{"label":"subject","polygon":[[0.1,0.2],[0.2,0.3],[0.3,0.2]]}]}.` },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'high' } },
      ] }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: config.GEMINI_MAX_OUTPUT_TOKENS,
    }),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string; type?: string }; choices?: Array<{ message?: { content?: string | null } }> } | null;
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    const noCredits = payload?.error?.code === 'credit_balance_exhausted' || payload?.error?.type === 'insufficient_quota';
    const message = noCredits
      ? 'OpenAI API credits are exhausted. Add credit in the OpenAI API billing settings, then retry.'
      : apiMessage;
    const statusCode = noCredits ? 402 : response.status === 429 || response.status >= 500 ? 503 : response.status === 401 || response.status === 403 ? response.status : 502;
    throw Object.assign(new Error(message), { status: response.status, statusCode });
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty segmentation response.');
  return text;
}

async function generateWithGemini(bytes: Buffer, mimeType: string, model: string, timeoutMs: number, keepDescription?: string, retry = false): Promise<string> {
  const response = await new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }).models.generateContent({
    model,
    contents: [{ role: 'user', parts: [
      { text: `${segmentationPrompt}${keepDescription ? `\nThe user specifically wants to keep: ${keepDescription}` : ''}${retry ? '\nReturn a complete, valid segmentation response following the schema exactly.' : ''}` },
      { inlineData: { mimeType, data: bytes.toString('base64') } },
    ] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: { subjects: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          label: { type: Type.STRING },
          polygon: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } },
        }, required: ['label', 'polygon'] } } },
        required: ['subjects'],
      },
      temperature: 0,
      maxOutputTokens: config.GEMINI_MAX_OUTPUT_TOKENS,
      httpOptions: { timeout: timeoutMs },
    },
  });
  if (!response.text) throw new Error('Gemini returned an empty segmentation response.');
  return response.text;
}

export async function segmentImage(bytes: Buffer, mimeType: string, keepDescription?: string): Promise<Segmentation> {
  const provider = config.AI_PROVIDER;
  const deadline = Date.now() + config.GEMINI_REQUEST_TIMEOUT_MS;
  const timeoutError = () => Object.assign(new Error(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'openai' ? 'OpenAI' : 'Gemini'} processing timed out. Try again with a smaller image.`), { statusCode: 504 });
  if (provider === 'gemini' && !config.GEMINI_API_KEY) throw Object.assign(new Error('Background removal is unavailable: configure GEMINI_API_KEY on the server.'), { statusCode: 503 });
  if (provider === 'deepseek' && !config.DEEPSEEK_API_KEY) throw Object.assign(new Error('Background removal is unavailable: configure DEEPSEEK_API_KEY on the server.'), { statusCode: 503 });
  if (provider === 'openai' && !config.OPENAI_API_KEY) throw Object.assign(new Error('Background removal is unavailable: configure OPENAI_API_KEY on the server.'), { statusCode: 503 });

  let lastError: unknown;
  let lastErrorWasAvailability = false;
  const models = provider === 'deepseek' ? [config.DEEPSEEK_MODEL] : provider === 'openai' ? [config.OPENAI_MODEL] : [...new Set([config.GEMINI_MODEL, config.GEMINI_FALLBACK_MODEL])];
  for (const [modelIndex, model] of models.entries()) {
    const attempts = config.GEMINI_MAX_RETRIES + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const timeoutMs = deadline - Date.now();
      if (timeoutMs <= 0) throw timeoutError();
      try {
        const text = provider === 'deepseek'
          ? await generateWithDeepSeek(bytes, mimeType, timeoutMs, keepDescription)
          : provider === 'openai'
            ? await generateWithOpenAI(bytes, mimeType, timeoutMs, keepDescription)
            : await generateWithGemini(bytes, mimeType, model, timeoutMs, keepDescription, attempt > 0);
        const result = resultSchema.parse(JSON.parse(text));
        if (!result.subjects.length) throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'openai' ? 'OpenAI' : 'Gemini'} could not detect a clear foreground subject. Try an image with a more distinct subject.`);
        return result;
      } catch (error) {
        if (Date.now() >= deadline) throw timeoutError();
        lastError = error;
        const statusCode = (error as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 401 || statusCode === 402 || statusCode === 403) throw error;
        lastErrorWasAvailability = isTemporaryAvailabilityError(error);
        if (lastErrorWasAvailability && modelIndex + 1 < models.length) break;
        if (attempt + 1 < attempts) {
          const delay = Math.min(400 * (attempt + 1), deadline - Date.now());
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
  }
  if (lastErrorWasAvailability) throw Object.assign(new Error(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'openai' ? 'OpenAI' : 'Gemini'} is temporarily busy or rate limited. Please try again shortly.`), { statusCode: 503 });
  if (lastError instanceof z.ZodError || lastError instanceof SyntaxError) throw new Error(`${provider === 'deepseek' ? 'DeepSeek' : provider === 'openai' ? 'OpenAI' : 'Gemini'} could not return a valid segmentation after retrying.`);
  throw lastError;
}
