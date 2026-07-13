# Deepgram text translation pipeline

The `deepgram` engine keeps the existing OpenAI Realtime and Gemini modes unchanged.

Pipeline:

```text
Soundcraft / FFmpeg PCM16 24 kHz
  -> Deepgram Nova-3 streaming STT (one audio stream)
  -> OpenAI Responses text translation (one request per completed phrase)
  -> existing SSE subtitles for TV and audience phones
```

## Required secrets

```env
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...
```

Optional settings:

```env
DEEPGRAM_SOURCE_LANGUAGE=ru
DEEPGRAM_STT_MODEL=nova-3
OPENAI_TEXT_TRANSLATION_MODEL=gpt-4.1-mini
DEEPGRAM_ENDPOINTING_MS=600
DEEPGRAM_UTTERANCE_END_MS=1200
DEEPGRAM_FLUSH_MS=900
```

## Mini-PC local setup

Add the values to the `.env` file next to `package.json`, restart the server, then open the existing admin interface:

```text
http://MINI-PC-IP:4000/admin
```

Open **Перевод**, choose **Deepgram STT + OpenAI Text** in the same engine selector used for OpenAI and Gemini, choose the source language, and press **Запустить**.

The same card shows:

- Deepgram connection state
- STT model
- OpenAI text translation model
- pending translation queue
- the latest recognized source phrase
- Soundcraft audio health and target-language status

## Cloudflare Worker secret

Run this inside the Cloudflare Worker project that serves `CLOUD_SYNC_URL`:

```bash
npx wrangler secret put DEEPGRAM_API_KEY
```

For a named Worker when there is no `wrangler.jsonc`/`wrangler.toml` in the current directory:

```bash
npx wrangler secret put DEEPGRAM_API_KEY --name YOUR_WORKER_NAME
```

Wrangler will ask for the secret value interactively, so the key is not written into shell history.

Important: the Worker `/api/device/config` response must expose the secret to an authenticated mini-PC as:

```json
{
  "deepgramApiKey": "..."
}
```

The current `church-media-server` repository contains the mini-PC client, but not the Cloudflare Worker source that implements `/api/device/config`. Until that Worker is updated, also put `DEEPGRAM_API_KEY` in the mini-PC `.env` file.

Deepgram interim results are shown for microphone monitoring. Only finalized utterances are sent to OpenAI for translation, which prevents unstable partial text from generating repeated translation requests.
