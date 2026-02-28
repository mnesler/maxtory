// Commander Spellbook combo ingest
//
// Paginates the Commander Spellbook /variants API, filters to commander-legal
// combos, and upserts them into the local SQLite DB.
// After all pages are fetched, runs a reconciliation pass to resolve
// combo_cards.oracle_id from the cards table.
//
// Usage:
//   node dist/ingest/spellbook.js

import fetch from "node-fetch";
import { getDb } from "../db/client.js";

const BASE_URL = "https://backend.commanderspellbook.com/variants";
const PAGE_SIZE = 100;
// Be polite — 200ms between pages
const PAGE_DELAY_MS = 200;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SpellbookCard {
  card: {
    name: string;
    oracleId: string;
  };
}

interface SpellbookFeature {
  feature: { name: string };
}

interface SpellbookVariant {
  id: string;
  uses: SpellbookCard[];
  produces: SpellbookFeature[];
  description: string;
  manaNeeded: string;
  identity: string;           // color identity string e.g. "URG"
  popularity: number;
  bracketTag: string;
  legalities: Record<string, boolean>;
}

interface SpellbookPage {
  next: string | null;
  results: SpellbookVariant[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function j(value: unknown): string {
  return JSON.stringify(value ?? []);
}

// Commander Spellbook uses a string like "URG" for color identity.
// Convert to the JSON array format we use: ["U","R","G"]
function identityToArray(identity: string): string[] {
  return identity.split("").filter((c) => "WUBRG".includes(c));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const db = getDb();

  const upsertCombo = db.prepare(`
    INSERT INTO combos (
      id, card_names, produces, description,
      mana_needed, color_identity, popularity, bracket_tag
    ) VALUES (
      @id, @card_names, @produces, @description,
      @mana_needed, @color_identity, @popularity, @bracket_tag
    )
    ON CONFLICT(id) DO UPDATE SET
      card_names     = excluded.card_names,
      produces       = excluded.produces,
      description    = excluded.description,
      mana_needed    = excluded.mana_needed,
      color_identity = excluded.color_identity,
      popularity     = excluded.popularity,
      bracket_tag    = excluded.bracket_tag
  `);

  const upsertComboCard = db.prepare(`
    INSERT OR IGNORE INTO combo_cards (combo_id, card_name)
    VALUES (@combo_id, @card_name)
  `);

  let url: string | null = `${BASE_URL}?format=json&limit=${PAGE_SIZE}`;
  let totalVariants = 0;
  let page = 0;

  console.log("Fetching Commander Spellbook combos...");

  while (url) {
    page++;
    const res = await fetch(url, {
      headers: { "User-Agent": "MaxtoryMTG/1.0", Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Spellbook API error on page ${page}: ${res.status}`);
    }

    const data = (await res.json()) as SpellbookPage;
    const variants = data.results.filter((v) => v.legalities?.commander === true);

    db.exec("BEGIN");
    let inserted = 0;
    try {
      for (const v of variants) {
        const cardNames = v.uses.map((u) => u.card.name);
        const produces = v.produces.map((p) => p.feature.name);

        upsertCombo.run({
          id:             v.id,
          card_names:     j(cardNames),
          produces:       j(produces),
          description:    v.description ?? null,
          mana_needed:    v.manaNeeded ?? null,
          color_identity: j(identityToArray(v.identity ?? "")),
          popularity:     v.popularity ?? 0,
          bracket_tag:    v.bracketTag ?? null,
        });

        for (const name of cardNames) {
          upsertComboCard.run({ combo_id: v.id, card_name: name });
        }
        inserted++;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    totalVariants += inserted;
    process.stdout.write(`\r  Page ${page}: ${totalVariants} combos upserted so far...`);

    url = data.next ?? null;
    if (url) await sleep(PAGE_DELAY_MS);
  }

  console.log(`\nAll pages fetched. Total: ${totalVariants} combos.`);

  // ── Reconciliation pass ───────────────────────────────────────────────────
  // Resolve combo_cards.oracle_id for any rows where we now have the card.
  console.log("Resolving oracle_ids for combo_cards...");
  const reconcile = db.prepare(`
    UPDATE combo_cards
    SET oracle_id = (
      SELECT oracle_id FROM cards WHERE cards.name = combo_cards.card_name
    )
    WHERE oracle_id IS NULL
  `);
  const { changes } = reconcile.run();
  console.log(`Resolved ${changes} combo_cards rows.`);

  const unresolved = db
    .prepare("SELECT COUNT(*) as n FROM combo_cards WHERE oracle_id IS NULL")
    .get() as { n: number };

  if (unresolved.n > 0) {
    console.log(
      `Note: ${unresolved.n} combo_cards rows still have no oracle_id ` +
        "(cards not yet ingested from Scryfall, or token/template slots)."
    );
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Spellbook ingest failed:", err);
  process.exit(1);
});
