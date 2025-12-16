declare const $: any;
declare const timeago: any;

// Configuration
const TRANSLATE_API_BASE_URL = "http://localhost:8066/api/v1";
const CACHE_MAX_SIZE = 100000;
const MIN_TEXT_LENGTH = 2;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 50;

// State
let SCLocalizationTranslating = false;
let memoryCache: Record<string, TranslationCacheEntry> | null = null;
let batchQueue: Array<{ node: Text; originalText: string; parent: Element | null }> = [];
let slowQueue: Array<{ node: Text; originalText: string; parent: Element | null }> = [];
let activeBatchWorkers = 0;
let activeSlowWorkers = 0;
const pendingRequests = new Map<string, Promise<string | null>>();

// Concurrency constants
const BATCH_WORKER_COUNT = 2;
const SLOW_WORKER_COUNT = 8;
const MAX_FAST_TEXT_LENGTH = 32;
const FAST_BATCH_SIZE = 50;

// Translation cache structure
interface TranslationCacheEntry {
    sourceText: string;
    targetText: string;
    matchType: string;
    timestamp: number;
}

interface TranslationCache {
    entries: Record<string, TranslationCacheEntry>;
    order: string[]; // For LRU eviction
}

// API Response types
interface TranslateApiResponse {
    source_text: string;
    target_text: string;
    source_lang: string;
    target_lang: string;
    match_type: string;
    exact_terms: any[];
    reference_terms: any[];
    from_cache: boolean;
    used_llm: boolean;
}

interface FastTranslateResult {
    source_text: string;
    target_text: string;
    match_type: 'term' | 'template' | 'cache' | 'noCache' | 'tooLong' | 'llm';
}

interface FastTranslateApiResponse {
    results: FastTranslateResult[];
    total: number;
    matched: number;
}

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
    'META', 'LINK', 'BASE', 'HEAD', 'TITLE'
]);

// Inline elements - these should have their text merged with siblings
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
    // Standalone icon classes
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

                // Handle race condition: Content changed while pending
                if (pendingNodes.has(node)) {
                    pendingNodes.delete(node);
                }

                // Check if this is an external change
                if (translatedNodes.has(node)) {
                    const storedTranslation = translatedNodes.get(node);
                    const currentText = node.nodeValue || '';

                    // If text matches what we set, ignore (our own change)
                    if (currentText === storedTranslation) return;

                    // External change detected: reset state
                    translatedNodes.delete(node);
                    originalTexts.delete(node);
                }

                // Process as new content
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
            startTranslation();
        }
    });
}

// Get current host domain for cache isolation
function getCurrentDomain(): string {
    return window.location.hostname;
}

// Translation cache operations
async function loadCacheToMemory(): Promise<void> {
    if (memoryCache) return;
    const cache = await getTranslationCache();
    memoryCache = cache.entries;
}

async function getTranslationCache(): Promise<TranslationCache> {
    return new Promise((resolve) => {
        const domain = getCurrentDomain();
        const cacheKey = `translation_cache_${domain}`;
        chrome.storage.local.get([cacheKey], (result) => {
            const cache = result[cacheKey] as TranslationCache;
            if (cache && cache.entries && cache.order) {
                resolve(cache);
            } else {
                resolve({ entries: {}, order: [] });
            }
        });
    });
}

async function saveTranslationCache(cache: TranslationCache): Promise<void> {
    return new Promise((resolve) => {
        const domain = getCurrentDomain();
        const cacheKey = `translation_cache_${domain}`;

        // Evict oldest entries if over limit
        while (cache.order.length > CACHE_MAX_SIZE) {
            const oldestKey = cache.order.shift();
            // Update memory cache
            if (memoryCache && oldestKey) delete memoryCache[oldestKey];
            if (oldestKey) {
                delete cache.entries[oldestKey];
            }
        }

        memoryCache = cache.entries;
        chrome.storage.local.set({ [cacheKey]: cache }, resolve);
    });
}

async function getCachedTranslation(text: string): Promise<TranslationCacheEntry | null> {
    // Fast path: memory cache
    if (memoryCache && memoryCache[text]) {
        return memoryCache[text];
    }

    // Fallback
    const cache = await getTranslationCache();
    if (!memoryCache) memoryCache = cache.entries;
    return cache.entries[text] || null;
}

async function setCachedTranslation(text: string, entry: TranslationCacheEntry): Promise<void> {
    const cache = await getTranslationCache();

    // Remove if already exists
    const idx = cache.order.indexOf(text);
    if (idx > -1) {
        cache.order.splice(idx, 1);
    }

    cache.entries[text] = entry;
    cache.order.push(text);

    await saveTranslationCache(cache);
}

