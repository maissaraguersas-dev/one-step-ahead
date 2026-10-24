# One Step Ahead

One tiny step at a time — for when a task feels too big to start.

Maya has a research paper due Friday. She's opened her laptop four times today,
looked at the words "Write research paper," felt a wall of dread, and closed it
again. Task-list apps and AI planners hand her a 10-step checklist, which makes
the paralysis worse. She doesn't need a plan. She needs the next 30 seconds.

**One Step Ahead never shows the mountain. It shows exactly one tiny step — and
when a step still feels too heavy, one tap makes it smaller.**

## Quick start (Demo mode — no key, no setup)

**Option A — just open it:**

```
double-click index.html
```

**Option B — one-line static server (recommended):**

```
npx serve .          # or: python3 -m http.server 8000
```

Then open the shown URL. Demo mode is a built-in offline engine with
hand-written micro-steps for three sample goals (writing, coding, a dreaded
email) plus a generic fallback ladder for anything else. A small badge in the
UI always says when you're in Demo mode.

## Live mode (with an Anthropic API key)

Requires Node 18+ (the proxy uses built-in `fetch`; there is nothing to
`npm install` — zero dependencies).

```
cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY=sk-ant-...
npm start
# open http://localhost:3000
```

- The key is read **only** from the environment (`.env` is git-ignored). It is
  never committed and never sent to the browser.
- `MODEL` (default `claude-sonnet-4-5`) and `PORT` (default `3000`) are
  configurable in `.env` or the environment.
- If the key is missing, the network is down, or the API misbehaves, the app
  automatically falls back to Demo mode — it never dead-ends.

## How it works

```
Start screen ──"Show me the first step"──> One step, big and calm
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                    "Done ✓"             "Too heavy"          "This step
                        │                     │               doesn't fit"
                 next single step     strictly smaller step   same-size different step
                        │                     │
                        ▼                     ▼
                ... until the model      (repeatable, down to
                 says the goal is done.   "Take one slow breath.")
                        │
                        ▼
                 "You did it." screen
```

- **You never see future steps, a step count, or a full list** — anywhere in
  the UI, the DOM, or the console. There is no "see all steps" feature, by
  design.
- After each "Done ✓" you get one short warm acknowledgment and a small tally
  that only counts up ("3 steps so far"). No streaks, no guilt, no red.
- **Take a break** pauses and saves state (also survives a refresh — state
  lives in `localStorage`, wrapped in `try/catch`).
- **Start over** asks for a second tap (a 3-second window, no modal) so a
  stray click can't wipe a session.

### The LLM layer

- The model must reply with **exactly one micro-step as strict JSON** — no
  preamble, no markdown, no lists. Every reply is validated against the
  schema: one sentence, ≤ 20 words, starts with a verb, no "and then", no
  lists, no future steps, `estimated_seconds` ≤ 120.
- Invalid output triggers up to **2 corrective retries**, then a **built-in
  safe step** takes over (from the demo engine).
- **"Too heavy"** sends the rejected step plus a shrink level. Level 1 =
  just open/look, level 2 = body-only setup, level 3+ = pure physical or
  sensory actions ("Put one hand on your mouse or trackpad").
- Temperature is fixed at **0.4** (set server-side). Conversation context is
  capped at the last 8 completed steps to keep latency low.
- All prompts are editable constants in `prompts.js` (system prompt, next /
  smaller / alternate templates, corrective message, few-shot examples).

### Files

| File            | What it is                                              |
|-----------------|---------------------------------------------------------|
| `index.html`    | Semantic single-page UI (6 calm screens)                |
| `styles.css`    | Light/dark themes, calm palette, accessibility styling |
| `app.js`        | Flow, state, validation orchestration, fallbacks        |
| `prompts.js`    | The LLM behavior contract (edit prompts here)           |
| `demo-engine.js`| Offline step engine (demo mode / safe fallback)        |
| `server.js`     | Static server + Anthropic proxy (< 60 lines, no deps)   |
| `test.js`       | Dependency-free test suite (`node test.js`)            |
| `.env.example`  | Config template — copy to `.env`, never commit `.env`  |

## Testing

```
npm test        # or: node test.js
```

The suite unit-tests the output validator, the shrink ladder, state
persistence, the retry/fallback paths (with a fake API), demo-engine behavior
across many goals (including empty, emoji, non-English, 2000-character and
prompt-injection inputs), WCAG contrast ratios for both themes (parsed from
`styles.css`), and static safety checks (one-step-only DOM, no HTML-string
rendering, no `console.*`, no committed keys, `server.js` < 60 lines).

For a real-browser end-to-end regression (28 checks: all flows, hostile
inputs, a11y assertions), with the server running and the
[`agent-browser`](https://github.com/vercel-labs/agent-browser) CLI installed:

```
bash e2e.sh
```

## Accessibility

- WCAG 2.2 AA: all text contrast ≥ 4.5:1 in **both** themes (verified
  numerically in `test.js`), visible focus rings, full keyboard operation
  (Enter submits / Enter = Done on the step screen).
- `aria-live="polite"` announcements for step changes; semantic HTML;
  every input labeled; skip link.
- Respects `prefers-reduced-motion` (nothing moves) and
  `prefers-color-scheme` (light/dark via CSS variables).
- Step text ≥ 28px on desktop, generous whitespace, one focal point per
  screen, touch targets ≥ 48px.
- **Bigger text** toggle and an **Easier reading** toggle (dyslexia-friendlier
  font stack with extra letter/word spacing — a CSS-based OpenDyslexic-style
  option, chosen so the app stays 100% offline and dependency-free).
- Calm palette: soft neutrals, one muted pine accent. No red, no flashing,
  no pressure timers.
- Responsive from 320px up.

## Privacy

Goals and step history stay on the device (`localStorage`). In live mode, the
goal text and the last few completed steps are sent to the Anthropic API via
your own proxy. No analytics, no accounts, no tracking.

## Limitations

Not a medical or therapeutic tool. Live-mode quality depends on the LLM.
English-first. No user studies have been run. Demo mode offers a limited set
of hand-written breakdowns.

## License

MIT.
