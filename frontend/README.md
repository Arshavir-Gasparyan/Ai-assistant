# Frontend: Next.js (App Router) + Tailwind

UI only. Talks to the backend over HTTP and SSE via `src/lib/api.ts`. Holds no secrets.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:4000
npm install
npm run dev                  # http://localhost:3000 (start the backend too)
npm run lint
npm run build
```

Structure:

```
src/
├── app/              routes: / (Dashboard), /assistant, /search
├── components/       nav, backend status indicator, shared UI
└── lib/api.ts        typed fetch wrapper + endpoint functions
```

> This is Next.js 16 with Cache Components enabled. Version-specific docs are bundled in
> `node_modules/next/dist/docs/` (see `AGENTS.md`).
