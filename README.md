# Puff

Puff 是一个以文档为中心、由多个 Agent 后端驱动的写作工作台。左侧是文件与项目，中间是编辑器，右侧是 AI 助手。你可以在同一个应用里同时连接 Paseo、OpenClaw 和 OpenCode，在不同服务器与不同写作会话之间切换。

窄屏和手机上，中间区域在文档预览与 Agent 对话之间切换：点击文档右上角的 Agent 按钮进入对话，再点击对话右上角的同一按钮切回文档。底部输入框位置固定，只切换内容；文件列表仍从左侧抽屉打开。移动端内容占满整个宽度，不再为折叠屏预留额外留白。

项目基于 Expo SDK 57 + React Native 0.86 + Expo Router，可运行在 Web、iOS 和 Android。

## 功能

- **文档编辑**：富文本编辑器、文件树、Markdown/HTML 预览，以及按文档保存的滚动位置和最近打开记录。
- **AI 写作会话**：右侧助手面板按项目组织会话，支持流式输出、工具调用展示、模型切换、权限自动允许和离线消息队列。
- **多后端**：同时保留多个连接；项目列表按来源和目录分组，切换连接不会中断其他后端上正在运行的任务。
- **Projects 侧边栏**：按连接和目录列出项目；每个连接下的 **Add project** 可以从当前项目目录开始浏览子文件夹，并把选中的文件夹作为一个新项目打开。
- **Web Preview**：渲染项目里的 `preview/index.html`，自动内联 `preview/` 子树和项目内被引用的资源。
- **内容插件**：支持文档、图片、白板、Lark/Feishu 工作副本等内容的预览与编辑入口。

## 环境要求

- Node.js 22（推荐）或更新的 LTS
- npm 10+
- iOS 模拟器需要 macOS + Xcode；Android 需要 Android Studio / SDK

## 安装与启动

```bash
npm install
npm start
```

如果 `npm install` 因 lockfile 里的私有 registry 地址报 `ENOTFOUND`，可以让 npm 忽略这些地址并使用当前配置的源：

```bash
npm install --replace-registry-host=always
```

Metro 默认监听 `http://localhost:8081`。其他命令：

```bash
npm run web       # 直接在浏览器打开
npm run ios       # 启动 iOS 模拟器
npm run android   # 启动 Android 模拟器
```

类型检查：

```bash
npx tsc --noEmit
```

## 连接后端

在连接页选择对应的标签，填写地址与凭据。配置保存在应用本地，下次启动会自动重连。

| 后端 | 地址示例 | 说明 |
| --- | --- | --- |
| Paseo Direct | `ws://localhost:6767/ws` | 直连 Paseo daemon，可带密码 |
| Paseo Relay | `https://app.paseo.sh/#offer=...` | 使用 Paseo 的配对链接 |
| OpenClaw | `ws://localhost:18789` | Gateway WebSocket，可带 token；可能需要设备配对 |
| OpenCode | `http://localhost:4096` | 需要 OpenCode **v2** server，填写启动时打印的密码；也可以直接粘贴一次性 pair link |

OpenCode 示例：

```bash
opencode serve --port 4096
```

Web 端需要允许页面来源：

```bash
opencode serve --port 4096 --cors http://localhost:8081
```

各后端的完整说明见：

- [Multiple backend connections](docs/multiple-backends.md)
- [Connecting to an OpenClaw Gateway](docs/openclaw-connection.md)
- [Connecting to an OpenCode server](docs/opencode-connection.md)
- [GitHub Actions → TestFlight](docs/ios-testflight-github.md)

## 后端支持策略

**OpenCode 是当前功能迭代的主要目标。** 新能力先在 OpenCode 上实现和验证；Paseo 与 OpenClaw 保持现有行为，不在功能迭代中修改它们的适配器。

具体约定：

