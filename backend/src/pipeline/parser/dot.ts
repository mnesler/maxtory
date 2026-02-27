// DOT DSL Parser for Attractor pipelines
// Parses the restricted Graphviz DOT subset defined in the Attractor spec

export interface GraphAttrs {
  goal?: string;
  label?: string;
  modelStylesheet?: string;
  defaultMaxRetry?: number;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  defaultFidelity?: string;
  rankdir?: string;
  [key: string]: unknown;
}

export interface NodeAttrs {
  label?: string;
  shape?: string;
  type?: string;
  prompt?: string;
  maxRetries?: number;
  goalGate?: boolean;
  retryTarget?: string;
  fallbackRetryTarget?: string;
  fidelity?: string;
  threadId?: string;
  class?: string;
  timeout?: string;
  llmModel?: string;
  llmProvider?: string;
  reasoningEffort?: string;
  autoStatus?: boolean;
  allowPartial?: boolean;
  toolCommand?: string;
  humanDefaultChoice?: string;
  joinPolicy?: string;
  errorPolicy?: string;
  maxParallel?: number;
  managerPollInterval?: string;
  managerMaxCycles?: number;
  managerStopCondition?: string;
  managerActions?: string;
  [key: string]: unknown;
}

export interface EdgeAttrs {
  label?: string;
  condition?: string;
  weight?: number;
  fidelity?: string;
  threadId?: string;
  loopRestart?: boolean;
  [key: string]: unknown;
}

export interface GraphNode {
  id: string;
  attrs: NodeAttrs;
}

export interface GraphEdge {
  from: string;
  to: string;
  attrs: EdgeAttrs;
}

export interface ParsedGraph {
  id: string;
  attrs: GraphAttrs;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokenType =
  | "IDENT"
  | "STRING"
  | "NUMBER"
  | "ARROW"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "EQUALS"
  | "COMMA"
  | "SEMICOLON"
  | "EOF";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(source: string): Token[] {
  // Strip comments
  const stripped = source
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  const tokens: Token[] = [];
  let i = 0;

  while (i < stripped.length) {
    // Skip whitespace
    if (/\s/.test(stripped[i])) { i++; continue; }

    const pos = i;

    // Arrow
    if (stripped[i] === "-" && stripped[i + 1] === ">") {
      tokens.push({ type: "ARROW", value: "->", pos });
      i += 2;
      continue;
    }

    // Single-char tokens
    const single: Record<string, TokenType> = {
      "{": "LBRACE", "}": "RBRACE",
      "[": "LBRACKET", "]": "RBRACKET",
      "=": "EQUALS", ",": "COMMA", ";": "SEMICOLON",
    };
    if (stripped[i] in single) {
      tokens.push({ type: single[stripped[i]], value: stripped[i], pos });
      i++;
      continue;
    }

    // Quoted string
    if (stripped[i] === '"') {
      let str = "";
      i++;
      while (i < stripped.length && stripped[i] !== '"') {
        if (stripped[i] === "\\") {
          i++;
          const escapes: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", '"': '"' };
          str += escapes[stripped[i]] ?? stripped[i];
        } else {
          str += stripped[i];
        }
        i++;
      }
      i++; // closing quote
      tokens.push({ type: "STRING", value: str, pos });
      continue;
    }

    // Number
    if (/[-0-9]/.test(stripped[i]) && (stripped[i] !== "-" || /[0-9]/.test(stripped[i + 1] ?? ""))) {
      let num = "";
      if (stripped[i] === "-") { num += "-"; i++; }
      while (i < stripped.length && /[0-9.]/.test(stripped[i])) { num += stripped[i]; i++; }
      // Duration suffix
      const durationSuffix = stripped.slice(i).match(/^(ms|s|m|h|d)/);
      if (durationSuffix) {
        num += durationSuffix[0];
        i += durationSuffix[0].length;
      }
      tokens.push({ type: "NUMBER", value: num, pos });
      continue;
    }

    // Identifier
    if (/[A-Za-z_]/.test(stripped[i])) {
      let ident = "";
      while (i < stripped.length && /[A-Za-z0-9_.]/.test(stripped[i])) { ident += stripped[i]; i++; }
      tokens.push({ type: "IDENT", value: ident, pos });
      continue;
    }

    // Skip unknown chars
    i++;
  }

  tokens.push({ type: "EOF", value: "", pos: stripped.length });
  return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType): Token {
    const tok = this.consume();
    if (tok.type !== type) {
      throw new Error(`Expected ${type} but got ${tok.type} (${tok.value}) at pos ${tok.pos}`);
    }
    return tok;
  }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  private tryConsume(...types: TokenType[]): Token | null {
    if (this.check(...types)) return this.consume();
    return null;
  }