async function setCachedTranslationsBatch(entries: TranslationCacheEntry[]): Promise<void> {
    const cache = await getTranslationCache();

    for (const entry of entries) {
        const text = entry.sourceText;
        // Remove if already exists
        const idx = cache.order.indexOf(text);
        if (idx > -1) {
            cache.order.splice(idx, 1);
        }

        cache.entries[text] = entry;
        cache.order.push(text);
    }

    await saveTranslationCache(cache);
}

// Check if element should be skipped
function shouldSkipElement(element: Element): boolean {
    if (SKIP_TAGS.has(element.tagName)) return true;

    // Skip by class
    for (const className of element.classList) {
        const lowerClass = className.toLowerCase();
        if (SKIP_CLASSES.has(lowerClass)) return true;

        // Skip common icon classes to prevent translating ligatures
        if (lowerClass.includes('material-icons') ||
            lowerClass.includes('material-symbols') ||
            lowerClass.startsWith('fa-') ||
            lowerClass.startsWith('icon-') ||
            lowerClass.startsWith('glyphicon-')) {
            return true;
        }
    }

    // Skip if translate="no"
    if (element.getAttribute('translate') === 'no') return true;

    // Skip contenteditable
    if (element.hasAttribute('contenteditable')) return true;

    // Skip hidden elements
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
        return true;
    }

    return false;
}

// Check if element is a block-level element (translation unit boundary)
function isBlockElement(element: Element): boolean {
    if (INLINE_TAGS.has(element.tagName)) return false;

    const display = window.getComputedStyle(element).display;
    return display === 'block' || display === 'flex' || display === 'grid' ||
        display === 'table' || display === 'table-cell' || display === 'table-row' ||
        display === 'list-item';
}

// Get combined text content from a translation unit (block element)
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

// Check if an element has only inline children (suitable for direct translation)
function hasOnlyInlineContent(element: Element): boolean {
    for (const child of element.children) {
        if (!INLINE_TAGS.has(child.tagName) && !shouldSkipElement(child)) {
            // Check if it's rendered as inline
            const display = window.getComputedStyle(child).display;
            if (display !== 'inline' && display !== 'inline-block') {
                return false;
            }
        }
        // Recursively check
        if (!hasOnlyInlineContent(child)) {
            return false;
        }
    }
    return true;
}

// Check if element has direct text children with English content
function hasDirectTextContent(element: Element): boolean {
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = (child.nodeValue || '').trim();
            if (text.length >= MIN_TEXT_LENGTH && /[a-zA-Z]/.test(text)) {
                return true;
            }
        }
    }
    return false;
}

// Find translation units (block elements with translatable content)
function findTranslationUnits(root: Element | Document) {
    const elements = root instanceof Document
        ? root.body.querySelectorAll('*')
        : [root, ...root.querySelectorAll('*')];

    for (const element of elements) {
        if (shouldSkipElement(element)) continue;

        // Strategy 1: Block elements with only inline content (original behavior)
        if (isBlockElement(element) && hasOnlyInlineContent(element)) {
            const text = getTranslationUnitText(element).trim();

            // Check if worth translating
            if (text.length >= MIN_TEXT_LENGTH && /[a-zA-Z]/.test(text)) {
                collectTextNodesFromUnit(element);
            }
        }
        // Strategy 2: Any element with direct text children containing English
        // This handles cases where parent has nested blocks but some direct text
        else if (hasDirectTextContent(element)) {
            collectDirectTextNodes(element);
        }
    }
}

function processNodeForTranslation(node: Text) {
    if (pendingNodes.has(node)) return;

    // Integrity check: if node is marked as translated, verify content matches
    if (translatedNodes.has(node)) {
        const expected = translatedNodes.get(node);
        if (node.nodeValue !== expected) {
            // Mismatch detected (missed mutation?), force re-process
            translatedNodes.delete(node);
            originalTexts.delete(node);
        } else {
            return;
        }
    }

    const text = node.nodeValue?.trim();
    if (!text || text.length < MIN_TEXT_LENGTH || !/[a-zA-Z]/.test(text)) return;

    // 1. Immediate Cache Check (Sync)
    if (memoryCache && memoryCache[text]) {
        applyTranslationToNode(node, node.nodeValue || '', memoryCache[text].targetText);
        // Ensure visual state is correct
        const parentEl = node.parentElement;
        if (parentEl) {
            updateParentVisualState(parentEl);
        }
        return;
    }

    // 2. Queue for API
    pendingNodes.add(node);

    // Add blinking effect
    const parentEl = node.parentElement;
    if (parentEl && !parentEl.classList.contains('sc-translating-text')) {
        parentEl.classList.add('sc-translating-text');
    }

    const item = { node, originalText: node.nodeValue || '', parent: parentEl };

    // 3. Dispatch to Queue
    if (text.length < MAX_FAST_TEXT_LENGTH) {
        batchQueue.push(item);
        triggerBatchWorkers();
    } else {
        slowQueue.push(item);
        triggerSlowWorkers();
    }
}

