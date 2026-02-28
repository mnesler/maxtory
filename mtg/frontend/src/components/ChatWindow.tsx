// ChatWindow — multi-turn SSE chat against the MTG assistant.
//
// Features:
//   - Streams tokens as they arrive
//   - Shows an intent badge (deck-build, combo-find, etc.)
//   - Shows retrieval stats (N cards, M combos)
//   - Auto-scrolls to the latest message
//   - Supports multi-turn (session is maintained server-side)

import {
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { streamChat } from "../api/mtg.js";
import type { IntentData, RetrievedData } from "../api/mtg.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = "user" | "assistant" | "system";

interface Message {
  id: string;
  role: Role;
  content: string;
  intent?: IntentData;
  retrieved?: RetrievedData;
  streaming?: boolean;
}

// ── Intent badge colours ──────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, string> = {
  "deck-build":   "#6366f1",
  "combo-find":   "#a78bfa",
  "tag-search":   "#38bdf8",
  "card-lookup":  "#22c55e",
  "power-assess": "#f59e0b",
  "general":      "#64748b",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

let msgCounter = 0;
function uid() { return String(++msgCounter); }

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sessionId: string;
  deckLoaded: boolean;
  deckName?: string;
  sessionBroken?: boolean;
}

export default function ChatWindow(props: Props) {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [input, setInput] = createSignal("");
  const [streaming, setStreaming] = createSignal(false);
  let bottomRef!: HTMLDivElement;
  let inputRef!: HTMLTextAreaElement;
  let cancelStream: (() => void) | null = null;

  // When a deck is first loaded, add a welcoming system message
  createEffect(() => {
    if (props.deckLoaded && messages().length === 0) {
      setMessages([
        {
          id: uid(),
          role: "system",
          content: props.deckName
            ? `Deck "${props.deckName}" loaded. Ask me to analyse it, suggest improvements, find combos, or recommend cuts.`
            : "Deck loaded. Ask me to analyse it, suggest improvements, find combos, or recommend cuts.",
        },
      ]);
    }
  });

  // Auto-scroll whenever messages change
  createEffect(() => {
    messages(); // track
    setTimeout(() => bottomRef?.scrollIntoView({ behavior: "smooth" }), 50);
  });

  onCleanup(() => cancelStream?.());

  function appendMessage(msg: Message) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateLastAssistantToken(token: string) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant" && last.streaming) {
        copy[copy.length - 1] = { ...last, content: last.content + token };
      }
      return copy;
    });
  }

  function finaliseLastAssistant(intent?: IntentData, retrieved?: RetrievedData) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") {
        copy[copy.length - 1] = { ...last, streaming: false, intent, retrieved };
      }
      return copy;
    });
  }

  function send() {
    const text = input().trim();
    if (!text || streaming()) return;

    setInput("");
    setStreaming(true);

    // Add user message
    appendMessage({ id: uid(), role: "user", content: text });

    // Add placeholder assistant message that will be streamed into
    const assistantId = uid();
    appendMessage({ id: assistantId, role: "assistant", content: "", streaming: true });

    let capturedIntent: IntentData | undefined;
    let capturedRetrieved: RetrievedData | undefined;

    cancelStream = streamChat(text, props.sessionId, {
      onIntent: (intent) => { capturedIntent = intent; },
      onRetrieved: (r) => { capturedRetrieved = r; },
      onToken: (token) => updateLastAssistantToken(token),
      onDone: () => {
        finaliseLastAssistant(capturedIntent, capturedRetrieved);
        setStreaming(false);
        cancelStream = null;
        setTimeout(() => inputRef?.focus(), 50);
      },
      onError: (msg) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            copy[copy.length - 1] = {
              ...last,
              content: last.content || `Error: ${msg}`,
              streaming: false,
            };
          }
          return copy;
        });
        setStreaming(false);
        cancelStream = null;
      },
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  onMount(() => {
    if (!props.deckLoaded) inputRef?.focus();
  });

  return (
    <div class="chat-window">
      {/* Session broken banner */}
      <Show when={props.sessionBroken}>
        <div class="session-broken-banner">
          ⚠ The server session was lost (server may have restarted). Please reload the page and re-load your deck before chatting.
        </div>
      </Show>

      {/* Message list */}
      <div class="chat-messages">
        <Show when={messages().length === 0}>
          <div class="chat-empty">
            <div class="chat-empty-icon">◈</div>
            <p>Load a deck to get started, then ask anything about it.</p>
            <p class="chat-empty-examples">
              Try: <em>"What ramp am I missing?"</em> · <em>"Find combos for my commander"</em> · <em>"What should I cut?"</em>
            </p>
          </div>
        </Show>

        <For each={messages()}>
          {(msg) => <ChatMessage msg={msg} />}
        </For>

        <div ref={bottomRef!} />
      </div>

      {/* Input area */}
      <div class="chat-input-area">
        <textarea
          ref={inputRef!}
          class="chat-input"
          rows={2}
          placeholder={
            props.sessionBroken
              ? "Session lost — reload the page and re-load your deck"
              : props.deckLoaded
              ? "Ask about your deck… (Enter to send, Shift+Enter for newline)"
              : "Load a deck first, then ask your questions here…"
          }
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming() || !!props.sessionBroken}
        />
        <button
          class="btn btn-primary send-btn"
          onClick={send}
          disabled={streaming() || !input().trim() || !!props.sessionBroken}
        >
          <Show when={streaming()} fallback="Send">
            <span class="spinner" />
          </Show>
        </button>
      </div>
    </div>
  );
}

