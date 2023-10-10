let dataVersion = null

chrome.runtime.onInstalled.addListener(function () {
    _checkVersion().then(_ => { });
    console.log("SWTT init");
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "_loadLocalizationData") {
        _initLocalization(request.url).then(data => {
            sendResponse({ result: data });
        });
        return true;
    }
});

async function _checkVersion() {
    dataVersion = await _getJsonData("versions.json");
    console.log("Localization Version ===");
    console.log(dataVersion);
}

async function _initLocalization(url) {
    console.log("url ===" + url);
    if (dataVersion == null) {
        await _checkVersion();
        return _initLocalization(url);
    }
    let v = dataVersion
    // TODO check version
    let data = {};
    data["zh-CN"] = await _getJsonData("zh-CN-rsi.json", { cacheKey: "zh-CN", version: v.rsi });

    if (url.includes("robertsspaceindustries.com")) {
        data["concierge"] = await _getJsonData("concierge.json", { cacheKey: "concierge", version: v.concierge });
        data["orgs"] = await _getJsonData("orgs.json", v.orgs);
        data["address"] = await _getJsonData("addresses.json", { cacheKey: "orgs", version: v.addresses });
        data["hangar"] = await _getJsonData("hangar.json", { cacheKey: "hangar", version: v.hangar });
    } else {
        data["UEX"] = await _getJsonData("zh-CN-uex.json", { cacheKey: "uex", version: v.uex });
    }
    // update data
    let replaceWords = getLocalizationResource(data, "zh-CN");

    function addLocalizationResource(key) {
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
            addLocalizationResource("concierge");
        }

        if (url.startsWith(hangar)) {
            addLocalizationResource("hangar");
        }
    } else {
        addLocalizationResource("UEX");
    }
    return replaceWords;
}


function getLocalizationResource(localizationResource, key) {
    const localizations = [];
    const dict = localizationResource[key];
    if (typeof dict === "object") {
        for (const [k, v] of Object.entries(dict)) {
            const trimmedKey = k
                .toString()
                .trim()
                .toLowerCase()
                .replace(/\xa0/g, ' ')
                .replace(/\s{2,}/g, ' ');
            localizations.push({ "word": trimmedKey, "replacement": v.toString() });
        }
    }
    return localizations;
}

async function _getJsonData(fileName, { cacheKey = "", version = null } = {}) {
    url = "https://ch.citizenwiki.cn/json-files/locales/" + fileName;
    const box = await getLocalStorage();
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
        console.log(`update ${cacheKey} v == ${version}  time == ${(endTime - startTime) / 1000}s`);
        await setLocalData(cacheKey, data);
        await setLocalData(`${cacheKey}_version`, version);
    }
    return data;
}


function getLocalStorage() {
    return new Promise((resolve) => {
        chrome.storage.local;
        resolve();
    });
}

function getLocalData(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            const data = result[key];
            resolve(data || null);
        });
    });
}

function setLocalData(key, data) {
    return new Promise((resolve) => {
        const newData = {};
        newData[key] = data;
        chrome.storage.local.set(newData, () => {
            resolve();
        });
    });
}
