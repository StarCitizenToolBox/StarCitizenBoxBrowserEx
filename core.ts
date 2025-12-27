

// Configuration (DOM-related only)
const MIN_TEXT_LENGTH = 2;
const MAX_FAST_TEXT_LENGTH = 32;
const FAST_BATCH_SIZE = 50;

// Regex to detect Chinese characters (CJK Unified Ideographs)
const CHINESE_REGEX = /[\u4e00-\u9fff]/;

// State
let SCLocalizationTranslating = false;
let isDomainWhitelisted = true; // Whether current domain is whitelisted (affects LLM usage)
let isUserLoggedIn = false; // Whether user is logged in (affects LLM availability)
let memoryCache: Record<string, { targetText: string; matchType: string }> | null = null;
let batchQueue: Array<{ node: Text; originalText: string; parent: Element | null }> = [];
let slowQueue: Array<{ node: Text; originalText: string; parent: Element | null }> = [];
let activeBatchWorkers = 0;
let activeSlowWorkers = 0;
const pendingRequests = new Map<string, Promise<string | null>>();

// Deduplication for fast batch translations
const pendingFastTexts = new Set<string>();
const pendingFastCallbacks = new Map<string, Array<(result: { targetText: string; matchType: string } | null) => void>>();

// Concurrency constants
const BATCH_WORKER_COUNT = 2;
const SLOW_WORKER_COUNT = 8;

// Store original text for each translated node
const originalTexts = new WeakMap<Text, string>();
const translatedNodes = new WeakMap<Text, string>();
const pendingNodes = new WeakSet<Text>();

// Elements that should never be translated
const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
    'CODE', 'PRE', 'KBD', 'VAR', 'SAMP',
    'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'SVG', 'MATH', 'CANVAS',
    'IMG', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK',
    'META', 'LINK', 'BASE', 'HEAD', 'TITLE',
    'MAT-ICON'
]);

// Inline elements
const INLINE_TAGS = new Set([
    'A', 'ABBR', 'ACRONYM', 'B', 'BDO', 'BIG', 'BR', 'CITE',
    'DFN', 'EM', 'FONT', 'I', 'KBD', 'LABEL', 'Q', 'S',
    'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP',
    'TIME', 'TT', 'U', 'VAR', 'MARK', 'DEL', 'INS'
]);

// Classes that indicate non-translatable content
const SKIP_CLASSES = new Set([
    'notranslate', 'no-translate', 'code', 'mono', 'monospace',
    'highlight', 'syntax', 'prism', 'hljs',
    'fa', 'fas', 'far', 'fal', 'fad', 'fab', 'icon', 'icons', 'icn', 'icomoon'
]);

function InitWebLocalization() {
    injectStyles();
    _checkTranslationState();
    setupMutationObserver();
    setupInteractionListeners();
}

function injectStyles() {
    if (document.getElementById('sc-translate-styles')) return;

    const style = document.createElement('style');
    style.id = 'sc-translate-styles';
    style.textContent = `
        @keyframes sc-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 1; }
        }
        
        .sc-translating-text {
            animation: sc-pulse 0.8s ease-in-out infinite;
        }
        
        .sc-translated-text {
            transition: opacity 0.3s ease;
        }
    `;
    document.head.appendChild(style);
}

function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
        if (!SCLocalizationTranslating) return;

        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        findTranslationUnits(node as Element);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        processNodeForTranslation(node as Text);
                    }
                }
            } else if (mutation.type === 'characterData') {
                const node = mutation.target as Text;

                if (pendingNodes.has(node)) {
                    pendingNodes.delete(node);
                }

                if (translatedNodes.has(node)) {
                    const storedTranslation = translatedNodes.get(node);
                    const currentText = node.nodeValue || '';

                    if (currentText === storedTranslation) return;

                    translatedNodes.delete(node);
                    originalTexts.delete(node);
                }

                processNodeForTranslation(node);
            }
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

