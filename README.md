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
- Ollama status in the popup is tied to the selected model:
  - `?` no model selected yet
  - `✓` available in Ollama
  - `!` selected model not installed
  - `×` Ollama offline

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

## Install

### 1. Clone the repository

```bash
git clone https://github.com/pshkrh/smartblock.git
cd smartblock
```

### 2. Install Ollama and at least one model

```bash
brew install ollama
ollama pull qwen2.5:7b
```

You can pick the active model from the popup header after Ollama is running.

### 3. Start Ollama with extension access enabled

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

If you prefer the macOS app, set the environment first and then launch it:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
open -a Ollama
```

### 4. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/path/to/smartblock/extension`
5. Pin SmartBlock to the toolbar

### 5. Choose a model and add your first site

1. Open the SmartBlock popup
2. Pick an Ollama model from the `Model` dropdown in the header
3. Add a domain such as `youtube.com`
4. Choose `Smart` or `Strict`
5. Set a daily limit in minutes

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

Make sure Ollama is running and started with `OLLAMA_ORIGINS="chrome-extension://*"`.

**Popup shows `?`**

Pick a model from the `Model` dropdown in the popup header.

**Popup shows `!` for the selected model**

Install the model you want to use, then refresh the popup:

```bash
ollama pull qwen2.5:7b
```

**A page is classified incorrectly**

Use the Activity tab to mark it as `Count` or `Ignore`. Manual overrides win over cache and model output.

**Deleting and re-adding a site still shows old usage**

Current code clears today's stored usage when a domain is removed. Reload the extension if the popup is showing stale state after a recent code update.
