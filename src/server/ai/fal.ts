import { createFalClient } from '@fal-ai/client';
import { config } from '../config.js';

type FalFile = { url?: string };

export async function requestFalMask(image: Buffer): Promise<Buffer> {
  if (!config.FAL_KEY) throw Object.assign(new Error('Background removal is unavailable: configure FAL_KEY on the server.'), { statusCode: 503 });
  const fal = createFalClient({ credentials: config.FAL_KEY });
  let response;
  try {
    response = await fal.subscribe(config.FAL_MODEL, {
      input: {
        image_url: `data:image/png;base64,${image.toString('base64')}`,
        model: 'General Use (Light)',
        operating_resolution: config.FAL_OPERATING_RESOLUTION,
        output_mask: true,
        mask_only: true,
        sync_mode: true,
      },
    });
  } catch (error) {
    const apiError = error as { status?: number; body?: { detail?: string }; message?: string };
    const detail = `${apiError.body?.detail || ''} ${apiError.message || ''}`;
    if (/exhausted balance|insufficient balance/i.test(detail)) {
      throw Object.assign(new Error('fal.ai API balance is exhausted. Add credit to the fal.ai account, then retry.'), { statusCode: 402 });
    }
    throw Object.assign(new Error(apiError.message || 'fal.ai could not process this image.'), { statusCode: apiError.status === 429 || (apiError.status || 0) >= 500 ? 503 : 502 });
  }
  const payload = response.data as { image?: FalFile; mask_image?: FalFile };
  const maskUrl = payload.mask_image?.url || payload.image?.url;
  if (!maskUrl) throw new Error('fal.ai returned no segmentation mask.');
  if (maskUrl.startsWith('data:')) {
    const comma = maskUrl.indexOf(',');
    if (comma < 0) throw new Error('fal.ai returned an invalid mask data URL.');
    const data = maskUrl.slice(comma + 1);
    return maskUrl.slice(0, comma).includes(';base64') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data));
  }
  const maskResponse = await fetch(maskUrl);
  if (!maskResponse.ok) throw new Error(`Could not download the fal.ai mask (HTTP ${maskResponse.status}).`);
  return Buffer.from(await maskResponse.arrayBuffer());
}