function setupInteractionListeners() {
    let timeout: any;
    const runCheck = () => {
        if (!SCLocalizationTranslating) return;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            findTranslationUnits(document.body);
        }, 500);
    };

    window.addEventListener('click', runCheck, true);
    window.addEventListener('keyup', runCheck, true);
}

function _saveLocalizationSwitchState(enable: boolean) {
    chrome.runtime.sendMessage({
        action: "_setTranslateSwitch",
        url: window.location.href,
        enableManual: enable
    }, () => { });
}

function _checkTranslationState() {
    chrome.runtime.sendMessage({
        action: "_getTranslateSwitch",
        url: window.location.href
    }, (response) => {
        if (response && response.enabled) {
            // If this is a default auto-enabled domain, it's whitelisted
            if (response.isDefault) {
                isDomainWhitelisted = true;
            }
            startTranslation();
        }
    });
}

// Get current host domain for cache isolation
function getCurrentDomain(): string {
    return window.location.hostname;
}

// ==================== Element Checking ====================

function shouldSkipElement(element: Element): boolean {
    if (SKIP_TAGS.has(element.tagName)) return true;

    for (const className of element.classList) {
        const lowerClass = className.toLowerCase();
        if (SKIP_CLASSES.has(lowerClass)) return true;

        if (lowerClass.includes('material-icons') ||
            lowerClass.includes('material-symbols') ||
            lowerClass.startsWith('fa-') ||
            lowerClass.startsWith('icon-') ||
            lowerClass.startsWith('glyphicon-')) {
            return true;
        }
    }

    // Skip <i> elements that are used as icons (empty or only whitespace content)
    if (element.tagName === 'I' && !element.textContent?.trim()) {
        return true;
    }

    if (element.getAttribute('translate') === 'no') return true;
    if (element.hasAttribute('contenteditable')) return true;
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
        return true;
    }

    return false;
}

function isBlockElement(element: Element): boolean {
    if (INLINE_TAGS.has(element.tagName)) return false;

    const display = window.getComputedStyle(element).display;
    return display === 'block' || display === 'flex' || display === 'grid' ||
        display === 'table' || display === 'table-cell' || display === 'table-row' ||
        display === 'list-item';
}

function getTranslationUnitText(element: Element): string {
    let text = '';

    function traverse(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.nodeValue || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (!shouldSkipElement(el)) {
                for (const child of node.childNodes) {
                    traverse(child);
                }
            }
        }
    }

    traverse(element);
    return text;
}

function hasOnlyInlineContent(element: Element): boolean {
    for (const child of element.children) {
        if (!INLINE_TAGS.has(child.tagName) && !shouldSkipElement(child)) {
            const display = window.getComputedStyle(child).display;
            if (display !== 'inline' && display !== 'inline-block') {
                return false;
            }
        }
        if (!hasOnlyInlineContent(child)) {
            return false;
        }
    }
    return true;
}

function hasDirectTextContent(element: Element): boolean {
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = (child.nodeValue || '').trim();
            if (text.length >= MIN_TEXT_LENGTH && /[a-zA-Z]/.test(text) && !CHINESE_REGEX.test(text)) {
                return true;
            }
        }
    }
    return false;
}

function findTranslationUnits(root: Element | Document) {
    const elements = root instanceof Document
        ? root.body.querySelectorAll('*')
        : [root, ...root.querySelectorAll('*')];

    for (const element of elements) {
        if (shouldSkipElement(element)) continue;

        if (isBlockElement(element) && hasOnlyInlineContent(element)) {
            const text = getTranslationUnitText(element).trim();

            if (text.length >= MIN_TEXT_LENGTH && /[a-zA-Z]/.test(text) && !CHINESE_REGEX.test(text)) {
                collectTextNodesFromUnit(element);
            }
        }
        else if (hasDirectTextContent(element)) {
            collectDirectTextNodes(element);
        }
    }
}

// ==================== Node Processing ====================

