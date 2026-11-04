import { useState, useSyncExternalStore } from 'react';
import { accessController } from '../../access/runtime';
import { useI18n } from '../../i18n';

export function AdminSessionControls() {
  const state = useSyncExternalStore(accessController.subscribe, accessController.getSnapshot);
  const { t } = useI18n(); const [confirm, setConfirm] = useState(false);
  if (state.status !== 'authenticated') return null;
  return <>
    <button type="button" className="entry-nav-rail__btn admin-logout-btn" data-testid="admin-logout-btn" title={t('adminAccess.signOut')} onClick={() => setConfirm(true)} aria-label={t('adminAccess.signOut')}>↪</button>
    {state.expiresSoon && <div className="admin-expiry-notice" role="status">{t('adminAccess.expiryWarning')}</div>}
    {confirm && <div className="admin-access-overlay"><section className="admin-access-card" role="alertdialog" aria-modal="true" aria-labelledby="admin-exit-title">
      <h2 id="admin-exit-title">{t('adminAccess.signOut')}</h2><p>{t('adminAccess.unsavedWarning')}</p>
      <div className="admin-access-actions"><button type="button" data-testid="admin-logout-cancel" onClick={() => setConfirm(false)} autoFocus>{t('adminAccess.cancel')}</button><button type="button" data-testid="admin-logout-confirm" onClick={() => { void accessController.logout(); }}>{t('adminAccess.confirmSignOut')}</button></div>
    </section></div>}
  </>;
}
