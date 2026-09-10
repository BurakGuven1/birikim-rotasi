import { describe, expect, it } from 'vitest';
import { assertLocalRequest, authorize } from './auth';
import { BotStore } from './store';

describe('local bot control boundary', () => {
  it('uses the browser Host when Next reconstructs its internal URL with another hostname', () => {
    const request = new Request('http://127.0.0.1:3000/api/bot/session', { method: 'POST', headers: { host: 'localhost:3000', 'x-forwarded-host': 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' } });
    expect(() => assertLocalRequest(request, true)).not.toThrow();
  });
  it('rejects cross-origin commands and non-loopback hosts', () => {
    expect(() => assertLocalRequest(new Request('http://localhost:3000/api/bot/command', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' } }), true)).toThrow();
    expect(() => assertLocalRequest(new Request('https://example.com/api/bot/status'), false)).toThrow();
    expect(() => assertLocalRequest(new Request('http://localhost:3000/api/bot/session', { method: 'POST' }), true)).toThrow();
  });
  it('requires a valid server-issued cookie even on localhost', () => {
    const store = new BotStore(':memory:');
    try {
      expect(() => authorize(new Request('http://localhost:3000/api/bot/status'), store)).toThrow();
      const token = store.createSession();
      expect(() => authorize(new Request('http://localhost:3000/api/bot/command', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', cookie: `bot_session=${token}` } }), store)).not.toThrow();
    } finally { store.close(); }
  });
});