// Collect only direct text nodes from an element (not nested)
function collectDirectTextNodes(element: Element) {
    for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            processNodeForTranslation(child as Text);
        }
    }
}

// Collect text nodes from a single translation unit
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

// Helper to update DOM after successful translation
function applyTranslationToNode(node: Text, originalText: string, translatedText: string) {
    if (!node.parentNode) return;

    // Verify content hasn't changed (dynamic update race condition protection)
    if (node.nodeValue !== originalText) return;

    // Check if result is different
    const trimmedOriginal = originalText.trim();
    if (translatedText === trimmedOriginal) return;

    // Store original text for undo
    originalTexts.set(node, originalText);

    // Preserve leading/trailing whitespace from original
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

        // Check if ANY text node in this parent is translated to keep the class
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

// Call Fast API
async function translateViaFastApi(texts: string[]): Promise<FastTranslateApiResponse | null> {
    try {
        const response = await fetch(`${TRANSLATE_API_BASE_URL}/translate/fast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                texts: texts,
                source_lang: 'en',
                target_lang: 'zh-CN',
                domain: getCurrentDomain()
            })
        });

        if (!response.ok) {
            return null;
        }

        return await response.json() as FastTranslateApiResponse;
    } catch (error) {
        console.error('Fast Translation API request failed:', error);
        return null;
    }
}

// --- Concurrent Workers ---

function triggerBatchWorkers() {
    // Start workers up to limit
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
        // If queue still has items, trigger again
        if (batchQueue.length > 0 && SCLocalizationTranslating && activeBatchWorkers < BATCH_WORKER_COUNT) {
            triggerBatchWorkers();
        }
    }
}

async function processBatchChunk(batch: Array<{ node: Text; originalText: string; parent: Element | null }>) {
    // Filter invalid nodes and check cache first
    const neededItems: typeof batch = [];

    for (const item of batch) {
        if (!item.node.parentNode) {
            cleanupPendingNode(item.node, item.parent);
            continue;
        }

        const text = item.originalText.trim();
        // Check cache one last time before API call
        if (memoryCache && memoryCache[text]) {
            applyTranslationToNode(item.node, item.originalText, memoryCache[text].targetText);
            cleanupPendingNodeAfterSuccess(item.node);
        } else {
            neededItems.push(item);
        }
    }

    if (neededItems.length === 0) return;

    // Rename for clarity in rest of function
    const validItems = neededItems;

    try {
        const uniqueTexts = [...new Set(validItems.map(i => i.originalText.trim()))];
        const fastResponse = await translateViaFastApi(uniqueTexts);

        let failedItems: typeof validItems = [];

        if (fastResponse && fastResponse.results) {
            const resultMap = new Map<string, string>();
            const entriesToCache: TranslationCacheEntry[] = [];

            for (const res of fastResponse.results) {
                if (res.match_type !== 'noCache' && res.match_type !== 'tooLong' && res.target_text) {
                    resultMap.set(res.source_text, res.target_text);
                    entriesToCache.push({
                        sourceText: res.source_text,
                        targetText: res.target_text,
                        matchType: res.match_type,
                        timestamp: Date.now()
                    });
                }
            }

            if (entriesToCache.length > 0) {
                setCachedTranslationsBatch(entriesToCache).catch(console.error);
            }

            for (const item of validItems) {
                const text = item.originalText.trim();
                const translation = resultMap.get(text);

                if (translation) {
                    applyTranslationToNode(item.node, item.originalText, translation);
                    cleanupPendingNodeAfterSuccess(item.node);
                } else {
                    failedItems.push(item);
                }
            }
        } else {
            failedItems = validItems;
        }

        // Move failed items to slow queue
        if (failedItems.length > 0) {
            slowQueue.push(...failedItems);
            triggerSlowWorkers();
        }

    } catch (err) {
        console.error("Batch worker error:", err);
        // On error, fallback all to slow queue
        slowQueue.push(...validItems);
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

            // Check validity
            if (!item.node.parentNode) {
                cleanupPendingNode(item.node, item.parent);
                continue;
            }

            const text = item.originalText.trim();

            // 1. Re-check cache (maybe populated by another worker or batch)
            if (memoryCache && memoryCache[text]) {
                applyTranslationToNode(item.node, item.originalText, memoryCache[text].targetText);
                cleanupPendingNodeAfterSuccess(item.node);
                continue;
            }

            // 2. Deduplicate / Check Pending
            let translationPromise = pendingRequests.get(text);
            if (!translationPromise) {
                // Call translateText but capture just the string result
                // Note: translateText handles caching, which updates memoryCache eventually
                translationPromise = translateText(text)
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

                // Re-check validity after await
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

// Helper function to clean up pending state and visual feedback
function cleanupPendingNode(node: Text, explicitParent?: Element | null): void {
    pendingNodes.delete(node);
    const parentEl = explicitParent || node.parentElement;
    if (parentEl) {
        updateParentVisualState(parentEl);
    }
}



// Call API to translate text
async function translateViaApi(text: string): Promise<TranslateApiResponse | null> {
    try {
        const response = await fetch(`${TRANSLATE_API_BASE_URL}/translate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                source_lang: 'en',
                target_lang: 'zh-CN',
                domain: getCurrentDomain()
            })
        });

        if (!response.ok) {
            console.error('Translation API error:', response.status);
            return null;
        }

        return await response.json() as TranslateApiResponse;
    } catch (error) {
        console.error('Translation API request failed:', error);
        return null;
    }
}

