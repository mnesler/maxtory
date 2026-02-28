// DeckLoader — two-tab input for loading a deck by Moxfield URL or raw paste.
//
// After a successful load it displays:
//   - Commander name badge
//   - Card count
//   - Scrollable card list grouped by section

import { createSignal, createMemo, For, Show } from "solid-js";
import type { LoadDeckResponse, DeckCard } from "../api/mtg.js";
import { loadDeckFromMoxfield, loadDeckFromPaste } from "../api/mtg.js";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  sessionId: string;
  onDeckLoaded: (response: LoadDeckResponse, cards: DeckCard[]) => void;
}

// ── Section display order / labels ────────────────────────────────────────────

const SECTION_ORDER = ["commander", "companion", "mainboard", "sideboard", "maybeboard"] as const;
const SECTION_LABELS: Record<string, string> = {
  commander: "Commander",
  companion: "Companion",
  mainboard: "Mainboard",
  sideboard: "Sideboard",
  maybeboard: "Maybeboard",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DeckLoader(props: Props) {
  const [activeTab, setActiveTab] = createSignal<"moxfield" | "paste">("moxfield");
  const [moxfieldUrl, setMoxfieldUrl] = createSignal("");
  const [decklist, setDecklist] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [warnings, setWarnings] = createSignal<string[]>([]);
  const [loadedDeck, setLoadedDeck] = createSignal<LoadDeckResponse | null>(null);
  const [loadedCards, setLoadedCards] = createSignal<DeckCard[]>([]);

  // Group cards by section for display (derived from loadedCards)
  const cardsBySection = createMemo(() => {
    const cards = loadedCards();
    const grouped = new Map<string, DeckCard[]>();
    for (const section of SECTION_ORDER) {
      const sectionCards = cards.filter((c) => c.section === section);
      if (sectionCards.length > 0) grouped.set(section, sectionCards);
    }
    return grouped;
  });

  async function handleLoad() {
    setError(null);
    setWarnings([]);
    setLoading(true);

    try {
      if (activeTab() === "moxfield") {
        const url = moxfieldUrl().trim();
        if (!url) {
          setError("Please enter a Moxfield deck URL.");
          return;
        }
        const response = await loadDeckFromMoxfield(url, props.sessionId);
        setLoadedDeck(response);
        setLoadedCards([]); // Moxfield response doesn't return card list inline
        if (response.warnings?.length) setWarnings(response.warnings);
        props.onDeckLoaded(response, []);
      } else {
        const text = decklist().trim();
        if (!text) {
          setError("Please paste a decklist.");
          return;
        }
        const response = await loadDeckFromPaste(text, props.sessionId);
        // Parse the paste locally to get the card list for display
        const parsedCards = parseDecklistLocally(text);
        setLoadedCards(parsedCards);
        setLoadedDeck(response);
        if (response.warnings?.length) setWarnings(response.warnings);
        props.onDeckLoaded(response, parsedCards);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setLoadedDeck(null);
    setLoadedCards([]);
    setError(null);
    setWarnings([]);
    setMoxfieldUrl("");
    setDecklist("");
  }

  return (
    <div class="deck-loader">
      <Show
        when={!loadedDeck()}
        fallback={<DeckDisplay deck={loadedDeck()!} cardsBySection={cardsBySection()} warnings={warnings()} onReset={handleReset} />}
      >
        <div class="deck-input-panel">
          {/* Tab bar */}
          <div class="tabs">
            <button
              class={`tab${activeTab() === "moxfield" ? " active" : ""}`}
              onClick={() => setActiveTab("moxfield")}
            >
              Moxfield URL
            </button>
            <button
              class={`tab${activeTab() === "paste" ? " active" : ""}`}
              onClick={() => setActiveTab("paste")}
            >
              Paste Decklist
            </button>
          </div>

          {/* Input area */}
          <Show when={activeTab() === "moxfield"}>
            <div class="input-group">
              <label class="input-label">Moxfield deck URL</label>
              <input
                type="text"
                class="input"
                placeholder="https://moxfield.com/decks/abc123..."
                value={moxfieldUrl()}
                onInput={(e) => setMoxfieldUrl(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLoad()}
              />
              <p class="hint">Only public decks are supported.</p>
            </div>
          </Show>

          <Show when={activeTab() === "paste"}>
            <div class="input-group">
              <label class="input-label">Paste decklist</label>
              <textarea
                rows={14}
                placeholder={`// Commander\n1 Atraxa, Praetors' Voice\n\n// Mainboard\n1 Sol Ring\n1 Arcane Signet\n...`}
                value={decklist()}
                onInput={(e) => setDecklist(e.currentTarget.value)}
              />
              <p class="hint">Standard format (e.g. Moxfield, Archidekt, MTGO, MTGA exports).</p>
            </div>
          </Show>

          {/* Error */}
          <Show when={error()}>
            <div class="alert alert-error">{error()}</div>
          </Show>

          {/* Load button */}
          <button
            class="btn btn-primary w-full"
            onClick={handleLoad}
            disabled={loading()}
          >
            <Show when={loading()} fallback="Load Deck">
              <span class="spinner" />
              Loading...
            </Show>
          </button>
        </div>
      </Show>
    </div>
  );
}

// ── DeckDisplay ───────────────────────────────────────────────────────────────

interface DeckDisplayProps {
  deck: LoadDeckResponse;
  cardsBySection: Map<string, DeckCard[]>;
  warnings: string[];
  onReset: () => void;
}

function DeckDisplay(props: DeckDisplayProps) {
  return (
    <div class="deck-display">
      {/* Header */}
      <div class="deck-header">
        <div>
          <div class="deck-name">
            {props.deck.name ?? "Loaded Deck"}
          </div>
          <div class="deck-meta">
            <Show when={props.deck.commanders.length > 0}>
              <span class="commander-badge">
                {props.deck.commanders.join(" / ")}
              </span>
            </Show>
            <span class="card-count">{props.deck.cardCount} cards</span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onClick={props.onReset}>
          Change Deck
        </button>
      </div>

      {/* Warnings */}
      <Show when={props.warnings.length > 0}>
        <div class="alert alert-warn">
          <For each={props.warnings}>
            {(w) => <div>{w}</div>}
          </For>
        </div>
      </Show>

      {/* Card list grouped by section */}
      <div class="card-list">
        <Show
          when={props.cardsBySection.size > 0}
          fallback={
            <p class="muted" style="padding: 8px 0;">
              Deck loaded from Moxfield. The LLM has full visibility of your card list.
            </p>
          }
        >
          <For each={[...props.cardsBySection.entries()]}>
            {([section, cards]) => (
              <div class="card-section">
                <div class="section-header">
                  {SECTION_LABELS[section] ?? section}
                  <span class="section-count">{cards.reduce((n, c) => n + c.quantity, 0)}</span>
                </div>
                <For each={cards}>
                  {(card) => (
                    <div class="card-item">
                      <span class="card-qty">{card.quantity}</span>
                      <span class="card-name">{card.name}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

// ── Local parser for display (mirrors backend logic, lightweight) ──────────────
// We re-parse on the frontend solely to show the card list; the authoritative
// parse is done server-side.

function parseDecklistLocally(text: string): DeckCard[] {
  const CARD_RE = /^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s*\d*)?$/;
  const lines = text.split(/\r?\n/);
  const cards: DeckCard[] = [];
  let section: DeckCard["section"] = "mainboard";

  for (const line of lines) {
    const t = line.trim();
    if (!t || t === "//") continue;

    const lower = t.toLowerCase();
    if (/^(?:\/\/\s*|#+\s*)?commanders?/i.test(t)) { section = "commander"; continue; }
    if (/^(?:\/\/\s*|#+\s*)?companions?/i.test(t)) { section = "companion"; continue; }
    if (/^(?:\/\/\s*|#+\s*)?(?:sideboard|sb:?)/i.test(t)) { section = "sideboard"; continue; }
    if (/^(?:\/\/\s*|#+\s*)?(?:maybeboard|maybe)/i.test(t)) { section = "maybeboard"; continue; }
    if (/^(?:\/\/\s*|#+\s*)?(?:deck|mainboard|main)/i.test(t)) { section = "mainboard"; continue; }

    void lower; // suppress unused var

    let workLine = t;
    let forcedSection = section;
    if (/^SB:\s*/i.test(workLine)) {
      workLine = workLine.replace(/^SB:\s*/i, "");
      forcedSection = "sideboard";
    }

    const m = CARD_RE.exec(workLine);
    if (m) {
      cards.push({ quantity: parseInt(m[1]!, 10), name: m[2]!.trim(), section: forcedSection });
    }
  }

  return cards;
}
