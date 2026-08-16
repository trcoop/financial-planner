# DIY Financial Planner

A browser-based financial planning engine with real-time projection and Monte Carlo simulation. Plan your financial future with interactive scenarios and probabilistic outcomes.

## Features

- **Real-time Projection** — Instantly see how your finances evolve over time
- **Monte Carlo Simulation** — Understand the probability range of outcomes
- **Zero Network Calls** — All computation happens in your browser. No data leaves your device.
- **Interactive Scenarios** — Adjust parameters and see results update live

## Quick Start

```bash
npm install
npm run dev
```

Visit http://localhost:5173 in your browser.

## Commands

- `npm run dev` — Start dev server (Vite)
- `npm test` — Run tests (Vitest + React Testing Library)
- `npm run build` — Type-check + production build
- `npm run lint` — Lint code (oxlint)

## Tech Stack

- **Frontend:** React + TypeScript
- **Build:** Vite
- **Testing:** Vitest + React Testing Library
- **Linting:** oxlint

## Architecture

See [`architecture.md`](./architecture.md) for how the system is structured, including:
- Separation of concerns (engine, UI, storage)
- Web Worker strategy
- Type-safe error handling

## Project Structure

```
src/
├── engine/      Pure calculation functions (projection, Monte Carlo)
├── ui/          React components with live state
└── storage/     localStorage persistence layer
```

## Design Philosophy

- **No external state management** — React's built-in state is sufficient
- **Type safety** — All errors are typed, not string-based
- **Zero network dependency** — No CDNs, analytics, or telemetry after page load
- **Fast feedback** — Dev server and tests run instantly

## Contributing

See [`CLAUDE.md`](./CLAUDE.md) for contributing guidelines and project constraints.

## License

MIT
