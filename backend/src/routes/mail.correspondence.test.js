import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/db.js', () => ({ query: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.session = { userId: 'user-1' }; next(); },
}));
vi.mock('../index.js', () => ({ imapManager: {} }));

import express from 'express';
import mailRoutes from './mail.js';
import { query } from '../services/db.js';

const MSG_ID = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
const ACCOUNT_ID = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const MESSAGE_SQL = /FROM messages m\s+JOIN email_accounts a ON m\.account_id = a\.id\s+WHERE m\.id = \$1/;
const ACCOUNTS_SQL = /FROM email_accounts a\s+WHERE a.user_id = \$1/;
const CORRESPONDENCE_SQL = /WITH deduped AS/;

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/mail', mailRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  query.mockReset();
});

function messageRow(overrides = {}) {
  return {
    id: MSG_ID,
    from_name: 'Client',
    from_email: 'client@example.com',
    to_addresses: [{ email: 'me@example.com' }],
    cc_addresses: [],
    bcc_addresses: [],
    ...overrides,
  };
}

// Routes each query to the fake table it selects from; the correspondence query itself
// is what the assertions below inspect.
function mockTables({ message = messageRow(), accounts = [{ id: ACCOUNT_ID, email_address: 'me@example.com', enabled: true, alias_emails: [] }], correspondence = [] } = {}) {
  query.mockImplementation(async (sql) => {
    if (MESSAGE_SQL.test(sql)) return { rows: message ? [message] : [] };
    if (ACCOUNTS_SQL.test(sql)) return { rows: accounts };
    if (CORRESPONDENCE_SQL.test(sql)) return { rows: correspondence };
    return { rows: [] };
  });
}

describe('GET /mail/messages/:id/correspondence', () => {
  it('rejects an id that is not a UUID before touching the database', async () => {
    const response = await fetch(`${baseUrl}/mail/messages/not-a-uuid/correspondence`);
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('404s when the message is not the user\'s', async () => {
    mockTables({ message: null });
    const response = await fetch(`${baseUrl}/mail/messages/${MSG_ID}/correspondence`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Message not found' });
  });

  it('returns an empty view for a note to self, without querying the history', async () => {
    mockTables({ message: messageRow({ from_email: 'me@example.com' }) });
    const response = await fetch(`${baseUrl}/mail/messages/${MSG_ID}/correspondence`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address: null, name: '', messages: [], total: 0, truncated: false });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns the exchange with directions, total and the truncation flag', async () => {
    mockTables({
      accounts: [
        { id: ACCOUNT_ID, email_address: 'me@example.com', enabled: true, alias_emails: ['sales@example.com'] },
        { id: 'a2a2a2a2-2222-4222-8222-a2a2a2a2a2a2', email_address: 'disabled@example.com', enabled: false, alias_emails: [] },
      ],
      correspondence: [
        { id: 'm2', from_email: 'client@example.com', incoming: false, total: 3, subject: 'Re: Order' },
        { id: 'm1', from_email: 'sales@example.com', incoming: true, total: 3, subject: 'Order' },
      ],
    });

    const response = await fetch(`${baseUrl}/mail/messages/${MSG_ID}/correspondence`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.address).toBe('client@example.com');
    expect(body.name).toBe('Client');
    expect(body.total).toBe(3);
    expect(body.truncated).toBe(true);
    expect(body.messages).toEqual([
      { id: 'm2', from_email: 'client@example.com', subject: 'Re: Order', direction: 'out' },
      { id: 'm1', from_email: 'sales@example.com', subject: 'Order', direction: 'in' },
    ]);

    const [, params] = query.mock.calls.find(([sql]) => CORRESPONDENCE_SQL.test(sql));
    expect(params).toEqual([[ACCOUNT_ID], 'client@example.com', 500]);

    const sql = query.mock.calls.find(([text]) => CORRESPONDENCE_SQL.test(text))[0];
    expect(sql).toContain("recipient ->> 'email'");
    expect(sql).toContain('bcc_addresses');
    expect(sql).toContain("f.special_use = '\\Trash'");
    expect(sql).toContain('COUNT(*) OVER()::int AS total');
  });

  it('reports failures without leaking the database error', async () => {
    const error = new Error('boom');
    query.mockImplementation(async (sql) => {
      if (MESSAGE_SQL.test(sql)) return { rows: [messageRow()] };
      if (ACCOUNTS_SQL.test(sql)) return { rows: [{ id: ACCOUNT_ID, email_address: 'me@example.com', enabled: true, alias_emails: [] }] };
      throw error;
    });
    const response = await fetch(`${baseUrl}/mail/messages/${MSG_ID}/correspondence`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to load correspondence' });
  });
});
