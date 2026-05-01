# SmartBlock

<p align="center">
  <img src="./extension/icons/icon128.png" alt="SmartBlock logo" width="128" height="128">
</p>

<p align="center">
  <strong>Smart website blocking that only counts distracting time.</strong>
</p>

<p align="center">
  Chrome MV3 extension • Local Ollama classification • Smart and Strict blocking modes
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-1f6feb?style=flat-square">
  <img alt="Local model" src="https://img.shields.io/badge/Ollama-Local-0f766e?style=flat-square">
  <img alt="Model" src="https://img.shields.io/badge/Default%20model-qwen2.5%3A3b-b45309?style=flat-square">
</p>

SmartBlock is a Chrome extension for time blocking mixed-use websites with a local Ollama model. Instead of treating an entire domain as distracting, it classifies the specific page you are on and only counts the pages that look like entertainment.

| Mode | Behavior |
| --- | --- |
| `Smart` | Classifies the page and only counts distracting time |
| `Strict` | Counts all active time on the domain |

## What It Does

- Tracks configured domains in `Smart` or `Strict` mode.
- Uses a local Ollama model for page classification.
- Uses manual overrides, fast rules, and cache before making a fresh model call.
- Redirects over-limit domains to a block page.
- Shows an Activity view with counted vs ignored pages, source labels, overrides, and cache clearing.

## Current Behavior

- SmartBlock only tracks domains you explicitly add in the popup.
- SmartBlock currently maintains a single active counting session at a time.
- If two distracting tabs are open on different monitors, the extension does not yet count both simultaneously.
- Ollama status in the popup shows the configured model name:
  - `Ollama: qwen2.5:3b`
  - `Missing: qwen2.5:3b`
  - `Ollama offline`

## How Classification Works

For Smart domains, SmartBlock evaluates a page in this order:

1. Manual override from the Activity tab
2. Fast local rules
3. Cached classification
4. Ollama classification
5. Fail-open fallback to productive if Ollama is unavailable

The built-in rule pass keeps some sites deterministic:

- `HARD_ENTERTAINMENT`: always counted on Smart domains
- `HARD_PRODUCTIVE`: never counted on Smart domains
- `MIXED`: curated fast paths before Ollama

## Setup

### 1. Install Ollama and the model

```bash
brew install ollama
ollama pull qwen2.5:3b
```

### 2. Start Ollama with extension access enabled

```bash
OLLAMA_ORIGINS="*" ollama serve
```

If you prefer the macOS app, launch it with that environment available in the session so Chrome extension requests are allowed.

### 3. Load the extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder
5. Pin SmartBlock to the toolbar

## Using It

1. Open the popup
2. Add a domain such as `youtube.com`
3. Choose `Smart` or `Strict`
4. Set a daily limit in minutes

In the Activity tab, you can inspect what counted, what did not, and override bad model decisions.

## Popup Overview

- `Limits` tab:
  - add/remove tracked domains
  - edit mode and daily limit
  - see live usage progress
- `Activity` tab:
  - recent classified pages
  - counted vs ignored summaries
  - manual `Count` / `Ignore` actions
  - clear cached classifications

## Block Behavior

When a domain hits its limit, SmartBlock redirects the tab to a block page. To continue, raise the domain limit from the popup. Removing the domain clears today's stored usage and activity for that site.

## Repository Layout

```text
extension/
├── manifest.json
├── icons/
└── src/
    ├── background/
    │   ├── service-worker.js
    │   ├── timer.js
    │   ├── classifier.js
    │   ├── rules.js
    │   ├── blocker.js
    │   ├── storage.js
    │   └── alarms.js
    ├── shared/
    ├── content/
    ├── popup/
    └── block/
```

## Customizing Rules

Edit [`extension/src/background/rules.js`](extension/src/background/rules.js) to tune domain behavior:

- `HARD_ENTERTAINMENT`
- `HARD_PRODUCTIVE`
- `MIXED`

Reload the extension after changing the rules.

## Troubleshooting

**Popup says `Ollama offline`**

Make sure Ollama is running and started with `OLLAMA_ORIGINS="*"`.

**Popup says `Missing: qwen2.5:3b`**

Install the configured model:

```bash
ollama pull qwen2.5:3b
```

**A page is classified incorrectly**

Use the Activity tab to mark it as `Count` or `Ignore`. Manual overrides win over cache and model output.

**Deleting and re-adding a site still shows old usage**

Current code clears today's stored usage when a domain is removed. Reload the extension if the popup is showing stale state after a recent code update.
