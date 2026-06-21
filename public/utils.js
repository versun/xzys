// ─── Shared pure utilities for horoscope-calendar ───
// These functions are used by both the frontend (index.html) and test suite.

// ─── Constants ───
const SIGNS = ['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座'];
const AREA_COLORS = {'事业':'area-事业','感情':'area-感情','财运':'area-财运','健康':'area-健康','学业':'area-学业','综合':'area-综合'};

const MODEL_CONTEXT_WINDOWS = {
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
  'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  'claude-3-opus': 200000, 'claude-3-sonnet': 200000, 'claude-3-haiku': 200000,
  'claude-3-5-sonnet': 200000, 'claude-3-5-haiku': 200000, 'claude-3-7-sonnet': 200000,
  'gemini-1.5-pro': 1000000, 'gemini-1.5-flash': 1000000,
  'gemini-2.0-flash': 1000000, 'gemini-2.5-flash': 1000000, 'gemini-2.5-pro': 1000000,
  'deepseek-chat': 64000, 'deepseek-reasoner': 64000,
};
const RESERVE_TOKENS = 8000;

const CORS_PROXIES = [
  url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];

const DEFAULT_PROMPT_TEMPLATE = `# 角色
你是一位专业的星座运势整理师，擅长从文字内容中精准提取结构化信息并输出为日历事件。

# 任务
从以下星座运势文字中，提取每个星座、每个时间段的重点运势信息。
目标星座：{signs}

# 提取规则
1. 根据文章标题、开头和正文自动判断运势类型（月运/周运/日运）以及对应的时间段
2. 从文章标题、开头或正文中识别来源老师/作者名称，填入 source 字段
3. 必须覆盖所有目标星座；同一星座在不同时间段、不同领域的预测，要分别作为独立记录输出
4. date 字段必须是严格的 YYYY-MM-DD 格式：
   - 日运：使用文章中的具体日期
   - 周运：使用当周周一的日期
   - 月运：如果文章按时间段分段（如 "月初1日到5日"、"6日到10日"、"6.13"、"6.4/6.10" 等），必须为每个时间段生成独立记录，date 取该时间段的起始日期；只有当月运没有明显时间段时，才默认使用当月 1 日
   - 年份和月份优先从文章标题/开头推断（如 "2026年6月运势" → 2026-06）；若未明确，使用当前年月
5. period 字段必须保留原文中的时间段描述（如 "2026年6月"、"6月1日-5日"、"6.13"），不得为空
6. 运势领域分类：事业、感情、财运、健康、学业、综合。若某时间段内没有明显领域侧重，使用 "综合"
7. 关键词用2-4个字概括核心主题
8. 详细描述控制在50字以内，保留最核心的信息
9. 注意事项单独列出（如有）
10. 宫位等专业术语保留原文，不需要额外解释
11. 为控制输出长度并确保 JSON 完整闭合：目标星座较多时，每个星座的每个时间段最多输出 1-2 条最关键记录（优先综合，其次事业/感情）。不要合并不同时间段，也不要为了缩短而只输出一条记录
12. 必须确保 JSON 数组完整闭合，最后一个对象后要有 ]，不要截断

# 输出格式（必须严格遵守）
请严格输出以下 JSON 数组，不要输出任何解释文字、markdown标记或其他内容，只输出纯JSON：
- 所有字符串和属性名必须用英文双引号包裹
- 每个属性名后面必须紧跟英文冒号
- 每个属性值后面必须有英文逗号，最后一个属性后不要逗号
- 每个对象之间必须有英文逗号
- 不要遗漏任何逗号或冒号

示例：
[
  {
    "date": "2025-06-05",
    "period": "6月5日",
    "sign": "狮子座",
    "area": "事业",
    "keyword": "突破",
    "detail": "工作上迎来重要转机...",
    "note": "注意沟通方式（如有）",
    "source": "来源老师名称或未知"
  },
  {
    "date": "2025-06-10",
    "period": "6月6日-10日",
    "sign": "狮子座",
    "area": "综合",
    "keyword": "合作",
    "detail": "适合推进合作，沟通效率提升",
    "note": "",
    "source": "来源老师名称或未知"
  }
]

# 原文内容
{text}`;

