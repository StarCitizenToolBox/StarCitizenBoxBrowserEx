// Import auth module
import { getAccessToken, fetchUserProfile, fetchUserCredits, isLoggedIn, initiateLogin, logout, getCachedUserProfile, USER_PROFILE_STORAGE_KEY, handleAuthCode } from './auth';



// Configuration
const TRANSLATE_API_BASE_URL = "http://localhost:8066/api/v1";
const CACHE_MAX_SIZE = 100000;

// Helper function to get authorization headers
async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}

interface CacheStats {
    domain: string;
    count: number;
}

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

// Domain whitelist check API response
interface DomainCheckResponse {
    domain: string;
    whitelisted: boolean;
    description?: string;
    is_general?: boolean;
}

// Domains that have translation enabled by default (when user hasn't set a preference)
const DEFAULT_AUTO_ENABLE_DOMAINS = new Set([
    "robertsspaceindustries.com",  // Star Citizen official website
    "uexcorp.space",               // UEX Corp - Star Citizen trading and market data
    "erkul.games",                 // A Game weapons data website
    "spviewer.eu",                 // A Game ship data website
    "sc-trade.tools"               // A Game Business transaction roadmap website
]);

// Check if domain matches any default auto-enable domain (supports subdomains)
function isDomainAutoEnabled(domain: string): boolean {
    if (DEFAULT_AUTO_ENABLE_DOMAINS.has(domain)) {
        return true;
    }
    // Check if it's a subdomain of any default domain
    for (const defaultDomain of DEFAULT_AUTO_ENABLE_DOMAINS) {
        if (domain.endsWith('.' + defaultDomain)) {
            return true;
        }
    }
    return false;
}

// Per-domain memory cache
const domainMemoryCaches = new Map<string, Record<string, TranslationCacheEntry>>();

// Create context menu on every service worker startup
function ensureContextMenuExists() {
    chrome.contextMenus.remove("translate", () => {
        chrome.runtime.lastError;
        chrome.contextMenus.create({
            id: "translate",
            title: "翻译为中文",
            contexts: ["all"]
        });
    });
}

ensureContextMenuExists();

chrome.runtime.onInstalled.addListener(function () {
    console.log("SC Box Extension init");
});

// Update context menu title based on translation status
function updateContextMenuTitle(isTranslating: boolean) {
    chrome.contextMenus.update("translate", {
        title: isTranslating ? "显示原文" : "翻译为中文"
    });
}

// Query translation status from content script
async function queryTranslationStatus(tabId: number): Promise<void> {
    try {
        const response = await chrome.tabs.sendMessage(tabId, { action: "_getTranslationStatus" });
        if (response && typeof response.isTranslating === 'boolean') {
            updateContextMenuTitle(response.isTranslating);
        } else {
            updateContextMenuTitle(false);
        }
    } catch {
        updateContextMenuTitle(false);
    }
}

chrome.tabs.onActivated.addListener((activeInfo) => {
    queryTranslationStatus(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        queryTranslationStatus(tabId);
    }
});

// ==================== Cache Operations ====================

