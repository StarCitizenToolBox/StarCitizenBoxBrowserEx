let SCLocalizationReplaceLocalesMap = {};
let SCLocalizationEnableSplitMode = false;

function InitWebLocalization() {
    // init script
    LocalizationWatchUpdate();
    // load Data
    _loadLocalizationData();
}

function LocalizationWatchUpdate() {
    const m = window.MutationObserver || window.WebKitMutationObserver;
    const observer = new m(function (mutations, observer) {
        for (let mutationRecord of mutations) {
            for (let node of mutationRecord.addedNodes) {
                traverseElement(node);
            }
        }
    });

    observer.observe(document.body, {
        subtree: true,
        characterData: true,
        childList: true,
    });

    if (window.location.href.includes("robertsspaceindustries.com")) {
        console.log("SCLocalizationEnableSplitMode = true");
        SCLocalizationEnableSplitMode = true;
    }

    if (window.location.hostname.includes("www.erkul.games")) {
        document.body.addEventListener("click", function (event) {
            setTimeout(function () {
                allTranslate().then(_ => {
                });
            }, 200);
        });
    }
}

function WebLocalizationUpdateReplaceWords(w) {
    let replaceWords = w.sort(function (a, b) {
        return b.word.length - a.word.length;
    });
    replaceWords.forEach(({ word, replacement }) => {
        SCLocalizationReplaceLocalesMap[word] = replacement;
    });
    if (window.location.hostname.startsWith("issue-council.robertsspaceindustries.com")) {
        SCLocalizationReplaceLocalesMap["save"] = "保存";
    }
    allTranslate().then(_ => {
    });
    // console.log("WebLocalizationUpdateReplaceWords ==" + w)
}

async function allTranslate() {
    async function replaceTextNode(node1) {
        if (node1.nodeType === Node.TEXT_NODE) {
            node1.nodeValue = GetSCLocalizationTranslateString(node1.nodeValue);
        } else {
            for (let i = 0; i < node1.childNodes.length; i++) {
                await replaceTextNode(node1.childNodes[i]);
            }
        }
    }

    await replaceTextNode(document.body);
}

function traverseElement(el) {
    if (!shouldTranslateEl(el)) {
        return
    }

    for (const child of el.childNodes) {
        if (["RELATIVE-TIME", "TIME-AGO"].includes(el.tagName)) {
            translateRelativeTimeEl(el);
            return;
        }

        if (child.nodeType === Node.TEXT_NODE) {
            translateElement(child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName === "INPUT") {
                translateElement(child);
            } else {
                traverseElement(child);
            }
        } else {
            // pass
        }
    }
}

function translateElement(el) {
    // Get the text field name
    let k;
    if (el.tagName === "INPUT") {
        if (el.type === 'button' || el.type === 'submit') {
            k = 'value';
        } else {
            k = 'placeholder';
        }
    } else {
        k = 'data';
    }
    el[k] = GetSCLocalizationTranslateString(el[k]);
}

function translateRelativeTimeEl(el) {
    const lang = (navigator.language || navigator.userLanguage);
    const datetime = $(el).attr('datetime');
    $(el).text(timeago.format(datetime, lang.replace('-', '_')));
}

function shouldTranslateEl(el) {
    const blockIds = [];
    const blockClass = [
        "css-truncate" // 过滤文件目录
    ];
    const blockTags = ["IMG", "svg", "mat-icon"];
    if (blockTags.includes(el.tagName)) {
        return false;
    }
    if (el.id && blockIds.includes(el.id)) {
        return false;
    }
    if (el.classList) {
        for (let clazz of blockClass) {
            if (el.classList.contains(clazz)) {
                return false;
            }
        }
    }
    return true;
}

