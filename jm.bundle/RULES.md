# jm.bundle 代码规则文档

## 一、项目概述

**jm.bundle** 是一个用于 [18comic.vip](https://18comic.vip)（JM 漫画）的爬虫工具包，包含：
- **后端核心** (`jm.bundle/`) — Node.js 爬虫 + Express HTTP 服务 + SQLite 存储 + CLI 命令行
- **前端 SPA** (`jm.bundle.front/`) — Vue 3 + TypeScript 管理界面
- **Web 前端** (`jm.bundle.web/`) — 备用 Vue 3 + JS 前端
- **VS Code 扩展** (`jm.bundle.vscode/`) — 在 VS Code 中操作

用途：漫画信息拉取、元数据解析、ZIP 下载、本地数据库管理、Web 管理面板、漫画阅读器集成。

---

## 二、整体架构

### 模块加载模式

入口 `jm.bundle.js` 使用 **工厂函数** 模式，通过 `create*` 系列函数组装核心组件：

```
jm.bundle.js
├── core/config.js      createConfig(manifest, ctx)       配置读写
├── core/message.js     createMessage(manifest, ctx, mod) 消息分发
├── core/crawler.js     createCrawler(...)                爬虫（单次下载，无状态管理）
├── core/store.js       createStore(...)                  数据库
├── core/server.js      createServer(...)                  HTTP服务
├── core/taskManager.js createTaskManager(...)             任务管理器（持久化、队列、进度广播）
└── core/cli.js         createCli(...)                     命令行
```

### 职责分离

| 组件 | 职责 |
|------|------|
| `crawler.js` | 单次漫画下载、元数据拉取、搜索、排行 — **不管理队列/状态** |
| `server.js`  | HTTP + WebSocket 服务，API 路由，静态文件托管，WS 消息路由到 taskManager |
| `taskManager.js` | 下载任务管理：持久化列表、队列调度、调用 crawler 下载、通过 server.sendMessage 广播进度 |
| `message.js` | 任务生命周期管理（phase/step），广播进度到所有 dispatcher |
| `cli.js`     | 命令行入口，直接调用 `crawler.album.downloadArchive()` |

- 支持两种运行模式：`activate()`（插件模式）和 `run(argv)`（CLI 模式）
- 所有模块通过 `manifest` 和上下文 `ctx` 进行依赖注入

### 协议系统 (`protocol.js`)

定义了四个核心枚举：

| 枚举 | 用途 | 示例 |
|------|------|------|
| `PHASE` | 任务阶段（"我在干什么"） | `LOGIN`, `FETCH_COMIC`, `FETCH_FILE` |
| `STEP`  | 任务子步骤 | `DOWNLOAD_PAGE`, `CAPTCHA`, `REAL_LINK`, `DOWNLOAD` |
| `STATE` | 运行状态（"做到哪了"） | `IDLE`, `WAITING`, `START`, `RUNNING`, `SUCCESS`, `ERROR` |
| `ERR`   | 错误码（"为什么失败"） | `{code: -30, message: "...", status: 502}` |

---

## 三、代码规范

### 1. 通用规范

- **语言**：后端使用 Node.js CommonJS (`'use strict'`)，前端使用 TypeScript / JavaScript (ESM)
- **缩进**：4 空格
- **引号**：单引号优先，字符串插值使用反引号
- **分号**：必须
- **命名**：
  - 变量/函数：`camelCase`
  - 常量：全大写 `UPPER_SNAKE_CASE` 或 `PascalCase`
  - 类/构造器：`PascalCase`
  - 私有方法：`_prefix`（非强制）
  - 文件名：全小写 `kebab-case`
- **`null` vs `undefined`**：不存在时返回 `null`，未初始化用 `null`
- **错误处理**：使用 `try/catch`，错误对象统一向上抛出，消息分发器捕获后广播 `STATE.ERROR`
- **异步**：全程 `async/await`，避免原始 Promise 链
- **`== null` 检查**：允许使用 `== null` 同时检查 `null` 和 `undefined`

### 2. 核心规范

#### config.js
- 配置读写：从 `config.json` 读取，运行时暴露响应式 `out` 对象
- `get()` 返回完整配置对象，`setValue(key, value)` 持久化
- 支持事件驱动更新：`trigger()` 和 `ctx.event.on/off`

#### message.js
- 消息分发器模式：注册多个 `dispatchers`（console / ws / electron），统一通过 `onMessage(payload)` 广播
- 消息结构遵循 `protocol` 定义的 `phase`/`step`/`state`
- `doPhase()` 和 `doLockPhase()` 管理任务生命周期
  - 自动创建 `stepHandler`，提供 `doStep()` 方法
  - 开始→进度→成功/失败三步通知
  - `safeSpread()` 过滤不可序列化字段（如 Stream/Buffer/Function）

#### crawler.js
- 所有爬虫方法返回对象，统一格式
- **职责单一**：只负责单次下载/抓取，不管理队列和下载状态
- 登录流程：`Cloudflare 校验 → 访问首页 → 提交登录 → 验证`
- 下载流程：`访问下载页 → 验证码 OCR → 获取真实链接 → 下载 ZIP`
- 验证码重试：带 10 次阈值的 OCR 计算
- 使用 `AsyncLock` 保证验证码+真实链接的原子性
- 关键工具函数：
  - `expireRetry()` — 登录过期自动重试
  - `withRetry()` — http 请求自动重试 3 次
  - `lock.acquire()` — 临界区保护
- 对外暴露 `init`, `account`, `album`, `search`, `rank`, `fetchRemoteFile`, `httpClient`

#### server.js
- Express + `express-ws` + `compression`
- RESTful API 风格，统一响应格式 `{ok: boolean, ...}`
- 所有 handler 用 `try/catch`，错误返回 `{ok: false, message}`
- **WS 消息路由**：`handleProgressWs` 在客户端连接时下发任务列表（`init`），收到的 WS 消息转发给 `taskManager.handleWSMessage()`
- WebSocket 推送下载进度给前端
- 前端静态文件内嵌（base64）或外置 `web/dist`
- `/file` 路由代理远程图片资源，缓存到本地

#### store.js
- SQLite 存储（通过 `better-sqlite3` 兼容层）
- `UPSERT` 模式：`INSERT ... ON CONFLICT DO UPDATE`
- JSON 列存储数组（tags / authors / thumbs / episodes）
- `jsonRowToDb()` 和 `dbRowToJson()` 双向转换
- `saveOrUpdateBatch()` 使用事务批量写入

#### parser.js
- 使用 `cheerio` 解析 HTML
- 每个解析函数职责单一，输入 HTML 字符串，输出结构化对象
- 选择器尽量准确，避免过度依赖 DOM 结构

#### taskManager.js
- 遵循 `createTaskManager(manifest, ctx, store, crawler, message, config)` 工厂模式
- 职责：管理持久化下载任务列表，调度下载，通过 `server.sendMessage` 广播进度
- **依赖注入**：`store`（查漫画名）、`crawler`（执行下载）、`message`（订阅进度消息）、`config`（读 dataDir）
- 通过 `setServer(server)` 后置注入 `server`，避免循环依赖
- 任务列表持久化到 `{dataDir}/tasks.json`
- 支持 WS 消息类型：`add`, `remove`, `start`, `pause`, `list`, `statuses`
- 广播消息类型：`init`, `added`, `removed`, `progress`, `completed`, `error`, `paused`, `started`
- 状态流转：`waiting → downloading → completed | error | paused → (resume → downloading)`
- 注册 `message.dispatchers.taskManager` 监听实时下载进度，自动更新任务状态

#### cli.js
- 使用 `commander` 库
- 命令格式：`namespace:action`（如 `album:download`）
- 三种模式：单编号、文件批量、交互式
- `p-queue` 控制并发（默认 15）
- 支持 ETA 计算和进度显示

### 3. 前端规范 (`jm.bundle.front`)

- **框架**：Vue 3 Composition API + `<script setup>` + TypeScript
- **构建**：Vite 6
- **UI 库**：Naive UI（按需自动导入）
- **状态管理**：Pinia
- **路由**：Vue Router 4（Hash 模式）
- **类型定义**：集中放在 `types.ts`
- **API 层**：统一通过 `api.ts`（`getJson`/`postJson`/`delJson`）
- **WebSocket**：在 `App.vue` 的 `onMounted` 中建立连接，断线自动重连
- **状态更新**：通过 Pinia store 的 `ingestWsPayload()` 实时更新
- **组件自动导入**：使用 `unplugin-vue-components` + `NaiveUiResolver`

### 4. 文件组织

```
jm.bundle/
├── jm.bundle.js              # 入口
├── config.json               # 用户配置
├── protocol.js               # 协议枚举
├── package.json              # 模块清单
├── core/
│   ├── cli.js                # 命令行
│   ├── config.js             # 配置管理
│   ├── crawler.js            # 爬虫
│   ├── message.js            # 消息分发
│   ├── notifier.js           # 系统通知
│   ├── parser.js             # HTML 解析
│   ├── server.js             # HTTP 服务
│   └── store.js              # 数据库
├── build/                    # webpack 构建
├── resources/                # 图标/模板
└── temp/                     # 临时数据

jm.bundle.front/
├── src/
│   ├── App.vue               # 根组件（含 WS 连接）
│   ├── main.ts               # 入口
│   ├── api.ts                # HTTP 请求封装
│   ├── types.ts              # 类型定义
│   ├── constants.ts          # 常量
│   ├── router/index.ts       # 路由
│   ├── stores/jmLive.ts      # Pinia 状态
│   ├── pages/                # 页面组件
│   ├── components/           # 通用组件
│   └── assets/               # 样式
├── index.html
└── vite.config.ts
```

---

## 四、关键约定

### 错误处理
- 自定义错误使用 `ERR` 枚举，包含 `{code, message, status}`
- 所有 API handler 使用 `try/catch`，统一返回 `{ok: false, message}`
- 爬虫层通过 `expireRetry()` 自动处理 403 登录过期

### 消息格式
```json
{
  "phase": "fetch_comic",
  "state": "running",
  "step": "download",
  "number": 12345,
  "complete": 50,
  "total": 100,
  "startTime": "...",
  "endTime": "..."
}
```

### API 响应格式
```json
{ "ok": true, "data": ... }
{ "ok": false, "message": "错误描述" }
```

### 同步机制
- `sync_local_to_db`：从本地 HTML 文件重新解析并更新数据库
- `sync_db_to_local`：从数据库导出 JSON 到磁盘 info 目录

### 文件路径约定
```
{dataDir}/
├── info/{number}.json       # 漫画元数据 JSON
├── html/{number}.txt        # 原始 HTML（压缩）
├── comic/{number}.zip       # 下载的 ZIP 文件
├── file/...                 # 缓存的外部资源
└── album_missing/           # 无效编号记录
```

### 构建与运行
- `npm run build` — webpack 打包所有子模块为单文件
- `npm run build:sea` — 打包为单文件可执行文件
- `npm run server` — 启动 HTTP 服务
- `npm run album:download <id>` — 下载单本漫画

---

## 五、风格要点总结

| 方面 | 规范 |
|------|------|
| 模块导出 | `module.exports = { createFoo }` |
| 异步 | 全部 `async/await` |
| 错误处理 | 尽量早 throw，统一在 `doStep` / `doPhase` 捕获 |
| 配置读取 | `config.get()` 实时读取，`config.setValue()` 持久化 |
| 并发控制 | `AsyncLock`（互斥）+ `p-queue`（并发队列） |
| Cookie 管理 | 拦截器自动合并响应 `set-cookie`，通过 `config.setValue()` 持久化 |
| 前端通信 | WebSocket 实时推送，REST API 做 CRUD |
| 代码注释 | 少量中文注释，关键步骤用编号注释 `// 1、...` `// 2、...` |
