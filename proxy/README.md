# Optional AI proxy (Cloudflare Worker)

Use this if you'd rather not keep an API key on the headset.

1. Create a Cloudflare Worker and paste in `worker.js`.
2. Add secrets: `ACCESS_TOKEN` (any long random string) and `ANTHROPIC_API_KEY`. Optionally add `OPENAI_API_KEY` to enable transcription.
3. Add a variable: `ALLOWED_ORIGIN` = `https://kactus528.github.io`.
4. In the app go to **AI Guide → My own proxy**. Set the Proxy URL to your Worker URL and the access token to your `ACCESS_TOKEN`.

The Worker stores and logs nothing. It checks the token and origin, then forwards the request.
