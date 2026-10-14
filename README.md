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
  grid. From any result: *More like this*, *Refine*, favorite, before/after
  slider, download, and *Use as base* to make your next run edit that result.
  Otherwise every run starts from your original photo — looking at a result
  doesn't change that — and the Review shows what it starts from. History
  branches from any result.
- **Grounded in real architecture, themes and purpose.** A built-in design
  knowledge base (architectural styles, design themes, and rules of thumb
  such as a 4–5 ft entry walk that leads clearly to the door) shapes the
  options, the AI's reasoning and its recommendations.
- **Plants that will actually grow there.** Your ZIP code fills in the USDA
  hardiness zone offline; plant choices are checked against zone, each
  spot's sun hours (from the photo's compass heading or a compass you set),
  water, mature size, deer pressure (Rutgers ratings) and invasive plants,
  with frost dates and soil from NOAA and USDA. Full sun means 6+ hours of
  direct sun, part sun 3–6 hours, shade under 3. Known problem plants (Japanese
  barberry, burning bush, Bradford pear…) get a caution; plants the USGS
  national list includes somewhere in the country get a note to check your
  state's list. Render plants as planted, after ~3 years, or mature.
- **Free on-device precision.** Small models running in your browser sharpen
  the AI's zone outlines to exact edges, let you tap to select an area, and
  can map a photo with no AI key at all. The free map says what it didn't
  find (often the front door, porch or planting beds); add those with *Tap to
  select*.
