# Jira 测试报告生成器 — Chrome 扩展

由油猴脚本 `jira脚本.js` 转换得到的 Chrome 扩展（Manifest V3），功能与原脚本完全一致：

- Test Execution 一键报告 + 合并执行
- Jira 问题页一键创建测试子任务：标题和工时手动填写，修复版本取当前任务，经办人取当前登录用户，创建后自动记工时并完成状态
- Jira 问题页子任务行工时一键记录，并自动处理 Start Progress / Done 状态流转
- 报障人候选勾选 / 自定义
- 已执行统计开关（含/不含阻塞、执行中）
- 仪表盘配置 + 4 宫格缺陷分布截图
- 截图预览、复制到剪贴板、自动下载兜底
- Xray 报告列表页每行「生成报告」按钮
- 设置面板（候选报障人、门户标题前缀、pageId / boardId / gadget IDs、共享组）
- `Alt + R` 快捷键唤起报告生成

## 安装

1. 打开 Chrome，地址栏访问 `chrome://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录 `chrome-extension/`
5. 访问 `https://jira.cjdropshipping.cn/browse/<ISSUE-KEY>` 或 Xray 报告页即可使用

## 使用

- 在 Test Execution 工单页：自动注入工具栏，或按 `Alt + R`
- 在 Jira 问题页：工具栏出现「创建子任务」按钮，可填写标题和预估工时（支持 0.5h、0.5、30m），提交后自动记录工时并处理 Start Progress / Done
- 在 Xray 报告列表页：每行末尾出现「生成报告」按钮
- 点击 Chrome 工具栏的扩展图标（J）：等价于 `Alt + R`，未在 Test Execution 页时打开设置面板

## 文件结构

```
chrome-extension/
├── manifest.json   # MV3 清单（content script 注入 MAIN world）
├── background.js   # action 图标点击 -> 调用页面内 __tm_generateReport
├── content.js      # 主体逻辑（与油猴脚本 IIFE 一致）
├── icons/          # 16/32/48/128 占位图标
└── README.md
```

## 与油猴脚本的差异

- 移除了 `==UserScript==` 元数据块；`@grant none` 等价于 `world: "MAIN"` 的 content script
- 新增 `background.js`：扩展图标点击调用主世界的 `window.__tm_generateReport()`
- 行为、选择器、API 调用、localStorage key 全部保持一致，可与油猴版本互换数据