async function getTranslationCache(domain: string): Promise<TranslationCache> {
    return new Promise((resolve) => {
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

async function saveTranslationCache(domain: string, cache: TranslationCache): Promise<void> {
    return new Promise((resolve) => {
        const cacheKey = `translation_cache_${domain}`;

        // Evict oldest entries if over limit
        while (cache.order.length > CACHE_MAX_SIZE) {
            const oldestKey = cache.order.shift();
            if (oldestKey) {
                delete cache.entries[oldestKey];
            }
        }

        // Update memory cache
        domainMemoryCaches.set(domain, cache.entries);
        chrome.storage.local.set({ [cacheKey]: cache }, resolve);
    });
}

async function loadCacheToMemory(domain: string): Promise<Record<string, TranslationCacheEntry>> {
    if (domainMemoryCaches.has(domain)) {
        return domainMemoryCaches.get(domain)!;
    }
    const cache = await getTranslationCache(domain);
    domainMemoryCaches.set(domain, cache.entries);
    return cache.entries;
}

async function getCachedTranslation(domain: string, text: string): Promise<TranslationCacheEntry | null> {
    const memoryCache = domainMemoryCaches.get(domain);
    if (memoryCache && memoryCache[text]) {
        return memoryCache[text];
    }

    const cache = await getTranslationCache(domain);
    if (!domainMemoryCaches.has(domain)) {
        domainMemoryCaches.set(domain, cache.entries);
    }
    return cache.entries[text] || null;
}

async function setCachedTranslation(domain: string, text: string, entry: TranslationCacheEntry): Promise<void> {
    const cache = await getTranslationCache(domain);

    const idx = cache.order.indexOf(text);
    if (idx > -1) {
        cache.order.splice(idx, 1);
    }

    cache.entries[text] = entry;
    cache.order.push(text);

    await saveTranslationCache(domain, cache);
}

async function setCachedTranslationsBatch(domain: string, entries: TranslationCacheEntry[]): Promise<void> {
    const cache = await getTranslationCache(domain);

    for (const entry of entries) {
        const text = entry.sourceText;
        const idx = cache.order.indexOf(text);
        if (idx > -1) {
            cache.order.splice(idx, 1);
        }

        cache.entries[text] = entry;
        cache.order.push(text);
    }

    await saveTranslationCache(domain, cache);
}

// ==================== API Calls ====================

async function translateViaFastApi(texts: string[], domain: string, use_llm: boolean = false): Promise<FastTranslateApiResponse | null> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${TRANSLATE_API_BASE_URL}/translate/batch`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                texts: texts,
                source_lang: 'en',
                target_lang: 'zh-CN',
                domain: domain,
                use_llm: use_llm
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

async function translateViaApi(text: string, domain: string, output_terms: boolean = false): Promise<TranslateApiResponse | null> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${TRANSLATE_API_BASE_URL}/translate`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                text: text,
                source_lang: 'en',
                target_lang: 'zh-CN',
                domain: domain,
                output_terms: output_terms
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

async function translateText(text: string, domain: string, output_terms: boolean = false): Promise<{ translated: string, matchType: string } | null> {
    if (!text) return null;

    // Check local cache first
    const cached = await getCachedTranslation(domain, text);
    if (cached) {
        return { translated: cached.targetText, matchType: cached.matchType };
    }

    // Call API
    const apiResult = await translateViaApi(text, domain, output_terms);
    if (apiResult && apiResult.target_text && apiResult.target_text !== apiResult.source_text) {
        // Cache the result
        await setCachedTranslation(domain, text, {
            sourceText: apiResult.source_text,
            targetText: apiResult.target_text,
            matchType: apiResult.match_type,
            timestamp: Date.now()
        });

        return { translated: apiResult.target_text, matchType: apiResult.match_type };
    }

    return null;
}

// ==================== Batch Translation Handler ====================

interface BatchTranslateRequest {
    texts: string[];
    domain: string;
    use_llm?: boolean;
}

interface BatchTranslateResponse {
    results: Record<string, { targetText: string; matchType: string } | null>;
    entriesToCache: TranslationCacheEntry[];
}

async function handleBatchTranslate(request: BatchTranslateRequest): Promise<BatchTranslateResponse> {
    const { texts, domain, use_llm } = request;
    const results: Record<string, { targetText: string; matchType: string } | null> = {};
    const entriesToCache: TranslationCacheEntry[] = [];

    // Load memory cache
    await loadCacheToMemory(domain);
    const memoryCache = domainMemoryCaches.get(domain) || {};

    // Check cache first
    const uncachedTexts: string[] = [];
    for (const text of texts) {
        if (memoryCache[text]) {
            results[text] = {
                targetText: memoryCache[text].targetText,
                matchType: memoryCache[text].matchType
            };
        } else {
            uncachedTexts.push(text);
        }
    }

    if (uncachedTexts.length === 0) {
        return { results, entriesToCache };
    }

    // Call fast API
    const fastResponse = await translateViaFastApi(uncachedTexts, domain, use_llm);

    if (fastResponse && fastResponse.results) {
        for (const res of fastResponse.results) {
            if (res.match_type !== 'noCache' && res.match_type !== 'tooLong' && res.target_text) {
                results[res.source_text] = {
                    targetText: res.target_text,
                    matchType: res.match_type
                };
                entriesToCache.push({
                    sourceText: res.source_text,
                    targetText: res.target_text,
                    matchType: res.match_type,
                    timestamp: Date.now()
                });
            } else {
                results[res.source_text] = null;
            }
        }

        // Save to cache
        if (entriesToCache.length > 0) {
            setCachedTranslationsBatch(domain, entriesToCache).catch(console.error);
        }
    }

    return { results, entriesToCache };
}

// ==================== Single Translation Handler ====================

interface SingleTranslateRequest {
    text: string;
    domain: string;
    output_terms?: boolean;
}

async function handleSingleTranslate(request: SingleTranslateRequest): Promise<{ translated: string; matchType: string } | null> {
    return translateText(request.text, request.domain, request.output_terms);
}

// ==================== Stats Functions ====================

function getURLDomain(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

async function getAllCacheStats(): Promise<CacheStats[]> {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
            const stats: CacheStats[] = [];
            for (const key of Object.keys(items)) {
                if (key.startsWith('translation_cache_')) {
                    const domain = key.replace('translation_cache_', '');
                    const cache = items[key];
                    if (cache && cache.order) {
                        stats.push({
                            domain,
                            count: cache.order.length
                        });
                    }
                }
            }
            stats.sort((a, b) => b.count - a.count);
            resolve(stats);
        });
    });
}

