/**
 * Handoff Modal — fork addition.
 *
 * Pops a Claude-style dialog when the user's 5-hour session OR 7-day weekly
 * quota crosses CC.THRESHOLDS.SESSION_MODAL / WEEKLY_MODAL (both 80%).
 *
 * Three variants depending on what's crossed:
 *   - Variant 1: session only
 *   - Variant 2: weekly only
 *   - Variant 3: both (single combined popup, not two separate modals)
 *
 * Two CTAs:
 *   1. "Send anyway"           — dismiss, let the user send
 *   2. "Insert handoff prompt" — replace input with a structured 5-point
 *      memory-extraction template so the user's next message becomes a
 *      portable handoff for use in another conversation or AI tool
 *
 * Tracking:
 *   - Shown-state is keyed by reset-window TIMESTAMP, not by user/conversation.
 *   - When a window resets, its reset-timestamp changes — modal can fire again
 *     for the new window's 80% crossing.
 *   - State persists across page reloads via chrome.storage.local (Phase G).
 */
(() => {
	'use strict';
	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const STORAGE_KEY = 'cc_modal_shown_resets';

	const HANDOFF_PROMPT = `We're approaching the end of this conversation's usable context.
Please produce a structured memory handoff I can paste into another
AI tool to continue this work. Include:

1. **Topic & goal:** What we're trying to accomplish
2. **Key decisions made:** With brief rationale
3. **Code, data, or artifacts produced:** Inline or with descriptions
4. **Current state:** Where we left off
5. **Open questions / next steps:** What's unresolved

Format as Markdown. Be comprehensive but concise.`;

	/** Same input-finding strategy as preview.js. Duplicated to keep modules independent. */
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
		for (const sel of editableSelectors) {
			const el = document.querySelector(sel);
			if (el) return el;
		}
		return null;
	}

	class HandoffModal {
		constructor() {
			this.backdrop = null;
			this.modal = null;
			this.titleEl = null;
			this.bodyEl = null;
			this.dismissBtn = null;
			this.handoffBtn = null;
			this.isOpen = false;

			// Phase G: track shown-state keyed by reset-window timestamp (ms since epoch).
			// When a window resets, its reset-timestamp changes — modal fires again.
			this.shownForSessionResetMs = null;
			this.shownForWeeklyResetMs = null;

			this.boundKeyHandler = null;
		}

		initialize() {
			this.backdrop = document.createElement('div');
			this.backdrop.className = 'cc-modal-backdrop cc-hidden';

			this.modal = document.createElement('div');
			this.modal.className = 'cc-modal';
			this.modal.setAttribute('role', 'dialog');
			this.modal.setAttribute('aria-modal', 'true');
			this.modal.setAttribute('aria-labelledby', 'cc-modal-title');

			this.titleEl = document.createElement('h3');
			this.titleEl.id = 'cc-modal-title';
			this.titleEl.className = 'cc-modal__title';

			this.bodyEl = document.createElement('div');
			this.bodyEl.className = 'cc-modal__body';

			const actions = document.createElement('div');
			actions.className = 'cc-modal__actions';

			this.dismissBtn = document.createElement('button');
			this.dismissBtn.type = 'button';
			this.dismissBtn.className = 'cc-modal__btn cc-modal__btn--secondary';
			this.dismissBtn.textContent = 'Send anyway';

			this.handoffBtn = document.createElement('button');
			this.handoffBtn.type = 'button';
			this.handoffBtn.className = 'cc-modal__btn cc-modal__btn--primary';
			this.handoffBtn.textContent = 'Insert handoff prompt';

			actions.appendChild(this.dismissBtn);
			actions.appendChild(this.handoffBtn);

			this.modal.appendChild(this.titleEl);
			this.modal.appendChild(this.bodyEl);
			this.modal.appendChild(actions);
			this.backdrop.appendChild(this.modal);

			this.dismissBtn.addEventListener('click', () => this.close());
			this.handoffBtn.addEventListener('click', () => this._injectHandoffPrompt());
			this.backdrop.addEventListener('click', (e) => {
				if (e.target === this.backdrop) this.close();
			});
			this.modal.addEventListener('click', (e) => e.stopPropagation());

			document.body.appendChild(this.backdrop);

			// Phase G: hydrate persisted tracking from chrome.storage.local
			this._loadFromStorage();
		}

		/**
		 * Called from main.js on every usage update. Fires modal at most once per
		 * reset window for whichever quotas have crossed 80%.
		 *
		 * @param {object} args
		 * @param {{pct:number, resetMs:number}|null} args.session - five_hour quota info
		 * @param {{pct:number, resetMs:number}|null} args.weekly  - seven_day quota info
		 */
		maybeShow({ session, weekly }) {
			if (this.isOpen) return;

			const sessionCrossed = session
				&& typeof session.pct === 'number'
				&& session.pct >= CC.THRESHOLDS.SESSION_MODAL;
			const weeklyCrossed = weekly
				&& typeof weekly.pct === 'number'
				&& weekly.pct >= CC.THRESHOLDS.WEEKLY_MODAL;

			// "Already shown for this reset window" = stored reset timestamp matches current
			const sessionAlreadyShown = sessionCrossed
				&& this.shownForSessionResetMs === session.resetMs;
			const weeklyAlreadyShown = weeklyCrossed
				&& this.shownForWeeklyResetMs === weekly.resetMs;

			const showSession = sessionCrossed && !sessionAlreadyShown;
			const showWeekly = weeklyCrossed && !weeklyAlreadyShown;

			if (!showSession && !showWeekly) return;

			// Mark as shown BEFORE displaying so re-entry can't double-fire
			if (showSession) this.shownForSessionResetMs = session.resetMs;
			if (showWeekly) this.shownForWeeklyResetMs = weekly.resetMs;
			this._saveToStorage(); // fire-and-forget — UI doesn't block on the write

			this._show({
				session: showSession ? session : null,
				weekly: showWeekly ? weekly : null
			});
		}

		_show({ session, weekly }) {
			if (!this.backdrop) return;

			// Build title + body based on which quotas crossed
			this.bodyEl.replaceChildren();

			if (session && weekly) {
				// Variant 3: both crossed
				this.titleEl.textContent = 'Both Claude quotas approaching limit';

				const intro = document.createElement('p');
				intro.textContent = "You're approaching the warning threshold on both quota windows:";
				this.bodyEl.appendChild(intro);

				const list = document.createElement('ul');
				list.className = 'cc-modal__list';
				const sessionItem = document.createElement('li');
				sessionItem.textContent = `Daily session: ${Math.round(session.pct)}%`;
				const weeklyItem = document.createElement('li');
				weeklyItem.textContent = `Weekly quota: ${Math.round(weekly.pct)}%`;
				list.appendChild(sessionItem);
				list.appendChild(weeklyItem);
				this.bodyEl.appendChild(list);

				const advice = document.createElement('p');
				advice.textContent = 'Sending more messages may exhaust your remaining quota and lock you out of Claude until the windows reset. Consider using your next message to extract a structured handoff you can paste into another conversation or AI tool.';
				this.bodyEl.appendChild(advice);
			} else if (session) {
				// Variant 1: session only
				this.titleEl.textContent = '5-hour session limit approaching';

				const p1 = document.createElement('p');
				p1.textContent = `Your daily session is at ${Math.round(session.pct)}%. Sending more messages may exhaust your remaining quota and lock you out of Claude until the session resets.`;
				this.bodyEl.appendChild(p1);

				const p2 = document.createElement('p');
				p2.textContent = 'Consider using your next message to extract a structured handoff you can paste into another conversation or AI tool while you wait.';
				this.bodyEl.appendChild(p2);
			} else if (weekly) {
				// Variant 2: weekly only
				this.titleEl.textContent = 'Weekly quota approaching limit';

				const p1 = document.createElement('p');
				p1.textContent = `Your weekly quota is at ${Math.round(weekly.pct)}%. Sending more messages may exhaust your remaining quota and lock you out of Claude until the weekly window resets.`;
				this.bodyEl.appendChild(p1);

				const p2 = document.createElement('p');
				p2.textContent = 'Consider using your next message to extract a structured handoff you can paste into another conversation or AI tool while you wait.';
				this.bodyEl.appendChild(p2);
			}

			// CTA label depends on whether input already has text
			const input = findChatInput();
			const hasText = input && input.textContent.trim().length > 0;
			this.handoffBtn.textContent = hasText
				? 'Replace input with handoff prompt'
				: 'Insert handoff prompt';

			this.backdrop.classList.remove('cc-hidden');
			this.isOpen = true;

			this.boundKeyHandler = (e) => {
				if (e.key === 'Escape') this.close();
			};
			document.addEventListener('keydown', this.boundKeyHandler);

			this.dismissBtn.focus();
		}

		close() {
			if (!this.isOpen) return;
			this.backdrop?.classList.add('cc-hidden');
			this.isOpen = false;
			if (this.boundKeyHandler) {
				document.removeEventListener('keydown', this.boundKeyHandler);
				this.boundKeyHandler = null;
			}
		}

		_injectHandoffPrompt() {
			const input = findChatInput();
			if (!input) {
				console.warn('[TokenCounter] handoff: chat input not found');
				this.close();
				return;
			}

			input.focus();

			// Primary path: select-all + execCommand('insertText') for ProseMirror compatibility.
			// Claude.ai's ProseMirror editor only updates its internal state in response to
			// synthetic beforeinput/input events, which execCommand fires. Plain textContent
			// assignment doesn't trigger them and leaves the send button disabled.
			let inserted = false;
			try {
				const range = document.createRange();
				range.selectNodeContents(input);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);

				inserted = document.execCommand('insertText', false, HANDOFF_PROMPT);
			} catch (e) {
				console.warn('[TokenCounter] handoff: execCommand path failed', e);
			}

			// Fallback: direct textContent + InputEvent dispatch
			if (!inserted) {
				try {
					input.textContent = HANDOFF_PROMPT;
					input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
				} catch (e) {
					console.warn('[TokenCounter] handoff: fallback insertion failed', e);
				}
			}

			// Put cursor at the end so the user can edit immediately
			try {
				const endRange = document.createRange();
				endRange.selectNodeContents(input);
				endRange.collapse(false);
				const endSel = window.getSelection();
				endSel.removeAllRanges();
				endSel.addRange(endRange);
			} catch (e) {
				// Selection APIs occasionally fail in odd states — non-fatal
			}

			this.close();
		}

		/**
		 * Phase G: load the persisted shown-state from chrome.storage.local.
		 * Async fire-and-forget — doesn't block modal initialization.
		 */
		async _loadFromStorage() {
			if (!globalThis.chrome?.storage?.local) return;
			try {
				const result = await chrome.storage.local.get([STORAGE_KEY]);
				const data = result?.[STORAGE_KEY];
				if (data && typeof data === 'object') {
					if (typeof data.sessionResetMs === 'number') {
						this.shownForSessionResetMs = data.sessionResetMs;
					}
					if (typeof data.weeklyResetMs === 'number') {
						this.shownForWeeklyResetMs = data.weeklyResetMs;
					}
				}
			} catch (e) {
				console.warn('[TokenCounter] modal: storage load failed', e);
			}
		}

		/**
		 * Phase G: persist shown-state so the modal doesn't re-pop after reload.
		 * Fire-and-forget — UI doesn't wait for the write.
		 */
		async _saveToStorage() {
			if (!globalThis.chrome?.storage?.local) return;
			try {
				await chrome.storage.local.set({
					[STORAGE_KEY]: {
						sessionResetMs: this.shownForSessionResetMs,
						weeklyResetMs: this.shownForWeeklyResetMs
					}
				});
			} catch (e) {
				console.warn('[TokenCounter] modal: storage save failed', e);
			}
		}
	}

	// Auto-instantiate singleton — modal is global, not per-conversation
	const instance = new HandoffModal();
	instance.initialize();
	CC.modal = instance;
})();
