# SYXLOR BG Remover

A private-use web application for AI-assisted image background removal. The browser handles the queue and preview; a Node server sends the image to the provider selected by `AI_PROVIDER` and applies the returned segmentation to the oriented original image. The analysis copy may be resized, but the PNG export uses the original pixels and dimensions.

## Requirements

- Node.js 20 or later
- An API key for the provider selected by `AI_PROVIDER` (`fal`, `gemini`, `deepseek`, or `openai`)

## Run locally

```sh
npm install
cp .env.example .env
# Set AI_PROVIDER and add the matching provider key to .env
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies `/api` to the Fastify server on port 8787. The API key stays on the server.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API server port |
| `AI_PROVIDER` | `gemini` in `.env.example` | Image processing provider: `fal`, `gemini`, `deepseek`, or `openai` |
| `GEMINI_API_KEY` | unset | Server-side Google Gemini credential; required to process images |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model used for visual understanding and structured output |
| `GEMINI_FALLBACK_MODEL` | `gemini-3-flash-preview` | Gemini fallback model |
| `GEMINI_REQUEST_TIMEOUT_MS` | `90000` | Request timeout |
| `GEMINI_MAX_RETRIES` | `2` | Number of retries after invalid or failed model responses (capped at 4) |
| `GEMINI_MAX_OUTPUT_TOKENS` | `8192` | Maximum segmentation response size |
| `DEEPSEEK_API_KEY` | unset | Server-side DeepSeek credential; required when `AI_PROVIDER=deepseek` |
| `DEEPSEEK_MODEL` | `deepseek-flash` | DeepSeek vision-capable model |
| `OPENAI_API_KEY` | unset | Server-side OpenAI credential; required when `AI_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI vision model used to generate the foreground segmentation |
| `FAL_KEY` | unset | Server-side fal.ai credential; required when `AI_PROVIDER=fal` |
| `FAL_MODEL` | `fal-ai/birefnet/v2` | fal.ai background-removal endpoint |
| `FAL_OPERATING_RESOLUTION` | `1024x1024` | fal.ai mask inference resolution |
| `MAX_FILE_SIZE_BYTES` | `20971520` | Maximum upload size |
| `MAX_IMAGE_PIXELS` | `100000000` | Maximum decoded pixel count per source image |
| `CORS_ORIGIN` | disabled | Comma-separated browser origins allowed by the API; the local Vite proxy is same-origin |

For deployments, set `CORS_ORIGIN` to the exact site origin if the browser app and API use separate origins. Put the API behind HTTPS and a platform or network access control if it is intended for private use. Do not expose `.env` or log request bodies. No account system is included.

## Production build

```sh
npm run build
```

The frontend build is written to `dist/client` and the compiled server to `dist/server`. Set `NODE_ENV=production` and run `npm start`; the Fastify service serves the built client and the API from one origin.

Build and run the included container with `docker build -t syxlor-bg-remover .` and `docker run --rm -p 8787:8787 --env-file .env syxlor-bg-remover`.

## API

- `GET /api/health` returns server health, selected provider, and whether its credential is configured.
- `POST /api/remove-background` accepts multipart `file` (JPG, PNG, WebP), optional `keep` (Gemini/DeepSeek/OpenAI only), and `format` (`png`, `webp`, or `jpeg`) fields. JPEG uses the optional validated `background` hex color; PNG and WebP preserve transparency. It responds with the selected image format or a JSON error. The route is limited to 20 requests per minute per IP and the server processes at most two images concurrently. Uploaded bytes are processed in memory and are not written to disk.

The browser processes a batch sequentially to keep memory use controlled. Successful items can be downloaded individually or combined into a ZIP archive locally in the browser.

fal.ai BiRefNet returns a foreground mask. The server resizes the mask to the oriented source dimensions and applies it to the original pixels with Sharp before validating the output. Gemini, DeepSeek, and OpenAI return foreground polygons, which the server rasterizes into an alpha mask.

## Privacy and legal

See [Privacy Policy](public/privacy.html) and [Terms and Conditions](public/terms.html). Images are sent to the configured provider for background-removal processing. Syxlor does not persist images to disk or a database. Configure deployment access and log retention, and review the selected provider's terms for your environment.

## License

This project is licensed under the [MIT License](LICENSE).