async function clearAllTranslationCaches(): Promise<void> {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (items) => {
            const keysToRemove: string[] = [];
            for (const key of Object.keys(items)) {
                if (key.startsWith('translation_cache_')) {
                    keysToRemove.push(key);
                }
            }
            domainMemoryCaches.clear();
            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove, () => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    });
}

function getLocalData(key: string): Promise<any> {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            const data = result[key];
            if (data === undefined) {
                return resolve(null);
            }
            resolve(data);
        });
    });
}

function setLocalData(key: string, data: any): Promise<void> {
    return new Promise<void>((resolve) => {
        const newData: Record<string, any> = {};
        newData[key] = data;
        chrome.storage.local.set(newData, () => {
            resolve();
        });
    });
}

// ==================== Message Handlers ====================

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "_setTranslateSwitch") {
        let domain = getURLDomain(request.url);
        let switchKey = `_translate_switch_${domain}`;
        setLocalData(switchKey, request.enableManual).then(() => {
            console.log("SET translate switch ===", domain, "enableManual === ", request.enableManual);
            sendResponse({ result: true });
        });
    } else if (request.action === "_getTranslateSwitch") {
        let domain = getURLDomain(request.url);
        let switchKey = `_translate_switch_${domain}`;
        getLocalData(switchKey).then(enableManual => {
            if (enableManual === null) {
                // User hasn't set a preference, check if domain is in default auto-enable list
                const autoEnabled = isDomainAutoEnabled(domain);
                sendResponse({ enabled: autoEnabled, isDefault: true });
            } else {
                // User has explicitly set a preference
                sendResponse({ enabled: enableManual === true, isDefault: false });
            }
        });
    } else if (request.action === "_getAllCacheStats") {
        getAllCacheStats().then(stats => {
            sendResponse({ stats });
        });
    } else if (request.action === "_clearDomainCache") {
        const cacheKey = `translation_cache_${request.domain}`;
        domainMemoryCaches.delete(request.domain);
        chrome.storage.local.remove(cacheKey, () => {
            sendResponse({ success: true });
        });
    } else if (request.action === "_clearAllCache") {
        clearAllTranslationCaches().then(() => {
            sendResponse({ success: true });
        });
    } else if (request.action === "_translationStatusChanged") {
        updateContextMenuTitle(request.isTranslating);
    } else if (request.action === "_translateBatch") {
        // Batch translation request from content script
        handleBatchTranslate(request).then(response => {
            sendResponse(response);
        });
    } else if (request.action === "_translateSingle") {
        // Single translation request from content script
        handleSingleTranslate(request).then(response => {
            sendResponse(response);
        });
    } else if (request.action === "_loadCache") {
        // Load cache to memory and return it
        loadCacheToMemory(request.domain).then(cache => {
            sendResponse({ cache });
        });
    } else if (request.action === "_handleAuthCode") {
        // Handle auth code from callback page (legacy)
        handleAuthCode(request.code, request.state).then((success) => {
            sendResponse({ success });
        }).catch((error) => {
            console.error('Auth code handling failed:', error);
            sendResponse({ success: false, error: error.message });
        });
    } else if (request.type === "OIDC_CALLBACK") {
        // Handle OIDC callback from content script on localhost callback page
        handleAuthCode(request.code, request.state).then((success) => {
            sendResponse({ success });
        }).catch((error) => {
            console.error('OIDC callback handling failed:', error);
            sendResponse({ success: false, error: error.message });
        });
    } else if (request.action === "_userLogin") {
        // Initiate OIDC login flow
        initiateLogin().then(() => {
            sendResponse({ success: true });
        }).catch((error) => {
            console.error('Login initiation failed:', error);
            sendResponse({ success: false, error: error.message });
        });
    } else if (request.action === "_userLogout") {
        // Logout user
        logout().then(() => {
            sendResponse({ success: true });
        });
    } else if (request.action === "_checkLoginStatus") {
        // Check if user is logged in
        isLoggedIn().then(loggedIn => {
            sendResponse({ loggedIn });
        });
    } else if (request.action === "_getUserProfile") {
        // Get user profile
        getCachedUserProfile().then(async (profile) => {
            if (!profile) {
                // Try to fetch from API
                profile = await fetchUserProfile();
            }
            sendResponse({ profile });
        });
    } else if (request.action === "_getUserCredits") {
        // Get user credits
        fetchUserCredits(TRANSLATE_API_BASE_URL).then(credits => {
            sendResponse({ credits });
        });
    } else if (request.action === "_refreshUserProfile") {
        // Refresh user profile from API
        fetchUserProfile().then(profile => {
            if (profile) {
                chrome.storage.local.set({ [USER_PROFILE_STORAGE_KEY]: profile });
            }
            sendResponse({ profile });
        });
    } else if (request.action === "_checkDomainWhitelist") {
        // Check domain whitelist for content scripts
        checkDomainWhitelist(request.domain).then(response => {
            if (response) {
                sendResponse(response);
            } else {
                // API failed, treat as whitelisted to not block translation
                sendResponse({ domain: request.domain, whitelisted: true, is_general: false });
            }
        });
    }
    return true;
});

