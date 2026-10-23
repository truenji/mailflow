import { query } from './db.js';
import { trashFolderExclusionCondition } from '../utils/mailUtils.js';

// A correspondence view is a history, not a pager: one request returns the exchange.
// The cap keeps a years-long thread with a mailing list from becoming an unbounded
// response; the newest messages are the ones worth showing first.
export const CORRESPONDENCE_LIMIT = 500;

export function normalizeAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// to_addresses / cc_addresses / bcc_addresses are JSONB arrays of { name, email }.
// Older rows may carry a JSON string, and a malformed value must not take the view down.
export function parseAddressList(value) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map(entry => {
      if (typeof entry === 'string') return { name: '', email: normalizeAddress(entry) };
      return { name: entry?.name || '', email: normalizeAddress(entry?.email) };
    })
    .filter(entry => entry.email);
}

export function ownAddressSet(accounts = []) {
  const addresses = new Set();
  for (const account of accounts) {
    const email = normalizeAddress(account?.email_address ?? account?.email);
    if (email) addresses.add(email);
    for (const alias of account?.aliases || []) {
      const aliasEmail = normalizeAddress(alias?.email ?? alias);
      if (aliasEmail) addresses.add(aliasEmail);
    }
  }
  return addresses;
}

// The other party of a message: its sender when the message came in, otherwise the
// first recipient that is not one of the user's own addresses. A message addressed
// only to the user (a note to self) has no correspondent.
export function resolveCorrespondent(message, ownAddresses) {
  const own = ownAddresses instanceof Set ? ownAddresses : ownAddressSet(ownAddresses);
  const from = normalizeAddress(message?.from_email);
  if (from && !own.has(from)) return { email: from, name: message?.from_name || '' };

  const recipients = [
    ...parseAddressList(message?.to_addresses),
    ...parseAddressList(message?.cc_addresses),
    ...parseAddressList(message?.bcc_addresses),
  ];
  const other = recipients.find(entry => entry.email && !own.has(entry.email));
  return other ? { email: other.email, name: other.name || '' } : null;
}

async function loadAccounts(userId) {
  const result = await query(`
    SELECT a.id, a.email_address, a.enabled,
           (SELECT COALESCE(json_agg(al.email), '[]'::json)
              FROM account_aliases al WHERE al.account_id = a.id) AS alias_emails
    FROM email_accounts a
    WHERE a.user_id = $1
  `, [userId]);
  return result.rows.map(row => ({
    id: row.id,
    email_address: row.email_address,
    enabled: row.enabled,
    aliases: Array.isArray(row.alias_emails) ? row.alias_emails : [],
  }));
}

// One row per message, preferring the INBOX copy when the same message exists in
// several folders, exactly as the thread route does. The direction is resolved from
// the sender, so a message sent from an alias still reads as outgoing.
export async function listCorrespondence({ userId, messageId }) {
  const messageResult = await query(`
    SELECT m.id, m.account_id, m.from_name, m.from_email, m.to_addresses, m.cc_addresses, m.bcc_addresses
    FROM messages m
    JOIN email_accounts a ON m.account_id = a.id
    WHERE m.id = $1 AND a.user_id = $2 AND m.is_deleted = false
  `, [messageId, userId]);
  if (!messageResult.rows.length) {
    throw Object.assign(new Error('Message not found'), { status: 404 });
  }

  const source = messageResult.rows[0];
  const accounts = await loadAccounts(userId);
  const correspondent = resolveCorrespondent(source, ownAddressSet(accounts));
  if (!correspondent) {
    return { address: null, name: '', messages: [], total: 0, truncated: false };
  }

  // A disabled account no longer syncs, but a message opened from it should still
  // show the correspondence that predates the account being switched off.
  const accountIds = accounts
    .filter(account => account.enabled || account.id === source.account_id)
    .map(account => account.id);
  if (!accountIds.length) {
    return { address: correspondent.email, name: correspondent.name, messages: [], total: 0, truncated: false };
  }

  const result = await query(`
    WITH deduped AS (
      SELECT DISTINCT ON (m.account_id, COALESCE(m.message_id, m.id::text))
             m.id, m.uid, m.folder, m.message_id, m.thread_id, m.subject,
             m.from_name, m.from_email, m.to_addresses, m.cc_addresses, m.bcc_addresses,
             m.date, m.snippet, m.is_read, m.is_starred, m.has_attachments,
             m.account_id, m.category, m.spam_verdict, m.spam_user_override, m.spam_score_ml,
             m.list_unsubscribe, m.list_unsubscribe_post, m.unsubscribed_at, m.delivery_addresses,
             a.name AS account_name, a.email_address AS account_email, a.color AS account_color,
             (co.id IS NOT NULL) AS has_contact_photo,
             (lower(trim(m.from_email)) = $2) AS incoming
      FROM messages m
      JOIN email_accounts a ON m.account_id = a.id
      LEFT JOIN contacts co ON co.user_id = a.user_id
                            AND co.primary_email = lower(m.from_email)
                            AND co.photo_data IS NOT NULL
      WHERE m.is_deleted = false
        AND m.account_id = ANY($1)
        AND (
          lower(trim(m.from_email)) = $2
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(CASE jsonb_typeof(m.to_addresses) WHEN 'array' THEN m.to_addresses ELSE '[]'::jsonb END) AS recipient
            WHERE lower(trim(recipient ->> 'email')) = $2
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(CASE jsonb_typeof(m.cc_addresses) WHEN 'array' THEN m.cc_addresses ELSE '[]'::jsonb END) AS recipient
            WHERE lower(trim(recipient ->> 'email')) = $2
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(CASE jsonb_typeof(m.bcc_addresses) WHEN 'array' THEN m.bcc_addresses ELSE '[]'::jsonb END) AS recipient
            WHERE lower(trim(recipient ->> 'email')) = $2
          )
        )
        AND ${trashFolderExclusionCondition()}
      ORDER BY m.account_id,
               COALESCE(m.message_id, m.id::text),
               CASE WHEN m.folder = 'INBOX' THEN 0 ELSE 1 END,
               m.date ASC
    ),
    counted AS (
      SELECT deduped.*, COUNT(*) OVER()::int AS total FROM deduped
    )
    SELECT * FROM counted
    ORDER BY date DESC, account_id, id
    LIMIT $3
  `, [accountIds, correspondent.email, CORRESPONDENCE_LIMIT]);

  const total = result.rows[0]?.total ?? 0;
  const messages = result.rows.map(row => {
    const message = { ...row, direction: row.incoming ? 'in' : 'out' };
    delete message.total;
    delete message.incoming;
    return message;
  });

  return {
    address: correspondent.email,
    name: correspondent.name,
    messages,
    total,
    truncated: total > messages.length,
  };
}
