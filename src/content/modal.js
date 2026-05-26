/**
 * Handoff Modal — fork addition.
 *
 * Pops a Claude-style dialog when projected context % crosses CC.THRESHOLDS.MODAL (85%).
 * Two CTAs:
 *   1. "Send anyway"   — dismiss, let the user send
 *   2. "Help me save context" — insert a structured handoff prompt into the chat input
 *
 * Fires at most once per conversation per page load. Phase E will persist the
 * "shown for X" set across reloads via chrome.storage.local.
 */
(() => {
	'use strict';
	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

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
			this.percentSpan = null;
			this.dismissBtn = null;
			this.handoffBtn = null;
			this.isOpen = false;
			this.shownForConversations = new Set();
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

			// Title
			const title = document.createElement('h3');
			title.id = 'cc-modal-title';
			title.className = 'cc-modal__title';
			title.textContent = 'Approaching context limit';

			// Body
			const body = document.createElement('div');
			body.className = 'cc-modal__body';

			const p1 = document.createElement('p');
			p1.appendChild(document.createTextNode('Your next message will push this conversation to '));
			this.percentSpan = document.createElement('strong');
			this.percentSpan.className = 'cc-modal__pct';
			p1.appendChild(this.percentSpan);
			p1.appendChild(document.createTextNode(' of its 200k context limit.'));

			const p2 = document.createElement('p');
			p2.textContent = 'Once you hit 100%, older messages get compacted and detail can be lost. Consider using your next prompt to extract a structured handoff you can paste into a new conversation or another AI tool.';

			body.appendChild(p1);
			body.appendChild(p2);

			// Actions
			const actions = document.createElement('div');
			actions.className = 'cc-modal__actions';

			this.dismissBtn = document.createElement('button');
			this.dismissBtn.type = 'button';
			this.dismissBtn.className = 'cc-modal__btn cc-modal__btn--secondary';
			this.dismissBtn.textContent = 'Send anyway';

			this.handoffBtn = document.createElement('button');
			this.handoffBtn.type = 'button';
			this.handoffBtn.className = 'cc-modal__btn cc-modal__btn--primary';
			this.handoffBtn.textContent = 'Help me save context';

			actions.appendChild(this.dismissBtn);
			actions.appendChild(this.handoffBtn);

			this.modal.appendChild(title);
			this.modal.appendChild(body);
			this.modal.appendChild(actions);
			this.backdrop.appendChild(this.modal);

			// Events
			this.dismissBtn.addEventListener('click', () => this.close());
			this.handoffBtn.addEventListener('click', () => this._injectHandoffPrompt());
			this.backdrop.addEventListener('click', (e) => {
				if (e.target === this.backdrop) this.close();
			});
			// Stop clicks inside the modal from bubbling to backdrop
			this.modal.addEventListener('click', (e) => e.stopPropagation());

			document.body.appendChild(this.backdrop);
		}

		/**
		 * Called by preview.js on every render. Shows the modal once per conversation
		 * when projected context % crosses CC.THRESHOLDS.MODAL.
		 */
		maybeShow({ projectedPct, conversationId }) {
			if (this.isOpen) return;
			if (typeof projectedPct !== 'number' || projectedPct < CC.THRESHOLDS.MODAL) return;
			if (!conversationId) return;
			if (this.shownForConversations.has(conversationId)) return;

			this.shownForConversations.add(conversationId);
			this._show(projectedPct);
		}

		_show(projectedPct) {
			if (!this.backdrop) return;

			// Cap at 999 for display so the modal doesn't show ridiculous numbers
			this.percentSpan.textContent = `${Math.round(Math.min(projectedPct, 999))}%`;

			// Switch CTA label based on whether input already has content
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

			// Focus dismiss by default — less destructive default action
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

			// Focus must come first so execCommand operates on this element
			input.focus();

			// Primary path: select-all + execCommand('insertText').
			// Claude.ai uses ProseMirror (React-based contenteditable). Plain
			// textContent assignment doesn't update ProseMirror's internal state,
			// which leaves the send button disabled. execCommand fires the
			// synthetic beforeinput/input events ProseMirror listens for.
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

			// Fallback path: if execCommand returned false or threw, fall back to
			// direct textContent assignment + InputEvent dispatch. May not update
			// editor state in all frameworks, but better than nothing.
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
	}

	// Auto-instantiate singleton — modal is global, not per-conversation
	const instance = new HandoffModal();
	instance.initialize();
	CC.modal = instance;
})();
