import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api.js';
import { useStore } from '../store/index.js';
import { formatMessageDateTime } from '../utils/formatDate.js';
import { useMobile } from '../hooks/useMobile.js';
import { applyMarkRead } from '../utils/markRead.js';
import AccountMark from './AccountMark.jsx';

function DirectionMark({ direction }) {
  const incoming = direction !== 'out';
  return (
    <span style={{
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: incoming ? 'rgba(124,106,247,0.12)' : 'var(--bg-tertiary)',
      color: incoming ? 'var(--accent)' : 'var(--text-secondary)',
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {incoming
          ? <><path d="M12 3v14"/><polyline points="6 11 12 17 18 11"/></>
          : <><path d="M12 21V7"/><polyline points="6 13 12 7 18 13"/></>}
      </svg>
    </span>
  );
}

function MessageRow({ message, current, onOpen, t }) {
  const incoming = message.direction !== 'out';
  return (
    <button
      onClick={() => onOpen(message)}
      title={t('correspondence.open')}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%',
        padding: '11px 18px', background: current ? 'var(--bg-tertiary)' : 'none',
        border: 'none', borderBottom: '1px solid var(--border-subtle)',
        borderLeft: `3px solid ${current ? 'var(--accent)' : 'transparent'}`,
        color: 'var(--text-primary)', font: 'inherit', textAlign: 'left', cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!current) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!current) e.currentTarget.style.background = 'none'; }}
    >
      <DirectionMark direction={message.direction} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: message.is_read ? 500 : 650,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {message.subject && message.subject !== '(no subject)' ? message.subject : t('message.noSubject')}
          </span>
          {!message.is_read && (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
          )}
          {message.has_attachments && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
            </svg>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
          <span style={{ fontSize: 11, color: incoming ? 'var(--accent)' : 'var(--text-tertiary)', flexShrink: 0 }}>
            {incoming ? t('correspondence.incoming') : t('correspondence.outgoing')}
          </span>
          <span style={{
            fontSize: 12, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {message.snippet || ''}
          </span>
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          {formatMessageDateTime(message.date, { withYear: true })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 }}>
          <AccountMark accountId={message.account_id} color={message.account_color || 'var(--accent)'} size={6} />
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{message.account_name}</span>
        </div>
      </div>
    </button>
  );
}

// The full exchange with one address: every message received from it and every message
// sent to it, across the user's accounts. Opened from "Show correspondence".
export default function CorrespondenceModal({ messageId, onClose }) {
  const { t } = useTranslation();
  const isMobile = useMobile();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getCorrespondence(messageId)
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [messageId]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // A correspondence row is not a row of the list on screen, so it is parked under the
  // deep-link key the reader already understands (MailApp.openDeepLinkMessage does the same).
  const openMessage = (message) => {
    const store = useStore.getState();
    store.setThreadMessages(`__dl_${message.id}`, [message]);
    store.setSelectedMessage(message.id);
    if (store.markReadBehavior !== 'manual') applyMarkRead(message);
    onClose();
  };

  const messages = data?.messages || [];
  const title = data?.address
    ? t('correspondence.title', { address: data.address })
    : t('correspondence.titleFallback');
  const subtitle = data?.address
    ? [data.name || '', t('correspondence.count', { count: data.total ?? messages.length })]
      .filter(Boolean).join(' · ')
    : '';

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: isMobile ? 'var(--bg-secondary)' : 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'center', padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: isMobile ? '100%' : 760,
          maxWidth: isMobile ? 'none' : 'calc(100vw - 32px)',
          maxHeight: isMobile ? 'none' : '82vh',
          height: isMobile ? '100%' : undefined,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)',
          borderRadius: isMobile ? 0 : 12,
          border: isMobile ? 'none' : '1px solid var(--border)',
          boxShadow: isMobile ? 'none' : 'var(--shadow-modal)',
          paddingTop: isMobile ? 'var(--sat)' : 0,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px',
          borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id={titleId} style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 1 }}>
                {subtitle}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('correspondence.close')}
            title={t('correspondence.close')}
            style={{
              flexShrink: 0, background: 'none', border: 'none', padding: 6,
              color: 'var(--text-tertiary)', cursor: 'pointer', borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {loading && (
            <div style={{ padding: '22px 18px', color: 'var(--text-tertiary)', fontSize: 13 }}>
              {t('common.loading')}
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: '22px 18px', color: 'var(--red, #e03131)', fontSize: 13 }}>
              {t('correspondence.error')}
            </div>
          )}
          {!loading && !error && messages.length === 0 && (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              {data?.address ? t('correspondence.empty') : t('correspondence.noAddress')}
            </div>
          )}
          {!loading && !error && messages.map(message => (
            <MessageRow
              key={message.id}
              message={message}
              current={message.id === messageId}
              onOpen={openMessage}
              t={t}
            />
          ))}
        </div>

        {!loading && !error && data?.truncated && (
          <div style={{
            flexShrink: 0, padding: '9px 18px', borderTop: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)', fontSize: 11,
          }}>
            {t('correspondence.truncated')}
          </div>
        )}
      </div>
    </div>
  );
}
