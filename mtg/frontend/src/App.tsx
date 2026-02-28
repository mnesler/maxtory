// MTG Deck Advisor — main application layout.
//
// Two-panel layout:
//   Left  — DeckLoader (load from Moxfield URL or paste)
//   Right — ChatWindow (RAG-powered assistant with deck context)

import { createSignal, Show } from "solid-js";
import DeckLoader from "./components/DeckLoader.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import CardTooltip from "./components/CardTooltip.jsx";
import type { LoadDeckResponse, DeckCard, SessionInfo } from "./api/mtg.js";
import { checkSession } from "./api/mtg.js";
import "./styles.css";

// Generate a session ID once per page load so the deck and chat share the same
// server-side session (and thus the same loadedDeck).
const SESSION_ID = crypto.randomUUID();

export default function App() {
  const [deckInfo, setDeckInfo] = createSignal<LoadDeckResponse | null>(null);
  const [sessionOk, setSessionOk] = createSignal<boolean | null>(null); // null=checking, true=ok, false=broken

  async function handleDeckLoaded(response: LoadDeckResponse, _cards: DeckCard[]) {
    setDeckInfo(response);
    setSessionOk(null);

    // Immediately verify the server-side session actually has the deck attached.
    // This catches the most common failure mode: server was restarted between
    // deck load and chat, so the in-memory session is gone.
    const info: SessionInfo | null = await checkSession(SESSION_ID);
    if (info?.hasDeck) {
      setSessionOk(true);
    } else {
      setSessionOk(false);
      console.warn("[session] Session check failed — hasDeck is false. Server may have restarted.", info);
    }
  }

  return (
    <div class="advisor-layout">
      <CardTooltip />
      {/* Header */}
      <header class="advisor-header">
        <div class="advisor-logo">
          <span class="advisor-logo-icon">◈</span>
          <span class="advisor-logo-text">MTG Deck Advisor</span>
        </div>
        <div class="advisor-header-sub">
          AI-powered Commander deck analysis · Powered by RAG + Scryfall data
        </div>
        {/* Session health indicator — only shown after a deck is loaded */}
        <Show when={deckInfo() !== null}>
          <div class="session-indicator">
            <Show when={sessionOk() === null}>
              <span class="session-badge session-checking">
                <span class="spinner spinner-sm" /> verifying session…
              </span>
            </Show>
            <Show when={sessionOk() === true}>
              <span class="session-badge session-ok">
                ● deck context active
              </span>
            </Show>
            <Show when={sessionOk() === false}>
              <span class="session-badge session-broken" title="The server may have restarted. Reload the page and re-load your deck.">
                ⚠ session lost — reload page &amp; re-load deck
              </span>
            </Show>
          </div>
        </Show>
      </header>

      {/* Two-panel body */}
      <div class="advisor-body">
        {/* Left panel — Deck Loader */}
        <aside class="advisor-deck-panel">
          <div class="panel-title">Your Deck</div>
          <DeckLoader
            sessionId={SESSION_ID}
            onDeckLoaded={handleDeckLoaded}
          />
        </aside>

        {/* Right panel — Chat */}
        <main class="advisor-chat-panel">
          <div class="panel-title">Deck Advisor Chat</div>
          <ChatWindow
            sessionId={SESSION_ID}
            deckLoaded={deckInfo() !== null && sessionOk() !== false}
            deckName={deckInfo()?.name}
            sessionBroken={sessionOk() === false}
          />
        </main>
      </div>
    </div>
  );
}