function processNodeForTranslation(node: Text) {
    if (pendingNodes.has(node)) return;

    const parentEl = node.parentElement;
    if (parentEl && shouldSkipElement(parentEl)) return;

    if (translatedNodes.has(node)) {
        const expected = translatedNodes.get(node);
        if (node.nodeValue !== expected) {
            translatedNodes.delete(node);
            originalTexts.delete(node);
        } else {
            return;
        }
    }

    const text = node.nodeValue?.trim();
    if (!text || text.length < MIN_TEXT_LENGTH || !/[a-zA-Z]/.test(text) || CHINESE_REGEX.test(text)) return;

    // Check memory cache first (sync)
    if (memoryCache && memoryCache[text]) {
        applyTranslationToNode(node, node.nodeValue || '', memoryCache[text].targetText);
        if (parentEl) {
            updateParentVisualState(parentEl);
        }
        return;
    }

    pendingNodes.add(node);

    if (parentEl && !parentEl.classList.contains('sc-translating-text')) {
        parentEl.classList.add('sc-translating-text');
    }

    const item = { node, originalText: node.nodeValue || '', parent: parentEl };

    // All texts go to fast queue first
    batchQueue.push(item);
    triggerBatchWorkers();
}

function collectDirectTextNodes(element: Element) {
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            processNodeForTranslation(child as Text);
        }
    }
}

function collectTextNodesFromUnit(element: Element) {
    const textNodes: Text[] = [];

    function traverse(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const textNode = node as Text;
            const text = textNode.nodeValue?.trim();
            if (text && text.length > 0) {
                textNodes.push(textNode);
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (!shouldSkipElement(el)) {
                for (const child of node.childNodes) {
                    traverse(child);
                }
            }
        }
    }

    traverse(element);

    for (const node of textNodes) {
        processNodeForTranslation(node);
    }
}

// ==================== DOM Updates ====================

function applyTranslationToNode(node: Text, originalText: string, translatedText: string) {
    if (!node.parentNode) return;
    if (node.nodeValue !== originalText) return;

    const trimmedOriginal = originalText.trim();
    if (translatedText === trimmedOriginal) return;

    originalTexts.set(node, originalText);

    const leadingSpace = originalText.match(/^(\s*)/)?.[1] || '';
    const trailingSpace = originalText.match(/(\s*)$/)?.[1] || '';

    node.nodeValue = leadingSpace + translatedText + trailingSpace;
    translatedNodes.set(node, node.nodeValue);
}

function updateParentVisualState(parentEl: Element) {
    const hasPendingChildren = Array.from(parentEl.childNodes).some(
        child => child.nodeType === Node.TEXT_NODE && pendingNodes.has(child as Text)
    );

    if (!hasPendingChildren) {
        parentEl.classList.remove('sc-translating-text');

        const hasTranslatedChildren = Array.from(parentEl.childNodes).some(
            child => child.nodeType === Node.TEXT_NODE && translatedNodes.has(child as Text)
        );

        if (hasTranslatedChildren) {
            parentEl.classList.add('sc-translated-text');
        }
    }
}

function cleanupPendingNodeAfterSuccess(node: Text) {
    pendingNodes.delete(node);
    const parentEl = node.parentElement;
    if (parentEl) {
        updateParentVisualState(parentEl);
    }
}

function cleanupPendingNode(node: Text, explicitParent?: Element | null): void {
    pendingNodes.delete(node);
    const parentEl = explicitParent || node.parentElement;
    if (parentEl) {
        updateParentVisualState(parentEl);
    }
}

// ==================== Translation via Background ====================

async function translateViaBackground(texts: string[], use_llm: boolean = false): Promise<Record<string, { targetText: string; matchType: string } | null>> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "_translateBatch",
            texts: texts,
            domain: getCurrentDomain(),
            use_llm: use_llm
        }, (response) => {
            if (response && response.results) {
                // Update local memory cache with new entries
                if (response.entriesToCache && memoryCache) {
                    for (const entry of response.entriesToCache) {
                        memoryCache[entry.sourceText] = {
                            targetText: entry.targetText,
                            matchType: entry.matchType
                        };
                    }
                }
                resolve(response.results);
            } else {
                resolve({});
            }
        });
    });
}