// ── ChatMessage ───────────────────────────────────────────────────────────────

function ChatMessage(props: { msg: Message }) {
  const msg = props.msg;

  if (msg.role === "system") {
    return (
      <div class="chat-msg chat-msg-system">
        <span class="chat-msg-icon">◈</span>
        <span>{msg.content}</span>
      </div>
    );
  }

  if (msg.role === "user") {
    return (
      <div class="chat-msg chat-msg-user">
        <div class="chat-bubble chat-bubble-user">
          <Markdown text={msg.content} />
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div class="chat-msg chat-msg-assistant">
      {/* Meta bar: intent badge + retrieval stats */}
      <Show when={msg.intent || msg.retrieved}>
        <div class="chat-meta">
          <Show when={msg.intent}>
            {(intent) => (
              <span
                class="intent-badge"
                style={`background: ${INTENT_COLORS[intent().type] ?? "#64748b"}22; color: ${INTENT_COLORS[intent().type] ?? "#94a3b8"}; border-color: ${INTENT_COLORS[intent().type] ?? "#64748b"}55`}
              >
                {intent().type}
              </span>
            )}
          </Show>
          <Show when={msg.retrieved}>
            {(r) => (
              <span class="retrieval-stats">
                {r().cardCount} cards · {r().comboCount} combos
                <Show when={!r().hasEmbeddings}>
                  {" "}· <span class="no-embeddings">(no embeddings)</span>
                </Show>
              </span>
            )}
          </Show>
        </div>
      </Show>

      <div class="chat-bubble chat-bubble-assistant">
        <Markdown text={msg.content} />
        <Show when={msg.streaming && !msg.content}>
          <span class="cursor-blink">▌</span>
        </Show>
      </div>
    </div>
  );
}

// ── Markdown renderer (lightweight) ──────────────────────────────────────────
// Renders common markdown patterns without a full library dependency:
// - **bold**, *italic*, `code`, ### headings, - bullet lists, blank line = paragraph

function Markdown(props: { text: string }) {
  const html = () => markdownToHtml(props.text);
  // eslint-disable-next-line solid/no-innerhtml
  return <div class="markdown" innerHTML={html()} />;
}

function markdownToHtml(text: string): string {
  if (!text) return "";

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  let html = escaped;

  // Headings
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rule
  html = html.replace(/^---+$/gm, "<hr/>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bullet lists — consecutive "- " lines become <ul><li>
  html = html.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, (match) => {
    const items = match
      .trim()
      .split("\n")
      .map((l) => `<li>${l.replace(/^[ \t]*[-*+] /, "").trim()}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  });

  // Paragraphs — blank lines between text
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      // Don't wrap block-level elements in <p>
      if (/^<(h[1-6]|ul|ol|li|hr|blockquote|pre|div)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");

  return html;
}
