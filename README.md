# MinimalPairs

Source repository for the rebuilt MinimalPairs listening product.

- `rescue/app`: Astro/React website, lesson player, guides and Firebase configuration.
- `rescue/content`: phoneme/word banks and content validation.
- `rescue/audio-reports`: private recording-report and support endpoint.
- `rescue/audio/studio`: local generation and audio QA tools.
- `speech-lab`: isolated speaking-feedback research. Start with [the technical roadmap](SPEECH-ROADMAP.md) and [current experiment status](speech-lab/STATUS.md).

## Local development

From `rescue/app`, run `npm ci`, create `.env` using `.env.example`, then run `npm run dev`.
Run `npm test` and `npm run check` for application checks.


## Deployment

`npm run deploy:preview` publishes a noindex preview using local environment configuration.
`node scripts/deploy-preview.mjs --production --build-only` builds and audits the production release without publishing.
The same command without `--build-only` publishes; use only after the domain, authentication and billing configuration are ready.

## Development history

MinimalPairs rescue development began September 28, 2026. The current GitHub branch began October 4 from the rebuilt application. The earlier development branch contains 33 commits from September 28 through October 1 and is archived separately.

## License

Original MinimalPairs software in this repository is licensed under the [Mozilla Public License 2.0](LICENSE). Third-party materials retain their own licenses. No license to MinimalPairs branding, standalone recordings, or commercial decks is granted here.
