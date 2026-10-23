import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CorrespondenceModal from './CorrespondenceModal.jsx';

// A small labelled action that opens the exchange with the other party. Used by the
// reading pane and by each message card in a conversation, which share the modal.
export default function CorrespondenceButton({ messageId, style, children }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('message.showCorrespondence')}
        style={style}
      >
        {children ?? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-3.6-.8L3 21l1.9-5.4A8.4 8.4 0 1121 11.5z"/>
              <path d="M8 10h8M8 14h5"/>
            </svg>
            <span>{t('message.showCorrespondence')}</span>
          </>
        )}
      </button>
      {open && <CorrespondenceModal messageId={messageId} onClose={() => setOpen(false)} />}
    </>
  );
}
