import { describe, expect, it } from 'vitest';
import { decodeRfc2231Value, normalizeAttachmentFilenames } from './rfc2231.js';

// The exact shape Yandex returned for a real message: an RFC 2231 ext-value in the
// plain `filename` parameter, with the charset in upper case. ImapFlow leaves it
// encoded (its repair only matches a lower-case charset), so the UI showed
// "UTF-8''%D0%9A..." instead of "Карточка клиента АО Органика 2026.pdf".
const YANDEX_FILENAME = "UTF-8''%D0%9A%D0%B0%D1%80%D1%82%D0%BE%D1%87%D0%BA%D0%B0"
  + '%20%D0%BA%D0%BB%D0%B8%D0%B5%D0%BD%D1%82%D0%B0%20%D0%90%D0%9E%20'
  + '%D0%9E%D1%80%D0%B3%D0%B0%D0%BD%D0%B8%D0%BA%D0%B0%20'
  + '%32%30%32%36%2E%70%64%66';

describe('decodeRfc2231Value', () => {
  it('decodes an ext-value with an upper-case charset', () => {
    expect(decodeRfc2231Value(YANDEX_FILENAME)).toBe('Карточка клиента АО Органика 2026.pdf');
  });

  it('decodes the same value with a lower-case charset', () => {
    expect(decodeRfc2231Value(YANDEX_FILENAME.replace(/^UTF-8/, 'utf-8')))
      .toBe('Карточка клиента АО Органика 2026.pdf');
  });

  it('decodes a non-UTF-8 charset', () => {
    // "Привет.txt" in windows-1251.
    expect(decodeRfc2231Value("windows-1251''%CF%F0%E8%E2%E5%F2.txt")).toBe('Привет.txt');
  });

  it('leaves an ordinary filename alone', () => {
    expect(decodeRfc2231Value('report.pdf')).toBe('report.pdf');
    expect(decodeRfc2231Value('Карточка клиента.pdf')).toBe('Карточка клиента.pdf');
  });

  it('does not mistake apostrophes in a plain name for a charset', () => {
    expect(decodeRfc2231Value("It's Bob's 100%.pdf")).toBe("It's Bob's 100%.pdf");
  });

  it('leaves a value with an unknown charset alone', () => {
    expect(decodeRfc2231Value("x-unknown''%D0%9A.pdf")).toBe("x-unknown''%D0%9A.pdf");
  });

  it('does not strip a prefix when there is nothing percent-encoded', () => {
    expect(decodeRfc2231Value("UTF-8''plain.pdf")).toBe("UTF-8''plain.pdf");
  });

  it('keeps an unencoded astral character intact next to an escape', () => {
    expect(decodeRfc2231Value("UTF-8''%F0%9F%98%80 \u{1F600}.txt")).toBe('\u{1F600} \u{1F600}.txt');
  });
});

describe('normalizeAttachmentFilenames', () => {
  it('decodes top-level and nested contains filenames', () => {
    const attachments = [{
      part: '2',
      filename: YANDEX_FILENAME,
      type: 'message/rfc822',
      contains: [{ filename: YANDEX_FILENAME, type: 'application/pdf' }],
    }];
    expect(normalizeAttachmentFilenames(attachments)).toEqual([{
      part: '2',
      filename: 'Карточка клиента АО Органика 2026.pdf',
      type: 'message/rfc822',
      contains: [{ filename: 'Карточка клиента АО Органика 2026.pdf', type: 'application/pdf' }],
    }]);
  });

  it('returns the same array when nothing needs decoding', () => {
    const attachments = [{ part: '2', filename: 'report.pdf' }];
    expect(normalizeAttachmentFilenames(attachments)).toBe(attachments);
  });

  it('tolerates a value that is not an attachment list', () => {
    expect(normalizeAttachmentFilenames(null)).toBe(null);
    expect(normalizeAttachmentFilenames('nope')).toBe('nope');
  });

  it('strips bidi overrides and control characters the decoded value may carry', () => {
    // A legacy row written before the decoder existed still holds the encoded
    // value. Decoding it must not smuggle U+202E (which reverses the visible
    // extension) or CR/LF back into a name the attachment strip renders.
    const attachments = [
      { filename: "UTF-8''invoice%E2%80%AEfdp.exe" },
      { filename: "UTF-8''line%0D%0Abreak.pdf" },
    ];
    expect(normalizeAttachmentFilenames(attachments)).toEqual([
      { filename: 'invoicefdp.exe' },
      { filename: 'linebreak.pdf' },
    ]);
  });

  it('sanitizes a plain stored name that predates the ingest-time strip', () => {
    const attachments = [{ filename: `invoice${String.fromCharCode(0x202e)}fdp.exe` }];
    expect(normalizeAttachmentFilenames(attachments)).toEqual([{ filename: 'invoicefdp.exe' }]);
  });
});