- 新能力优先做成可选接口或能力检测，不因为一个功能去加宽所有后端都必须实现的 `WriterBackend` 必需方法。
- Paseo 和 OpenClaw 可以长期缺少某些新功能，界面对缺失能力做降级或说明，而不是在它们的适配器里模拟。
- 共享的 UI、状态和契约改动应当是后端中立的，并且不能改变 Paseo/OpenClaw 的既有行为；如果某个功能不改这两个适配器就无法落地，应先确认再动手。
- Paseo/OpenClaw 的 bug 修复属于单独的工作，不并入 OpenCode 的功能迭代。
- 不追求三个 backend 的功能完全对齐；能力差异直接记录在对应文档里。

需要改动 Paseo 或 OpenClaw 时，以用户明确的指令为准，而不是把它当作实现新功能的顺手步骤。

## 项目与目录

Puff 里的 “Projects” 是按工作目录（`cwd`）聚合的导航概念，不是某个后端独有的对象：

- 同一个目录下的会话，无论来自哪个 workspace ID，都会合并成一行。
- 不同连接上的相同路径仍是两个独立项目。
- 打开项目会恢复该目录最近使用的会话；没有会话时，按当前 Provider/模型新建一个。

在 Projects 侧边栏中，每个连接下都有 **Add project**：

1. 以当前项目目录为起点，列出子文件夹。
2. 可以逐层进入；标题左侧的向上按钮或列表里的 **…** 可以返回上一级。到了起始目录后继续向上，会把浏览根目录移到父目录，因此也能选到同级或更上层的文件夹。
3. 选择某个文件夹后，Puff 会打开该目录；如果没有可用会话，会自动创建一个。
4. 完成后刷新目录列表，新项目随即出现在侧边栏。

向上浏览依赖当前 backend 的目录读取权限；如果后端不允许访问父目录，界面会显示错误，并停留在原目录。起始目录本身不能直接选为“新项目”，需要进入子文件夹，或先向上再选。

## 目录结构

```
app/                 Expo Router 页面与路由
src/
  agent/             AI 助手面板、消息渲染、模型选择
  backend/           WriterBackend 契约与适配器
    paseo/           Paseo daemon 客户端映射
    openclaw/        OpenClaw Gateway 适配器
    opencode/        OpenCode v2 HTTP + SSE 适配器
  client/            流式事件 reducer
  content/           内容类型与插件上下文
  editor/            编辑器、文件树、Projects 侧边栏、项目选择弹窗
  feishu-preview/    Feishu/Lark 预览支持
  plugins/           内容插件运行时
  settings/          设置页
  stores/            Zustand 状态与持久化
  web-preview/       preview/index.html 加载与内联
  utils/             启动追踪、轮询等工具
docs/                设计记录、连接说明和讨论记录
scripts/             本地 UI/行为检查脚本
assets/              图标与启动图
```

## 架构要点

前端只依赖 `WriterBackend` 接口（`src/backend/types.ts`）。每个适配器负责把原生协议映射成统一的会话、时间线、文件与 Provider 模型：

- **Paseo**：`@getpaseo/client` daemon 客户端。
- **OpenClaw**：Gateway WebSocket RPC，包含设备身份、权限审批与文件作用域。
- **OpenCode**：`/api/...` HTTP 接口与 `/api/event` SSE 流，使用 XMLHttpRequest 读取事件，兼容浏览器与 React Native。

状态集中在 `src/stores/`。连接、项目目录、模型选择、最近会话、文档位置和排队消息都按连接端点隔离，避免两个服务器共用同名路径或 ID 时互相污染。

## 文档

- `docs/multiple-backends.md`：多后端架构说明
- `docs/openclaw-connection.md`：OpenClaw 连接说明
- `docs/opencode-connection.md`：OpenCode 连接说明
- `docs/ios-testflight-github.md`：GitHub Actions 构建与 TestFlight 发布说明
- `docs/skills/puff-preview/SKILL.md`：Web Preview 编写规范

## 许可证

MIT。见 [LICENSE](LICENSE)。