// ─── Token estimation ───
function estimateTokens(text) {
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChinese = text.replace(/[\u4e00-\u9fff]/g, '');
  const engTokens = nonChinese.split(/\s+/).filter(Boolean).length * 1.3
    + (nonChinese.match(/[^\w\s]/g) || []).length * 0.5;
  return Math.round(chinese + engTokens);
}

function getContextWindow(model) {
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
  for (const [prefix, w] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(prefix.replace(/-$/, ''))) return w;
  }
  return 128000;
}

function truncateMessages(messages, maxTokens) {
  const available = Math.max(maxTokens - RESERVE_TOKENS, maxTokens / 2);
  const systemMsgs = messages.filter(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');
  const systemTokens = systemMsgs.reduce((s, m) => s + estimateTokens(m.content || ''), 0);
  let remaining = available - systemTokens;
  if (remaining <= 0) return { result: systemMsgs, truncated: true };
  const kept = [];
  let used = 0;
  for (let i = otherMsgs.length - 1; i >= 0; i--) {
    const t = estimateTokens(otherMsgs[i].content || '');
    if (used + t <= remaining) { kept.unshift(otherMsgs[i]); used += t; }
    else break;
  }
  return { result: [...systemMsgs, ...kept], truncated: kept.length < otherMsgs.length };
}

// ─── JSON repair for LLM output ───
function tokenizeJson(jsonStr) {
  const tokens = [];
  let i = 0;
  while (i < jsonStr.length) {
    const ch = jsonStr[i];
    if (/\s/.test(ch)) {
      let j = i;
      while (j < jsonStr.length && /\s/.test(jsonStr[j])) j++;
      tokens.push({ type: 'ws', value: jsonStr.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
      tokens.push({ type: ch, value: ch });
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1, escaped = false;
      while (j < jsonStr.length) {
        if (escaped) { escaped = false; j++; continue; }
        if (jsonStr[j] === '\\') { escaped = true; j++; continue; }
        if (jsonStr[j] === '"') break;
        j++;
      }
      tokens.push({ type: 'string', value: jsonStr.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (/[-\d]/.test(ch)) {
      let j = i;
      if (jsonStr[j] === '-') j++;
      while (j < jsonStr.length && /\d/.test(jsonStr[j])) j++;
      if (jsonStr[j] === '.') {
        j++;
        while (j < jsonStr.length && /\d/.test(jsonStr[j])) j++;
      }
      if (jsonStr[j] === 'e' || jsonStr[j] === 'E') {
        j++;
        if (jsonStr[j] === '+' || jsonStr[j] === '-') j++;
        while (j < jsonStr.length && /\d/.test(jsonStr[j])) j++;
      }
      tokens.push({ type: 'number', value: jsonStr.slice(i, j) });
      i = j;
      continue;
    }
    if (jsonStr.slice(i, i + 4) === 'true') { tokens.push({ type: 'true', value: 'true' }); i += 4; continue; }
    if (jsonStr.slice(i, i + 5) === 'false') { tokens.push({ type: 'false', value: 'false' }); i += 5; continue; }
    if (jsonStr.slice(i, i + 4) === 'null') { tokens.push({ type: 'null', value: 'null' }); i += 4; continue; }
    tokens.push({ type: 'char', value: ch });
    i++;
  }
  return tokens;
}

function repairJson(jsonStr) {
  // 去掉 Markdown 代码块
  jsonStr = jsonStr.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1');
  jsonStr = jsonStr.trim();

  // 提取第一个 [ ... ] 或 { ... } 结构
  const firstBracket = jsonStr.indexOf('[');
  const firstBrace = jsonStr.indexOf('{');
  let start = -1;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket <= firstBrace)) start = firstBracket;
  else if (firstBrace !== -1) start = firstBrace;

  if (start !== -1) {
    const open = jsonStr[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0, end = -1, inString = false, escapeNext = false;
    for (let i = start; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) jsonStr = jsonStr.slice(start, end + 1);
    else jsonStr = jsonStr.slice(start);
  }

  const tokens = tokenizeJson(jsonStr);
  const result = [];
  const stack = [];
  let lastNonWs = null;

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];

    if (t.type === 'ws') {
      result.push(t.value);
      continue;
    }

    // 修复缺失的逗号
    if (t.type === 'string' || t.type === '{' || t.type === '[') {
      if (lastNonWs) {
        const inObject = stack.length > 0 && stack[stack.length - 1] === '{';
        const inArray = stack.length > 0 && stack[stack.length - 1] === '[';
        const needsCommaInObject = inObject && lastNonWs.type !== '{' && lastNonWs.type !== ',' && lastNonWs.type !== ':';
        const needsCommaInArray = inArray && lastNonWs.type !== '[' && lastNonWs.type !== ',';
        if (needsCommaInObject || needsCommaInArray) {
          result.push(',');
          result.push(' ');
          lastNonWs = { type: ',', value: ',' };
        }
      }
    }

    // 修复缺失的冒号：对象中属性名后面应该是 :
    if (t.type === 'string' && stack.length > 0 && stack[stack.length - 1] === '{') {
      if (lastNonWs && (lastNonWs.type === '{' || lastNonWs.type === ',')) {
        let j = idx + 1;
        while (j < tokens.length && tokens[j].type === 'ws') j++;
        const next = tokens[j];
        if (!next || next.type !== ':') {
          result.push(t.value);
          result.push(':');
          lastNonWs = { type: ':', value: ':' };
          continue;
        }
      }
    }

    // 修复末尾多余逗号
    if ((t.type === '}' || t.type === ']') && lastNonWs && lastNonWs.type === ',') {
      while (result.length > 0 && /\s/.test(result[result.length - 1])) result.pop();
      if (result.length > 0 && result[result.length - 1] === ',') result.pop();
      lastNonWs = null;
    }

    result.push(t.value);
    lastNonWs = t;

    if (t.type === '{' || t.type === '[') stack.push(t.type);
    else if (t.type === '}' || t.type === ']') stack.pop();
  }

  // 补全未闭合的括号
  while (stack.length > 0) {
    const open = stack.pop();
    result.push(open === '{' ? '}' : ']');
  }

  return result.join('');
}

function extractJsonStr(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return trimmed;
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const start = raw.indexOf('[');
  if (start === -1) {
    const objStart = raw.indexOf('{');
    if (objStart === -1) throw new Error('未找到 JSON 数组或对象');
    return raw.slice(objStart);
  }
  let depth = 0, end = -1, inString = false, escapeNext = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) {
    const lastBrace = raw.lastIndexOf('}');
    if (lastBrace > start) return raw.slice(start, lastBrace + 1) + ']';
    throw new Error('JSON 数组括号不匹配');
  }
  return raw.slice(start, end + 1);
}

function getDepthAndStringState(jsonStr) {
  let depth = 0, inString = false, escapeNext = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return { depth, inString };
}

function findLastStringStart(jsonStr) {
  let inString = false, escapeNext = false, start = -1;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') {
      if (!inString) start = i;
      inString = !inString;
    }
  }
  return inString ? start : -1;
}

