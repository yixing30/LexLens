# Chrome 网上应用店发布准备

此文档记录 LexLens 0.7.18 的上架材料与操作。上传前先解决末尾的词典来源核查事项，并核对隐私政策与实际版本一致。可直接粘贴的商店描述见 [listing-zh-CN.md](../store-assets/listing-zh-CN.md)，独立上传的图标见 [LexLens-store-icon-128.png](../store-assets/LexLens-store-icon-128.png)。

## 1. 构建包

在项目根目录运行：

```sh
npm run check
npm test
npm run build:webstore
```

候选 ZIP 位于 `dist/LexLens-Chrome-0.7.18-webstore-candidate.zip`。ZIP 根目录直接包含 `manifest.json`，仅收录扩展所需的 26 个文件；不包含本地安装说明、生成标记、开发脚本或演示页面。每次改动代码后需要提高 `manifest.json` 与 `package.json` 的版本，再重新构建。

## 2. 开发者账号

打开 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)，用将来长期维护扩展的 Google 账号注册。首次注册需接受开发者协议并支付一次性注册费；发布前还需要启用两步验证。账号注册、付款和接受协议须由账号持有人完成。

## 3. 上传和商店资料

在后台选择 **Add new item**，上传上面的 ZIP。填写 Store Listing、Privacy、Distribution 和必要的 Test instructions。商店名称、简短描述与版本来自 ZIP 中的 `manifest.json`，不能直接在后台改；长描述使用 [商店描述文案](../store-assets/listing-zh-CN.md)。

**单一用途：** 在用户授权的英文网页上，按阅读等级提供本地词义标注与按需查词、语法线索和翻译。

**权限用途草稿：**

| 权限 | 用途 |
| --- | --- |
| `storage` | 在本机保存阅读等级、网站开关、浮动按钮位置与主动标记的学习记录。 |
| `activeTab` | 用户点击扩展图标时读取并操作当前标签页，支持临时启用标注和显示状态。 |
| `scripting` | 在当前网页尚未运行内容脚本时，由用户打开弹窗触发注入并启动标注。 |
| `<all_urls>` 与内容脚本 | 用户希望在任意英文网页自动标注；扩展需要读取获授权页面的可读取文字并插入行间释义。 |

在 Privacy 页准确披露本机处理的**网站内容**和**浏览活动／网站域名**。即使不上传服务器，Chrome 也要求披露本机处理。远程代码选择“否”（本版本没有下载后执行的代码）。隐私政策 URL 可填写：`https://github.com/yixing30/LexLens/blob/main/PRIVACY.md`。提交前再次核对 [PRIVACY.md](../PRIVACY.md) 与产品行为。

至少上传一张展示当前版本真实使用画面的 1280×800 或 640×400 截图；建议分别展示网页行间释义、选词查词、选句语法和独立阅读视图。商店图标可单独上传 `store-assets/LexLens-store-icon-128.png`；它是 128×128 PNG，图形周围留透明边距。440×280 的宣传图目前为可选项。截图不能用模拟页面冒充实际运行结果。

Distribution 选择 **Public** 才会公开出现在商店；**Unlisted** 仅知道链接的人可以安装；**Private** 限定测试者。三种可见性都需要同样的政策审核。完成后点击 **Submit for Review**；可以选择审核通过后自动发布或延后手动发布。

## 4. 发布前待核查

`data/NOTICE.md` 已记录 ECDICT 数据源采用 MIT 许可，同时其上游说明称词条汇集自其他词表、开源词典和爬取资料。当前包包含由这些词条派生的中文释义。**公开分发前需确认具体派生数据具有可再分发依据；仅保留 ECDICT 的 MIT 文件不能替代该核查。** 若无法确认，应替换相关词典数据后重新构建，并更新来源说明。CEFR-J 与 Octanove 的署名及许可要求见 `data/ENGLISH-LEVELS-NOTICE.md`。

## 官方参考

- [注册开发者账号](https://developer.chrome.com/docs/webstore/register)
- [准备扩展 ZIP](https://developer.chrome.com/docs/webstore/prepare)
- [首次发布流程](https://developer.chrome.com/docs/webstore/publish)
- [商店资料与图片](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [可见范围](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