- **Idea board.** Collect inspiration images, notes, design themes and real
  products (AI search of Home Depot, Lowe's and nurseries, or paste a link).
  Generations and suggestions draw on it.
- **Fine-tune.** A secondary mode with precise hand tools: outline surfaces,
  exact paint colors, material textures, lighting and time of day, and
  placing plants and fixtures.

Projects, photos and results stay in your browser (IndexedDB). AI requests go
out only when you run them. If the page reloads — or the browser unloads the
tab while you're in ChatGPT — Mode reopens the project you were in, waiting
hand-offs included; *All projects* takes you back to the projects page. If the browser runs out of storage space, Mode
says so: delete old runs or photos, or back up and delete a project under
**Settings → Storage**.

## Quick start (no keys needed)

You need **Node.js 22.13 or newer** (`node -v` in a terminal shows yours):
install the current LTS version from https://nodejs.org (npm comes with it).
No API keys or accounts are needed to try Mode.

1. **Get the code.** On https://github.com/atg-y2k/Mode click
   **Code → Download ZIP** and unzip it. You get a folder named
   `Mode-claude-home-redesign-studio` (on Windows, *Extract All* may put it
   inside a folder of the same name: use the one that contains
   `package.json`). Or, with Git (this makes a folder named `Mode`):

   ```
   git clone https://github.com/atg-y2k/Mode.git
   ```

   There is only one branch, so there is nothing to switch.
2. **Open a terminal in that folder.**
   - macOS: open **Terminal** (Applications → Utilities), type `cd` and a
     space, drag the folder onto the Terminal window and press Return. If
     macOS asks whether Terminal may access files in your Downloads folder,
     click **Allow**: Mode's folder is in there.
   - Windows: open the folder in File Explorer, click the address bar, type
     `cmd` and press Enter. This opens **Command Prompt** in the folder; use
     it rather than PowerShell.
3. **Install** (once; it downloads a few hundred MB and can take a few
   minutes):

   ```
   npm install
   ```

4. **Start Mode:**

   ```
   npm run dev
   ```

5. When the terminal shows `Local: http://localhost:5173/`, open
   **http://localhost:5173** in Chrome or Edge. Keep the terminal open while
   you use Mode. To stop Mode, click the terminal and press **Ctrl+C** (on
   Windows, answer `Y` to "Terminate batch job?"). Next time, do steps 2, 4
   and 5 again.

You may see these; they are harmless:

- `.env not found. Continuing without it.` The `.env` file only holds
  optional keys and settings (see [Keys](#keys-optional)).
- `npm notice New major version of npm available`: you don't need to update
  npm.
- Windows asking whether Node.js may use your network: **Cancel** is fine,
  Mode keeps working on this computer (only phones on your Wi-Fi need it).
- macOS asking whether Terminal may access your Downloads folder when you
  turn on *Watch my Downloads folder* (only if Mode's folder is somewhere
  else): allow it so results import by themselves, or decline and paste or
  drop results instead.

If something goes wrong:

- PowerShell says running scripts is disabled: use Command Prompt (step 2),
  or type `npm.cmd` instead of `npm`.
- `npm` is not recognized or not found: install Node.js, then open a new
  terminal window.
- `Port 5173 is already in use`: Mode is probably still running in another
  terminal window. Use that one, or stop it there with Ctrl+C first.
- `port 8787 is already in use`: if Mode isn't running elsewhere, another
  program uses that port. Put `PORT=8788` in `.env` (see
  [Keys](#keys-optional) for how to make it) and start again.
- `Operation not permitted` on macOS: Terminal isn't allowed into the folder
  that holds Mode (often Downloads). Open System Settings → Privacy &
  Security → Files & Folders → Terminal, turn on *Downloads Folder*, then
  quit and reopen Terminal.

Your projects are saved in this browser, for the address
http://localhost:5173: another browser, or another address (such as
`npm start` on http://localhost:8787), starts empty. In Chrome or Edge use
JPEG or PNG photos: iPhone HEIC photos don't open there (Mode says how to get
a JPEG). Nothing is downloaded from model sites until you first map, sharpen
or tap-select a photo on this device (the models total about 30–200 MB;
mapping and sharpening show the size first).

### Keys (optional)

To add keys, copy `.env.example` to `.env` in the Mode folder and open it in
a text editor. Copy it only the first time: if `.env` already exists, just
open it (the second line), or the copy replaces the keys you added. macOS:

```
cp -n .env.example .env
open -e .env
```

Windows (Command Prompt or PowerShell):

```
copy .env.example .env
notepad .env
```

Fill in what you need, save, and restart Mode (Ctrl+C, then `npm run dev`).

| Variable | Used for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Recommended. Scene understanding (architecture, sun, routes), design planning, element options, recommendations, idea descriptions, product search (Claude). |
| `OPENAI_API_KEY` | Optional: automatic renders with GPT Image (`OPENAI_IMAGE_MODEL`, default `gpt-image-2.5-flare`). |
| `GEMINI_API_KEY` | Optional: automatic renders with Google Gemini (`GEMINI_IMAGE_MODEL`); `GOOGLE_API_KEY` works too. |
| `IMAGE_PROVIDER` | Default image provider when image keys are set (`openai` or `gemini`), or `none` to turn automatic renders off. |
| `HANDOFF_WATCH_DIR` | Folder to watch for downloaded hand-off results (default `~/Downloads`). |

With no keys at all, Mode still works: renders go through the manual hand-off
to your ChatGPT or Gemini app, Mode writes each instruction from your choices,
scenes can be mapped on your device, and Fine-tune needs nothing. Tips for the hand-off:
start a new chat for each image, use *Download full size* (not right-click),
and on Gemini with a Google AI plan use *More → Redo with Pro*; on a free
Gemini account ChatGPT usually edits better.

Mode also uses keys already set in your computer's environment (for example
in your shell profile), even without a `.env` file: if `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set there, those
features turn on and are billed to that key. The `[api]` startup line in the
terminal shows what is on (`AI: off ... image providers: off` means nothing
paid is used); to keep paid features off, put `MODE_AI=off` and
`IMAGE_PROVIDER=none` in `.env`. While keys are on, phones and computers on
your Wi-Fi can use them through Mode too (the terminal warns about this): set
`MODE_ACCESS_TOKEN` in `.env` and enter the same token under
**Settings → Server access token** to require it.

### Production

```
npm run build
npm start
```

`npm start` serves the app and the API together on http://localhost:8787 (set
`PORT` in `.env` to change it), compressed so phones on your Wi-Fi load it
quickly. Projects you made at http://localhost:5173 don't show up there: each
address has its own browser storage. The build writes source maps next to the
bundles for debugging, but the browser never downloads them.

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

```
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

TypeScript check, unit tests (Vitest), then the browser smoke tests
(Playwright; `npx playwright install chromium` is needed once, before the first
`npm run test:e2e`). The e2e tests start their own keyless servers (Vite on
5199, API on 8787) and refuse to run against an API that has keys.

On Linux x64 with npm 10, `npm install` also downloads optional CUDA files for
onnxruntime-node, which Mode doesn't use (it runs its models in the browser):
set `ONNXRUNTIME_NODE_INSTALL=skip` in the environment to skip them. npm 11
and newer skip them already (`allowScripts` in package.json).

Architecture and module contracts are documented in [SPEC.md](SPEC.md).
