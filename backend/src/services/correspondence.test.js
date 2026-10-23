import { describe, expect, it } from 'vitest';
import { normalizeAddress, ownAddressSet, parseAddressList, resolveCorrespondent } from './correspondence.js';

const accounts = [
  { email_address: 'Me@Example.com', aliases: [{ email: 'sales@example.com' }, 'support@example.com'] },
  { email_address: 'second@example.org', aliases: [] },
];
const own = ownAddressSet(accounts);

describe('parseAddressList', () => {
  it('reads the JSONB array shape and normalizes addresses', () => {
    expect(parseAddressList([
      { name: 'Client', email: ' Client@Example.COM ' },
      { email: '' },
      { name: 'No email' },
    ])).toEqual([{ name: 'Client', email: 'client@example.com' }]);
  });

  it('reads a stored JSON string and tolerates malformed values', () => {
    expect(parseAddressList('[{"name":"A","email":"a@example.com"}]'))
      .toEqual([{ name: 'A', email: 'a@example.com' }]);
    expect(parseAddressList('{not json')).toEqual([]);
    expect(parseAddressList(null)).toEqual([]);
  });
});

describe('ownAddressSet', () => {
  it('includes login addresses and aliases, case-insensitively', () => {
    expect(own).toEqual(new Set(['me@example.com', 'sales@example.com', 'support@example.com', 'second@example.org']));
  });
});

describe('resolveCorrespondent', () => {
  it('uses the sender of a received message', () => {
    expect(resolveCorrespondent({
      from_name: 'Client Name',
      from_email: 'client@example.com',
      to_addresses: [{ email: 'me@example.com' }],
    }, own)).toEqual({ email: 'client@example.com', name: 'Client Name' });
  });

  it('uses the first non-own recipient of a sent message', () => {
    expect(resolveCorrespondent({
      from_email: 'me@example.com',
      to_addresses: [{ name: 'Colleague', email: 'colleague@example.com' }, { email: 'other@example.com' }],
    }, own)).toEqual({ email: 'colleague@example.com', name: 'Colleague' });
  });

  it('skips own aliases and falls through to Cc then Bcc', () => {
    expect(resolveCorrespondent({
      from_email: 'sales@example.com',
      to_addresses: [{ email: 'support@example.com' }],
      cc_addresses: [{ name: 'Watcher', email: 'watcher@example.com' }],
    }, own)).toEqual({ email: 'watcher@example.com', name: 'Watcher' });

    expect(resolveCorrespondent({
      from_email: 'me@example.com',
      to_addresses: [{ email: 'support@example.com' }],
      bcc_addresses: [{ email: 'hidden@example.com' }],
    }, own)).toEqual({ email: 'hidden@example.com', name: '' });
  });

  it('returns null for a note to self', () => {
    expect(resolveCorrespondent({
      from_email: 'me@example.com',
      to_addresses: [{ email: 'me@example.com' }],
      cc_addresses: [{ email: 'sales@example.com' }],
    }, own)).toBe(null);
  });

  it('normalizes a mixed-case sender before comparing it with own addresses', () => {
    expect(resolveCorrespondent({ from_email: 'ME@EXAMPLE.COM' }, own)).toBe(null);
    expect(normalizeAddress('  A@B.C ')).toBe('a@b.c');
  });
});