function truncateToLastValidRecord(jsonStr) {
  // 当 JSON 末尾被截断时，保留最后一个完整的对象/记录，丢弃不完整记录并关闭数组
  const candidates = [];
  let depth = 0, inString = false, escapeNext = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === '}' || ch === ']') {
      if (depth === 2 && ch === '}') candidates.push(i);
      depth--;
    }
  }
  for (let idx = candidates.length - 1; idx >= 0; idx--) {
    const end = candidates[idx] + 1;
    let candidate = jsonStr.slice(0, end).trim().replace(/,\s*$/, '') + '\n]';
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  // 没有完整对象：尝试关闭未终止的字符串和括号
  const state = getDepthAndStringState(jsonStr);
  if (state.inString) {
    const stringStart = findLastStringStart(jsonStr);
    let closePos = jsonStr.length;
    for (let i = stringStart + 1; i < jsonStr.length; i++) {
      if (jsonStr[i] === '\n' || jsonStr[i] === '\r') {
        closePos = i;
        break;
      }
    }
    let candidate = jsonStr.slice(0, closePos).trimEnd() + '"';
    const state2 = getDepthAndStringState(candidate);
    let d = state2.depth;
    const closers = [];
    while (d > 0) {
      closers.push(d === 1 ? ']' : '}');
      d--;
    }
    candidate = candidate + closers.join('');
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  return jsonStr;
}

// ─── Date normalization ───
function inferYearMonth(text) {
  if (!text) return { year: null, month: null };
  // 匹配 "2026年6月"、"2026年06月"、"6月运势" 等
  const m = text.match(/(?:(\d{4})年)?\s*(\d{1,2})月/);
  if (m) {
    const now = new Date();
    return {
      year: m[1] ? Number(m[1]) : now.getFullYear(),
      month: m[2] ? Number(m[2]) : now.getMonth() + 1,
    };
  }
  return { year: null, month: null };
}

function normalizeDate(dateStr, defaultYear, defaultMonth) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  const build = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 已经是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY-MM 或 YYYY/M → 补 01 日
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})$/);
  if (m) return build(m[1], m[2], 1);

  // 完整日期范围，两边都含年：2026-06-01~2026-06-05 / 2026.6.1 至 2026.6.5
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\s*[-~至到]\s*(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return build(m[1], m[2], m[3]);

  // 完整日期（单日期或范围起始）：2026-06-01 / 2026.6.1 / 2026/6/1
  m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return build(m[1], m[2], m[3]);

  // 月.日（单日期或范围起始）：6.13 / 6.4/6.10 / 6-1
  m = s.match(/(\d{1,2})[-\/.](\d{1,2})/);
  if (m) {
    const year = defaultYear || new Date().getFullYear();
    return build(year, m[1], m[2]);
  }

  // 中文：2025年6月5日 / 6月5日 / 6月5号（范围中只取起始日）
  m = s.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})\s*(?:日|号)?/);
  if (m) {
    const year = (m[1] ? Number(m[1]) : defaultYear) || new Date().getFullYear();
    return build(year, m[2], m[3]);
  }

  // 仅有中文"日/号"，如"6日"、"10号"（配合默认月份）
  m = s.match(/(\d{1,2})\s*(?:日|号)/);
  if (m) {
    const year = defaultYear || new Date().getFullYear();
    const month = defaultMonth || new Date().getMonth() + 1;
    return build(year, month, m[1]);
  }

  // 中文：2025年6月 / 6月（无具体日期）
  m = s.match(/(?:(\d{4})年)?\s*(\d{1,2})月/);
  if (m) {
    const year = (m[1] ? Number(m[1]) : defaultYear) || new Date().getFullYear();
    return build(year, m[2], 1);
  }

  // 纯数字 8位：20250605 → YYYY-MM-DD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  // 纯数字 6位：202506 → YYYY-MM-01
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;

  // 无法识别，原样返回（后续 filter 会处理）
  return s;
}

// Export for Node.js/Bun test environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SIGNS, AREA_COLORS, MODEL_CONTEXT_WINDOWS, RESERVE_TOKENS, CORS_PROXIES, DEFAULT_PROMPT_TEMPLATE,
    estimateTokens, getContextWindow, truncateMessages,
    tokenizeJson, repairJson, extractJsonStr,
    getDepthAndStringState, findLastStringStart, truncateToLastValidRecord,
    inferYearMonth, normalizeDate,
  };
}
