# Claude Token Counter

A browser extension for [claude.ai](https://claude.ai) that shows token usage with traffic-light color warnings, a live pre-send token preview, and a context-handoff modal at 85%.

> **Forked from [she-llac/claude-counter](https://github.com/she-llac/claude-counter)** (MIT). All upstream features (token count, cache timer, session + weekly usage bars) are preserved. This fork adds the warning system, preview, and handoff modal described below.

![Claude Token Counter screenshot](./screenshot.png)

## What this fork adds

| Feature | Where you see it |
|---|---|
| **Traffic-light color system** — green (<50%), yellow (50–70%), red (≥70%) | On the main context bar, session bar, weekly bar, and preview bar |
| **Pre-send token preview** — live estimate of `+N tok · current% → projected%` as you type or paste | A new line below the message input |
| **85% handoff modal** — Claude-style popup that fires once per conversation when projected context crosses 85% | Two CTAs: dismiss, or inject a structured handoff prompt into the chat input so your next message becomes a portable memory summary |

## Installation (developer / unpacked)

This fork is **not** distributed as a release zip or a Chrome Web Store listing. Install from source:

```bash
git clone https://github.com/<your-username>/claude-token-counter.git
```

Then in Chrome / Edge / Brave:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Pick the cloned folder
5. Open https://claude.ai — extension is active

To get updates: `git pull` then click the 🔄 refresh icon on the extension card.

## Honest limitations

This is a hobby fork. Real things you should know before relying on it:

- **Token counts are approximate.** We use OpenAI's `o200k_base` tokenizer because Claude's real tokenizer isn't public. Expect ±5–15% deviation from Claude's actual counts. Every number is labeled `(est.)`.
- **The extension depends on private claude.ai endpoints.** Anthropic hasn't documented these and can change them at any time. When that happens, the extension breaks until selectors get updated.
- **No automatic updates.** You're running a `git pull` workflow, not a store-managed extension.
- **The 85% modal re-pops after a page refresh.** Intentional — we didn't add `chrome.storage` persistence to keep the permission footprint minimal. See [DESIGN.md](./DESIGN.md) for the reasoning.
- **Session/weekly quota impact is not shown** in the pre-send preview. claude.ai's API only exposes % used, not the absolute token capacity behind the limit — so we can't honestly compute "+X% of quota."
- **Attachments (images, PDFs) are not counted** in the pre-send preview. They contribute to the conversation token total once Claude processes them.
- **Tested only on Chrome MV3.** Firefox and Edge should work (same MV3 manifest) but aren't actively tested.

## How it works

1. A content script wraps `window.fetch` to intercept claude.ai's API responses.
2. Conversation data flows through `tokens.js`, which counts tokens via the bundled o200k tokenizer.
3. `ui.js` renders the upstream header + usage bars; `preview.js` renders the new pre-send preview; `modal.js` handles the 85% popup.
4. The bridge runs in page context (`src/injected/bridge.js`) and talks to the content script via `window.postMessage`.

For deeper architecture notes, see [DESIGN.md](./DESIGN.md).

## Privacy

- All processing happens locally in your browser.
- The extension reads your existing `lastActiveOrg` cookie to query claude.ai's `/usage` endpoint — same authentication claude.ai itself uses.
- No data is sent to any external server.
- No tracking, no telemetry.
- The fork has **zero permissions** declared in the manifest beyond what's needed to inject scripts into `claude.ai/*`.

## Credits

- Upstream extension: [she-llac/claude-counter](https://github.com/she-llac/claude-counter) — the entire base architecture, token counting, cache timer, and usage bars are theirs.
- Tokenizer: [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT, bundled in `src/vendor/o200k_base.js`).
- Inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19.

## License

MIT — same as upstream. See [LICENSE](./LICENSE).
