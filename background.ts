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

let dataVersion: VersionData | null = null

chrome.runtime.onInstalled.addListener(function () {
    _checkVersion().then(_ => {
    });
    console.log("SWTT init");
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "_loadLocalizationData") {
        let domain = getURLDomain(request.url);
        let switchKey = `_translate_switch_${domain}`;
        getLocalData(switchKey).then(enableManual => {
            console.log("GET domain ===", domain, "enableManual === ", enableManual);
            _initLocalization(request.url, enableManual).then(data => {
                sendResponse({result: data});
            });
        })
    } else if (request.action === "_setTranslateSwitch") {
        let domain = getURLDomain(request.url);
        let switchKey = `_translate_switch_${domain}`;
        setLocalData(switchKey, request.enableManual).then(() => {
            console.log("SET translate switch ===", domain, "enableManual === ", request.enableManual);
            sendResponse({result: true});
        });
    }
    return true;
});

function getURLDomain(url: string): string {
    const urlObj = new URL(url);
    return urlObj.hostname;
}

async function _checkVersion(): Promise<void> {
    dataVersion = await _getJsonData("versions.json") as VersionData;
    console.log("Localization Version ===", dataVersion);
}

async function _initLocalization(url: string, enableManual: boolean): Promise<ReplaceWord[]> {
    console.log("url ===" + url);
    if (dataVersion == null) {
        await _checkVersion();
        return _initLocalization(url, enableManual);
    }
    if (enableManual != null && !enableManual) return [];
    let v = dataVersion
    // TODO check version
    let data: Record<string, any> = {};

    if (url.includes("robertsspaceindustries.com")) {
        data["zh-CN"] = await _getJsonData("zh-CN-rsi.json", {cacheKey: "zh-CN", version: v.rsi});
        data["concierge"] = await _getJsonData("concierge.json", {cacheKey: "concierge", version: v.concierge});
        data["orgs"] = await _getJsonData("orgs.json", {cacheKey: "orgs", version: v.orgs});
        data["address"] = await _getJsonData("addresses.json", {cacheKey: "addresses", version: v.addresses});
        data["hangar"] = await _getJsonData("hangar.json", {cacheKey: "hangar", version: v.hangar});
    } else if (url.includes("uexcorp.space")) {
        data["UEX"] = await _getJsonData("zh-CN-uex.json", {cacheKey: "uex", version: v.uex});
    } else if (url.includes("erkul.games")) {
        data["DPS"] = await _getJsonData("zh-CN-dps.json", {cacheKey: "dps", version: v.dps});
    } else if (enableManual) {
        data["zh-CN"] = await _getJsonData("zh-CN-rsi.json", {cacheKey: "zh-CN", version: v.rsi});
        data["concierge"] = await _getJsonData("concierge.json", {cacheKey: "concierge", version: v.concierge});
        data["orgs"] = await _getJsonData("orgs.json", {cacheKey: "orgs", version: v.orgs});
        data["address"] = await _getJsonData("addresses.json", {cacheKey: "address", version: v.addresses});
        data["hangar"] = await _getJsonData("hangar.json", {cacheKey: "hangar", version: v.hangar});
        data["UEX"] = await _getJsonData("zh-CN-uex.json", {cacheKey: "uex", version: v.uex});
        data["DPS"] = await _getJsonData("zh-CN-dps.json", {cacheKey: "dps", version: v.dps});
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
            replaceWords.push({"word": 'members', "replacement": '名成员'});
            addLocalizationResource("orgs");
        }
        if (url.startsWith(address)) {
            addLocalizationResource("address");
        }

        if (url.startsWith(referral)) {
            replaceWords.push(
                {"word": 'Total recruits: ', "replacement": '总邀请数：'},
                {"word": 'Prospects ', "replacement": '未完成的邀请'},
                {"word": 'Recruits', "replacement": '已完成的邀请'}
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
        replaceWords.push({"word": 'members', "replacement": '名成员'});
        addLocalizationResource("orgs");
        addLocalizationResource("address");
        replaceWords.push(
            {"word": 'Total recruits: ', "replacement": '总邀请数：'},
            {"word": 'Prospects ', "replacement": '未完成的邀请'},
            {"word": 'Recruits', "replacement": '已完成的邀请'}
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
            localizations.push({"word": trimmedKey, "replacement": String(v)});
        }
    }
    return localizations;
}

interface JsonDataOptions {
    cacheKey?: string;
    version?: string | null;
}

async function _getJsonData(fileName: string, options: JsonDataOptions = {}): Promise<any> {
    const {cacheKey = "", version = null} = options;
    const url = "https://ecdn.git.scbox.xkeyc.cn/SCToolBox/ScWeb_Chinese_Translate/raw/branch/main/json/locales/" + fileName;
    if (cacheKey && cacheKey !== "") {
        const localVersion = await getLocalData(`${cacheKey}_version`);
        const data = await getLocalData(cacheKey);
        if (data && typeof data === 'object' && Object.keys(data).length > 0 && localVersion === version) {
            return data;
        }
    }
    const startTime = new Date();
    const response = await fetch(url, {method: 'GET', mode: 'cors'});
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
            if (data === undefined ){
                return  resolve(null);
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

chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.create({
        id: "translate",
        title: "切换翻译",
        contexts: ["all"]
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    console.log("contextMenus", info, tab);
    let passedUrl = "manual";
    const supportedSites = ["robertsspaceindustries.com", "erkul.games", "uexcorp.space"];
    if (tab && tab.url && supportedSites.find(site => tab.url!.includes(site))) {
        passedUrl = tab.url;
    }
    _initLocalization(passedUrl, true).then(data => {
        if (tab && tab.id !== undefined) {
            chrome.tabs.sendMessage(tab.id, {action: "_toggleTranslation", data}).then((_) => {
            });
        }
    });
});
