# Design notes — Claude Token Counter fork

One-pager capturing the decisions made on top of [she-llac/claude-counter](https://github.com/she-llac/claude-counter). Written for future-me and anyone reviewing this fork.

## Why fork

The upstream extension already covers the boring-and-correct parts: token counting, cache timer, session + weekly usage bars, fetch interception, theme detection. This fork adds three user-facing features that weren't in upstream:

1. **Traffic-light color warnings** on every bar (50% yellow / 70% red), replacing upstream's binary blue + single red-warn at 90%.
2. **Pre-send token preview** below the input — live estimate of what a message will cost before you hit send.
3. **85% handoff modal** that fires once per conversation, offering to inject a structured memory-extraction prompt so the user's next message becomes a portable summary for use in another conversation or AI tool.

The yellow band is small. The preview and modal are the real value.

## Decisions and trade-offs

### Tokenizer accuracy

**Decision:** Use OpenAI `o200k_base` (already bundled by upstream), label every number `(est.)`.

**Why:** Claude's real tokenizer isn't public. Anthropic does publish a `count_tokens` API but it costs API credits per call and requires the user's API key — overkill for a browser extension. Honest labeling beats fake precision.

### Session/weekly quota impact in preview

**Decision:** Omit.

**Why:** claude.ai's API surfaces session and weekly usage as a `%` only, with no absolute token capacity behind it. Showing "+X% of 5h quota" would require either making up a denominator or tracking it ourselves across sessions — neither is honest in v0.1.

### Project knowledge / system prompts

**Decision:** Ignore in v0.1.

**Why:** The pre-send preview shows the delta from the **input box only**, not the system prompt or attached project knowledge. Documenting the limitation is more honest than estimating it badly.

### Attachments

**Decision:** Don't count in the preview.

**Why:** We can't read extracted PDF/image content before the user actually sends. Once Claude processes an attachment, its tokens land in the main conversation count anyway — which the post-send token bar reflects.

### Color tier thresholds

**Decision:** 50% yellow, 70% red, 85% modal. Hard thresholds, no gradient.

**Why:** Matches the user-spec progressive warning system. Hard thresholds are easier to test and reason about than a gradient. 85% sits comfortably below the 100% wall so the modal has time to be useful.

### Modal once-per-conversation

**Decision:** Track in an **in-memory** `Set<conversationId>`. Do NOT persist across reloads.

**Why:** We considered `chrome.storage.local` persistence (Phase E, briefly implemented and reverted before commit). Cost was 1 permission, ~45 lines of code, and one race condition (storage hadn't loaded when modal might fire). Benefit was "modal stays dismissed after F5." Honest assessment: page refresh on a single near-capacity conversation is rare, the in-memory cost is small, and fewer permissions is more trustworthy for an open-source extension. Upstream has 1.5k stars and zero storage permission — they figured the same thing out for their feature set.

Practical consequence: if you refresh a near-capacity conversation, you'll see the modal again. Dismiss it again. Cheap.

### Over-limit display

**Decision:** Show the raw unclamped percentage (e.g. `116%`) in both the preview line AND the modal. Bar width stays clamped to 100% (DOM can't render past that), but the *number* shows the actual magnitude of overflow. Suffix `· over limit` is kept for unmistakability.

**Why:** When the preview clamped at 100% and the modal showed 116%, users saw two different numbers for the same scenario. Consistency + honesty beats visual neatness.

### Handoff prompt injection

**Decision:** Use `document.execCommand('insertText', ...)` as the primary path. Fallback to `textContent` + `InputEvent` if execCommand fails.

**Why:** Claude.ai uses ProseMirror (React-based contenteditable). ProseMirror's internal editor state only updates in response to synthetic `beforeinput` / `input` events that execCommand fires. Plain `textContent` assignment writes the DOM but leaves the editor's state stale — the send button stays disabled, text vanishes on send. execCommand is deprecated but still works in every major browser, and is the established workaround for React-based editors.

### Anchor stability

**Decision:** Anchor the preview line to the upstream's `.cc-usageRow` element, not to claude.ai's testid-based containers.

**Why:** First attempt used `[data-testid="chat-input-grid-container"]`, which doesn't exist on current claude.ai. The upstream's `.cc-usageRow` is a class WE control via the upstream's own DOM injection, so as long as the upstream session/weekly bars render, our preview has somewhere to attach.

### Code organization

**Decision:** New features live in new files (`modal.js`, `preview.js`). Touch upstream files (`ui.js`, `main.js`, `tokens.js`, `styles.css`, `manifest.json`) only minimally.

**Why:** Easier to upstream individual features back to she-llac/claude-counter as PRs later. Keeps the divergence shallow and traceable.

## What was deliberately left out (v0.2 candidates)

- **Storage-backed dismissal memory** — modal re-pops after refresh. See above.
- **Session-quota impact estimate** — needs either a backend or persistent observation to compute honestly.
- **Project knowledge token counting** — would require parsing claude.ai's project endpoint.
- **Attachment counting in preview** — needs reading extracted content before send.
- **Focus restoration after modal closes** — small a11y win.
- **Cross-conversation cumulative spend dashboard** — was Interp 2 of the persistence discussion; cut for scope.
- **Firefox/Edge testing** — should work with same MV3 manifest, not actively verified.
- **A "this fork has diverged from upstream" notice** — would help users know they're behind on bug fixes from she-llac.

## Risks acknowledged

- **claude.ai API and DOM are private.** Anthropic can change selectors, endpoints, or response shapes at any time. The extension will break and require updates when they do.
- **Distributing publicly is a soft ToS risk.** This extension intercepts authenticated API traffic on a service we don't own. We're not commercializing it, but we're not on solid ground either.
- **The o200k tokenizer is a 2MB blob.** It's the largest single file in the extension. Acceptable for an unpacked dev install; questionable for a Chrome Web Store submission.