  parse(): ParsedGraph {
    // Optional: "digraph" keyword
    if (this.peek().type === "IDENT" && this.peek().value === "digraph") {
      this.consume();
    }

    let graphId = "G";
    if (this.peek().type === "IDENT" || this.peek().type === "STRING") {
      graphId = this.consume().value;
    }

    this.expect("LBRACE");

    const graph: ParsedGraph = {
      id: graphId,
      attrs: {},
      nodes: new Map(),
      edges: [],
    };

    // Default attr stacks
    let nodeDefaults: NodeAttrs = {};

    const parseValue = (): string => {
      const tok = this.peek();
      if (tok.type === "STRING" || tok.type === "IDENT" || tok.type === "NUMBER") {
        return this.consume().value;
      }
      return this.consume().value;
    };

    const parseAttrBlock = (): Record<string, string> => {
      const attrs: Record<string, string> = {};
      this.expect("LBRACKET");
      while (!this.check("RBRACKET", "EOF")) {
        const key = (this.peek().type === "IDENT" || this.peek().type === "STRING")
          ? this.consume().value
          : this.consume().value;
        this.expect("EQUALS");
        const val = parseValue();
        attrs[key] = val;
        this.tryConsume("COMMA");
      }
      this.expect("RBRACKET");
      return attrs;
    };

    const parseStatements = (scope: { nodeDefaults: NodeAttrs }) => {
      while (!this.check("RBRACE", "EOF")) {
        const tok = this.peek();

        // graph [ ... ]  -- graph attributes block
        if (tok.type === "IDENT" && tok.value === "graph" && this.tokens[this.pos + 1]?.type === "LBRACKET") {
          this.consume();
          const attrs = parseAttrBlock();
          Object.assign(graph.attrs, normalizeGraphAttrs(attrs));
          this.tryConsume("SEMICOLON");
          continue;
        }

        // node [ ... ] -- node defaults
        if (tok.type === "IDENT" && tok.value === "node" && this.tokens[this.pos + 1]?.type === "LBRACKET") {
          this.consume();
          const attrs = parseAttrBlock();
          scope.nodeDefaults = { ...scope.nodeDefaults, ...normalizeNodeAttrs(attrs) };
          this.tryConsume("SEMICOLON");
          continue;
        }

        // edge [ ... ] -- edge defaults (currently just skip)
        if (tok.type === "IDENT" && tok.value === "edge" && this.tokens[this.pos + 1]?.type === "LBRACKET") {
          this.consume();
          parseAttrBlock();
          this.tryConsume("SEMICOLON");
          continue;
        }

        // rankdir = ...  or  goal = ...  top-level KV
        if (
          (tok.type === "IDENT") &&
          this.tokens[this.pos + 1]?.type === "EQUALS" &&
          this.tokens[this.pos + 2]?.type !== "ARROW"
        ) {
          const key = this.consume().value;
          this.expect("EQUALS");
          const val = parseValue();
          this.tryConsume("SEMICOLON");
          // Check if it's not a node followed by edges
          if (
            this.peek().type !== "ARROW" &&
            !this.tokens.slice(this.pos, this.pos + 5).some((t) => t.type === "ARROW")
          ) {
            (graph.attrs as Record<string, unknown>)[toCamelCase(key)] = val;
            continue;
          }
        }

        // subgraph { ... }
        if (tok.type === "IDENT" && tok.value === "subgraph") {
          this.consume();
          // optional subgraph id
          if (this.peek().type === "IDENT") this.consume();
          this.expect("LBRACE");
          const subScope = { nodeDefaults: { ...scope.nodeDefaults } };
          parseStatements(subScope);
          this.expect("RBRACE");
          this.tryConsume("SEMICOLON");
          continue;
        }

        // Node or edge statement
        if (tok.type === "IDENT" || tok.type === "STRING") {
          const nodeId = this.consume().value;

          // Collect chain: A -> B -> C
          const chain: string[] = [nodeId];
          while (this.check("ARROW")) {
            this.consume(); // ->
            const next = this.peek();
            if (next.type === "IDENT" || next.type === "STRING") {
              chain.push(this.consume().value);
            }
          }

          // Attribute block
          let rawAttrs: Record<string, string> = {};
          if (this.check("LBRACKET")) {
            rawAttrs = parseAttrBlock();
          }
          this.tryConsume("SEMICOLON");

          if (chain.length === 1) {
            // Node statement
            const nodeAttrs = { ...scope.nodeDefaults, ...normalizeNodeAttrs(rawAttrs) };
            if (!graph.nodes.has(nodeId)) {
              graph.nodes.set(nodeId, { id: nodeId, attrs: nodeAttrs });
            } else {
              const existing = graph.nodes.get(nodeId)!;
              graph.nodes.set(nodeId, { id: nodeId, attrs: { ...existing.attrs, ...nodeAttrs } });
            }
          } else {
            // Edge chain: ensure nodes exist, add edges
            for (const id of chain) {
              if (!graph.nodes.has(id)) {
                graph.nodes.set(id, { id, attrs: { ...scope.nodeDefaults } });
              }
            }
            const edgeAttrs = normalizeEdgeAttrs(rawAttrs);
            for (let i = 0; i < chain.length - 1; i++) {
              graph.edges.push({ from: chain[i], to: chain[i + 1], attrs: { ...edgeAttrs } });
            }
          }
          continue;
        }

        // Skip unexpected tokens
        this.consume();
      }
    };

    parseStatements({ nodeDefaults });

    this.expect("RBRACE");
    return graph;
  }
}