async function translateSingleViaBackground(text: string, output_terms: boolean = false): Promise<{ translated: string; matchType: string } | null> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "_translateSingle",
            text: text,
            domain: getCurrentDomain(),
            output_terms: output_terms
        }, (response) => {
            if (response && response.translated) {
                // Update local memory cache
                if (memoryCache) {
                    memoryCache[text] = {
                        targetText: response.translated,
                        matchType: response.matchType
                    };
                }
                resolve(response);
            } else {
                resolve(null);
            }
        });
    });
}

async function loadCacheFromBackground(): Promise<void> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "_loadCache",
            domain: getCurrentDomain()
        }, (response) => {
            if (response && response.cache) {
                memoryCache = {};
                for (const [key, entry] of Object.entries(response.cache)) {
                    const e = entry as any;
                    memoryCache[key] = {
                        targetText: e.targetText,
                        matchType: e.matchType
                    };
                }
            } else {
                memoryCache = {};
            }
            resolve();
        });
    });
}

// ==================== Concurrent Workers ====================

function triggerBatchWorkers() {
    while (activeBatchWorkers < BATCH_WORKER_COUNT && batchQueue.length > 0) {
        runBatchWorker();
    }
}

async function runBatchWorker() {
    activeBatchWorkers++;

    try {
        while (batchQueue.length > 0 && SCLocalizationTranslating) {
            const batch = batchQueue.splice(0, FAST_BATCH_SIZE);
            if (batch.length === 0) break;

            await processBatchChunk(batch);
        }
    } finally {
        activeBatchWorkers--;
        if (batchQueue.length > 0 && SCLocalizationTranslating && activeBatchWorkers < BATCH_WORKER_COUNT) {
            triggerBatchWorkers();
        }
    }
}

async function processBatchChunk(batch: Array<{ node: Text; originalText: string; parent: Element | null }>) {
    const neededItems: typeof batch = [];
    const waitingItems: Array<{ item: typeof batch[0]; text: string }> = [];

    for (const item of batch) {
        if (!item.node.parentNode) {
            cleanupPendingNode(item.node, item.parent);
            continue;
        }

        const text = item.originalText.trim();
        if (memoryCache && memoryCache[text]) {
            applyTranslationToNode(item.node, item.originalText, memoryCache[text].targetText);
            cleanupPendingNodeAfterSuccess(item.node);
        } else if (pendingFastTexts.has(text)) {
            waitingItems.push({ item, text });
        } else {
            neededItems.push(item);
        }
    }

    // Register callbacks for waiting items
    for (const { item, text } of waitingItems) {
        const callback = (result: { targetText: string; matchType: string } | null) => {
            if (!item.node.parentNode) {
                cleanupPendingNode(item.node, item.parent);
                return;
            }
            if (result) {
                applyTranslationToNode(item.node, item.originalText, result.targetText);
                cleanupPendingNodeAfterSuccess(item.node);
            } else {
                if (text.length >= MAX_FAST_TEXT_LENGTH) {
                    slowQueue.push(item);
                    triggerSlowWorkers();
                } else {
                    cleanupPendingNode(item.node, item.parent);
                }
            }
        };

        if (!pendingFastCallbacks.has(text)) {
            pendingFastCallbacks.set(text, []);
        }
        pendingFastCallbacks.get(text)!.push(callback);
    }

    if (neededItems.length === 0) return;

    const validItems = neededItems;
    const uniqueTexts = [...new Set(validItems.map(i => i.originalText.trim()))];

    for (const text of uniqueTexts) {
        pendingFastTexts.add(text);
    }

    try {
        // Step 1: Call background for fast batch translation (use_llm = false)
        let results = await translateViaBackground(uniqueTexts, false);

        // Identify misses
        const misses: string[] = [];
        for (const text of uniqueTexts) {
            if (!results[text]) {
                misses.push(text);
            }
        }

        // Step 2: Handle misses - only use LLM if user is logged in AND domain is whitelisted
        if (misses.length > 0 && isUserLoggedIn && isDomainWhitelisted) {
            const shortMisses = misses.filter(t => t.length < MAX_FAST_TEXT_LENGTH);

            if (shortMisses.length > 0) {
                // Retry short texts with use_llm = true
                const llmResults = await translateViaBackground(shortMisses, true);
                // Merge results
                results = { ...results, ...llmResults };
            }
        }

        let slowItems: typeof validItems = [];

        for (const item of validItems) {
            const text = item.originalText.trim();
            const result = results[text];

            if (result) {
                applyTranslationToNode(item.node, item.originalText, result.targetText);
                cleanupPendingNodeAfterSuccess(item.node);
            } else {
                if (text.length >= MAX_FAST_TEXT_LENGTH) {
                    slowItems.push(item);
                } else {
                    cleanupPendingNode(item.node, item.parent);
                }
            }
        }

        // Notify waiting callbacks
        for (const text of uniqueTexts) {
            const callbacks = pendingFastCallbacks.get(text);
            if (callbacks) {
                const result = results[text] || null;
                for (const cb of callbacks) {
                    cb(result);
                }
                pendingFastCallbacks.delete(text);
            }
            pendingFastTexts.delete(text);
        }

        if (slowItems.length > 0) {
            slowQueue.push(...slowItems);
            triggerSlowWorkers();
        }

    } catch (err) {
        console.error("Batch worker error:", err);

        for (const text of uniqueTexts) {
            const callbacks = pendingFastCallbacks.get(text);
            if (callbacks) {
                for (const cb of callbacks) {
                    cb(null);
                }
                pendingFastCallbacks.delete(text);
            }
            pendingFastTexts.delete(text);
        }

        for (const item of validItems) {
            const text = item.originalText.trim();
            if (text.length >= MAX_FAST_TEXT_LENGTH) {
                slowQueue.push(item);
            } else {
                cleanupPendingNode(item.node, item.parent);
            }
        }
        triggerSlowWorkers();
    }
}

