// Cloudflare Pages Function: 使用 Workers AI 提供免 API Key 的 AI 服务
// 免费额度：每天 10,000 neurons（具体以 Cloudflare 官方为准）
const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';

// 最大请求体大小：2MB
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return jsonResponse({ error: 'Workers AI 绑定未配置，请在 wrangler.jsonc 中配置 ai.binding 并重新部署' }, 500);
  }

  // 限制请求体大小，防止大 body 导致内存/CPU 问题
  let bodyText;
  try {
    bodyText = await readBodyWithLimit(request, MAX_REQUEST_BYTES);
  } catch (e) {
    return jsonResponse({ error: e.message }, 413);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    return jsonResponse({ error: '请求体必须是 JSON' }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: '缺少 messages 字段' }, 400);
  }

  const model = body.model && body.model.startsWith('@cf/') ? body.model : DEFAULT_MODEL;
  // Workers AI 各模型输出 token 上限不同；默认模型 @cf/zai-org/glm-4.7-flash 支持 128K 输出，
  // 但运势提取不需要过长输出，默认 8K 足以避免长时间等待和额度浪费。
  const max_tokens = Math.min(Number(body.max_tokens) || 8192, 65536);
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.3;

  // GLM-4.7-Flash 等推理模型默认会把大量输出 token 用于思考过程，导致可见内容为空。
  // 用户可通过 enableThinking 开关控制；默认关闭，确保输出用于最终回答。
  const enableThinking = body.enableThinking === true;
  const runInputs = {
    messages,
    max_tokens,
    temperature,
  };
  if (model.includes('glm-4.7')) {
    runInputs.chat_template_kwargs = { enable_thinking: enableThinking };
    if (!enableThinking) {
      runInputs.reasoning_effort = 'low';
    }
  }

  try {
    // 如果前端显式要求非流式，直接返回 JSON（作为流式卡断时的兜底）
    if (body.stream === false) {
      const result = await env.AI.run(model, runInputs);
      const content = result.response || result.choices?.[0]?.message?.content || '';
      return jsonResponse({ choices: [{ message: { role: 'assistant', content } }] }, 200);
    }

    const stream = await env.AI.run(model, {
      ...runInputs,
      stream: true,
    });

    // Workers AI 流式格式因模型而异：
    // - 旧版模型：data: {"response":"..."}
    // - Chat Completions 模型（如 GLM-4.7-Flash）：data: {"choices":[{"delta":{"content":"..."}}]}
    // 这里统一转换为 OpenAI 兼容 SSE 返回前端
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    normalizeStream(stream, writer, encoder);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    const msg = e.message || String(e);
    if (msg.includes('model') && (msg.includes('not found') || msg.includes('not supported') || msg.includes('找不到'))) {
      return jsonResponse({ error: `模型不可用: ${model}。请在设置里更换其他 @cf/ 模型后再试。` }, 400);
    }
    return jsonResponse({ error: `AI 调用失败: ${msg}` }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readBodyWithLimit(request, maxBytes) {
  // 优先通过 Content-Length 快速拒绝
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('请求体超过最大限制');
  }

  const reader = request.body?.getReader();
  if (!reader) return '{}';

  const decoder = new TextDecoder();
  let chunks = '';
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value?.byteLength || 0;
    if (total > maxBytes) {
      throw new Error('请求体超过最大限制');
    }

    chunks += decoder.decode(value, { stream: true });
  }
  chunks += decoder.decode();
  return chunks;
}

async function normalizeStream(workerStream, writer, encoder) {
  const reader = workerStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const text = extractTextFromChunk(line);
        if (text) await writeOpenAIChunk(writer, encoder, text);
      }
    }

    // flush remaining buffer
    if (buffer.trim()) {
      const text = extractTextFromChunk(buffer);
      if (text) await writeOpenAIChunk(writer, encoder, text);
    }

    await writer.write(encoder.encode('data: [DONE]\n\n'));
  } catch (e) {
    console.error(JSON.stringify({ message: 'stream normalize error', error: e.message }));
    await writer.write(encoder.encode('data: ' + JSON.stringify({ error: e.message }) + '\n\n'));
  } finally {
    writer.close();
  }
}

function extractTextFromChunk(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ')) return '';
  const data = trimmed.slice(6);
  if (data === '[DONE]') return '';

  try {
    const parsed = JSON.parse(data);

    // 1. 旧版 Workers AI 流式格式：{ response: "..." }
    if (typeof parsed.response === 'string' && parsed.response) {
      return parsed.response;
    }

    // 2. OpenAI 兼容流式格式：{ choices: [{ delta: { content: "..." } }] }
    const deltaContent = parsed.choices?.[0]?.delta?.content;
    if (typeof deltaContent === 'string') {
      return deltaContent;
    }

    // 3. OpenAI 兼容非流式 choices 格式（兜底）
    const messageContent = parsed.choices?.[0]?.message?.content;
    if (typeof messageContent === 'string') {
      return messageContent;
    }
  } catch (e) {
    // malformed chunk, skip
  }
  return '';
}

async function writeOpenAIChunk(writer, encoder, text) {
  const openaiChunk = JSON.stringify({
    choices: [{
      index: 0,
      delta: { content: text },
      finish_reason: null,
    }],
  });
  await writer.write(encoder.encode('data: ' + openaiChunk + '\n\n'));
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
