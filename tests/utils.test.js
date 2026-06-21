import { describe, it, expect } from "bun:test";
import {
  SIGNS,
  AREA_COLORS,
  MODEL_CONTEXT_WINDOWS,
  RESERVE_TOKENS,
  CORS_PROXIES,
  DEFAULT_PROMPT_TEMPLATE,
  estimateTokens,
  getContextWindow,
  truncateMessages,
  tokenizeJson,
  repairJson,
  extractJsonStr,
  getDepthAndStringState,
  findLastStringStart,
  truncateToLastValidRecord,
  inferYearMonth,
  normalizeDate,
} from "../public/utils.js";

describe("public/utils.js", () => {
  describe("Constants", () => {
    it("SIGNS should have 12 zodiac signs", () => {
      expect(SIGNS.length).toBe(12);
      expect(SIGNS[0]).toBe("白羊座");
      expect(SIGNS[11]).toBe("双鱼座");
    });

    it("AREA_COLORS should map all areas", () => {
      expect(AREA_COLORS["事业"]).toBe("area-事业");
      expect(AREA_COLORS["感情"]).toBe("area-感情");
      expect(AREA_COLORS["财运"]).toBe("area-财运");
      expect(AREA_COLORS["健康"]).toBe("area-健康");
      expect(AREA_COLORS["学业"]).toBe("area-学业");
      expect(AREA_COLORS["综合"]).toBe("area-综合");
    });

    it("MODEL_CONTEXT_WINDOWS should have known models", () => {
      expect(MODEL_CONTEXT_WINDOWS["gpt-4o"]).toBe(128000);
      expect(MODEL_CONTEXT_WINDOWS["claude-3-opus"]).toBe(200000);
      expect(MODEL_CONTEXT_WINDOWS["deepseek-chat"]).toBe(64000);
    });

    it("RESERVE_TOKENS should be 8000", () => {
      expect(RESERVE_TOKENS).toBe(8000);
    });

    it("CORS_PROXIES should have 2 proxy functions", () => {
      expect(CORS_PROXIES.length).toBe(2);
      expect(typeof CORS_PROXIES[0]).toBe("function");
      expect(CORS_PROXIES[0]("https://example.com")).toContain("corsproxy.io");
      expect(CORS_PROXIES[1]("https://example.com")).toContain("allorigins.win");
    });

    it("DEFAULT_PROMPT_TEMPLATE should contain placeholders", () => {
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("{text}");
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("{signs}");
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("JSON");
    });
  });

  describe("estimateTokens", () => {
    it("should return 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it("should count Chinese characters as 1 token each", () => {
      expect(estimateTokens("你好世界")).toBe(4);
      expect(estimateTokens("白羊座")).toBe(3);
    });

    it("should estimate English words correctly", () => {
      // "hello world" = 2 words * 1.3 = 2.6 ≈ 3
      expect(estimateTokens("hello world")).toBe(3);
    });

    it("should handle mixed Chinese and English", () => {
      // "hello" = 1 * 1.3 = 1.3 ≈ 1, "世界" = 2
      expect(estimateTokens("hello 世界")).toBe(3);
    });

    it("should count punctuation in non-Chinese text", () => {
      // "hi!" = 1 word * 1.3 + 1 punct * 0.5 = 1.8 ≈ 2
      expect(estimateTokens("hi!")).toBe(2);
    });
  });

  describe("getContextWindow", () => {
    it("should return exact match for known models", () => {
      expect(getContextWindow("gpt-4o")).toBe(128000);
      expect(getContextWindow("deepseek-chat")).toBe(64000);
    });

    it("should return prefix match for model variants", () => {
      expect(getContextWindow("gpt-4o-2024-08-06")).toBe(128000);
      expect(getContextWindow("claude-3-5-sonnet-20241022")).toBe(200000);
    });

    it("should return default 128000 for unknown models", () => {
      expect(getContextWindow("unknown-model")).toBe(128000);
      expect(getContextWindow("")).toBe(128000);
    });
  });

  describe("truncateMessages", () => {
    it("should keep all messages when under limit", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ];
      const result = truncateMessages(messages, 128000);
      expect(result.result.length).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it("should always keep system messages", () => {
      const messages = [
        { role: "system", content: "System prompt." },
        { role: "user", content: "a".repeat(100000) },
      ];
      const result = truncateMessages(messages, 10000);
      expect(result.result.some((m) => m.role === "system")).toBe(true);
    });

    it("should truncate from oldest non-system messages", () => {
      const messages = [
        { role: "system", content: "System." },
        { role: "user", content: "Hello world this is message one with many words" },
        { role: "user", content: "Another message with enough words to consume tokens" },
        { role: "user", content: "Third message also has many words in it" },
      ];
      // estimateTokens: each word ≈ 1.3 tokens
      // msg1: 9 words ≈ 12 tokens, msg2: 9 words ≈ 12 tokens, msg3: 8 words ≈ 10 tokens
      // system: 2 tokens
      // available = max(20 - 8000, 10) = 10
      // remaining = 10 - 2 = 8
      // Only msg3 (10 tokens) doesn't fit, so we keep msg2+msg3? No, msg3 alone is 10 > 8
      // Actually msg1=12, msg2=12, msg3=10. None fit in 8. So only system kept.
      const result = truncateMessages(messages, 20);
      expect(result.truncated).toBe(true);
      expect(result.result[0].role).toBe("system");
      expect(result.result.length).toBe(1);
    });

    it("should return only system messages when limit is very small", () => {
      // System message must be small enough to fit under the limit
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "Hello world this is a long message that should not fit" },
      ];
      // available = max(10 - 8000, 5) = 5
      // system tokens = 3, remaining = 2
      // user message has ~10 words * 1.3 = 13 tokens, way more than 2
      const result = truncateMessages(messages, 10);
      expect(result.result.every((m) => m.role === "system")).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it("should handle empty messages array", () => {
      const result = truncateMessages([], 128000);
      expect(result.result.length).toBe(0);
      expect(result.truncated).toBe(false);
    });

    it("should handle messages without content", () => {
      const messages = [
        { role: "system" },
        { role: "user" },
      ];
      const result = truncateMessages(messages, 128000);
      expect(result.result.length).toBe(2);
      expect(result.truncated).toBe(false);
    });
  });

  describe("tokenizeJson", () => {
    it("should tokenize empty string", () => {
      expect(tokenizeJson("")).toEqual([]);
    });

    it("should tokenize whitespace", () => {
      const tokens = tokenizeJson("  \n\t  ");
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe("ws");
    });

    it("should tokenize structural characters", () => {
      const tokens = tokenizeJson("{[]}:,");
      expect(tokens.map((t) => t.type)).toEqual(["{", "[", "]", "}", ":", ","]);
    });

    it("should tokenize strings", () => {
      const tokens = tokenizeJson('"hello"');
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe("string");
      expect(tokens[0].value).toBe('"hello"');
    });

    it("should tokenize strings with escaped quotes", () => {
      const tokens = tokenizeJson('"hello \\"world\\""');
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe("string");
      expect(tokens[0].value).toBe('"hello \\"world\\""');
    });

    it("should tokenize integers", () => {
      const tokens = tokenizeJson("42");
      expect(tokens[0].type).toBe("number");
      expect(tokens[0].value).toBe("42");
    });

    it("should tokenize negative numbers", () => {
      const tokens = tokenizeJson("-123");
      expect(tokens[0].type).toBe("number");
      expect(tokens[0].value).toBe("-123");
    });

    it("should tokenize floats", () => {
      const tokens = tokenizeJson("3.14");
      expect(tokens[0].type).toBe("number");
      expect(tokens[0].value).toBe("3.14");
    });

    it("should tokenize scientific notation", () => {
      const tokens = tokenizeJson("1.23e-4");
      expect(tokens[0].type).toBe("number");
      expect(tokens[0].value).toBe("1.23e-4");
    });

    it("should tokenize booleans and null", () => {
      const tokens = tokenizeJson("true false null");
      expect(tokens.filter((t) => t.type === "ws").length).toBe(2);
      expect(tokens.some((t) => t.type === "true")).toBe(true);
      expect(tokens.some((t) => t.type === "false")).toBe(true);
      expect(tokens.some((t) => t.type === "null")).toBe(true);
    });

    it("should tokenize unknown characters", () => {
      const tokens = tokenizeJson("@#$");
      expect(tokens.every((t) => t.type === "char")).toBe(true);
    });

    it("should tokenize complex JSON", () => {
      const tokens = tokenizeJson('{"key": "value", "num": 42}');
      const types = tokens.map((t) => t.type);
      expect(types).toContain("{");
      expect(types).toContain("}");
      expect(types).toContain(":");
      expect(types).toContain(",");
      expect(types).toContain("string");
      expect(types).toContain("number");
    });
  });

  describe("repairJson", () => {
    it("should return valid JSON unchanged", () => {
      const valid = '[{"a": 1, "b": 2}]';
      expect(repairJson(valid)).toBe(valid);
    });

    it("should strip markdown code blocks", () => {
      const md = '```json\n[{"a": 1}]\n```';
      expect(repairJson(md)).toBe('[{"a": 1}]');
    });

    it("should fix missing comma between objects", () => {
      const broken = '[{"a": 1}{"b": 2}]';
      const fixed = repairJson(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should fix missing colon after property name", () => {
      const broken = '[{"a" 1}]';
      const fixed = repairJson(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should fix trailing comma", () => {
      const broken = '[{"a": 1,}]';
      const fixed = repairJson(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should close unclosed brackets", () => {
      const broken = '[{"a": 1';
      const fixed = repairJson(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should handle empty string", () => {
      expect(repairJson("")).toBe("");
    });

    it("should extract JSON from surrounding text", () => {
      const mixed = 'Here is the JSON: [{"a": 1}] and more text';
      const fixed = repairJson(mixed);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should fix multiple errors in one JSON", () => {
      const broken = '[{"a" 1}{"b" 2}]';
      const fixed = repairJson(broken);
      const parsed = JSON.parse(fixed);
      expect(parsed.length).toBe(2);
    });
  });

  describe("extractJsonStr", () => {
    it("should return JSON starting with [ directly", () => {
      const json = '[{"a": 1}]';
      expect(extractJsonStr(json)).toBe(json);
    });

    it("should return JSON starting with { directly", () => {
      const json = '{"a": 1}';
      expect(extractJsonStr(json)).toBe(json);
    });

    it("should extract from markdown code block", () => {
      const md = 'Some text\n```json\n[{"a": 1}]\n```\nMore text';
      expect(extractJsonStr(md)).toBe('[{"a": 1}]');
    });

    it("should extract array from mixed text", () => {
      const mixed = 'Result: [{"a": 1}] done';
      expect(extractJsonStr(mixed)).toBe('[{"a": 1}]');
    });

    it("should extract object when no array found", () => {
      const mixed = 'Result: {"a": 1}';
      expect(extractJsonStr(mixed)).toBe('{"a": 1}');
    });

    it("should throw when no JSON found", () => {
      expect(() => extractJsonStr("no json here")).toThrow();
    });

    it("should handle unclosed array by adding closing bracket", () => {
      const broken = 'Start [{"a": 1}';
      expect(extractJsonStr(broken)).toBe('[{"a": 1}]');
    });

    it("should throw when brackets are mismatched and no closing brace found", () => {
      const broken = 'Start [{"a": 1';
      expect(() => extractJsonStr(broken)).toThrow();
    });
  });

  describe("getDepthAndStringState", () => {
    it("should return zero depth for balanced JSON", () => {
      const state = getDepthAndStringState('[{"a": 1}]');
      expect(state.depth).toBe(0);
      expect(state.inString).toBe(false);
    });

    it("should detect unclosed string", () => {
      const state = getDepthAndStringState('[{"a": "hello}]');
      expect(state.inString).toBe(true);
    });

    it("should detect unclosed brackets", () => {
      const state = getDepthAndStringState('[{"a": 1');
      expect(state.depth).toBe(2);
      expect(state.inString).toBe(false);
    });

    it("should handle escaped quotes correctly", () => {
      const state = getDepthAndStringState('[{"a": "hello \\"world\\""}]');
      expect(state.depth).toBe(0);
      expect(state.inString).toBe(false);
    });
  });

  describe("findLastStringStart", () => {
    it("should return -1 for properly closed strings", () => {
      expect(findLastStringStart('[{"a": "hello"}]')).toBe(-1);
    });

    it("should find start of unclosed string", () => {
      const json = '[{"a": "hello';
      const start = findLastStringStart(json);
      expect(start).toBeGreaterThan(0);
      expect(json[start]).toBe('"');
    });

    it("should handle empty string", () => {
      expect(findLastStringStart("")).toBe(-1);
    });
  });

  describe("truncateToLastValidRecord", () => {
    it("should return valid JSON with normalized ending", () => {
      const valid = '[{"a": 1}, {"b": 2}]';
      const result = truncateToLastValidRecord(valid);
      // Function may normalize whitespace at end
      expect(() => JSON.parse(result)).not.toThrow();
      const parsed = JSON.parse(result);
      expect(parsed.length).toBe(2);
    });

    it("should truncate to last complete object", () => {
      const broken = '[{"a": 1}, {"b": 2}, {"c":';
      const fixed = truncateToLastValidRecord(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
      const parsed = JSON.parse(fixed);
      expect(parsed.length).toBe(2);
    });

    it("should close unclosed string and brackets", () => {
      const broken = '[{"a": "hello';
      const fixed = truncateToLastValidRecord(broken);
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should handle unclosed string with newline", () => {
      // Tests the fallback path where string is unclosed and we find newline to truncate
      const broken = '[{"a": "hello\nmore text';
      const fixed = truncateToLastValidRecord(broken);
      // Should close the string and brackets, producing valid JSON
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should handle unclosed string without newline", () => {
      // Tests line 349: when there's no newline in the unclosed string,
      // closePos stays at jsonStr.length and we append closing quote
      const broken = '[{"a": "hello';
      const fixed = truncateToLastValidRecord(broken);
      // Should produce something parseable (even if empty-ish)
      expect(() => JSON.parse(fixed)).not.toThrow();
    });

    it("should return original when string fix also fails", () => {
      // Tests line 349 (catch {}): when even the string-closing fallback can't produce valid JSON
      // Input: unclosed string containing a null byte (control character) — JSON strings cannot contain unescaped control characters
      const broken = '[{"a": "\x00';
      const fixed = truncateToLastValidRecord(broken);
      // When no fix works, it returns the original broken string
      expect(fixed).toBe(broken);
      expect(() => JSON.parse(fixed)).toThrow();
    });

    it("should return original if no fix possible", () => {
      const broken = "not json";
      expect(truncateToLastValidRecord(broken)).toBe(broken);
    });
  });

  describe("inferYearMonth", () => {
    it("should extract year and month from text", () => {
      const result = inferYearMonth("2026年6月运势");
      expect(result.year).toBe(2026);
      expect(result.month).toBe(6);
    });

    it("should use current year when only month is given", () => {
      const result = inferYearMonth("6月运势");
      expect(result.year).toBe(new Date().getFullYear());
      expect(result.month).toBe(6);
    });

    it("should return nulls when no match", () => {
      const result = inferYearMonth("some random text");
      expect(result.year).toBeNull();
      expect(result.month).toBeNull();
    });

    it("should handle empty text", () => {
      const result = inferYearMonth("");
      expect(result.year).toBeNull();
      expect(result.month).toBeNull();
    });

    it("should handle null/undefined", () => {
      expect(inferYearMonth(null)).toEqual({ year: null, month: null });
      expect(inferYearMonth(undefined)).toEqual({ year: null, month: null });
    });
  });

  describe("normalizeDate", () => {
    it("should return YYYY-MM-DD as-is", () => {
      expect(normalizeDate("2025-06-18")).toBe("2025-06-18");
    });

    it("should convert YYYY-MM to YYYY-MM-01", () => {
      expect(normalizeDate("2025-06")).toBe("2025-06-01");
      expect(normalizeDate("2025/6")).toBe("2025-06-01");
    });

    it("should parse full date range and return start date", () => {
      expect(normalizeDate("2025-06-01~2025-06-05")).toBe("2025-06-01");
      expect(normalizeDate("2025.6.1 至 2025.6.5")).toBe("2025-06-01");
    });

    it("should parse full date", () => {
      expect(normalizeDate("2025-06-01")).toBe("2025-06-01");
      expect(normalizeDate("2025.6.1")).toBe("2025-06-01");
      expect(normalizeDate("2025/6/1")).toBe("2025-06-01");
    });

    it("should parse month.day format", () => {
      const year = new Date().getFullYear();
      expect(normalizeDate("6.18")).toBe(`${year}-06-18`);
      expect(normalizeDate("6-18")).toBe(`${year}-06-18`);
    });

    it("should parse Chinese date format", () => {
      expect(normalizeDate("2025年6月18日")).toBe("2025-06-18");
      expect(normalizeDate("6月18日")).toBe(`${new Date().getFullYear()}-06-18`);
      expect(normalizeDate("6月18号")).toBe(`${new Date().getFullYear()}-06-18`);
    });

    it("should parse Chinese day only with defaults", () => {
      const year = new Date().getFullYear();
      expect(normalizeDate("18日", 2025, 6)).toBe("2025-06-18");
      expect(normalizeDate("18号", 2025, 6)).toBe("2025-06-18");
    });

    it("should parse Chinese month only", () => {
      expect(normalizeDate("2025年6月")).toBe("2025-06-01");
      expect(normalizeDate("6月")).toBe(`${new Date().getFullYear()}-06-01`);
    });

    it("should parse 8-digit number", () => {
      expect(normalizeDate("20250618")).toBe("2025-06-18");
    });

    it("should parse 6-digit number", () => {
      expect(normalizeDate("202506")).toBe("2025-06-01");
    });

    it("should return original for unrecognized format", () => {
      expect(normalizeDate("random")).toBe("random");
    });

    it("should return empty string for empty input", () => {
      expect(normalizeDate("")).toBe("");
      expect(normalizeDate(null)).toBe("");
      expect(normalizeDate(undefined)).toBe("");
    });

    it("should use defaultYear and defaultMonth", () => {
      expect(normalizeDate("6.18", 2025, 3)).toBe("2025-06-18");
      expect(normalizeDate("18日", 2025, 3)).toBe("2025-03-18");
    });
  });
});