// ─── Attribute normalizers ────────────────────────────────────────────────────

function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function parseBool(v: string): boolean {
  return v === "true" || v === "1";
}

function normalizeGraphAttrs(raw: Record<string, string>): GraphAttrs {
  const result: GraphAttrs = {};
  for (const [k, v] of Object.entries(raw)) {
    switch (k) {
      case "goal": result.goal = v; break;
      case "label": result.label = v; break;
      case "model_stylesheet": result.modelStylesheet = v; break;
      case "default_max_retry": result.defaultMaxRetry = parseInt(v); break;
      case "retry_target": result.retryTarget = v; break;
      case "fallback_retry_target": result.fallbackRetryTarget = v; break;
      case "default_fidelity": result.defaultFidelity = v; break;
      case "rankdir": result.rankdir = v; break;
      default: (result as Record<string, unknown>)[toCamelCase(k)] = v;
    }
  }
  return result;
}

function normalizeNodeAttrs(raw: Record<string, string>): NodeAttrs {
  const result: NodeAttrs = {};
  for (const [k, v] of Object.entries(raw)) {
    switch (k) {
      case "label": result.label = v; break;
      case "shape": result.shape = v; break;
      case "type": result.type = v; break;
      case "prompt": result.prompt = v; break;
      case "max_retries": result.maxRetries = parseInt(v); break;
      case "goal_gate": result.goalGate = parseBool(v); break;
      case "retry_target": result.retryTarget = v; break;
      case "fallback_retry_target": result.fallbackRetryTarget = v; break;
      case "fidelity": result.fidelity = v; break;
      case "thread_id": result.threadId = v; break;
      case "class": result.class = v; break;
      case "timeout": result.timeout = v; break;
      case "llm_model": result.llmModel = v; break;
      case "llm_provider": result.llmProvider = v; break;
      case "reasoning_effort": result.reasoningEffort = v; break;
      case "auto_status": result.autoStatus = parseBool(v); break;
      case "allow_partial": result.allowPartial = parseBool(v); break;
      case "tool_command": result.toolCommand = v; break;
      case "human.default_choice": result.humanDefaultChoice = v; break;
      case "join_policy": result.joinPolicy = v; break;
      case "error_policy": result.errorPolicy = v; break;
      case "max_parallel": result.maxParallel = parseInt(v); break;
      case "manager.poll_interval": result.managerPollInterval = v; break;
      case "manager.max_cycles": result.managerMaxCycles = parseInt(v); break;
      case "manager.stop_condition": result.managerStopCondition = v; break;
      case "manager.actions": result.managerActions = v; break;
      default: (result as Record<string, unknown>)[toCamelCase(k)] = v;
    }
  }
  return result;
}

function normalizeEdgeAttrs(raw: Record<string, string>): EdgeAttrs {
  const result: EdgeAttrs = {};
  for (const [k, v] of Object.entries(raw)) {
    switch (k) {
      case "label": result.label = v; break;
      case "condition": result.condition = v; break;
      case "weight": result.weight = parseInt(v); break;
      case "fidelity": result.fidelity = v; break;
      case "thread_id": result.threadId = v; break;
      case "loop_restart": result.loopRestart = parseBool(v); break;
      default: (result as Record<string, unknown>)[toCamelCase(k)] = v;
    }
  }
  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function parseDot(source: string): ParsedGraph {
  const parser = new Parser(source);
  return parser.parse();
}

export function getOutgoingEdges(graph: ParsedGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function getIncomingEdges(graph: ParsedGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

export function findStartNode(graph: ParsedGraph): GraphNode | undefined {
  for (const node of graph.nodes.values()) {
    if (node.attrs.shape === "Mdiamond") return node;
    if (node.id.toLowerCase() === "start") return node;
  }
  return undefined;
}

export function findExitNode(graph: ParsedGraph): GraphNode | undefined {
  for (const node of graph.nodes.values()) {
    if (node.attrs.shape === "Msquare") return node;
    if (node.id.toLowerCase() === "exit") return node;
  }
  return undefined;
}

export function resolveHandlerType(node: GraphNode): string {
  if (node.attrs.type) return node.attrs.type;
  const shapeMap: Record<string, string> = {
    Mdiamond: "start",
    Msquare: "exit",
    box: "codergen",
    hexagon: "wait.human",
    diamond: "conditional",
    component: "parallel",
    tripleoctagon: "parallel.fan_in",
    parallelogram: "tool",
    house: "stack.manager_loop",
  };
  return shapeMap[node.attrs.shape ?? "box"] ?? "codergen";
}
