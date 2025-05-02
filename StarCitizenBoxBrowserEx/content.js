// 注入脚本到网页上下文
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
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
      chrome.runtime.sendMessage({action: "_loadLocalizationData", url: "manual"}, function (response) {
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