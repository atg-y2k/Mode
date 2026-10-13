# Mode — Home Redesign Studio

Upload a photo of your house (the front, the yard, a room) and see how it
could look: describe an idea, compose it from simple design elements, and
compare photoreal variations side by side.

- **It understands the photo.** Mode categorizes each photo (front of house,
  front yard, kitchen…) and maps it: facade, roof, front door, porch,
  walkway, driveway, lawn, planting beds, the yard's border, trees / walls,
  floor, cabinetry… It also describes the routes (for example from the
  driveway to the front door), the sun exposure, and the house's
  architectural style.
- **You describe the rendition with design elements, not drag and drop.**
  Add a *Pathway* and Mode asks you visual questions with swatches to compare,
  such as stone size (large flagstone, medium pavers, small cobbles, pea
  gravel), shape, width, edging and lighting. Other elements include border
  edging, planting beds, lawn, patio, outdoor lighting, front door, exterior
  paint, wall paint, flooring, interior lighting and cabinets. Add a free-text
  prompt, pick the areas that may change, and generate.
- **Compare and refine.** Generate several takes, or *compare* one question
  (the path in four stone sizes, everything else unchanged) in a labeled
  grid. From any result: *More like this*, *Refine*, *Use as base*, favorite,
  before/after slider, download.
- **Grounded in real architecture, themes and purpose.** A built-in design
  knowledge base (architectural styles, design themes, and rules of thumb
  such as a 4–5 ft entry walk that leads clearly to the door) shapes the
  options, the AI's reasoning and its recommendations.
- **Plants that will actually grow there.** Outdoor plant choices are checked
  against your hardiness zone and climate (from your ZIP code), each spot's
  sun, water needs and mature size, and you can render plants as newly
  planted, established or mature.
- **Idea board.** Collect inspiration images, notes, design themes and real
  products (AI search of Home Depot, Lowe's and nurseries, or paste a link).
  Generations and suggestions draw on it.
- **Fine-tune.** A secondary mode with precise hand tools: outline surfaces,
  exact paint colors, material textures, lighting and time of day, and
  placing plants and fixtures.

Projects, photos and results stay in your browser (IndexedDB). AI requests go
out only when you run them.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install
cp .env.example .env   # add your keys (see below)
npm run dev            # app on http://localhost:5173, API on :8787
```

### Keys

| Variable | Used for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Scene understanding, design planning, element options, recommendations, idea descriptions, product search (Claude). |
| `OPENAI_API_KEY` | Photoreal variations with OpenAI's image model (`OPENAI_IMAGE_MODEL`, default `gpt-image-1`). |
| `GEMINI_API_KEY` | Photoreal variations with Google Gemini (`GEMINI_IMAGE_MODEL`, default `gemini-2.5-flash-image`). |
| `IMAGE_PROVIDER` | Default image provider (`openai` or `gemini`); you can switch per run in the app. |

Configure at least one image provider for photoreal variations. Fine-tune
mode works without any keys.

### Production

```bash
npm run build
npm start              # one Node process serves the app and the API on $PORT (default 8787)
```

If you expose the server beyond your own network, set `MODE_ACCESS_TOKEN` and
enter the same token under **Settings → Server access token**.

The server only answers to IP addresses, `localhost`, this computer's name
(and `<name>.local`) and `HOST`; any other name in the `Host` header gets a
403, which keeps web pages from reaching it through DNS rebinding. If you reach
Mode under a domain name — a reverse proxy that passes the original `Host`
header, a public domain, a Tailscale name — add it to `MODE_ALLOWED_HOSTS`
(comma-separated; a leading dot allows all subdomains, e.g.
`MODE_ALLOWED_HOSTS=mode.example.com,.home.example.net`). Behind a reverse
proxy, also set `TRUST_PROXY=true` so the AI rate limit sees each client's
address; the Downloads watcher then needs `MODE_ACCESS_TOKEN`.

## Development

```bash
npm run typecheck      # TypeScript
npm test               # unit tests (vitest)
npm run test:e2e       # browser smoke tests (Playwright)
```

Architecture and module contracts are documented in [SPEC.md](SPEC.md).
