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
- **Photoreal results through your own ChatGPT or Gemini.** Mode prepares the
  photo with the area to change outlined plus a precise instruction; you paste
  it into the ChatGPT or Gemini app (your subscription) and bring the result
  back by pasting, dropping or downloading it. Mode lines it up with your
  photo, corrects colour drift and keeps every pixel outside the area exactly
  as photographed, then shows it in staging to accept or reject. Image API
  keys are optional for fully automatic renders.
- **Compare and refine.** Generate several takes, or *compare* one question
  (the path in four stone sizes, everything else unchanged) in a labeled
  grid. From any result: *More like this*, *Refine*, *Use as base*, favorite,
  before/after slider, download. History branches from any result.
- **Grounded in real architecture, themes and purpose.** A built-in design
  knowledge base (architectural styles, design themes, and rules of thumb
  such as a 4–5 ft entry walk that leads clearly to the door) shapes the
  options, the AI's reasoning and its recommendations.
- **Plants that will actually grow there.** Your ZIP code fills in the USDA
  hardiness zone offline; plant choices are checked against zone, each
  spot's sun hours (from the photo's compass heading or a compass you set),
  water, mature size, deer pressure and the USGS invasive-species list, with
  frost dates and soil from NOAA and USDA. Render plants as planted, after
  ~3 years, or mature.
- **Free on-device precision.** Small models running in your browser sharpen
  the AI's zone outlines to exact edges, let you tap to select an area, and
  can map a photo with no AI key at all.
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
| `ANTHROPIC_API_KEY` | Recommended. Scene understanding (architecture, sun, routes), design planning, element options, recommendations, idea descriptions, product search (Claude). |
| `OPENAI_API_KEY` | Optional: automatic renders with GPT Image (`OPENAI_IMAGE_MODEL`, default `gpt-image-2.5-flare`). |
| `GEMINI_API_KEY` | Optional: automatic renders with Google Gemini (`GEMINI_IMAGE_MODEL`). |
| `IMAGE_PROVIDER` | Default image provider when image keys are set (`openai` or `gemini`). |
| `HANDOFF_WATCH_DIR` | Folder to watch for downloaded hand-off results (default `~/Downloads`). |

With no keys at all, Mode still works: renders go through the manual hand-off
to your ChatGPT or Gemini app, plans come from built-in templates, scenes can
be mapped on your device, and Fine-tune needs nothing. Tips for the hand-off:
start a new chat for each image, use *Download full size* (not right-click),
and on Gemini with a Google AI plan use *More → Redo with Pro*; on a free
Gemini account ChatGPT usually edits better.

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

## Data sources

Hardiness zones are derived from the USDA/OSU PRISM 2023 map (via phzmapi.org;
not the official USDA map); invasive flags come from USGS US-RIIS v2.0 (CC0);
frost dates from NOAA 1991–2020 climate normals; soil from USDA Soil Data
Access. See [public/data/ATTRIBUTION.md](public/data/ATTRIBUTION.md). Rebuild
the bundled tables with `npm run build:site-data`. The optional on-device
SegFormer model is under NVIDIA's non-commercial licence and is only
downloaded after you agree.

## Development

```bash
npm run typecheck      # TypeScript
npm test               # unit tests (vitest)
npm run test:e2e       # browser smoke tests (Playwright)
```

Architecture and module contracts are documented in [SPEC.md](SPEC.md).
