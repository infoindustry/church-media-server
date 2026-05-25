# Bible files for local integration

This folder is prepared for local Bible texts.

Recommended sources:

1. **Russian Synodal Translation / Синодальный перевод**
   - Repository: https://github.com/bibleonline/rst
   - Recommended source folder: `parsed66` or `usfm`
   - License note in repository README: Public Domain

2. **King James Version / KJV**
   - Repository: https://github.com/farskipper/kjv
   - Recommended file: `json/verses-1769.json`
   - License note in repository README: Public Domain / Unlicense

Run on a computer with internet:

```bash
node scripts/download-bibles.mjs
```

Downloaded files will be saved into:

```txt
vendor/bibles/raw/
```

Later we can convert them into the app format:

```txt
vendor/bibles/normalized/
```

The app already has an endpoint with the source list:

```txt
/api/bibles/sources
```


## Serbian / Crnogorski

Для сербского/черногорского текста добавлен отдельный импорт:

```bash
npm run import:serbian
```

Скрипт скачивает Serbian JSON из Free Use Bible API, автоматически выбирает доступный сербский перевод и добавляет его в `vendor/bibles/normalized/bibles.json` как `sr_latn`. Подробнее: `vendor/bibles/SERBIAN_SOURCE.md`.


## Serbian DK ekavski

В v1.3 добавлен загруженный SWORD-модуль `SrKDEkavski.zip` (Public Domain): Serbian Bible Daničić-Karadžić Ekavski. В приложении доступны `sr_latn` и `sr_cyrl`.
