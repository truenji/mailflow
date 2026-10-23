// The correspondence modal is the only path that parks a message outside the
// current folder in the reader. These tests pin the dialog contract, the rows the
// user sees, and the __dl_ parking that makes the reading pane show the clicked row.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) {
      return { format: 'module', shortCircuit: true, source: [
        'export const useTranslation = () => ({ t: (k, o) => (o ? k + " " + JSON.stringify(o) : k), i18n: { language: "en", changeLanguage: () => {} } });',
        'export const initReactI18next = { type: "3rdParty", init: () => {} };',
        'export const Trans = ({ children }) => children ?? null;',
        'export const I18nextProvider = ({ children }) => children ?? null;',
        'export default { useTranslation, initReactI18next };',
      ].join('\n') };
    }
    if (url.endsWith('.json')) {
      return { format: 'module', shortCircuit: true, source: `export default ${readFileSync(new URL(url), 'utf8')}` };
    }
    const shimViteEnv = (code) => code.replaceAll('import.meta.env', 'globalThis.__VITE_ENV__');
    if (url.endsWith('.jsx')) {
      const out = transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url });
      return { format: 'module', shortCircuit: true, source: shimViteEnv(out.code) };
    }
    if (url.startsWith('file:') && url.endsWith('.js')) {
      const code = readFileSync(new URL(url), 'utf8');
      if (code.includes('import.meta.env')) return { format: 'module', shortCircuit: true, source: shimViteEnv(code) };
    }
    return nextLoad(url, context);
  },
});

const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example.invalid', pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  CustomEvent: dom.window.CustomEvent, Node: dom.window.Node, Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement, getComputedStyle: dom.window.getComputedStyle,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.__VITE_ENV__ = { MODE: 'test', DEV: false, PROD: true };

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { useStore } = await import('../store/index.js');
const CorrespondenceModal = (await import('./CorrespondenceModal.jsx')).default;

const PAYLOAD = {
  address: 'client@example.com',
  name: 'Client',
  total: 2,
  truncated: false,
  messages: [
    {
      id: 'm1', from_email: 'client@example.com', direction: 'in', subject: 'Hello',
      is_read: true, account_id: 'a1', account_name: 'Me', account_color: '#ff0000',
      date: '2026-01-02T10:00:00.000Z', snippet: 'Earlier note',
    },
    {
      id: 'm2', from_email: 'sales@example.com', direction: 'out', subject: 'Re: Hello',
      is_read: false, account_id: 'a1', account_name: 'Me', account_color: '#ff0000',
      date: '2026-01-03T10:00:00.000Z', snippet: 'Reply',
    },
  ],
};

let fetchCalls;

function stubFetch(payload = PAYLOAD) {
  fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    if (String(url).endsWith('/correspondence')) {
      return { ok: true, status: 200, json: async () => payload };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

describe('CorrespondenceModal', () => {
  let container;
  let root;
  let closed;

  beforeEach(async () => {
    stubFetch();
    closed = 0;
    useStore.setState({
      accounts: [{ id: 'a1', email_address: 'me@example.com', name: 'Me', color: '#ff0000' }],
      messages: [],
      threadMessages: {},
      selectedMessageId: null,
      markReadBehavior: 'manual',
      unreadCounts: {},
      categoryCounts: {},
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    container.remove();
  });

  async function render(props = {}) {
    await React.act(async () => root.render(React.createElement(CorrespondenceModal, {
      messageId: 'm1', onClose: () => { closed += 1; }, ...props,
    })));
    // Let the getCorrespondence promise settle inside act.
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }

  function dialog() {
    return container.querySelector('[role="dialog"]');
  }

  function row(subject) {
    return [...dialog().querySelectorAll('button')].find(b => b.textContent.includes(subject));
  }

  test('renders a labelled dialog with the exchange and directions', async () => {
    await render();

    const el = dialog();
    assert.ok(el, 'dialog exists');
    assert.equal(el.getAttribute('aria-modal'), 'true');
    assert.match(el.textContent, /correspondence\.title .*client@example\.com/);
    assert.match(el.textContent, /correspondence\.incoming/);
    assert.match(el.textContent, /correspondence\.outgoing/);
    assert.match(el.textContent, /Hello/);
    assert.match(el.textContent, /Re: Hello/);
    assert.equal(fetchCalls[0].url, '/api/mail/messages/m1/correspondence');
  });

  test('clicking a row parks it for the reader and closes the dialog', async () => {
    await render();

    await React.act(async () => {
      row('Hello').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });

    const state = useStore.getState();
    assert.equal(state.threadMessages.__dl_m1?.[0]?.subject, 'Hello');
    assert.equal(state.selectedMessageId, 'm1');
    assert.equal(closed, 1);
  });

  test('Escape closes the dialog', async () => {
    await render();

    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    assert.equal(closed, 1);
  });

  test('shows the no-address state for a note to self', async () => {
    stubFetch({ address: null, name: '', total: 0, truncated: false, messages: [] });
    await render();

    assert.match(dialog().textContent, /correspondence\.noAddress/);
  });

  test('shows the error state without leaking the server message', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    await render();

    assert.match(dialog().textContent, /correspondence\.error/);
    assert.doesNotMatch(dialog().textContent, /boom/);
  });
});
