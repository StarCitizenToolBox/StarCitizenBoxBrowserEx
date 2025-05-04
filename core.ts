declare const $: any;
declare const timeago: any;

let SCLocalizationReplaceLocalesMap = {};
let SCLocalizationEnableSplitMode = false;
let SCLocalizationTranslating = false;

function InitWebLocalization() {
    // init script
    LocalizationWatchUpdate();
    // load Data
    _loadLocalizationData();
}

function LocalizationWatchUpdate() {
    const m = window.MutationObserver || (window as any).WebKitMutationObserver;
    const observer = new m(function (mutations: MutationRecord[], observer: MutationObserver) {
        for (let mutationRecord of mutations) {
            for (let node of mutationRecord.addedNodes) {
                traverseElement(node as Element);
            }
        }
    });

    observer.observe(document.body, {
        subtree: true,
        characterData: true,
        childList: true,
    });

    if (window.location.href.includes("robertsspaceindustries.com")) {
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
}

async function allTranslate() {
    SCLocalizationTranslating = true;

    async function replaceTextNode(node: Node, parentNode?: Element) {
        if (node.nodeType === Node.TEXT_NODE) {
            // 保存原始文本内容
            const originalText = node.nodeValue || '';
            const translatedText = GetSCLocalizationTranslateString(originalText);
            
            // 只有当文本发生变化时才保存原始文本
            if (originalText !== translatedText && parentNode) {
                const originalValue = parentNode.getAttribute('data-original-value') || "";
                parentNode.setAttribute('data-original-value', originalValue + originalText);
                node.nodeValue = translatedText;
            }
        } else {
            for (let i = 0; i < node.childNodes.length; i++) {
                await replaceTextNode(node.childNodes[i], node as Element);
            }
        }
    }

    await replaceTextNode(document.body, document.body);
}

async function undoTranslate(): Promise<{success: boolean}> {
    SCLocalizationTranslating = false;

    document.querySelectorAll('*[data-original-value]').forEach((element: Element) => {
        (element as HTMLElement).innerText = element.getAttribute('data-original-value') || '';
        element.removeAttribute('data-original-value');
    });

    // 处理输入元素
    const inputElements = document.querySelectorAll('input[type="button"], input[type="submit"], input[type="text"], input[type="password"]');
    inputElements.forEach((el: Element) => {
        // 尝试从 data-original-value 属性恢复原始值
        if (el.hasAttribute('data-original-value')) {
            if ((el as HTMLInputElement).type === 'button' || (el as HTMLInputElement).type === 'submit') {
                (el as HTMLInputElement).value = el.getAttribute('data-original-value') || '';
            } else {
                (el as HTMLInputElement).placeholder = el.getAttribute('data-original-value') || '';
            }
            el.removeAttribute('data-original-value');
        }
    });
    
    return Promise.resolve({ success: true });
}

function traverseElement(el: Element) {
    if (!SCLocalizationTranslating) {
        return;
    }

    if (!shouldTranslateEl(el)) {
        return
    }

    for (const child of el.childNodes) {
        if (["RELATIVE-TIME", "TIME-AGO"].includes(el.tagName)) {
            translateRelativeTimeEl(el);
            return;
        }

        if (child.nodeType === Node.TEXT_NODE) {
            translateElement(child, el);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if ((child as Element).tagName === "INPUT") {
                translateElement(child, el);
            } else {
                traverseElement(child as Element);
            }
        } else {
            // pass
        }
    }
}

function translateElement(el, parentNode) {
    // Get the text field name
    let k;
    let translatedText;
    if (el.tagName === "INPUT") {
        if (el.type === 'button' || el.type === 'submit') {
            k = 'value';
        } else {
            k = 'placeholder';
        }

        translatedText = GetSCLocalizationTranslateString(el[k]);
        if (el[k] === translatedText) return;

        const originalValue = parentNode.getAttribute('data-original-value') || "";
        el.setAttribute('data-original-value', originalValue + el[k]);
    } else {
        k = 'data';

        translatedText = GetSCLocalizationTranslateString(el[k]);
        if (el[k] === translatedText) return;

        const originalValue = parentNode.getAttribute('data-original-value') || "";
        parentNode.setAttribute('data-original-value', originalValue + el[k]);
    }
    el[k] = translatedText;
}

function translateRelativeTimeEl(el: Element) {
    const lang = (navigator.language || navigator.language);
    const datetime = ($ as any)(el).attr('datetime');
    ($ as any)(el).text((timeago as any).format(datetime, lang.replace('-', '_')));
}

function shouldTranslateEl(el: Element) {
    const blockIds: string[] = [];
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
    if (request.action === "_toggleTranslation") {
        if (SCLocalizationTranslating) {
            SCLocalizationTranslating = false;
            undoTranslate();
            return;
        }
        SCLocalizationEnableSplitMode = true;
        WebLocalizationUpdateReplaceWords(request.data);
    }
});

window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'SC_TRANSLATE_REQUEST') return;

    const { action } = event.data;

    let response: {success: boolean, error?: string} = { success: false };

    if (action === 'translate') {
        try {
            SCLocalizationEnableSplitMode = true;
            chrome.runtime.sendMessage({ action: "_loadLocalizationData", url: "manual" }, function (response) {
                WebLocalizationUpdateReplaceWords(response.result);
            });
            response = { success: true };
        } catch (error: any) {
            response = { success: false, error: error.message };
        }
    } else if (action === 'undoTranslate') {
        try {
            response = await undoTranslate();
        } catch (error: any) {
            response = { success: false, error: error.message };
        }
    }
});

window.postMessage({ type: 'SC-BOX-TRANSLATE-API-AVAILABLE' }, '*');
