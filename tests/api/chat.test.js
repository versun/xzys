import { describe, it, expect, jest } from "bun:test";

// ─── Helpers to simulate Cloudflare Pages Function context ───

function createRequest(body, opts = {}) {
  const init = {
    method: opts.method || "POST",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request("https://example.com/api/chat", init);
}

function createEnv(aiMock = {}) {
  return { AI: aiMock };
}

function createContext(request, env = {}) {
  return { request, env };
}

// ─── Import the module under test ───

import {
  onRequestPost,
  onRequestOptions,
} from "../../functions/api/chat.js";

describe("functions/api/chat.js", () => {
  describe("onRequestOptions", () => {
    it("should return CORS headers for OPTIONS", async () => {
      const resp = await onRequestOptions();
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(resp.headers.get("Access-Control-Allow-Methods")).toBe(
        "POST, OPTIONS"
      );
      expect(resp.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type"
      );
    });
  });

  describe("onRequestPost - input validation", () => {
    it("should return 500 when AI binding is missing", async () => {
      const req = createRequest({ messages: [{ role: "user", content: "hi" }] });
      const ctx = createContext(req, {});
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const data = await resp.json();
      expect(data.error).toContain("绑定未配置");
    });

    it("should return 400 when body is not valid JSON", async () => {
      const req = new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not json",
      });
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("JSON");
    });

    it("should return 400 when messages is missing", async () => {
      const req = createRequest({});
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("messages");
    });

    it("should return 400 when messages is empty array", async () => {
      const req = createRequest({ messages: [] });
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("messages");
    });

    it("should return 400 when messages is not an array", async () => {
      const req = createRequest({ messages: "hello" });
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("messages");
    });

    it("should return 413 when body exceeds max size", async () => {
      const hugeBody = "x".repeat(3 * 1024 * 1024); // 3MB
      const req = new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: hugeBody }] }),
      });
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(413);
      const data = await resp.json();
      expect(data.error).toContain("超过最大限制");
    });
  });

  describe("onRequestPost - non-streaming", () => {
    it("should return JSON response when stream=false", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "Hello from AI",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.choices[0].message.content).toBe("Hello from AI");
      expect(data.choices[0].message.role).toBe("assistant");
    });

    it("should use default model when invalid model provided", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          choices: [{ message: { content: "OK" } }],
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        model: "invalid-model",
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      // Should call with default model
      expect(aiMock.run.mock.calls[0][0]).toBe("@cf/zai-org/glm-4.7-flash");
    });

    it("should use provided @cf/ model", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        model: "@cf/meta/llama-3.3-70b",
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][0]).toBe("@cf/meta/llama-3.3-70b");
    });

    it("should cap max_tokens at 65536", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        max_tokens: 100000,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].max_tokens).toBe(65536);
    });

    it("should use default max_tokens 8192 when not provided", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].max_tokens).toBe(8192);
    });

    it("should use default temperature 0.3 when not provided", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].temperature).toBe(0.3);
    });

    it("should use provided temperature", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        temperature: 0.7,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].temperature).toBe(0.7);
    });

    it("should add enable_thinking for glm-4.7 when enableThinking=true", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        model: "@cf/zai-org/glm-4.7-flash",
        enableThinking: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].chat_template_kwargs).toEqual({
        enable_thinking: true,
      });
      expect(aiMock.run.mock.calls[0][1].reasoning_effort).toBeUndefined();
    });

    it("should add reasoning_effort low for glm-4.7 when enableThinking=false", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        model: "@cf/zai-org/glm-4.7-flash",
        enableThinking: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(aiMock.run.mock.calls[0][1].chat_template_kwargs).toEqual({
        enable_thinking: false,
      });
      expect(aiMock.run.mock.calls[0][1].reasoning_effort).toBe("low");
    });

    it("should not add chat_template_kwargs for non-glm models", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        model: "@cf/meta/llama-3.3-70b",
        enableThinking: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      await onRequestPost(ctx);
      expect(
        aiMock.run.mock.calls[0][1].chat_template_kwargs
      ).toBeUndefined();
      expect(aiMock.run.mock.calls[0][1].reasoning_effort).toBeUndefined();
    });

    it("should handle AI response with choices format", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          choices: [{ message: { role: "assistant", content: "Choice content" } }],
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const data = await resp.json();
      expect(data.choices[0].message.content).toBe("Choice content");
    });

    it("should handle empty AI response gracefully", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({}),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const data = await resp.json();
      expect(data.choices[0].message.content).toBe("");
    });

    it("should return 400 for model not found error", async () => {
      const aiMock = {
        run: jest.fn().mockRejectedValue(new Error("model not found")),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("模型不可用");
    });

    it("should return 400 for model not supported error", async () => {
      const aiMock = {
        run: jest.fn().mockRejectedValue(new Error("model not supported")),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data.error).toContain("模型不可用");
    });

    it("should return 500 for generic AI error", async () => {
      const aiMock = {
        run: jest.fn().mockRejectedValue(new Error("network timeout")),
      };
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(500);
      const data = await resp.json();
      expect(data.error).toContain("AI 调用失败");
    });
  });

  describe("onRequestPost - streaming", () => {
    it("should return SSE stream when stream=true", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ response: "Hello" })}\n\n`
            )
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ response: " world" })}\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("text/event-stream");

      // Read the stream and verify it contains OpenAI-compatible chunks
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain('"delta"');
      expect(result).toContain("[DONE]");
    });

    it("should handle OpenAI-compatible stream format", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "Hello" } }],
              })}\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain("Hello");
      expect(result).toContain("[DONE]");
    });

    it("should handle stream with message.content format", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                choices: [{ message: { content: "Full message" } }],
              })}\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain("Full message");
    });

    it("should handle [DONE] markers in stream", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ response: "test" })}\n\ndata: [DONE]\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      // [DONE] from input should be skipped, only our final [DONE] should remain
      const doneCount = (result.match(/\[DONE\]/g) || []).length;
      expect(doneCount).toBe(1);
    });

    it("should handle malformed stream chunks gracefully", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: not valid json\n\ndata: ${JSON.stringify({
                response: "valid",
              })}\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain("valid");
      expect(result).toContain("[DONE]");
    });

    it("should handle stream errors gracefully", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.error(new Error("Stream broken"));
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      // Should still return a response, but stream will contain error
      expect(resp.status).toBe(200);
    });
  });

  describe("onRequestPost - request body size limit", () => {
    it("should accept body at exactly the limit size boundary", async () => {
      // Create a body that's just under 2MB
      const content = "x".repeat(100);
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      const req = createRequest({
        messages: [{ role: "user", content }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
    });

    it("should handle request without Content-Length header", async () => {
      const aiMock = {
        run: jest.fn().mockResolvedValue({
          response: "OK",
        }),
      };
      // Use createRequest which sets content-type but NOT content-length
      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
    });
  });

  describe("onRequestPost - streaming with message.content format", () => {
    it("should handle message.content format in stream", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({
                choices: [{ message: { content: "Full message" } }],
              })}\n\n`
            )
          );
          controller.close();
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain("Full message");
    });

    it("should propagate stream errors to client", async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.error(new Error("Stream processing failed"));
        },
      });

      const aiMock = {
        run: jest.fn().mockResolvedValue(mockStream),
      };

      const req = createRequest({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });
      const ctx = createContext(req, createEnv(aiMock));
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(200);
      
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value);
      }
      expect(result).toContain("error");
    });
  });

  describe("onRequestPost - body size edge cases", () => {
    it("should reject body with oversized Content-Length", async () => {
      const hugeBody = "x".repeat(3 * 1024 * 1024);
      const req = new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          "content-length": String(hugeBody.length + 100),
        },
        body: JSON.stringify({ messages: [{ role: "user", content: hugeBody }] }),
      });
      const ctx = createContext(req, createEnv());
      const resp = await onRequestPost(ctx);
      expect(resp.status).toBe(413);
    });
  });
});