function triggerSlowWorkers() {
    while (activeSlowWorkers < SLOW_WORKER_COUNT && slowQueue.length > 0) {
        runSlowWorker();
    }
}

async function runSlowWorker() {
    activeSlowWorkers++;
    try {
        while (slowQueue.length > 0 && SCLocalizationTranslating) {
            const item = slowQueue.shift();
            if (!item) break;

            if (!item.node.parentNode) {
                cleanupPendingNode(item.node, item.parent);
                continue;
            }

            const text = item.originalText.trim();

            // Check memory cache
            if (memoryCache && memoryCache[text]) {
                applyTranslationToNode(item.node, item.originalText, memoryCache[text].targetText);
                cleanupPendingNodeAfterSuccess(item.node);
                continue;
            }

            // Skip LLM translation if user is not logged in or domain is not whitelisted
            // Since slow queue items are long texts that require LLM translation
            if (!isUserLoggedIn || !isDomainWhitelisted) {
                cleanupPendingNode(item.node, item.parent);
                continue;
            }

            // Deduplicate
            let translationPromise = pendingRequests.get(text);
            if (!translationPromise) {
                translationPromise = translateSingleViaBackground(text)
                    .then(res => res ? res.translated : null)
                    .catch(err => {
                        console.error("Slow translation error:", err);
                        return null;
                    })
                    .finally(() => {
                        pendingRequests.delete(text);
                    });
                pendingRequests.set(text, translationPromise);
            }

            try {
                const result = await translationPromise;

                if (!item.node.parentNode || !SCLocalizationTranslating) {
                    cleanupPendingNode(item.node, item.parent);
                    continue;
                }

                if (result) {
                    applyTranslationToNode(item.node, item.originalText, result);
                    cleanupPendingNodeAfterSuccess(item.node);
                } else {
                    cleanupPendingNode(item.node, item.parent);
                }
            } catch (err) {
                console.error("Slow worker error:", err);
                cleanupPendingNode(item.node, item.parent);
            }
        }
    } finally {
        activeSlowWorkers--;
        if (slowQueue.length > 0 && SCLocalizationTranslating && activeSlowWorkers < SLOW_WORKER_COUNT) {
            triggerSlowWorkers();
        }
    }
}

// ==================== Translation Control ====================

