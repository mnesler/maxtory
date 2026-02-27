# Attractor

A full-stack implementation of [StrongDM's Attractor](https://github.com/strongdm/attractor) — a DOT-based AI pipeline runner with a SolidJS dashboard.

## Structure

```
attractor/
├── backend/    TypeScript/Node.js API server + pipeline engine + agent loop
├── frontend/   SolidJS dashboard
└── examples/   Sample .dot pipeline files
```

## Prerequisites

- Node.js 20+
- (Optional) `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for real LLM calls

## Quick Start

Install all workspace dependencies from the monorepo root:

```bash
npm install
```

### Start the backend

```bash
cd backend
npm run dev
```

The API server starts on **http://localhost:3000** by default. Set `PORT` to override.

### Start the frontend (dev)

```bash
cd frontend
npm run dev
```

The dashboard opens on **http://localhost:5173**.

### Build for production

```bash
# backend
cd backend && npm run build

# frontend
cd frontend && npm run build
```

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Backend HTTP port (default: `3000`) |
| `ANTHROPIC_API_KEY` | Enables Claude models for LLM nodes |
| `OPENAI_API_KEY` | Enables OpenAI models for LLM nodes |

When no API keys are set the backend uses a simulated LLM response.

## Running a Pipeline

### Via REST API

```bash
# Start a run from a .dot file
curl -X POST http://localhost:3000/api/runs \
  -H "Content-Type: application/json" \
  -d '{"dot": "'"$(cat examples/hello_world.dot)"'", "input": "hello"}'

# Check run status
curl http://localhost:3000/api/runs/<run-id>

# Submit a human-gate answer
curl -X POST http://localhost:3000/api/runs/<run-id>/human-answer \
  -H "Content-Type: application/json" \
  -d '{"answer": "approved"}'
```

### Via Dashboard

Open the dashboard, paste or upload a `.dot` file on the **New Pipeline** page, and click **Run**.

## Pipeline DSL

Pipelines are [Graphviz DOT](https://graphviz.org/doc/info/lang.html) directed graphs. Node shapes map to handlers:

| Shape | Handler | Description |
|---|---|---|
| `Mdiamond` | start | Pipeline entry point |
| `Msquare` | exit | Pipeline exit point |
| `box` | codergen | LLM code-generation step |
| `hexagon` | wait.human | Human-in-the-loop gate |
| `diamond` | conditional | Branch on condition |
| `component` | parallel | Fork into parallel branches |
| `tripleoctagon` | parallel.fan_in | Join parallel branches |
| `parallelogram` | tool | Execute a tool/function |
| `house` | stack.manager_loop | Recursive stack manager |

See `examples/` for working pipelines.

## WebSocket Events

Connect to `ws://localhost:3000` to stream real-time events for all runs.
Each message is a JSON `AgentEvent` with `kind`, `runId`, `timestamp`, and `data`.
