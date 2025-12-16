interface VersionData {
    rsi: string;
    concierge: string;
    orgs: string;
    addresses: string;
    hangar: string;
    uex: string;
    dps: string;
    [key: string]: string;
}

interface ReplaceWord {
    word: string;
    replacement: string;
}

interface CacheStats {
    domain: string;
    count: number;
}

let dataVersion: VersionData | null = null

chrome.runtime.onInstalled.addListener(function () {
    console.log("SC Box Extension init");
    chrome.contextMenus.create({
        id: "translate",
        title: "切换翻译",
        contexts: ["all"]
    });
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "_loadLocalizationData") {
        let domain = getURLDomain(request.url);
        let switchKey = `_translate_switch_${domain}`;
        getLocalData(switchKey).then(enableManual => {
            console.log("GET domain ===", domain, "enableManual === ", enableManual);
            _initLocalization(request.url, enableManual).then(data => {
                sendResponse({ result: data });
            });
        })
    } else if (request.action === "_setTranslateSwitch") {
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
            sendResponse({ enabled: enableManual === true });
        });
    } else if (request.action === "_getAllCacheStats") {
        getAllCacheStats().then(stats => {
            sendResponse({ stats });
        });
    } else if (request.action === "_clearDomainCache") {
        const cacheKey = `translation_cache_${request.domain}`;
        chrome.storage.local.remove(cacheKey, () => {
            sendResponse({ success: true });
        });
    } else if (request.action === "_clearAllCache") {
        clearAllTranslationCaches().then(() => {
            sendResponse({ success: true });
        });
    }
    return true;
});

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
            // Sort by count descending
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

async function _checkVersion(): Promise<void> {
    dataVersion = await _getJsonData("versions.json") as VersionData;
    console.log("Localization Version ===", dataVersion);
}

async function _initLocalization(url: string, enableManual: boolean): Promise<ReplaceWord[]> {
    console.log("url ===" + url);
    // Check if translation is disabled first, before fetching any resources
    if (enableManual != null && !enableManual) return [];

    // TODO check version
    let data: Record<string, any> = {};

    if (url.includes("robertsspaceindustries.com")) {
        data["zh-CN"] = await _getJsonData("zh-CN-rsi.json", { cacheKey: "zh-CN", versionKey: "rsi" });
        data["concierge"] = await _getJsonData("concierge.json", { cacheKey: "concierge", versionKey: "concierge" });
        data["orgs"] = await _getJsonData("orgs.json", { cacheKey: "orgs", versionKey: "orgs" });
        data["address"] = await _getJsonData("addresses.json", { cacheKey: "addresses", versionKey: "addresses" });
        data["hangar"] = await _getJsonData("hangar.json", { cacheKey: "hangar", versionKey: "hangar" });
    } else if (url.includes("uexcorp.space")) {
        data["UEX"] = await _getJsonData("zh-CN-uex.json", { cacheKey: "uex", versionKey: "uex" });
    } else if (url.includes("erkul.games")) {
        data["DPS"] = await _getJsonData("zh-CN-dps.json", { cacheKey: "dps", versionKey: "dps" });
    } else if (enableManual) {
        data["zh-CN"] = await _getJsonData("zh-CN-rsi.json", { cacheKey: "zh-CN", versionKey: "rsi" });
        data["concierge"] = await _getJsonData("concierge.json", { cacheKey: "concierge", versionKey: "concierge" });
        data["orgs"] = await _getJsonData("orgs.json", { cacheKey: "orgs", versionKey: "orgs" });
        data["address"] = await _getJsonData("addresses.json", { cacheKey: "address", versionKey: "addresses" });
        data["hangar"] = await _getJsonData("hangar.json", { cacheKey: "hangar", versionKey: "hangar" });
        data["UEX"] = await _getJsonData("zh-CN-uex.json", { cacheKey: "uex", versionKey: "uex" });
        data["DPS"] = await _getJsonData("zh-CN-dps.json", { cacheKey: "dps", versionKey: "dps" });
    }
    // update data
    let replaceWords: ReplaceWord[] = [];

    function addLocalizationResource(key: string): void {
        replaceWords.push(...getLocalizationResource(data, key));
    }

    if (url.includes("robertsspaceindustries.com")) {
        const org = "https://robertsspaceindustries.com/orgs";
        const citizens = "https://robertsspaceindustries.com/citizens";
        const organization = "https://robertsspaceindustries.com/account/organization";
        const concierge = "https://robertsspaceindustries.com/account/concierge";
        const referral = "https://robertsspaceindustries.com/account/referral-program";
        const address = "https://robertsspaceindustries.com/account/addresses";
        const hangar = "https://robertsspaceindustries.com/account/pledges";
        const spectrum = "https://robertsspaceindustries.com/spectrum/community/";
        if (url.startsWith(spectrum)) {
            return [];
        }
        addLocalizationResource("zh-CN");
        if (url.startsWith(org) || url.startsWith(citizens) || url.startsWith(organization)) {
            replaceWords.push({ "word": 'members', "replacement": '名成员' });
            addLocalizationResource("orgs");
        }
        if (url.startsWith(address)) {
            addLocalizationResource("address");
        }

        if (url.startsWith(referral)) {
            replaceWords.push(
                { "word": 'Total recruits: ', "replacement": '总邀请数：' },
                { "word": 'Prospects ', "replacement": '未完成的邀请' },
                { "word": 'Recruits', "replacement": '已完成的邀请' }
            );
        }

        if (url.startsWith(concierge)) {
            replaceWords = [];
            addLocalizationResource("concierge");
        }

        if (url.startsWith(hangar)) {
            addLocalizationResource("hangar");
        }
    } else if (url.includes("uexcorp.space")) {
        addLocalizationResource("UEX");
    } else if (url.includes("erkul.games")) {
        addLocalizationResource("DPS");
    } else if (enableManual) {
        addLocalizationResource("zh-CN");
        replaceWords.push({ "word": 'members', "replacement": '名成员' });
        addLocalizationResource("orgs");
        addLocalizationResource("address");
        replaceWords.push(
            { "word": 'Total recruits: ', "replacement": '总邀请数：' },
            { "word": 'Prospects ', "replacement": '未完成的邀请' },
            { "word": 'Recruits', "replacement": '已完成的邀请' }
        );
        addLocalizationResource("concierge");
        addLocalizationResource("hangar");
        addLocalizationResource("UEX");
        addLocalizationResource("DPS");
    }
    return replaceWords;
}


