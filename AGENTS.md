# 星座运势日历生成器 (Horoscope Calendar)

## 项目简介

一个基于 Cloudflare Pages + Workers AI 的单页应用，用于从星座运势文章中自动提取结构化信息，生成可导出的日历表格数据。

核心功能：粘贴运势文字 → AI 自动提取 → 生成结构化 JSON/CSV/Markdown 表格

## 技术栈

| 层级 | 技术 |
|------|------|
| 部署平台 | Cloudflare Pages (Pages Functions) |
| 前端 | 纯 HTML/CSS/JS (单页应用，无框架) |
| 后端 | Cloudflare Pages Functions (functions/api/*.js) |
| AI 服务 | Cloudflare Workers AI (免 API Key) |
| 可选 AI | 任意 OpenAI 兼容 API (OpenAI / DeepSeek / OpenRouter 等) |
| 包管理 | Bun |
| 开发工具 | Wrangler CLI v4 |

## 项目结构

```
horoscope-calendar/
├── index.html              # 单页应用（全部前端逻辑）
├── functions/
│   ├── api/
│   │   ├── chat.js         # Workers AI 代理端点 (POST /api/chat)
│   │   └── fetch.js        # CORS 代理抓取端点 (GET /api/fetch?url=...)
├── package.json            # 依赖: wrangler
├── wrangler.jsonc          # Cloudflare 配置 (ai binding)
├── .wrangler/              # 本地开发状态 (KV, Cache)
└── test_content.txt        # 测试数据
```

## 关键文件说明

### index.html
- 完整的单页应用，包含 CSS、HTML 结构、JavaScript 逻辑
- 四步向导式界面：API 设置 → 输入内容 → AI 处理 → 结果展示
- 核心功能：
  - 支持 Cloudflare Workers AI 和自定义 OpenAI 兼容 API 双模式
  - 链接自动抓取（通过 CORS 代理 + 本地 /api/fetch）
  - 智能 Token 估算和上下文截断（防止超长输入）
  - 流式 AI 响应 + 实时预览
  - 多层 JSON 容错修复（LLM 输出常见格式错误）
  - 日期智能解析（支持多种中文日期格式）
  - 结果导出：CSV / JSON / Markdown

### functions/api/chat.js
- Cloudflare Pages Function
- 代理前端请求到 Workers AI
- 支持流式 (SSE) 和非流式响应
- 统一 Workers AI 多种流式格式为 OpenAI 兼容 SSE
- 模型默认：`@cf/zai-org/glm-4.7-flash`
- 支持 `enableThinking` 开关控制推理模式

### functions/api/fetch.js
- Cloudflare Pages Function
- 代理抓取目标网页，绕过浏览器 CORS 限制
- SSRF 防护：禁止访问内网、回环、元数据地址
- 限制响应体大小（2MB）
- 模拟浏览器 User-Agent 请求

### wrangler.jsonc
```jsonc
{
  "name": "horoscope-calendar",
  "compatibility_date": "2026-06-01",
  "ai": { "binding": "AI" }
}
```

## 开发命令

```bash
# 本地开发（带 live-reload）
bun run dev
# 等价于: wrangler pages dev . --live-reload

# 部署到 Cloudflare Pages
bun run deploy
# 等价于: wrangler pages deploy .
```

## 环境要求

- **本地开发**: 需要 Wrangler 登录 `wrangler login`
- **Workers AI**: 部署到 Cloudflare Pages 后自动可用（有免费额度）
- **自定义 API**: 需要填写 API Base URL + API Key（浏览器端存储在 localStorage）

## 数据流

1. 用户粘贴运势文章链接 → 前端通过 `/api/fetch` 或公共 CORS 代理抓取 HTML
2. 前端用 DOMParser 提取纯文本（去除 script/style/nav/footer 等噪音）
3. 构建结构化提示词（默认模板 + 自定义变量替换）
4. 发送给 AI（Workers AI 或自定义 API）
5. AI 返回 JSON 数组 → 前端多层解析修复 → 日期标准化
6. 渲染表格 → 支持 CSV/JSON/Markdown 导出

## 注意事项

- 前端所有 API Key 存储在 `localStorage`，仅在浏览器使用
- Workers AI 每天有免费额度限制（约 10,000 neurons）
- 微信公众号等需要登录的页面无法自动抓取，需手动粘贴
- 推理模型（如 GLM-4.7-Flash）默认关闭 thinking 模式以避免空输出
- 长文本会自动估算 token 并截断，保留系统提示词和最近的上下文
