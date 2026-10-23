// Incoming MIME parameter names are not always labelled the way RFC 2231 requires.
//
// Some servers (Yandex among them) put an RFC 2231 extended value in the plain
// `filename` parameter instead of `filename*`:
//
//   Content-Disposition: attachment; filename="UTF-8''%D0%9A...pdf"
//
// ImapFlow only repairs that shape when the charset is written in lower case, so a
// `UTF-8''...` value reaches us still percent-encoded. Decode it ourselves, once, for
// every attachment name we read from a BODYSTRUCTURE or from a stored row.

const EXT_VALUE_RE = /^([\x21-\x7e]+?)'([\x21-\x7e]*)'([\s\S]*)$/;
const PERCENT_SEQUENCE_RE = /%[0-9A-Fa-f]{2}/;
const MAX_VALUE_LENGTH = 4096;

function percentDecodeToBytes(value) {
  const bytes = [];
  for (let i = 0; i < value.length;) {
    if (value[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 3;
      continue;
    }
    // Copy the character as UTF-8 bytes: the ext-value may mix encoded and
    // unencoded characters (RFC 2231 allows it). Iterate by code point so a
    // surrogate pair is encoded as one character, not two replacement bytes.
    const char = String.fromCodePoint(value.codePointAt(i));
    for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte);
    i += char.length;
  }
  return Uint8Array.from(bytes);
}

// A charset label is validated by asking TextDecoder to resolve it: a filename that
// merely happens to contain two apostrophes ("It's Bob's file.pdf") must not be
// mistaken for an encoded value.
function decoderFor(charset) {
  try {
    return new TextDecoder(charset);
  } catch {
    return null;
  }
}

export function decodeRfc2231Value(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  if (raw.length > MAX_VALUE_LENGTH) return raw;

  const match = raw.match(EXT_VALUE_RE);
  if (!match) return raw;
  const [, charset, , encoded] = match;
  // Encoded values are percent-encoded; without a %XX there is nothing to decode,
  // and stripping the prefix would corrupt a legitimate name.
  if (!PERCENT_SEQUENCE_RE.test(encoded)) return raw;

  const decoder = decoderFor(charset);
  if (!decoder) return raw;

  try {
    const decoded = decoder.decode(percentDecodeToBytes(encoded));
    return decoded || raw;
  } catch {
    return raw;
  }
}

// Attachment lists are stored as JSON (`messages.attachments`), with nested
// `contains` entries for files inside a forwarded message. Decode both levels so a
// row written before this fix is repaired when it is read, and stays repaired once
// the caller persists the result.
export function normalizeAttachmentFilenames(attachments) {
  if (!Array.isArray(attachments)) return attachments;
  let changed = false;
  const normalized = attachments.map(attachment => {
    if (!attachment || typeof attachment !== 'object') return attachment;
    const filename = decodeRfc2231Value(attachment.filename);
    const contains = normalizeAttachmentFilenames(attachment.contains);
    const filenameChanged = filename !== attachment.filename;
    const containsChanged = contains !== attachment.contains;
    if (!filenameChanged && !containsChanged) return attachment;
    changed = true;
    return {
      ...attachment,
      ...(filenameChanged ? { filename } : {}),
      ...(containsChanged ? { contains } : {}),
    };
  });
  return changed ? normalized : attachments;
}
