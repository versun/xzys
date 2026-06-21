// Test setup: mock browser globals for Node.js/Bun test environment
// This file is preloaded before all tests via bunfig.toml

global.document = {
  createElement: (tag) => ({
    tagName: tag,
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    },
    appendChild: () => {},
    remove: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    click: () => {},
    focus: () => {},
    blur: () => {},
    // For textarea innerHTML decode
    value: '',
  }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: {
    appendChild: () => {},
    removeChild: () => {},
    innerHTML: '',
    textContent: '',
  },
  title: '',
  addEventListener: () => {},
  removeEventListener: () => {},
  createTextNode: (text) => ({ textContent: text }),
};

global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  },
  location: { href: 'https://example.com/' },
  DOMParser: class DOMParser {
    parseFromString(html, type) {
      return {
        body: {
          innerText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          textContent: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        },
        documentElement: {
          innerText: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          textContent: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        },
        querySelectorAll: () => [],
      };
    }
  },
  URL: global.URL,
  Blob: global.Blob,
  navigator: {
    clipboard: {
      writeText: () => Promise.resolve(),
    },
  },
};

global.localStorage = global.window.localStorage;
global.DOMParser = global.window.DOMParser;
global.navigator = global.window.navigator;

// AbortSignal.timeout polyfill for Bun < 1.1
if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = (ms) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  };
}

// Mock fetch for tests that need it
global.fetch = global.fetch || (() => Promise.resolve(new Response('{}', { status: 200 })));
