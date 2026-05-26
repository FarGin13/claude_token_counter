/**
 * Pre-send Token Preview — fork addition.
 *
 * Renders an always-on line below the chat input area showing:
 *   - delta tokens for whatever's currently in the input box
 *   - current context %  →  projected context % (if there's text)
 *   - mini progress bar of the projected %, colored with traffic-light tiers
 *
 * Honest limitations (v0.1):
 *   - Uses o200k tokenizer (same as upstream conversation count). Approximate, not Claude's real tokenizer.
 *   - Does NOT count attachments (images, files). User sees "+ N files" hint only.
 *   - Does NOT show session/weekly quota impact — claude.ai's API only exposes % usage, not absolute capacity, so we can't compute "+X% of quota" honestly.
 *   - Heavy pastes (>200k chars) skip tokenization to avoid blocking the main thread.
 */
(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const DEBOUNCE_MS = 200;
	const MAX_TOKENIZE_CHARS = 200000;

	/**
	 * Find Claude.ai's contenteditable chat input element.
	 *
	 * Strategy: walk UP from the model-selector-dropdown (a stable anchor we KNOW exists,
	 * since the upstream usage bars rely on it). At each level, look for a contenteditable
	 * descendant. This avoids depending on grid-container/grid-area testids which Claude.ai
	 * has since removed.
	 */
	function findChatInput() {
		const editableSelectors = [
			'div[contenteditable="true"][role="textbox"]',
			'div.ProseMirror[contenteditable="true"]',
			'[contenteditable="true"]'
		];

		const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
		if (modelSelector) {
			let scope = modelSelector;
			for (let i = 0; i < 8 && scope; i++) {
				scope = scope.parentElement;
				if (!scope) break;
				for (const sel of editableSelectors) {
					const el = scope.querySelector(sel);
					if (el) return el;
				}
			}
		}

		// Last-resort fallback: any contenteditable on the page
		for (const sel of editableSelectors) {
			const el = document.querySelector(sel);
			if (el) return el;
		}
		return null;
	}

	/** Apply traffic-light tier class to a bar fill. Duplicated from ui.js to keep modules independent. */
	function applyTier(fillEl, pct) {
		if (!fillEl) return;
		const isGreen = pct < CC.THRESHOLDS.YELLOW;
		const isYellow = pct >= CC.THRESHOLDS.YELLOW && pct < CC.THRESHOLDS.RED;
		const isRed = pct >= CC.THRESHOLDS.RED;
		fillEl.classList.toggle('cc-tier-green', isGreen);
		fillEl.classList.toggle('cc-tier-yellow', isYellow);
		fillEl.classList.toggle('cc-tier-red', isRed);
	}

	class PreviewBar {
		constructor() {
			this.container = null;
			this.textSpan = null;
			this.bar = null;
			this.barFill = null;

			this.inputEl = null;
			this.boundInputHandler = null;
			this.debounceTimer = null;

			this.currentConvTokens = 0;
			this.themeObserver = null;
			this.attachObserver = null;
		}

		initialize() {
			this.container = document.createElement('div');
			this.container.className = 'text-text-400 text-[11px] cc-previewRow';

			this.textSpan = document.createElement('span');
			this.textSpan.className = 'cc-previewText';

			this.bar = document.createElement('div');
			this.bar.className = 'cc-bar cc-bar--mini cc-bar--preview';
			this.barFill = document.createElement('div');
			this.barFill.className = 'cc-bar__fill';
			this.bar.appendChild(this.barFill);

			this.container.appendChild(this.textSpan);
			this.container.appendChild(this.bar);

			this._observeTheme();
			this._render();
		}

		_observeTheme() {
			this.themeObserver = new MutationObserver(() => this._refreshChrome());
			this.themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-mode']
			});
		}

		/**
		 * Anchor the preview into the chat input area.
		 *
		 * Primary anchor: insert as the next sibling of the upstream `.cc-usageRow`.
		 *   We KNOW cc-usageRow is in the DOM as long as ui.attachUsageLine() has run
		 *   (the session/weekly bars render). This avoids depending on Claude.ai's
		 *   internal testids which they've removed.
		 *
		 * Fallback anchor: walk up from model-selector-dropdown to find a flex toolbar row,
		 *   insert preview after that. Mirrors upstream's attachUsageLine fallback logic.
		 */
		attach() {
			if (!this.container) return;

			// Primary: anchor to upstream usage row
			const usageRow = document.querySelector('.cc-usageRow');
			if (usageRow) {
				if (usageRow.nextElementSibling !== this.container) {
					usageRow.after(this.container);
				}
			} else {
				// Fallback: walk up from model selector
				const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
				if (!modelSelector) return;

				let row = modelSelector;
				let toolbarRow = null;
				for (let i = 0; i < 6 && row; i++) {
					row = row.parentElement;
					if (!row || row === document.body) break;
					const style = window.getComputedStyle(row);
					if (style.display === 'flex' && row.querySelectorAll('button').length > 1) {
						toolbarRow = row;
						break;
					}
				}
				if (!toolbarRow) return;
				if (toolbarRow.nextElementSibling !== this.container) {
					toolbarRow.after(this.container);
				}
			}

			// (Re-)bind to whatever input element currently exists
			const input = findChatInput();
			if (input && input !== this.inputEl) {
				this._unbindInput();
				this.inputEl = input;
				this._bindInput(input);
			}

			this._refreshChrome();
			this._render();
		}

		_bindInput(input) {
			this.boundInputHandler = () => {
				clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => this._render(), DEBOUNCE_MS);
			};
			input.addEventListener('input', this.boundInputHandler);
			// Also catch paste explicitly (some pastes don't fire 'input' immediately)
			input.addEventListener('paste', this.boundInputHandler);
		}

		_unbindInput() {
			if (this.inputEl && this.boundInputHandler) {
				this.inputEl.removeEventListener('input', this.boundInputHandler);
				this.inputEl.removeEventListener('paste', this.boundInputHandler);
			}
			this.boundInputHandler = null;
			this.inputEl = null;
		}

		/** Called by main.js whenever the upstream conversation token count changes. */
		setCurrentConversationTokens(n) {
			this.currentConvTokens = typeof n === 'number' && Number.isFinite(n) ? n : 0;
			this._render();
		}

		_refreshChrome() {
			if (!this.bar) return;
			const root = document.documentElement;
			const isDark = root.dataset?.mode === 'dark';

			this.bar.style.setProperty(
				'--cc-stroke',
				isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT
			);
			this.bar.style.setProperty(
				'--cc-fill',
				isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT
			);
			this.bar.style.setProperty(
				'--cc-tier-green',
				isDark ? CC.COLORS.TIER_GREEN_DARK : CC.COLORS.TIER_GREEN_LIGHT
			);
			this.bar.style.setProperty(
				'--cc-tier-yellow',
				isDark ? CC.COLORS.TIER_YELLOW_DARK : CC.COLORS.TIER_YELLOW_LIGHT
			);
			this.bar.style.setProperty(
				'--cc-tier-red',
				isDark ? CC.COLORS.TIER_RED_DARK : CC.COLORS.TIER_RED_LIGHT
			);
		}

		_readInputText() {
			if (!this.inputEl) return '';
			// textContent collapses formatting tags but preserves text — close enough for token estimate
			return this.inputEl.textContent || '';
		}

		_render() {
			if (!this.textSpan || !this.barFill) return;

			const inputText = this._readInputText();
			const currentTotal = this.currentConvTokens;
			const limit = CC.CONST.CONTEXT_LIMIT_TOKENS;
			const currentPct = Math.max(0, Math.min(100, (currentTotal / limit) * 100));

			let deltaTokens = 0;
			let warning = '';

			if (inputText.length > MAX_TOKENIZE_CHARS) {
				// Avoid blocking main thread on huge pastes
				warning = ' · paste too large to estimate live';
			} else if (inputText.length > 0 && CC.tokens?.countTokens) {
				try {
					deltaTokens = CC.tokens.countTokens(inputText);
				} catch (e) {
					console.warn('[TokenCounter] preview tokenize failed:', e);
					deltaTokens = 0;
				}
			}

			const projectedTotal = currentTotal + deltaTokens;
			const projectedPctRaw = (projectedTotal / limit) * 100; // unclamped — used for over-limit detection
			const projectedPct = Math.max(0, Math.min(100, projectedPctRaw));

			// Round once so the visual % matches the comparison (avoids "47% → 47%" looking redundant)
			const currentRounded = Math.round(currentPct);
			const projectedRounded = Math.round(projectedPct);

			// Hide the arrow when both rounds are equal; show "context X%" instead
			const pctPart = currentRounded === projectedRounded
				? `context ${projectedRounded}%`
				: `${currentRounded}% → ${projectedRounded}%`;

			// Over-limit indicator: projected total exceeds the 200k context cap
			const overSuffix = projectedPctRaw > 100 ? '  ·  over limit' : '';

			const text = `+${deltaTokens.toLocaleString()} tok (est.)  ·  ${pctPart}${overSuffix}${warning}`;

			this.textSpan.textContent = text;

			// Bar visualizes the PROJECTED %, tinted by tier
			this.barFill.style.width = `${projectedPct}%`;
			applyTier(this.barFill, projectedPct);
		}
	}

	CC.preview = { PreviewBar };
})();
