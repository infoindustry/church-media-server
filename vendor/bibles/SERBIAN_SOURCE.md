# Serbian / Crnogorski Bible source

## Recommended integration for this project

Use the importer:

```bash
npm run import:serbian
```

The script uses **Free Use Bible API**:

- available translations endpoint: `https://bible.helloao.org/api/available_translations.json`
- books endpoint: `https://bible.helloao.org/api/{translation}/books.json`
- chapter endpoint: `https://bible.helloao.org/api/{translation}/{book}/{chapter}.json`

It searches for Serbian candidates automatically, downloads all chapters, normalizes them into:

```txt
vendor/bibles/normalized/bibles.json
```

and adds:

```txt
sr_latn — Srpski / Crnogorski latinica
```

If the source text is Cyrillic, the importer also transliterates it to Latin and stores the original as `sr_cyrl`.

## Manual choice

If several Serbian translations are found, you can choose one manually:

```bash
SERBIAN_TRANSLATION_ID=TRANSLATION_ID npm run import:serbian
```

## Alternative sources found

1. STEP Bible / Biblica Open New Serbian Translation Latin
   - `https://www.stepbible.org/version.jsp?version=SrpNSPl`
   - Good contemporary Serbian Latin source, used for Montenegro/Serbia.
   - License requires copyright notice and share-alike terms.

2. WordProject Serbian Holy Bible
   - `https://www.wordproject.org/download/bibles/`
   - Has an offline Serbian download.
   - Useful as backup/manual source, but verify copyright/distribution terms before bundling publicly.
