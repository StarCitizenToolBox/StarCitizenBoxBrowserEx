# 星际公民盒子 浏览器拓展

为您将星际公民官网及常用工具网站翻译为中文的浏览器拓展，所有翻译内容来自 星际公民中文社区汉化组。
本插件也内置于 [星际公民盒子](https://github.com/xkeyC/StarCitizenToolBox) 。

SC网站翻译项目：[CxJuice/ScWeb_Chinese_Translate](https://github.com/CxJuice/ScWeb_Chinese_Translate)

## **本插件仅供大致浏览使用，不对任何有关本插件产生的问题负责！在涉及账号操作前请注意确认网站的原本内容！**

![img](https://github.com/xkeyC/StarCitizenBoxBrowserEx/assets/39891083/9580f52a-13ea-4234-a0d3-b8d06f06dda2)

## 安装

[Google Chrome 应用商店](https://chrome.google.com/webstore/detail/gocnjckojmledijgmadmacoikibcggja?authuser=0&hl=zh-CN)

[Microsoft Edge 加载项（因微软审核较慢，可能存在版本滞后，推荐优先使用 Chrome 源）](https://microsoftedge.microsoft.com/addons/detail/lipbbcckldklpdcpfagicipecaacikgi)

[Firefox ADD-ONS](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%98%9F%E9%99%85%E5%85%AC%E6%B0%91%E7%9B%92%E5%AD%90%E6%B5%8F%E8%A7%88%E5%99%A8%E6%8B%93%E5%B1%95/)

## 手动安装

下载 zip 后使用插件的开发者功能手动安装 dist/chrome 文件夹 Firefox 安装 dist/firefox 文件夹。

### 通过 GitHub Actions 构建

仓库中包含了一个可以手动触发的 GitHub Actions 工作流，可以自动构建 Chrome 和 Firefox 扩展并上传到 Actions 产物中。

**使用步骤：**

1. 访问仓库的 [Actions](../../actions) 页面
2. 在左侧选择 "Build Browser Extensions" 工作流
3. 点击右侧的 "Run workflow" 按钮
4. 选择分支后点击 "Run workflow" 确认
5. 等待构建完成后，在工作流运行详情页面下载 `chrome-extension.zip` 和 `firefox-extension.zip` 产物

产物保留时间为 30 天。

### 开发者

#### 调用翻译Hook

```tsx
  enum SCBoxTranslateStatus {
    Available,
    Translated,
    NotAvailable,
  }

  const [translateApiAvailable, setTranslateApiAvailable] = useState<SCBoxTranslateStatus>(SCBoxTranslateStatus.NotAvailable);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window) return;
      // 在插件加载后会向页面发送消息
      if (event.data?.type === 'SC-BOX-TRANSLATE-API-AVAILABLE') {
        setTranslateApiAvailable(SCBoxTranslateStatus.Available);
      }
      // 在翻译状态改变时插件也会向页面发送消息
      if (event.data?.type === 'TOGGLED-SC-BOX-TRANSLATE') {
        switch (event.data.action) {
          case 'on':
            setTranslateApiAvailable(SCBoxTranslateStatus.Translated);
            return;
          case 'off':
            setTranslateApiAvailable(SCBoxTranslateStatus.Available);
            return;
        }
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
```

```ts
  // 触发翻译
  window.postMessage({ 
    type: 'SC_TRANSLATE_REQUEST', 
    action: 'translate', 
    requestId: Math.random().toString(36)
  }, '*');

  // 撤销翻译
  window.postMessage({ 
    type: 'SC_TRANSLATE_REQUEST', 
    action: 'undoTranslate', 
    requestId: Math.random().toString(36)
  }, '*');
```

#### 开发/调试

##### 安装依赖

```bash
pnpm install
```

##### 开发模式

此命令在开发模式下运行您的扩展程序。它将启动一个新的浏览器实例，加载您的扩展程序。每当您对代码进行更改时，页面将自动重新加载，从而提供流畅的开发体验。

```bash
pnpm dev
# firefox
pnpm dev:firefox
```

##### 编译

此命令用于为生产环境构建您的扩展程序。它会优化和打包您的扩展程序，准备好部署到目标浏览器的商店。

```bash
pnpm build
# firefox
pnpm build:firefox
```
