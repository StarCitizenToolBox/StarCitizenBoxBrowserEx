# 星际公民盒子 浏览器拓展

为您将星际公民官网及常用工具网站翻译为中文的浏览器拓展，所有翻译内容来自 星际公民中文社区汉化组。
本插件也内置于 [星际公民盒子](https://github.com/xkeyC/StarCitizenToolBox) 。

SC网站翻译项目：[CxJuice/ScWeb_Chinese_Translate](https://github.com/CxJuice/ScWeb_Chinese_Translate)

## 本插件仅供大致浏览使用，不对任何有关本插件产生的问题负责！在涉及账号操作前请注意确认网站的原本内容！

![img](https://github.com/xkeyC/StarCitizenBoxBrowserEx/assets/39891083/9580f52a-13ea-4234-a0d3-b8d06f06dda2)

## 安装

[Google Chrome 应用商店](https://chrome.google.com/webstore/detail/gocnjckojmledijgmadmacoikibcggja?authuser=0&hl=zh-CN)

[Microsoft Edge 加载项（因微软审核较慢，可能存在版本滞后，推荐优先使用 Chrome 源）](https://microsoftedge.microsoft.com/addons/detail/lipbbcckldklpdcpfagicipecaacikgi)

[Firefox ADD-ONS](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%98%9F%E9%99%85%E5%85%AC%E6%B0%91%E7%9B%92%E5%AD%90%E6%B5%8F%E8%A7%88%E5%99%A8%E6%8B%93%E5%B1%95/)

## 手动安装

下载 zip 后使用插件的开发者功能手动安装 dist/chrome 文件夹 Firefox 安装 dist/firefox 文件夹。

### 开发

#### 安装依赖

```bash
pnpm install
```

#### 开发模式

此命令在开发模式下运行您的扩展程序。它将启动一个新的浏览器实例，加载您的扩展程序。每当您对代码进行更改时，页面将自动重新加载，从而提供流畅的开发体验。

```bash
pnpm dev
# firefox
pnpm dev:firefox
```

#### 编译

此命令用于为生产环境构建您的扩展程序。它会优化和打包您的扩展程序，准备好部署到目标浏览器的商店。

```bash
pnpm build
# firefox
pnpm build:firefox
```