// Check domain whitelist via API
async function checkDomainWhitelist(domain: string): Promise<DomainCheckResponse | null> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${TRANSLATE_API_BASE_URL}/domain/check?domain=${encodeURIComponent(domain)}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            console.error('Domain check API error:', response.status);
            return null;
        }

        return await response.json() as DomainCheckResponse;
    } catch (error) {
        console.error('Domain check API request failed:', error);
        return null;
    }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log("contextMenus", info, tab);
    if (tab && tab.id !== undefined && tab.url) {
        const tabId = tab.id;

        // First check current translation status
        try {
            const statusResponse = await chrome.tabs.sendMessage(tabId, { action: "_getTranslationStatus" });

            // If already translating, just toggle off without checking whitelist
            if (statusResponse && statusResponse.isTranslating) {
                chrome.tabs.sendMessage(tabId, { action: "_toggleTranslation" });
                return;
            }
        } catch (e) {
            // Content script might not be ready, continue anyway
        }

        // For starting translation, check domain whitelist
        const domain = getURLDomain(tab.url);
        const domainCheck = await checkDomainWhitelist(domain);

        if (domainCheck === null) {
            // API failed, proceed anyway (treat as whitelisted)
            chrome.tabs.sendMessage(tabId, {
                action: "_startTranslationWithWhitelist",
                isWhitelisted: true
            });
            return;
        }

        if (domainCheck.whitelisted || domainCheck.is_general) {
            // Domain is whitelisted, proceed directly with whitelist flag
            chrome.tabs.sendMessage(tabId, {
                action: "_startTranslationWithWhitelist",
                isWhitelisted: true
            });
        } else {
            // Domain not whitelisted, ask for confirmation
            chrome.tabs.sendMessage(tabId, {
                action: "_showDomainConfirmation",
                domain: domain,
                description: domainCheck.description || ''
            });
        }
    }
});