function GetSCLocalizationTranslateString(txtSrc) {
    const key = txtSrc.toLowerCase().replace(/\xa0/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const sourceKey = txtSrc.replace(/\xa0/g, ' ').replace(/\s{2,}/g, ' ').trim();
    let noTheKey = key.replace("the ", "");
    let noHorizontalKey = key.replace("- ", "");

    if (SCLocalizationReplaceLocalesMap[key]) {
        txtSrc = SCLocalizationReplaceLocalesMap[key]
    } else if (SCLocalizationEnableSplitMode) {
        if (sourceKey.includes(" - ")) {
            let nodeValue = txtSrc
            let splitKey = sourceKey.split(" - ");
            if (splitKey[0].toLowerCase() === "upgrade" && key.includes("to") && key.endsWith("edition")) {
                // 升级包规则
                let noVersionStr = key.replace("STANDARD EDITION".toLowerCase(), "").replace("upgrade", "").replace("WARBOND EDITION".toLowerCase(), "")
                let shipNames = noVersionStr.split(" to ")
                let finalString = "升级包 " + GetSCLocalizationTranslateString(shipNames[0]) + " 到 " + GetSCLocalizationTranslateString(shipNames[1]);
                if (key.endsWith("WARBOND EDITION".toLowerCase())) {
                    finalString = finalString + " 战争债券版"
                } else {
                    finalString = finalString + " 标准版"
                }
                txtSrc = finalString
            } else {
                // 机库通用规则
                splitKey.forEach(function (splitKey) {
                    if (SCLocalizationReplaceLocalesMap[splitKey.toLowerCase()]) {
                        nodeValue = nodeValue.replace(splitKey, SCLocalizationReplaceLocalesMap[splitKey.toLowerCase()])
                    } else {
                        nodeValue = nodeValue.replace(splitKey, GetSCLocalizationTranslateString(splitKey))
                    }
                });
                txtSrc = nodeValue
            }
        } else if (key.endsWith("starter pack") || key.endsWith("starter package")) {
            let shipName = key.replace("starter package", "").replace("starter pack", "").trim()
            if (SCLocalizationReplaceLocalesMap[shipName.toLowerCase()]) {
                shipName = SCLocalizationReplaceLocalesMap[shipName.toLowerCase()];
            }
            txtSrc = shipName + " 新手包";
        } else if (key.startsWith("the ") && SCLocalizationReplaceLocalesMap[noTheKey]) {
            txtSrc = SCLocalizationReplaceLocalesMap[noTheKey];
        } else if (key.startsWith("- ") && SCLocalizationReplaceLocalesMap[noHorizontalKey]) {
            txtSrc = "- " + SCLocalizationReplaceLocalesMap[noHorizontalKey];
        }
    }
    return txtSrc
}

InitWebLocalization();

function _loadLocalizationData() {
    chrome.runtime.sendMessage({ action: "_loadLocalizationData", url: window.location.href }, function (response) {
        WebLocalizationUpdateReplaceWords(response.result);
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "_initTranslation") {
        SCLocalizationEnableSplitMode = true;
        WebLocalizationUpdateReplaceWords(request.data);
    }
});

// 注入脚本到网页上下文
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// 监听来自网页的消息
window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'SC_TRANSLATE_REQUEST') return;

    console.log("event.data ==" + JSON.stringify(event.data));

    const { action, payload, requestId } = event.data;

    let response = { success: false };

    if (action === 'translate') {
        try {
            SCLocalizationEnableSplitMode = true;
            chrome.runtime.sendMessage({ action: "_loadLocalizationData", url: "manual" }, function (response) {
                WebLocalizationUpdateReplaceWords(response.result);
            });
        } catch (error) {
            response = { success: false, error: error.message };
        }
    } else if (action === 'updateReplaceWords') {
        try {
            if (payload && payload.words && Array.isArray(payload.words)) {
                WebLocalizationUpdateReplaceWords(payload.words);
                response = { success: true };
            } else {
                response = { success: false, error: 'Invalid words format' };
            }
        } catch (error) {
            response = { success: false, error: error.message };
        }
    }

    // 发送响应回网页
    window.postMessage({
        type: 'SC_TRANSLATE_RESPONSE',
        requestId,
        response
    }, '*');
});

window.postMessage({ type: 'SC-BOX-TRANSLATE-API-AVAILABLE' }, '*');