// Check user login status from background
async function checkLoginStatus(): Promise<boolean> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: "_checkLoginStatus"
        }, (response) => {
            if (chrome.runtime.lastError || !response) {
                resolve(false);
                return;
            }
            resolve(response.loggedIn === true);
        });
    });
}

async function startTranslation() {
    if (SCLocalizationTranslating) return;

    SCLocalizationTranslating = true;
    window.postMessage({ type: 'TOGGLED-SC-BOX-TRANSLATE', action: 'on' }, '*');

    // Check user login status for LLM availability
    isUserLoggedIn = await checkLoginStatus();

    // Load cache from background
    await loadCacheFromBackground();

    findTranslationUnits(document);

    triggerBatchWorkers();
    triggerSlowWorkers();
}

function stopTranslation(): Promise<{ success: boolean }> {
    SCLocalizationTranslating = false;
    isDomainWhitelisted = true; // Reset whitelist status
    isUserLoggedIn = false; // Reset login status
    batchQueue = [];
    slowQueue = [];
    pendingRequests.clear();
    pendingFastTexts.clear();
    pendingFastCallbacks.clear();

    const translatedParents = document.querySelectorAll('.sc-translated-text');
    translatedParents.forEach(parent => {
        parent.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                const node = child as Text;
                if (translatedNodes.has(node)) {
                    const original = originalTexts.get(node);
                    if (original !== undefined) {
                        node.nodeValue = original;
                    }
                    translatedNodes.delete(node);
                    originalTexts.delete(node);
                }
            }
        });
        parent.classList.remove('sc-translated-text');
    });

    document.querySelectorAll('.sc-translating-text').forEach(el => {
        el.classList.remove('sc-translating-text');
    });

    window.postMessage({ type: 'TOGGLED-SC-BOX-TRANSLATE', action: 'off' }, '*');

    return Promise.resolve({ success: true });
}

function toggleTranslation() {
    if (SCLocalizationTranslating) {
        stopTranslation();
        _saveLocalizationSwitchState(false);
    } else {
        startTranslation();
        _saveLocalizationSwitchState(true);
    }
    notifyTranslationStatusChange();
}

function notifyTranslationStatusChange() {
    chrome.runtime.sendMessage({
        action: "_translationStatusChanged",
        isTranslating: SCLocalizationTranslating
    }).catch(() => {
        // Ignore errors
    });
}

// Show domain confirmation dialog for non-whitelisted domains
function showDomainConfirmation(domain: string, _description: string) {
    // Check if dialog already exists
    if (document.getElementById('sc-domain-confirm-overlay')) return;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'sc-domain-confirm-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: sc-fade-in 0.2s ease;
    `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: linear-gradient(145deg, #1a1a2e, #16213e);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 24px 32px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: sc-slide-up 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Icon
    const icon = document.createElement('div');
    icon.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#f59e0b" stroke-width="2"/>
            <path d="M12 8v4" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
            <circle cx="12" cy="16" r="1" fill="#f59e0b"/>
        </svg>
    `;
    icon.style.cssText = `text-align: center; margin-bottom: 16px;`;

    // Title
    const title = document.createElement('h3');
    title.textContent = '翻译提示';
    title.style.cssText = `
        color: #fff;
        font-size: 20px;
        font-weight: 600;
        margin: 0 0 12px 0;
        text-align: center;
    `;

    // Message
    const message = document.createElement('p');
    message.innerHTML = `当前网站 <strong style="color: #60a5fa;">${domain}</strong> 未进行翻译优化，翻译效果可能受限。<br><br>是否继续开启翻译？`;
    message.style.cssText = `
        color: rgba(255, 255, 255, 0.8);
        font-size: 14px;
        line-height: 1.6;
        margin: 0 0 24px 0;
        text-align: center;
    `;

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: center;
    `;

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = `
        padding: 10px 24px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        background: transparent;
        color: rgba(255, 255, 255, 0.8);
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
    `;
    cancelBtn.onmouseover = () => {
        cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
    };
    cancelBtn.onmouseout = () => {
        cancelBtn.style.background = 'transparent';
    };

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '继续翻译';
    confirmBtn.style.cssText = `
        padding: 10px 24px;
        border: none;
        border-radius: 8px;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
    `;
    confirmBtn.onmouseover = () => {
        confirmBtn.style.transform = 'translateY(-1px)';
        confirmBtn.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
    };
    confirmBtn.onmouseout = () => {
        confirmBtn.style.transform = 'translateY(0)';
        confirmBtn.style.boxShadow = 'none';
    };

    // Add keyframe animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes sc-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes sc-slide-up {
            from { 
                opacity: 0;
                transform: translateY(20px);
            }
            to { 
                opacity: 1;
                transform: translateY(0);
            }
        }
    `;
    document.head.appendChild(style);

    // Close dialog function
    const closeDialog = () => {
        overlay.style.animation = 'sc-fade-in 0.2s ease reverse';
        setTimeout(() => {
            overlay.remove();
            style.remove();
        }, 180);
    };

    // Event handlers
    cancelBtn.onclick = closeDialog;
    overlay.onclick = (e) => {
        if (e.target === overlay) closeDialog();
    };
    confirmBtn.onclick = () => {
        closeDialog();
        // Start translation after confirmation (with LLM disabled for non-whitelisted domain)
        isDomainWhitelisted = false;
        startTranslation();
        _saveLocalizationSwitchState(true);
        notifyTranslationStatusChange();
    };

    // Assemble dialog
    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialog.appendChild(icon);
    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Focus confirm button
    confirmBtn.focus();
}

