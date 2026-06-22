# 星座运势日历生成器

从星座运势文章中自动提取结构化信息，生成可导出的日历表格数据。

## 快速开始

```bash
bun install
bun run dev
```

访问 `http://localhost:8788`。

## 测试

```bash
bun test
```

## 部署

### 方式一：手动部署

```bash
bun run deploy
```

### 方式二：Git 自动部署（推荐）

在 [Cloudflare Dashboard](https://dash.cloudflare.com) 的 **Workers & Pages** 中创建项目并选择 **Connect to Git**，授权 GitHub/GitLab 仓库。构建设置：

- **Production branch**: `main`
- **Build command**: （留空）
- **Build output directory**: `.`
- **Root directory**: `/`

之后每次 `git push origin main` 会自动部署到 Cloudflare Pages。

## 详细说明

见 [AGENTS.md](./AGENTS.md)。

## 开源协议

MIT
