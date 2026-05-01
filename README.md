# SmartBlock

Smart website blocking that only counts distracting time.

SmartBlock uses a local LLM to distinguish productive from entertainment use on sites you configure (e.g. a YouTube tutorial vs. a vlog, or a serious article vs. casual browsing). Productive pages never tick the clock.

## How it works

- **Chrome extension (MV3)** tracks the active tab, classifies each page, and blocks domains when the daily entertainment budget is exhausted.
- **Ollama** (running locally) powers the LLM classifier. No cloud, no API keys.
- **Smart limits** classify page context and only count distracting pages.
- **Strict limits** count all active time on the domain without classification.
- A rule-based pre-pass handles common domains instantly without hitting the model:
  - TikTok, Instagram, X, Netflix, Reddit, etc. → always entertainment
  - GitHub, MDN, Wikipedia, Coursera, etc. → always productive
  - YouTube, LinkedIn, Twitch, Medium, Substack → curated fast paths before Ollama

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

Click the extension icon → type a domain (e.g. `youtube.com`) → choose **Smart** or **Strict** → set a daily minute limit → **Add**.

## Usage

| Situation | What happens |
|---|---|
| Smart domain, distracting page | Timer ticks |
| Smart domain, productive page | Timer pauses |
| Strict domain | Timer ticks for all active time |
| Ambiguous Smart page | Ollama classifies it; result cached for 7 days |
| Limit reached | Redirected to block page |
| Block page | Increase the site's limit from the popup to continue |
| Ollama is offline | Timer pauses (fail-open); popup shows "Ollama offline" |
| Activity tab | Shows counted and ignored pages with classifier source |
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

Edit [`extension/src/background/rules.js`](extension/src/background/rules.js) to tune curated fast paths:

- `HARD_ENTERTAINMENT` always counts on Smart domains.
- `HARD_PRODUCTIVE` never counts on Smart domains.
- `MIXED` gets extra URL/title fast paths before Ollama.

Reload the extension at `chrome://extensions` after saving.

## Troubleshooting

**Popup shows "Ollama offline"**
Make sure Ollama is running with `OLLAMA_ORIGINS="*" ollama serve`. The `OLLAMA_ORIGINS` flag is required — without it Chrome extension requests are blocked by CORS.

**Timer isn't ticking on a site I expected**
Make sure the domain is configured in the popup. SmartBlock only tracks configured domains. If it is configured as Smart, the page may be classified as productive; check the Activity tab for the verdict and source.

**Block page appears on a productive site**
The domain may be set to Strict, or it may be in `HARD_ENTERTAINMENT`. Switch the domain to Smart in the popup, or move the domain to `MIXED`/remove it from `HARD_ENTERTAINMENT` in `rules.js` for per-page classification.
