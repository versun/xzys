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
├── public/
│   └── utils.js            # 前端与测试共用的纯工具函数
├── functions/
│   ├── api/
│   │   ├── chat.js         # Workers AI 代理端点 (POST /api/chat)
│   │   └── fetch.js        # CORS 代理抓取端点 (GET /api/fetch?url=...)
├── tests/                  # 测试套件
│   ├── api/                # Pages Functions 测试
│   ├── setup.js            # 测试环境初始化
│   └── utils.test.js       # utils.js 单元测试
├── package.json            # 依赖: wrangler
├── bunfig.toml             # Bun 测试配置
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
  - 链接自动抓取（通过本地 `/api/fetch` 代理）
  - 流式 AI 响应 + 实时预览
  - 简单 JSON 提取与修复（剥离 markdown 代码块、补引号/逗号/括号等常见 LLM 格式错误）
  - 日期智能解析（支持多种中文日期格式）
  - 结果导出：CSV / JSON / Markdown

### public/utils.js
- 前端与测试共用的纯工具函数
- JSON 提取与修复（`extractJsonStr` / `repairJson`）
- 日期推断与标准化（`inferYearMonth` / `normalizeDate`）
- 默认提示词模板（`DEFAULT_PROMPT_TEMPLATE`）

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
# 安装依赖
bun install

# 本地开发（带 live-reload）
bun run dev
# 等价于: wrangler pages dev . --live-reload

# 运行测试
bun test

# 部署到 Cloudflare Pages（手动）
bun run deploy
# 等价于: wrangler pages deploy .
```

## 自动部署（推荐）

通过 Cloudflare Pages 的 Git 集成，每次 `git push` 到已连接的分支后会自动构建并部署：

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com) 进入 **Workers & Pages**
2. 创建 Pages 项目并选择 **Connect to Git**
3. 授权 GitHub/GitLab 并选择本仓库
4. 构建设置：
   - **Production branch**: `main`
   - **Build command**: （留空，纯静态 + Pages Functions，无需构建）
   - **Build output directory**: `.`
   - **Root directory**: `/`
5. 保存后，后续推送到 `main` 将自动部署

注意：Git 集成启用后不能切换回 Direct Upload；如需暂停自动部署，可在项目 **Settings → Builds → Branch control** 中关闭。

## 环境要求

- **本地开发**: 需要 Wrangler 登录 `wrangler login`
- **Workers AI**: 部署到 Cloudflare Pages 后自动可用（有免费额度）
- **自定义 API**: 需要填写 API Base URL + API Key（浏览器端存储在 localStorage）

## 数据流

1. 用户粘贴运势文章链接 → 前端通过 `/api/fetch` 代理抓取 HTML
2. 前端用 DOMParser 提取纯文本（去除 script/style/nav/footer 等噪音）
3. 构建结构化提示词（默认模板 + 自定义变量替换）
4. 发送给 AI（Workers AI 或自定义 API）
5. AI 返回 JSON 数组 → 前端简单解析修复 → 日期标准化
6. 渲染表格 → 支持 CSV/JSON/Markdown 导出

## 注意事项

- 前端所有 API Key 存储在 `localStorage`，仅在浏览器使用
- Workers AI 每天有免费额度限制（约 10,000 neurons）
- 微信公众号等需要登录的页面无法自动抓取，需手动粘贴
- 推理模型（如 GLM-4.7-Flash）默认关闭 thinking 模式以避免空输出
