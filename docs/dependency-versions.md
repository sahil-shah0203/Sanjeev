# Dependency versions and provenance

Generated from installed direct dependency metadata. Exact transitive resolution is in both lockfiles. Do not infer full license clearance from this inventory. The project remains private; source-deck rights are separate from software licenses.

Node recommended: 22.12+; exercised locally: 22.11.0 on Windows. Package manager: pnpm 10.34.6; installation/tests here also use npm 10.9.0.

| Package | Pinned version | Declared license | Use |
| --- | --- | --- | --- |
| @supabase/ssr | 0.12.7 | MIT | Runtime |
| @supabase/supabase-js | 2.117.2 | MIT | Runtime |
| @zip.js/zip.js | 2.23.0 | BSD-3-Clause | Runtime |
| dexie | 4.4.6 | Apache-2.0 | Runtime |
| dexie-react-hooks | 4.4.0 | Apache-2.0 | Runtime |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) | Runtime |
| fzstd | 0.1.1 | MIT | Runtime |
| katex | 0.19.0 | MIT | Runtime |
| lucide-react | 1.51.0 | ISC | Runtime |
| next | 16.3.8 | MIT | Runtime |
| pg | 8.23.1 | MIT | Runtime |
| react | 19.3.0 | MIT | Runtime |
| react-dom | 19.3.0 | MIT | Runtime |
| sql.js | 1.14.2 | MIT | Runtime |
| ts-fsrs | 5.4.2 | MIT | Runtime |
| zod | 4.6.5 | MIT | Runtime |
| @axe-core/playwright | 4.13.0 | MPL-2.0 | Development |
| @biomejs/biome | 2.5.15 | MIT OR Apache-2.0 | Development |
| @electric-sql/pglite | 0.5.8 | Apache-2.0 | Development |
| @playwright/test | 1.63.0 | Apache-2.0 | Development |
| @tailwindcss/postcss | 4.3.3 | MIT | Development |
| @types/jsdom | 30.0.0 | MIT | Development |
| @types/katex | 0.16.8 | MIT | Development |
| @types/node | 22.20.5 | MIT | Development |
| @types/pg | 8.23.1 | MIT | Development |
| @types/react | 19.3.0 | MIT | Development |
| @types/react-dom | 19.3.0 | MIT | Development |
| @types/sql.js | 1.4.11 | MIT | Development |
| fake-indexeddb | 6.2.5 | Apache-2.0 | Development |
| jsdom | 26.1.0 | MIT | Development |
| pnpm | 10.34.6 | MIT | Development |
| prettier | 3.9.9 | MIT | Development |
| railway | 3.12.0 | MIT | Development |
| supabase | 2.119.0 | MIT | Development |
| tailwindcss | 4.3.3 | MIT | Development |
| tsx | 4.23.15 | MIT | Development |
| typescript | 7.0.2 | Apache-2.0 | Development |
| vitest | 4.1.11 | MIT | Development |

## Format references

Anki discovery sources were checked against upstream reference commit `f5a0b608069094c1cf461b2d5998f1a285e68021` (2026-09-11 reference snapshot, not a claim to be the newest commit).

- [Package metadata and media fields](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/proto/anki/import_export.proto)
- [Note-type config fields](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/proto/anki/notetypes.proto)
- [Archive member selection](https://github.com/ankitects/anki/blob/f5a0b608069094c1cf461b2d5998f1a285e68021/rslib/src/import_export/package/meta.rs)
- [Zstandard frame format, RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html)

The wire/frame reader is an independent restricted implementation; Anki runtime code and generated protobuf files are not vendored. Anki upstream code carries AGPL terms. Any future copied/generated upstream code needs an explicit licensing review. Runtime package license texts are emitted into `apps/web/public/third-party-licenses.txt` during the build, including the licenses accompanying copied SQL WASM and KaTeX assets. Package installs preserve their own notices.

The browser uses an SVG icon drawn in repository source and system fonts. No generated stock imagery or external font service is required. The private sample is neither bundled nor licensed for public demo use.
