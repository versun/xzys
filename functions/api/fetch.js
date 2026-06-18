// Cloudflare Pages Function: 代理抓取目标网页，绕过浏览器 CORS 限制
// 禁止访问内网、回环及云元数据地址，防止 SSRF 滥用；不限制公网域名。

// 最大允许抓取的字节数（2MB）
const MAX_FETCH_BYTES = 2 * 1024 * 1024;

export async function onRequestGet(context) {
  const { request } = context;
  const urlParam = new URL(request.url).searchParams.get('url');

  if (!urlParam) {
    return jsonResponse({ error: '缺少 url 参数' }, 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(urlParam);
  } catch {
    return jsonResponse({ error: 'url 格式无效' }, 400);
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return jsonResponse({ error: 'url 必须以 http:// 或 https:// 开头' }, 400);
  }

  // SSRF 基础防护：禁止访问内网、回环、元数据地址
  if (isPrivateOrInternalHost(targetUrl.hostname)) {
    return jsonResponse({ error: '不允许访问该地址' }, 403);
  }

  try {
    const resp = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      return jsonResponse(
        { error: `目标网页返回错误: ${resp.status} ${resp.statusText}` },
        502
      );
    }

    // 流式返回，同时限制总大小
    const limitedBody = limitStreamSize(resp.body, MAX_FETCH_BYTES);
    return new Response(limitedBody, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return jsonResponse({ error: `抓取失败: ${e.message}` }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function isPrivateOrInternalHost(hostname) {
  const host = hostname.toLowerCase();

  // 回环与本地主机
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

  // 私有 IPv4 段
  if (host.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|127\.)/)) return true;

  // 常见内网/元数据域名
  const blocked = [
    'metadata.google.internal',
    'metadata',
    '169.254.169.254',
    'fc00::',
    'fec0::',
    'ff00::',
  ];
  return blocked.some((b) => host === b || host.endsWith('.' + b));
}

function limitStreamSize(readableStream, maxBytes) {
  if (!readableStream) return readableStream;

  const { readable, writable } = new TransformStream();
  const reader = readableStream.getReader();
  const writer = writable.getWriter();
  let total = 0;

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value?.byteLength || 0;
        if (total > maxBytes) {
          await writer.abort(new Error('响应体超过最大限制'));
          return;
        }

        await writer.write(value);
      }
      await writer.close();
    } catch (e) {
      await writer.abort(e);
    } finally {
      reader.releaseLock();
    }
  })();

  return readable;
}
