# 星座运势日历生成器

从星座运势文章中自动提取结构化信息，生成可导出的日历表格数据。

## 功能特性

- **AI 自动提取** — 粘贴运势文字，AI 自动识别日期、星座、领域、关键词等结构化信息
- **双模式 AI 支持** — 支持 Cloudflare Workers AI（免 API Key，有免费额度）或任意 OpenAI 兼容 API
- **链接自动抓取** — 粘贴文章链接即可自动抓取内容，支持 CORS 代理和本地代理双通道
- **智能日期解析** — 自动识别月运、周运、日运，支持多种中文日期格式（如"6月初"、"6.13"、"6月1日-5日"等）
- **流式响应预览** — 实时显示 AI 输出进度
- **多格式导出** — 支持 CSV、JSON、Markdown 表格导出
- **星座筛选** — 可选择只关注特定星座，减少输出量
- **自定义提示词** — 支持编辑 AI 提示词模板，灵活适配不同来源的文章格式

## 技术栈

| 层级 | 技术 |
|------|------|
| 部署平台 | Cloudflare Pages |
| 前端 | 纯 HTML/CSS/JS（单页应用，无框架依赖） |
| 后端 | Cloudflare Pages Functions |
| AI 服务 | Cloudflare Workers AI / OpenAI 兼容 API |
| 包管理 | Bun |
| 开发工具 | Wrangler CLI v4 |

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) 已安装
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 已安装并登录：`wrangler login`

### 本地开发

```bash
# 安装依赖
bun install

# 启动本地开发服务器（带 live-reload）
bun run dev
```

访问 `http://localhost:8788` 即可使用。

### 部署到 Cloudflare Pages

```bash
# 一键部署
bun run deploy
```

部署后，Workers AI 功能自动可用（无需配置 API Key）。

### 使用自定义 API（可选）

如果不想使用 Workers AI，可以在应用内设置：

- **OpenAI**: `https://api.openai.com/v1` + API Key
- **DeepSeek**: `https://api.deepseek.com/v1` + API Key
- **OpenRouter**: `https://openrouter.ai/api/v1` + API Key
- 其他任意 OpenAI 兼容接口

## 使用流程

1. **API 设置** — 选择使用 Cloudflare Workers AI 或填写自定义 API 信息
2. **输入内容** — 粘贴运势文章链接（自动抓取）或直接粘贴文字内容；选择关注的星座（可选）
3. **AI 处理** — 自动发送给 AI 提取结构化数据，实时显示处理进度
4. **查看结果** — 以表格形式展示提取结果，支持 CSV / JSON / Markdown 导出

## 项目结构

```
horoscope-calendar/
├── index.html              # 单页应用（全部前端逻辑：UI、状态管理、AI 调用、数据解析）
├── functions/
│   └── api/
│       ├── chat.js         # Workers AI 代理端点：统一流式/非流式响应，格式转换
│       └── fetch.js        # CORS 代理抓取端点：带 SSRF 防护的网页抓取
├── package.json            # 项目配置，依赖 wrangler
├── wrangler.jsonc          # Cloudflare 配置（Workers AI binding）
└── .gitignore              # 忽略 node_modules、.wrangler、.dev.vars
```

## 核心实现细节

### 智能 Token 估算与截断

前端根据模型上下文窗口自动估算输入 token 数，超长内容时优先保留系统提示词和最近的上下文，避免超出模型限制。

### 多层 JSON 容错修复

LLM 输出 JSON 时常出现格式错误，系统采用四层修复策略：

1. **直接解析** — 尝试直接 `JSON.parse()`
2. **截断修复** — 若末尾被截断，保留最后一个完整记录并关闭数组
3. **自动修复** — 修复常见错误（缺失逗号、冒号、多余逗号等）
4. **AI 修复兜底** — 让 AI 自己修复损坏的 JSON

### 日期智能解析

支持多种中文日期格式自动标准化为 `YYYY-MM-DD`：

- `2026年6月5日` → `2026-06-05`
- `6.13` / `6月13日` → 自动推断年月
- `6月1日-5日` → 取起始日期 `2026-06-01`
- `月初`、`月中`、`月末` → 根据上下文推断具体日期

### 安全抓取代理

`functions/api/fetch.js` 提供带 SSRF 防护的网页抓取：

- 禁止访问内网、回环地址（`localhost`、`127.0.0.1`、`10.x.x.x` 等）
- 禁止访问云元数据地址
- 限制响应体大小（2MB）
- 模拟真实浏览器 User-Agent

## 配置说明

### wrangler.jsonc

```jsonc
{
  "name": "horoscope-calendar",
  "compatibility_date": "2026-06-01",
  "ai": { "binding": "AI" }    // Workers AI 绑定
}
```

### 环境变量（本地开发）

如需在本地使用 Workers AI，创建 `.dev.vars` 文件（不会被提交到 Git）：

```
# 通常不需要，wrangler 会自动使用登录账号的权限
```

## 浏览器兼容性

- 现代浏览器（Chrome、Firefox、Safari、Edge 最新版）
- 需要支持 `fetch`、`AbortSignal.timeout`、`DOMParser`、`TransformStream`
- 不支持 IE

## 注意事项

- **API Key 存储**：自定义 API 的 Key 存储在浏览器 `localStorage` 中，仅在本地使用，不会上传到服务器
- **Workers AI 额度**：每天有免费额度限制（约 10,000 neurons），超出后需要等待次日或升级套餐
- **链接抓取限制**：微信公众号、小红书等需要登录或反爬的页面可能无法自动抓取，此时请手动复制文字内容粘贴
- **推理模型**：部分推理模型（如 GLM-4.7-Flash）默认会大量输出思考过程，应用默认关闭 thinking 模式以确保有实际内容输出
- **长文本处理**：超过 15,000 字的输入会触发警告，系统会自动截断以适应模型上下文窗口

## 开源协议

MIT
