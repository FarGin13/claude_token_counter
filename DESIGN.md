# Design notes — Claude Token Counter fork

One-pager capturing the decisions made on top of [she-llac/claude-counter](https://github.com/she-llac/claude-counter). Written for future-me and anyone reviewing this fork.

## Why fork

The upstream extension already covers the boring-and-correct parts: token counting, cache timer, session + weekly usage bars, fetch interception, theme detection. This fork adds two user-facing features that weren't in upstream:

1. **Traffic-light color warnings** on every bar (50% yellow / 70% red), replacing upstream's binary blue + single red-warn at 90%.
2. **Session/weekly handoff modal** at 60%/80% with persistent dismissal, offering to inject a structured memory-extraction prompt so the user's next message becomes a portable summary for use in another conversation or AI tool.

The traffic-light tweak is small. The modal is the real value.

## Decisions and trade-offs

### Why the modal moved from context % to session / weekly %

**Original design (v0.5.0):** modal fired when projected conversation context % crossed 85%.

**Problem we hit:** the trigger depended on the o200k tokenizer estimate, which is approximate (±10–15%). So the modal could pop at "actually 75%" or "actually 95%" — neither being the user's real situation.

**Fix (v0.6.0):** trigger on **session %** (≥ 60%) and **weekly %** (≥ 80%). Both numbers come from claude.ai's API directly — no tokenizer involved, no estimation error.

**Bonus:** session/weekly lockout is a more urgent problem than context compaction. Context just gets auto-summarized by Claude silently; running out of session quota locks you out of Claude entirely until the 5h or 7d window resets. The modal is now warning you about something with real, actionable urgency.

### Three modal variants

Modal copy adapts to which quotas are crossed:

- **Variant 1:** session only crossed → "5-hour session limit approaching"
- **Variant 2:** weekly only crossed → "Weekly quota approaching limit"
- **Variant 3:** both crossed → single combined modal with a list of both percentages, NOT two separate popups

### Why we ended up with `chrome.storage.local` persistence

This was a back-and-forth decision. Final answer: yes, persist.

**For:** the session/weekly modal fires more often than a context-based one would (you hit 60% session in one heavy day of use). Without persistence, every page refresh would re-pop the modal. That's annoying enough to justify the `storage` permission.

**Against:** more permissions, more potential bug surface, divergence from upstream's lean stance.

**Resolution:** storage is a benign permission (per-extension key-value storage, no cross-site or user data access). The UX win outweighs the cost.

### Why per-reset-window tracking (not per-page-load)

Storage tracks the **reset timestamps** of the session and weekly windows we've already fired the modal for. When a window resets (5h passes for session, 7d for weekly), its reset timestamp changes, our stored value goes stale, and the modal can fire again in the next window.

This means:
- Dismiss at session 65%, refresh page → modal stays dismissed (timestamp matches)
- Dismiss at session 65%, wait 5 hours, cross 60% in new session → modal fires again (new timestamp)
- Modal won't naggily fire forever once dismissed
- Modal won't permanently disable itself once dismissed

### Why we removed the pre-send token preview

**Built it in v0.5.0:** a live `+N tok (est.) · projected %` row below the chat input, updating on every keystroke. Was supposed to catch big pastes before sending.

**Removed in v0.6.0:** the user found the accuracy insufficient (o200k tokenizer ±10–15% from Claude's actual count, plus we don't count system prompt / project knowledge / attachments). Once the modal trigger moved off context %, the preview became cosmetic. Cost (clutter, dead code, recalc on every keystroke) outweighed benefit.

**Alternative considered:** keep preview as informational with explicit `±15%` range labels. Decided this was over-engineering — the modal is the action point, header bar is the static reference, preview was redundant.

### Why we removed the token calibration multiplier

Briefly added a `×1.12` correction in `tokens.js` to push o200k counts closer to Claude's actual. After dropping the preview, this only affected the header token count. Removed for consistency: if we trust the `~` prefix to communicate approximation, we don't need to also fudge the number.

### Tokenizer accuracy (the recurring honesty issue)

Claude's tokenizer isn't public. Anthropic does expose a `count_tokens` API that returns Claude's exact count, but using it would require:

- User's Anthropic API key (settings UI, secure storage)
- Network roundtrip per estimate (latency)
- Rate limit handling

That's its own substantial feature (~4–6 hours of work). Deferred to a possible v0.7 if anyone cares enough.

For now: header count is `~approximate`, modal trigger uses claude.ai's first-party % (no estimate).

### Color tier thresholds

50% yellow, 70% red, 80%/60% modal triggers. Hard thresholds, no gradient.

- 50/70 chosen because they're the universal traffic-light memory aid
- 60% session because 5h sessions fill fast — earlier warning gives more handoff time
- 80% weekly because 7d windows are longer, less urgency at lower thresholds
- Modal triggers different from color tiers so colors can change before the modal interrupts

### Code organization

New features live in new files (`modal.js`). Touch upstream files (`ui.js`, `main.js`, `tokens.js`, `styles.css`, `manifest.json`) only minimally.

Easier to upstream individual features back to she-llac/claude-counter as PRs later. Keeps the divergence shallow and traceable.

### Anchor stability

Modal attaches to `document.body` (always exists). UI elements anchor through upstream's existing logic (model-selector-dropdown ancestor walk). We deliberately avoided `data-testid="chat-input-grid-container"` because Claude.ai has removed it.

### Handoff prompt injection

Uses `document.execCommand('insertText', ...)` as the primary path. Falls back to `textContent` + `InputEvent` if execCommand fails.

Claude.ai uses ProseMirror (React-based contenteditable). ProseMirror's internal editor state only updates in response to synthetic `beforeinput` / `input` events that execCommand fires. Plain `textContent` writes the DOM but leaves the editor state stale — the send button stays disabled, text vanishes on send.

## What was deliberately left out (v0.7 candidates)

- **Real Anthropic `count_tokens` API integration** — for true tokenizer accuracy in the header count. Requires settings UI for API key, async wiring, rate limits.
- **Session-quota impact estimate in any UI** — needs persistent observation across the 5h window or an absolute-capacity API that claude.ai doesn't expose.
- **Project knowledge token counting** — would require parsing claude.ai's project endpoint.
- **Firefox / Edge active testing** — should work with the same MV3 manifest; not actively verified.
- **A "this fork has diverged from upstream" notice** — would help users know they're behind on bug fixes from she-llac.
- **Configurable thresholds** — currently hardcoded to 60% / 80%. Some users might want different values.

## Risks acknowledged

- **claude.ai API and DOM are private.** Anthropic can change selectors, endpoints, or response shapes at any time. The extension will break and require updates when they do.
- **Distributing publicly is a soft ToS risk.** This extension intercepts authenticated API traffic on a service we don't own. We're not commercializing it, but we're not on solid ground either.
- **The o200k tokenizer is a 2MB blob.** It's the largest single file in the extension. Acceptable for an unpacked dev install or a release zip; questionable if we ever submit to the Chrome Web Store.
- **The `storage` permission is real.** Even though we only store our own dismissal timestamps, browser-extension reviewers (and security-conscious users) will see we declare it. Worth the UX cost; documented in [README](./README.md#privacy).
