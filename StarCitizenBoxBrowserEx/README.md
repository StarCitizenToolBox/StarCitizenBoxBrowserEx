# 星际公民盒子浏览器拓展

为星际公民网站及工具站提供汉化功能的浏览器扩展。

## 网页API使用说明

本扩展现在提供了网页API，允许网页JavaScript直接调用翻译功能。

### 手动触发翻译

```javascript
// 检查API是否可用
if (window.SCTranslateApi && window.SCTranslateApi.translate) {
  // 触发翻译
  window.SCTranslateApi.translate()
    .then(response => {
      if (response.success) {
        console.log('翻译成功');
      } else {
        console.error('翻译失败:', response.error);
      }
    });
}
```

## 安全说明

- API仅在扩展支持的网站上可用
- 所有API操作都在网页上下文中执行，不会泄露敏感权限