// 在网页上下文中定义一个API
window.SCTranslateApi = {
  // 手动触发页面翻译
  translate: async () => {
    const requestId = Math.random().toString(36).substr(2);
    return new Promise((resolve) => {
      const handler = (event) => {
        if (event.data.type === 'SC_TRANSLATE_RESPONSE' && event.data.requestId === requestId) {
          window.removeEventListener('message', handler);
          resolve(event.data.response);
        }
      };
      window.addEventListener('message', handler);

      window.postMessage({ 
        type: 'SC_TRANSLATE_REQUEST', 
        action: 'translate', 
        requestId 
      }, '*');
    });
  }
}; 