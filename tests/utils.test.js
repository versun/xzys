import { describe, it, expect } from "bun:test";
import {
  SIGNS,
  DEFAULT_PROMPT_TEMPLATE,
  repairJson,
  extractJsonStr,
  inferYearMonth,
  normalizeDate,
} from "../public/utils.js";

describe("public/utils.js", () => {
  describe("SIGNS", () => {
    it("has 12 zodiac signs", () => {
      expect(SIGNS.length).toBe(12);
      expect(SIGNS[0]).toBe("白羊座");
      expect(SIGNS[11]).toBe("双鱼座");
    });
  });

  describe("DEFAULT_PROMPT_TEMPLATE", () => {
    it("contains placeholders", () => {
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("{text}");
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("{signs}");
      expect(DEFAULT_PROMPT_TEMPLATE).toContain("JSON");
    });
  });

  describe("extractJsonStr", () => {
    it("returns JSON starting with [ directly", () => {
      const json = '[{"a": 1}]';
      expect(extractJsonStr(json)).toBe(json);
    });

    it("extracts from markdown code block", () => {
      const md = 'text\n```json\n[{"a": 1}]\n```\nmore';
      expect(extractJsonStr(md)).toBe('[{"a": 1}]');
    });

    it("extracts array from mixed text", () => {
      const mixed = 'Result: [{"a": 1}] done';
      expect(extractJsonStr(mixed)).toBe('[{"a": 1}]');
    });

    it("throws when no JSON found", () => {
      expect(() => extractJsonStr("no json")).toThrow();
    });
  });

  describe("repairJson", () => {
    it("returns valid JSON unchanged", () => {
      const valid = '[{"a": 1, "b": 2}]';
      expect(() => JSON.parse(repairJson(valid))).not.toThrow();
    });

    it("strips markdown code blocks", () => {
      const md = '```json\n[{"a": 1}]\n```';
      expect(JSON.parse(repairJson(md))).toEqual([{ a: 1 }]);
    });

    it("fixes missing comma between objects", () => {
      const broken = '[{"a": 1}{"b": 2}]';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed.length).toBe(2);
    });

    it("fixes trailing comma", () => {
      const broken = '[{"a": 1,}]';
      expect(() => JSON.parse(repairJson(broken))).not.toThrow();
    });

    it("closes unclosed brackets", () => {
      const broken = '[{"a": 1';
      expect(() => JSON.parse(repairJson(broken))).not.toThrow();
    });

    it("fixes missing colon after property name", () => {
      const broken = '[{"a" 1}]';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].a).toBe(1);
    });

    it("fixes missing colon with string value", () => {
      const broken = '[{"a" "b"}]';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].a).toBe("b");
    });

    it("closes truncated string inside object", () => {
      const broken = '[{"a": "unclosed value';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].a).toBe("unclosed value");
    });

    it("closes truncated string with trailing backslash", () => {
      const broken = '[{"a": "value with backslash\\';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].a).toBe("value with backslash");
    });

    it("fixes unquoted Chinese string value", () => {
      const broken = '[{"date":"2026-06-22","detail":金星土星互动带来改变}]';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].detail).toBe("金星土星互动带来改变");
    });

    it("fixes unquoted value with missing colon", () => {
      const broken = '[{"detail" 金星土星互动带来改变}]';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].detail).toBe("金星土星互动带来改变");
    });

    it("repairs truncated nested array with open string", () => {
      const broken = '[{"a": [1, 2, "three';
      const parsed = JSON.parse(repairJson(broken));
      expect(parsed[0].a).toEqual([1, 2, "three"]);
    });
  });

  describe("inferYearMonth", () => {
    it("extracts year and month", () => {
      const result = inferYearMonth("2026年6月运势");
      expect(result.year).toBe(2026);
      expect(result.month).toBe(6);
    });

    it("uses current year when only month given", () => {
      const result = inferYearMonth("6月运势");
      expect(result.year).toBe(new Date().getFullYear());
      expect(result.month).toBe(6);
    });

    it("returns nulls when no match", () => {
      expect(inferYearMonth("random")).toEqual({ year: null, month: null });
    });
  });

  describe("normalizeDate", () => {
    it("returns YYYY-MM-DD as-is", () => {
      expect(normalizeDate("2025-06-18")).toBe("2025-06-18");
    });

    it("parses Chinese date", () => {
      expect(normalizeDate("2025年6月18日")).toBe("2025-06-18");
      expect(normalizeDate("6月18日")).toBe(`${new Date().getFullYear()}-06-18`);
    });

    it("parses month.day format", () => {
      const year = new Date().getFullYear();
      expect(normalizeDate("6.18")).toBe(`${year}-06-18`);
    });

    it("parses 8-digit number", () => {
      expect(normalizeDate("20250618")).toBe("2025-06-18");
    });

    it("returns empty for empty input", () => {
      expect(normalizeDate("")).toBe("");
    });
  });
});
