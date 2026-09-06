# lw.AIUsage

`lw.AIUsage` 是一款轻量、本地优先的 AI Coding 用量统计与可视化工具。它从本机的 Codex 和 Claude Code 日志中提取用量元数据，帮助你按时间、Agent、模型和项目查看 Token 消耗，并估算对应的 API 等价成本。

应用不会把 Prompt、Response、源码或工具调用内容写入统计记录，也没有云端同步接口。为处理 JSONL 的断行边界，扫描游标可能暂存当前未完成的一行，下一次扫描后会被消费，不会进入统计展示或诊断导出。

## 功能特性

- 自动检测本机 Codex 与 Claude Code 数据源，并显示未检测、已就绪或活跃状态。
- 增量扫描 JSONL 日志，通过文件游标避免重复处理；支持目录监听和自动增量同步。
- 展示 Token 总量、用量记录数、活跃 Agent、预计 API 等价成本和每日趋势。
- 支持按日期、Agent、模型和项目筛选明细。
- 支持按模型、项目统计记录数、Token 和预计成本。
- 使用 Web Worker 解析日志，减少大量数据处理对界面的阻塞。
- 使用 IndexedDB 在本机保存标准化记录、聚合结果和扫描游标。
- 支持中文、English，以及跟随系统、浅色、深色三种主题。
- 支持重建统计、重置本地数据和导出已脱敏路径的诊断信息。
- 可通过 `lw.Web2App` 打包为单文件 Windows EXE，并使用项目专属图标。

## 工作原理

`lw.AIUsage` 是一款本地优先的 AI Coding 用量统计工具，主要用于查看 Codex 和 Claude Code 的 Token 使用情况。

软件的基本工作流程如下：

1. 自动检测当前用户目录中的 Codex 和 Claude Code 日志位置。
2. 读取日志中的时间、模型、项目、会话和 Token 用量等元数据。
3. 通过增量扫描、扫描游标和去重机制，避免重复读取和重复统计。
4. 将不同 Agent 的日志转换为统一的用量记录，并保存在本机 IndexedDB 数据库中。
5. 按日期、Agent、模型和项目进行聚合，生成概览、明细、统计卡片和 Token 趋势。
6. 根据内置价格表估算 API 等价成本，帮助开发者了解自己的 AI Coding 使用规模。

开发环境通过本地文件桥读取日志；打包后的 Windows EXE 通过 `lw.Web2App` 提供的 Native IPC 读取指定目录。采集器、业务层和存储层通过抽象接口连接，便于后续增加新的 Agent 或运行环境。

软件只提取统计所需的元数据，不保存 Prompt、Response、源码或工具调用内容，也不会将用量数据上传到服务器。成本金额仅用于用量参考，不代表订阅费用或供应商最终账单。

## 支持的数据源

| Agent       | 默认扫描位置                                      | 状态   |
| ----------- | ------------------------------------------------- | ------ |
| Codex       | `~/.codex/sessions`、`~/.codex/archived_sessions` | 已支持 |
| Claude Code | `~/.claude/projects`                              | 已支持 |

扫描位置由当前用户的主目录动态确定。上游日志格式发生变化时，可能需要同步更新解析器。

## 隐私与数据边界

本地数据库只保存统计所需的标准化元数据，包括来源、会话标识、时间、模型、项目标识、Token 分类和扫描游标。

- 不保存 Prompt 或 Response。
- 不保存源码或工具调用内容。
- 不上传用量数据，项目没有云端 Endpoint。
- EXE 仅申请读取、列目录、判断文件是否存在和监听变更等只读 Native IPC 能力，没有文件写入权限。
- EXE 的本地文件访问范围限制在当前用户的 `${HOME}/.codex` 和 `${HOME}/.claude` 目录。
- 导出的诊断信息会对 Windows、macOS 和 Linux 用户目录路径做脱敏处理。

## 环境要求

