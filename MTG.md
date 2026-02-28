# MTG Card Database & LLM Tagging Pipeline

## What Was Built

### Workspace Setup
- Added `mtg/` as an npm workspace inside the `maxtory` monorepo
- `mtg/package.json` — runtime dep: `node-fetch`; devDeps: `typescript`, `tsx`,
  `@types/node@^22` (required for `node:sqlite` types)
- `mtg/tsconfig.json` — ES2022, NodeNext module resolution
- `mtg/.gitignore` — ignores `data/`, `dist/`, `node_modules/`

### Database (`mtg/src/db/`)
- **`schema.ts`** — four tables:
  - `cards` — one row per oracle ID, commander-legal cards only
  - `card_tags` — LLM-assigned tags per card (unique per oracle_id+tag)
  - `combos` — Commander Spellbook variants
  - `combo_cards` — join table: which cards appear in which combos, with
    resolved `oracle_id` after reconciliation
  - `tagging_runs` — audit trail for pipeline runs
- **`client.ts`** — singleton `DatabaseSync` (Node 22 built-in `node:sqlite`,
  no native compilation required), WAL mode, foreign keys on

### Ingest (`mtg/src/ingest/`)
- **`scryfall.ts`** — downloads Scryfall oracle_cards bulk JSON (~162 MB),
  filters to commander-legal, optional `--set=<code>` filter, upserts into
  `cards`. Handles double-faced cards (merges oracle text and colors from faces).
- **`spellbook.ts`** — paginates Commander Spellbook `/variants` API, upserts
  combos and combo_cards. Resumable (skips already-ingested rows via offset).
  Retries on 403/429/5xx with exponential backoff. Runs reconciliation pass
  to resolve `combo_cards.oracle_id` from the `cards` table after ingestion.

### Tagger (`mtg/src/tagger/`)
- **`prompt.ts`** — fixed vocabulary of 68 tags across 5 groups (Role,
  Resource, Trigger/Mechanic, Quantity, Sentinel). `buildSystemPrompt()`,
  `buildUserPrompt(card)`, `parseTagsFromResponse()` (extracts JSON array,
  filters to vocabulary, falls back to `needs-review`).
- **`tag_set.ts`** — CLI entry point for the pipeline tool node. Fetches one
  batch of untagged cards for a set, calls OpenRouter LLM per card, writes
  validated tags to `card_tags`. Outputs `{"outcome":"more"}` or
  `{"outcome":"done"}` to stdout for the pipeline engine.

### Pipeline (`mtg/pipelines/`)
- **`tag_set.dot`** — Graphviz DOT pipeline graph. Loops `tag_batch →
  check_done → tag_batch` until stdout contains `"done"`. Tool node uses
  `tool_command=` attribute (maps to `node.attrs.toolCommand` in the backend
  DOT parser).

### Data Ingested
| Table | Rows |
|---|---|
| `cards` | 30,395 commander-legal cards |
| `combos` | 44,336 (Spellbook API blocked before full completion; resumable) |
| `combo_cards` | 144,615 total; 144,408 resolved to oracle IDs; 207 unresolved (tokens/templates) |

---

## Plan Yet to Be Implemented

### 1. Tag a set via the pipeline
- Build a trigger script (`mtg/src/trigger.ts`) that:
  - Takes `--set=<code>` as an argument
  - Reads `pipelines/tag_set.dot`
  - Substitutes `SET_CODE` with the provided set code
  - POSTs `{ dotSource }` to `http://localhost:3001/api/runs`
  - Prints the run ID and a link to monitor progress
- Add a root-level npm script: `"tag": "node --experimental-sqlite mtg/dist/trigger.js"`
- Run the tagger against `dsk` (269 cards) as a first smoke test

### 2. Finish the Spellbook ingest
- Run `npm run ingest:spellbook --workspace=mtg` again when the IP block
  clears (auto-resumes from offset 44,336)

### 3. Query / recommendation layer (future)
- A read API (`GET /api/mtg/cards?tags=ramp,draw&colors=G,U`) over the
  tagged card DB
- Vector embeddings on oracle text for semantic similarity search
- Deck-building assistant: given a commander, suggest cards by tag profile
  and combo membership