// Translate text with caching
async function translateText(text: string): Promise<{ translated: string, matchType: string } | null> {
    if (!text) return null;

    // Check local cache first
    const cached = await getCachedTranslation(text);
    if (cached) {
        return { translated: cached.targetText, matchType: cached.matchType };
    }

    // Call API
    const apiResult = await translateViaApi(text);
    if (apiResult && apiResult.target_text && apiResult.target_text !== apiResult.source_text) {
        // Cache the result
        await setCachedTranslation(text, {
            sourceText: apiResult.source_text,
            targetText: apiResult.target_text,
            matchType: apiResult.match_type,
            timestamp: Date.now()
        });

        return { translated: apiResult.target_text, matchType: apiResult.match_type };
    }

    return null;
}

// Start translation
async function startTranslation() {
    if (SCLocalizationTranslating) return;

    SCLocalizationTranslating = true;
    window.postMessage({ type: 'TOGGLED-SC-BOX-TRANSLATE', action: 'on' }, '*');

    // Preload cache for sync access
    await loadCacheToMemory();

    // Find all translation units and collect text nodes
    findTranslationUnits(document);

    // Initial triggers
    triggerBatchWorkers();
    triggerSlowWorkers();
}

// Stop translation and restore original text
function stopTranslation(): Promise<{ success: boolean }> {
    SCLocalizationTranslating = false;
    batchQueue = [];
    slowQueue = [];
    pendingRequests.clear();

    // Restore original text for all translated nodes
    // Optimize: Only iterate elements that we marked as translated
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

    // Remove any remaining visual classes (translating state)
    document.querySelectorAll('.sc-translating-text').forEach(el => {
        el.classList.remove('sc-translating-text');
    });

    // Clear processed parents set
    // Note: processedParents was removed in previous refactor

    window.postMessage({ type: 'TOGGLED-SC-BOX-TRANSLATE', action: 'off' }, '*');

    return Promise.resolve({ success: true });
}

// Toggle translation
function toggleTranslation() {
    if (SCLocalizationTranslating) {
        stopTranslation();
        _saveLocalizationSwitchState(false);
    } else {
        startTranslation();
        _saveLocalizationSwitchState(true);
    }
}

// Initialize
InitWebLocalization();

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "_toggleTranslation") {
        toggleTranslation();
    } else if (request.action === "_getCacheStats") {
        getTranslationCache().then(cache => {
            sendResponse({
                count: cache.order.length,
                domain: getCurrentDomain()
            });
        });
        return true;
    } else if (request.action === "_clearCache") {
        const domain = getCurrentDomain();
        const cacheKey = `translation_cache_${domain}`;
        chrome.storage.local.remove(cacheKey, () => {
            sendResponse({ success: true });
        });
        return true;
    }
});

// Handle messages from page scripts
window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'SC_TRANSLATE_REQUEST') return;

    const { action } = event.data;

    if (action === 'translate') {
        startTranslation();
        _saveLocalizationSwitchState(true);
    } else if (action === 'undoTranslate') {
        await stopTranslation();
        _saveLocalizationSwitchState(false);
    }
});

window.postMessage({ type: 'SC-BOX-TRANSLATE-API-AVAILABLE' }, '*');