- Node.js 22（CI 使用的版本）
- pnpm 11.19.0
- Python 3 与 Pillow（仅在重新生成 ICO 图标时需要）
- Windows 10 1809+ 或 Windows 11 x64，以及 WebView2 Evergreen Runtime（仅在运行打包后的 EXE 时需要）
- [`lw.Web2App`](https://github.com/lxw112190/lw.Web2App) v0.2.7 或更高版本（仅在本地打包 EXE 时需要）

## 本地开发

安装依赖并启动开发环境：

```bash
pnpm install
pnpm dev
```

开发环境通过 Vite 本地文件桥读取 Agent 日志；打包环境会自动切换到 `lw.Web2App` Native IPC。

常用检查命令：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 构建 Web 版本

```bash
pnpm build
```

构建结果位于 `apps/desktop/dist`。

## 打包 Windows EXE

桌面打包由 [`lw.Web2App`](https://github.com/lxw112190/lw.Web2App) 提供。打包脚本按以下顺序查找工具目录：

1. 命令行参数 `-Web2AppRoot`；
2. 环境变量 `LW_WEB2APP_ROOT`；
3. 当前项目同级的 `lw.Web2App` 或兼容旧目录名 `lw.Web2Exe`。

依次执行：

```bash
pnpm build
pnpm make:icon
pnpm package:web2app
```

- `pnpm make:icon` 会把 `assets/lw-aiusage-icon.png` 转换为包含 16 至 256 像素多尺寸图层的标准 ICO。
- `pnpm package:web2app` 会调用 `lw.Web2App.exe`，将 `apps/desktop/dist` 打包为 `artifacts/lw.AIUsage.exe`。
- 打包完成后会调用 `lw.Web2App inspect` 校验 Payload 完整性。
- 打包时仅启用 `app.paths`、`fs.exists`、`fs.list`、`fs.read` 和 `fs.watch` 等只读 Native IPC 能力。

如需指定工具目录：

```powershell
pnpm package:web2app -- -Web2AppRoot 'C:\path\to\lw.Web2App'
```

如果 Windows 资源管理器仍显示旧图标，通常是系统图标缓存造成的；可先复制或重命名 EXE 验证新图标，再刷新资源管理器图标缓存。

## CI 与下载

GitHub Actions 会在每次推送和 Pull Request 中执行代码检查、类型检查、测试和 Web 构建，然后在 Windows Runner 上生成并校验 EXE。

- 工作流固定使用 [`lw.Web2App v0.2.7`](https://github.com/lxw112190/lw.Web2App/releases/tag/v0.2.7) 的 `lw.Web2App-windows-x64.zip`，下载后会先校验官方发布包的 SHA-256。
- 每次成功运行都会提供名为 `lw.AIUsage-windows-x64` 的 Artifact，内含 `lw.AIUsage.exe` 和 `SHA256SUMS.txt`，保留 30 天。
- 推送 `v*` 标签时，同一组文件会自动发布到对应的 GitHub Release，供长期下载。

## 项目结构

```text
apps/desktop          Vue 3 桌面界面
packages/application  数据源检测、同步、查询与诊断
packages/collectors   Codex、Claude Code 采集器和解析器
packages/core         核心模型、聚合与价格估算
packages/platform     开发文件桥与 lw.Web2App Native IPC 适配
packages/storage      IndexedDB/Dexie 本地存储
assets                应用图标与 README 图片
tools                 图标生成和 EXE 打包脚本
```

采集器只依赖 `PlatformPort`，业务层只依赖 `UsageRepository`，便于后续增加新的运行环境、数据源或存储实现。

## 当前限制

- 当前仅支持 Codex 和 Claude Code。
- 预计成本使用项目内置价格表计算，仅用于用量参考，不代表订阅费用或供应商账单。
- 未匹配到价格表的模型不会计入预计成本。
- Windows EXE 的生成依赖本机已编译的 `lw.Web2App.exe`。
- `lw.Web2App` 当前仍将 Native IPC 标记为实验性能力，后续升级打包器时需要同步验证接口兼容性。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

## 联系与支持

- 作者：天天代码码天天
- QQ：819069052
- QQ Group：C# 人工智能实践｜群号：758616458

如果项目对你有帮助，可以扫码支持维护：

<img src="assets/sponsor.jpg" alt="微信扫码支持 lw.AIUsage 维护" width="360">
