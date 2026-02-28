// MTG Deck Advisor — main application layout.
//
// Two-panel layout:
//   Left  — DeckLoader (load from Moxfield URL or paste)
//   Right — ChatWindow (RAG-powered assistant with deck context)

import { createSignal } from "solid-js";
import DeckLoader from "./components/DeckLoader.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import type { LoadDeckResponse, DeckCard } from "./api/mtg.js";
import "./styles.css";

// Generate a session ID once per page load so the deck and chat share the same
// server-side session (and thus the same loadedDeck).
const SESSION_ID = crypto.randomUUID();

export default function App() {
  const [deckInfo, setDeckInfo] = createSignal<LoadDeckResponse | null>(null);

  function handleDeckLoaded(response: LoadDeckResponse, _cards: DeckCard[]) {
    setDeckInfo(response);
  }

  return (
    <div class="advisor-layout">
      {/* Header */}
      <header class="advisor-header">
        <div class="advisor-logo">
          <span class="advisor-logo-icon">◈</span>
          <span class="advisor-logo-text">MTG Deck Advisor</span>
        </div>
        <div class="advisor-header-sub">
          AI-powered Commander deck analysis · Powered by RAG + Scryfall data
        </div>
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
            deckLoaded={deckInfo() !== null}
            deckName={deckInfo()?.name}
          />
        </main>
      </div>
    </div>
  );
}
