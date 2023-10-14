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

    if (window.location.hostname.includes("www.erkul.games") || window.location.hostname.includes("ccugame.app")) {
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
    replaceWords.forEach(({word, replacement}) => {
        SCLocalizationReplaceLocalesMap[word] = replacement;
    });
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
            sourceKey.split(" - ").forEach(function (splitKey) {
                if (SCLocalizationReplaceLocalesMap[splitKey.toLowerCase()]) {
                    nodeValue = nodeValue.replace(splitKey, SCLocalizationReplaceLocalesMap[splitKey.toLowerCase()])
                } else {
                    nodeValue = nodeValue.replace(splitKey, GetSCLocalizationTranslateString(splitKey))
                }
            });
            txtSrc = nodeValue
        } else if (key.includes("starter pack") || key.includes("starter package")) {
            let shipName = key.replace("starter package", "").replace("starter pack", "").trim()
            if (SCLocalizationReplaceLocalesMap[shipName.toLowerCase()]) {
                shipName = SCLocalizationReplaceLocalesMap[shipName.toLowerCase()];
            }
            txtSrc = shipName + " 新手包";
        } else if (key.startsWith("the ") && SCLocalizationReplaceLocalesMap[noTheKey]) {
            txtSrc = SCLocalizationReplaceLocalesMap[noTheKey];
        } else if (key.startsWith("- ") && SCLocalizationReplaceLocalesMap[noHorizontalKey]) {
            txtSrc = "- "+SCLocalizationReplaceLocalesMap[noHorizontalKey];
        }
    }
    return txtSrc
}

InitWebLocalization();

function _loadLocalizationData() {
    chrome.runtime.sendMessage({action: "_loadLocalizationData", url: window.location.href}, function (response) {
        WebLocalizationUpdateReplaceWords(response.result);
    });
}