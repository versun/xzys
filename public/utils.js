// ─── Shared pure utilities for horoscope-calendar ───
// These functions are used by both the frontend (index.html) and test suite.

// ─── Constants ───
const SIGNS = ['白羊座','金牛座','双子座','巨蟹座','狮子座','处女座','天秤座','天蝎座','射手座','摩羯座','水瓶座','双鱼座'];

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

// ─── JSON repair for LLM output ───
function extractJsonStr(raw) {
  const code = raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, '$1').trim();
  const firstArr = code.indexOf('[');
  const firstObj = code.indexOf('{');
  const first = Math.min(firstArr >= 0 ? firstArr : Infinity, firstObj >= 0 ? firstObj : Infinity);
  if (!isFinite(first)) throw new Error('未找到 JSON 数组或对象');

  const open = code[first];
  const close = open === '[' ? ']' : '}';
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = first; i < code.length; i++) {
    const c = code[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  return end === -1 ? code.slice(first) : code.slice(first, end + 1);
}

function repairJson(raw) {
  let s = extractJsonStr(raw);
  let out = '', last = '', stack = [];
  let inStr = false, esc = false, needColon = false, isKeyString = false;
  let expectValue = false, inUnquoted = false;
  const isValueStart = (c) => c === '"' || c === '{' || c === '[' || /[\d\-]/.test(c) || c === 't' || c === 'f' || c === 'n';

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (inUnquoted) {
      if (c === ',' || c === '}' || c === ']' || c === '\n' || c === '\r') {
        out += '"';
        inUnquoted = false;
      } else {
        out += c === '"' ? '\\"' : c;
        continue;
      }
    }

    if (esc) { esc = false; out += c; last = c; continue; }
    if (c === '\\') { esc = true; out += c; last = c; continue; }

    if (needColon) {
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
        out += c;
        continue;
      }
      if (c === ':') {
        needColon = false;
      } else if (c === '}') {
        out += ':null';
        needColon = false;
      } else {
        out += ':';
        needColon = false;
        expectValue = true;
      }
    }

    if (c === '"') {
      expectValue = false;
      if (inStr) {
        if (isKeyString) needColon = true;
        isKeyString = false;
      } else {
        isKeyString = stack.length > 0 && stack[stack.length - 1] === '{' && (last === '{' || last === ',');
      }
      inStr = !inStr;
      out += c;
      last = c;
      continue;
    }

    if (inStr) { out += c; last = c; continue; }

    if (expectValue) {
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
        out += c;
        continue;
      }
      if (c === '}' || c === ']') {
        out += 'null';
        expectValue = false;
      } else if (!isValueStart(c)) {
        out += '"';
        out += c;
        inUnquoted = true;
        expectValue = false;
        continue;
      } else {
        expectValue = false;
      }
    }

    if (c === '{' || c === '[') {
      if (last === '}' || last === ']') out += ',';
      stack.push(c);
      if (c === '[') expectValue = true;
    } else if (c === '}' || c === ']') {
      while (out.endsWith(' ') || out.endsWith(',')) {
        if (out.endsWith(',')) { out = out.slice(0, -1); break; }
        out = out.slice(0, -1);
      }
      stack.pop();
    } else if (c === ':') {
      expectValue = true;
    } else if (c === ',' && stack.length > 0 && stack[stack.length - 1] === '[') {
      expectValue = true;
    }
    out += c;
    if (c !== ' ' && c !== '\n' && c !== '\t' && c !== '\r') last = c;
  }

  if (esc) out = out.slice(0, -1);
  if (inStr) {
    out += '"';
    if (isKeyString) needColon = true;
  }
  if (inUnquoted) out += '"';
  if (needColon) out += ':null';
  while (stack.length) out += stack.pop() === '{' ? '}' : ']';
  return out;
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
    SIGNS, DEFAULT_PROMPT_TEMPLATE,
    repairJson, extractJsonStr,
    inferYearMonth, normalizeDate,
  };
}
