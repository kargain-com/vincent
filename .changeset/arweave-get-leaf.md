---
"@kargain/vincent": minor
---

Add the public zero-dependency `@kargain/vincent/arweave` subpath with `createArweaveGetLeaf` for ANS-104 tag-query leaf discovery. This pairs with `@kargain/vincent/decoder` to give consumers the full client decode stack; `getLeaf` remains injectable, so Arweave is only the reference backend and mirrors, caches, or alternate sources can be supplied instead.
