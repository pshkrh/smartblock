# SmartBlock

Smart website blocking that only counts distracting time.

SmartBlock uses a local LLM to distinguish productive from entertainment use on mixed-use sites (e.g. a YouTube tutorial vs. a vlog). Productive pages never tick the clock.

## How it works

- **Chrome extension (MV3)** tracks the active tab, classifies each page, and blocks domains when the daily entertainment budget is exhausted.
- **Ollama** (running locally) powers the LLM classifier. No cloud, no API keys.
- A rule-based pre-pass handles common domains instantly without hitting the model:
  - TikTok, Instagram, X, Netflix, Reddit, etc. → always entertainment
  - GitHub, MDN, Wikipedia, Coursera, etc. → always productive
  - YouTube, LinkedIn, Twitch, Medium → classified per page via Ollama

## Setup

### 1. Install and start Ollama

```bash
# Install from https://ollama.com
brew install ollama

# Allow requests from the Chrome extension
OLLAMA_ORIGINS="*" ollama serve
```

Open a second terminal:

```bash
ollama pull qwen2.5:3b
```

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the SmartBlock icon to your toolbar

### 3. Set your limits

Click the extension icon → type a domain (e.g. `youtube.com`) → set a daily minute limit → **Add**.

## Usage

| Situation | What happens |
|---|---|
| You open a YouTube vlog | Timer ticks |
| You open a YouTube tutorial | Timer pauses (title keyword matched) |
| Ambiguous page | Ollama classifies it; result cached for 7 days |
| Limit reached | Redirected to block page |
| Block page | One-time 5-minute snooze available |
| Ollama is offline | Timer pauses (fail-open); popup shows "Ollama offline" |
| Browser restarts | Today's usage and config are preserved |
| Midnight | All timers reset, blocks lifted automatically |

## File structure

```
extension/
├── manifest.json
├── icons/
└── src/
    ├── background/
    │   ├── service-worker.js   # Event wiring
    │   ├── timer.js            # Timestamp-based accumulator
    │   ├── classifier.js       # Rules + cache + Ollama
    │   ├── rules.js            # Domain lists & keyword patterns
    │   ├── blocker.js          # declarativeNetRequest management
    │   ├── storage.js          # chrome.storage helpers
    │   └── alarms.js           # Poll + midnight reset
    ├── shared/                 # Shared config, messages, dates, domains, DNR IDs
    ├── content/
    │   └── content-script.js   # URL/title/snippet extraction
    ├── popup/                  # Extension popup
    └── block/                  # Block page
```

## Customising domain lists

Edit [`extension/src/background/rules.js`](extension/src/background/rules.js) to move domains between `HARD_ENTERTAINMENT`, `HARD_PRODUCTIVE`, and `MIXED`. Reload the extension at `chrome://extensions` after saving.

## Troubleshooting

**Popup shows "Ollama offline"**
Make sure Ollama is running with `OLLAMA_ORIGINS="*" ollama serve`. The `OLLAMA_ORIGINS` flag is required — without it Chrome extension requests are blocked by CORS.

**Timer isn't ticking on a site I expected**
The domain may be hitting the productive fast-path (title keyword, known-productive list, or UNKNOWN domain default). Open DevTools → Extensions → service worker → Console to see classification logs.

**Block page appears on a productive site**
The domain may be in `HARD_ENTERTAINMENT`. Move it to `MIXED` in `rules.js` so it gets per-page classification.
