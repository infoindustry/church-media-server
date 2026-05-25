# Download status

The project is prepared for Bible integration, but the full Bible source files were not embedded during this build because the sandbox environment could not download GitHub JSON/API files directly.

What is included:

- `vendor/bibles/sources.json`
- `vendor/bibles/README.md`
- `scripts/download-bibles.mjs`
- `/api/bibles/sources`

Run this on the mini-PC or your Mac with internet:

```bash
node scripts/download-bibles.mjs
```

It will download:

- English KJV JSON from `farskipper/kjv`.
- Russian Synodal `parsed66` files from `bibleonline/rst`.

After that, the next development step is converting/importing the downloaded files into fast local verse search.