function getLocalizationResource(localizationResource: Record<string, any>, key: string): ReplaceWord[] {
    const localizations: ReplaceWord[] = [];
    const dict = localizationResource[key];
    if (typeof dict === "object") {
        for (const [k, v] of Object.entries(dict)) {
            const trimmedKey = k
                .toString()
                .trim()
                .toLowerCase()
                .replace(/\xa0/g, ' ')
                .replace(/\s{2,}/g, ' ');
            localizations.push({ "word": trimmedKey, "replacement": String(v) });
        }
    }
    return localizations;
}

interface JsonDataOptions {
    cacheKey?: string;
    versionKey?: string;
}

async function _getJsonData(fileName: string, options: JsonDataOptions = {}): Promise<any> {
    const { cacheKey = "", versionKey = "" } = options;
    const url = "https://ecdn.git.scbox.xkeyc.cn/SCToolBox/ScWeb_Chinese_Translate/raw/branch/main/json/locales/" + fileName;

    // Get version from dataVersion by versionKey if needed
    let version: string | null = null;
    if (versionKey && versionKey !== "") {
        if (dataVersion == null) {
            await _checkVersion();
        }
        version = dataVersion?.[versionKey] ?? null;
    }

    if (cacheKey && cacheKey !== "") {
        const localVersion = await getLocalData(`${cacheKey}_version`);
        const data = await getLocalData(cacheKey);
        if (data && typeof data === 'object' && Object.keys(data).length > 0 && localVersion === version) {
            return data;
        }
    }
    const startTime = new Date();
    const response = await fetch(url, { method: 'GET', mode: 'cors' });
    const endTime = new Date();
    const data = await response.json();
    if (cacheKey && cacheKey !== "") {
        const timeDiff = endTime.getTime() - startTime.getTime();
        console.log(`update ${cacheKey} v == ${version}  time == ${timeDiff / 1000}s`);
        await setLocalData(cacheKey, data);
        await setLocalData(`${cacheKey}_version`, version);
    }
    return data;
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



chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log("contextMenus", info, tab);
    if (tab && tab.id !== undefined) {
        chrome.tabs.sendMessage(tab.id, { action: "_toggleTranslation" }).then((_) => {
        });
    }
});
