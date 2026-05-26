(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_MENU_TRIGGER: '[data-testid="chat-menu-trigger"]',
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
		CHAT_PROJECT_WRAPPER: '.chat-project-wrapper',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script'
	});

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: '#2c84db',
		PROGRESS_FILL_LIGHT: '#5aa6ff',
		PROGRESS_OUTLINE_DARK: '#787877',
		PROGRESS_OUTLINE_LIGHT: '#bfbfbf',
		PROGRESS_MARKER_DARK: '#ffffff',
		PROGRESS_MARKER_LIGHT: '#111111',
		RED_WARNING: '#ce2029',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5',
		// --- Fork additions: traffic-light tier colors ---
		TIER_GREEN_DARK: '#10B981',
		TIER_GREEN_LIGHT: '#34D399',
		TIER_YELLOW_DARK: '#F59E0B',
		TIER_YELLOW_LIGHT: '#FBBF24',
		TIER_RED_DARK: '#EF4444',
		TIER_RED_LIGHT: '#F87171'
	});

	// --- Fork additions: utilization thresholds (percentages) ---
	CC.THRESHOLDS = Object.freeze({
		YELLOW: 50,  // >= 50% → yellow tier
		RED: 70,     // >= 70% → red tier
		MODAL: 85    // >= 85% → trigger handoff modal (Phase D)
	});
})();
