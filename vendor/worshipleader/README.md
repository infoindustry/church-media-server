# Worship Leader song sources

Put downloaded Worship Leader / OpenSong exports here before importing them.

Recommended layout:

```txt
vendor/worshipleader/opensong/ru/
vendor/worshipleader/opensong/en/
vendor/worshipleader/opensong/uk/
vendor/worshipleader/mp3-links.csv
```

Each language folder should contain the extracted OpenSong XML song files.
The OpenSong XML export contains lyrics/chords metadata, but not MP3 URLs.
Do not import these files into the working song catalog directly; use them only
as a staging source to extract Worship Leader song IDs and match a separate MP3
metadata source.

`mp3-links.csv` is the active Worship Leader MP3 source used by the server. It
contains remote MP3 metadata and semicolon-separated categories for ru/en/uk.
It stays separate from the working audio catalog until a track is selected or
downloaded locally. When a matching OpenSong XML file is present, the TV screen
can show MP3 playback together with manually paged lyrics.
