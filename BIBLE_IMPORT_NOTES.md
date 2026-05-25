# Bible integration notes

В этой версии уже подключены тексты из переданного архива:

- `ru_synodal` — Русский Синодальный перевод
- `en_kjv` — King James Version

Нормализованный файл:

```txt
vendor/bibles/normalized/bibles.json
```

Админка использует его через API:

```txt
GET  /api/bible/translations
GET  /api/bible/lookup?reference=Ин%203:16&translations=ru_synodal,en_kjv
POST /api/bible/show-reference
POST /api/bible/add-reference-to-plan
```

Сербский/черногорский перевод пока не найден в переданном архиве, поэтому чекбокс `Srpski/Crnogorski` в админке показан как недоступный. Когда будет файл с сербским/черногорским текстом, его нужно добавить как отдельную translation id, например:

```txt
sr_latn
```

После этого чекбокс автоматически станет активным, если перевод будет добавлен в `vendor/bibles/normalized/bibles.json`.
