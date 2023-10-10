let replaceLocalesMap = {};

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
    replaceWords.forEach(({ word, replacement }) => {
        replaceLocalesMap[word] = replacement;
    });
    allTranslate().then(_ => {
    });
    // console.log("WebLocalizationUpdateReplaceWords ==" + w)
}

async function allTranslate() {
    async function replaceTextNode(node1) {
        if (node1.nodeType === Node.TEXT_NODE) {
            let nodeValue = node1.nodeValue;
            const key = nodeValue.trim().toLowerCase()
                .replace(/\xa0/g, ' ') // replace '&nbsp;'
                .replace(/\s{2,}/g, ' ');
            if (replaceLocalesMap[key]) {
                nodeValue = replaceLocalesMap[key]
            }
            node1.nodeValue = nodeValue;
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

    const txtSrc = el[k].trim();
    const key = txtSrc.toLowerCase()
        .replace(/\xa0/g, ' ') // replace '&nbsp;'
        .replace(/\s{2,}/g, ' ');
    if (replaceLocalesMap[key]) {
        el[k] = el[k].replace(txtSrc, replaceLocalesMap[key])
    }
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

InitWebLocalization();

function _loadLocalizationData() {
    chrome.runtime.sendMessage({ action: "_loadLocalizationData", url: window.location.href }, function (response) {
        WebLocalizationUpdateReplaceWords(response.result);
    });
}