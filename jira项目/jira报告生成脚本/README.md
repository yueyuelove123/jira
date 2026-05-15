# Jira 测试报告生成器

这是 `jira脚本.js` 的 Chrome 扩展版本，适用于 Jira 问题页、Xray Test Execution 页面和 Tempo 我的工时页面。扩展主体逻辑与油猴脚本保持一致，方便在不安装 Tampermonkey 的环境中使用。

更新记录见：[CHANGELOG.md](https://github.com/yueyuelove123/jira/blob/main/CHANGELOG.md)

## 主要功能

- 创建测试子任务并自动记录工时：在 Jira 问题页点击「创建子任务」，填写标题、记录日期和预估工时，脚本会自动创建子任务、记录 Tempo 工时，并完成 Start Progress / Done 状态流转。
- 子任务行手动记工时：每个子任务行都有「记工时」按钮，可按剩余预估或手动工时记录，支持自选记录日期。
- 工时格式兼容：支持 `0.5h`、`0.5`、`4h`、`30m` 等写法。
- 测试小结缓存：Test Execution 报告弹窗里的测试小结会按工单缓存，关闭弹窗后不丢失；用户清空输入时才删除缓存。
- 一键生成测试报告：读取 Test Execution 用例总数、执行进度、通过率、失败 / 阻塞 / 执行中数量，并生成可复制报告文本。
- 合并多个测试执行：可加载同一修复版本下的其他 Test Execution，勾选后合并生成多段报告。
- 报障人筛选：支持自动采集报障人，也可从候选人中勾选或手动添加，用于缺陷统计和仪表盘筛选。
- 已执行统计开关：可切换“已执行”是否包含阻塞和执行中用例。
- 仪表盘配置：自动创建 Jira 筛选器，更新门户标题，并同步 4 个缺陷分布 gadget。
- 仪表盘截图：生成 4 宫格缺陷分布图，支持预览、复制到剪贴板；剪贴板不可用时自动下载 PNG。
- Xray 报告列表增强：在 Test Execution 报告列表每行追加「生成报告」按钮，新标签打开后自动生成报告。
- Tempo 工时标题复制：在我的工时列表页点击「复制当天标题」，一键复制当天工时卡片标题。
- 设置面板：可配置候选报障人、门户标题前缀、pageId / boardId / gadget IDs、共享组等。
- 快捷键：在 Test Execution 页面按 `Alt + R` 打开报告弹窗。

## 使用入口

- Jira 问题页：工具栏显示「创建子任务」，子任务列表行显示「记工时」。
- Test Execution 页面：工具栏显示「生成测试报告」「配置仪表盘」「设置」，也可按 `Alt + R`。
- Xray Test Execution 报告列表页：每行显示「生成报告」。
- Tempo 我的工时列表页：页面用户名后面显示「复制当天标题」。
- Chrome 扩展图标：点击后等价于 `Alt + R`；如果当前不是 Test Execution 页面，则打开设置面板。

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择 `jira报告生成脚本/` 目录。
5. 访问 `https://jira.cjdropshipping.cn/browse/<ISSUE-KEY>`、Xray 报告页或 Tempo 我的工时页使用。

## 文件说明

```text
jira报告生成脚本/
├── manifest.json   # Chrome MV3 清单
├── background.js   # 扩展图标点击逻辑
├── content.js      # 主体逻辑，与 jira脚本.js 的 IIFE 同步
├── icons/          # 扩展图标
└── README.md       # 功能说明
```

## 与油猴脚本的关系

- `jira脚本.js` 是油猴脚本版本。
- `jira报告生成脚本/content.js` 是扩展版本主体逻辑，保持与 `jira脚本.js` 的 IIFE 部分一致。
- `manifest.json` 使用 `world: "MAIN"` 注入页面主世界，以保持与 `@grant none` 油猴脚本一致的运行环境。