// ==================== Initialize ====================

InitWebLocalization();

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "_toggleTranslation") {
        toggleTranslation();
    } else if (request.action === "_startTranslationWithWhitelist") {
        // Start translation with explicit whitelist status
        if (!SCLocalizationTranslating) {
            isDomainWhitelisted = request.isWhitelisted === true;
            startTranslation();
            _saveLocalizationSwitchState(true);
            notifyTranslationStatusChange();
        }
    } else if (request.action === "_showDomainConfirmation") {
        // Show confirmation dialog for non-whitelisted domains
        showDomainConfirmation(request.domain, request.description || '');
    } else if (request.action === "_getTranslationStatus") {
        sendResponse({ isTranslating: SCLocalizationTranslating });
        return false;
    } else if (request.action === "_getCacheStats") {
        // Forward to background
        chrome.runtime.sendMessage({ action: "_getAllCacheStats" }, (response) => {
            sendResponse(response);
        });
        return true;
    } else if (request.action === "_clearCache") {
        chrome.runtime.sendMessage({
            action: "_clearDomainCache",
            domain: getCurrentDomain()
        }, (response) => {
            memoryCache = {};
            sendResponse(response);
        });
        return true;
    }
});

// Handle messages from page scripts
window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'SC_TRANSLATE_REQUEST') return;

    const { action } = event.data;

    if (action === 'translate') {
        // Check whitelist before starting translation (same as context menu)
        if (SCLocalizationTranslating) {
            // Already translating, ignore
            return;
        }

        // Request whitelist check from background
        chrome.runtime.sendMessage({
            action: "_checkDomainWhitelist",
            domain: getCurrentDomain()
        }, (response) => {
            if (chrome.runtime.lastError || !response) {
                // API failed, proceed anyway
                startTranslation();
                _saveLocalizationSwitchState(true);
                notifyTranslationStatusChange();
                return;
            }

            if (response.whitelisted || response.is_general) {
                // Domain is whitelisted, proceed directly
                isDomainWhitelisted = true;
                startTranslation();
                _saveLocalizationSwitchState(true);
                notifyTranslationStatusChange();
            } else {
                // Domain not whitelisted, show confirmation
                showDomainConfirmation(getCurrentDomain(), response.description || '');
            }
        });
    } else if (action === 'undoTranslate') {
        await stopTranslation();
        _saveLocalizationSwitchState(false);
    }
});

window.postMessage({ type: 'SC-BOX-TRANSLATE-API-AVAILABLE' }, '*');
