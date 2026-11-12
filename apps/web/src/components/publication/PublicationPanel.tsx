import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TreeNode, PublicationPreview, PublicationStatus } from '@molio/contracts';
import { publicationApi } from '../../api/publication';
import './PublicationPanel.css';
import { useI18n } from '../../i18n';

function wikiMarkdownFiles(tree: TreeNode[]): string[] {
  const wiki = tree.find((node) => node.path === 'wiki' && node.type === 'directory');
  const paths: string[] = [];
  const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
    if (node.type === 'directory') visit(node.children ?? []);
    else if (node.path.toLowerCase().endsWith('.md')) paths.push(node.path);
  });
  if (wiki?.type === 'directory') visit(wiki.children ?? []);
  return paths.sort((a, b) => a.localeCompare(b));
}

export function PublicationPanel({ vaultId, tree, onClose }: { vaultId: string; tree: TreeNode[]; onClose: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const files = useMemo(() => wikiMarkdownFiles(tree), [tree]);

  const reload = useCallback(async () => {
    try { setStatus(await publicationApi.status(vaultId)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '状态读取失败'); }
  }, [vaultId]);
  useEffect(() => { void reload(); }, [reload]);

  const published = useMemo(() => new Map((status?.pages ?? []).filter((page) => page.published).map((page) => [page.sourcePath, page])), [status]);
  const switchBlocked = !!status?.vaultId && status.vaultId !== vaultId && status.pages.some((page) => page.published);
  const toggle = (sourcePath: string, checked: boolean) => {
    setSelected((previous) => { const next = new Set(previous); if (checked) next.add(sourcePath); else next.delete(sourcePath); return next; });
    setPreview(null);
  };

  const createPreview = async () => {
    if (!selected.size) { setError(t('publicWiki.selectFirst')); return; }
    setBusy(true); setError('');
    try { setPreview(await publicationApi.preview({ vaultId, selectedPaths: [...selected].sort() })); }
    catch (e) { setError(e instanceof Error ? e.message : '预览失败'); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true); setError('');
    try { await publicationApi.commit({ previewId: preview.id, expectedRevision: preview.expectedRevision }); setPreview(null); setSelected(new Set()); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '发布失败'); }
    finally { setBusy(false); }
  };
  const withdraw = async (pageId: string) => {
    if (!status || !window.confirm(t('publicWiki.confirmWithdraw'))) return;
    setBusy(true); setError('');
    try { await publicationApi.withdraw({ expectedRevision: status.revision, pageIds: [pageId] }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '撤回失败'); }
    finally { setBusy(false); }
  };
  const toggleSite = async (enabled: boolean) => {
    if (!status) return;
    setBusy(true); setError('');
    try { await publicationApi.setSite({ expectedRevision: status.revision, enabled }); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '站点设置失败'); }
    finally { setBusy(false); }
  };

  return <section className="publication-panel" data-testid="public-publication-panel" aria-labelledby="publication-title">
    <header className="publication-panel__header"><div><p className="publication-panel__eyebrow">MOLIO / WIKI</p><h2 id="publication-title">{t('publicWiki.title')}</h2><p>{t('publicWiki.description')}</p></div><button type="button" onClick={onClose} aria-label={t('common.close')}>×</button></header>
    {error && <p className="publication-panel__error" role="alert">{error}</p>}
    {switchBlocked && <p className="publication-panel__warning" role="status">{t('publicWiki.switchBlocked')}</p>}
    <div className="publication-panel__site"><strong>{t('publicWiki.visitorSite')}</strong><label><input data-testid="publication-site-enabled" type="checkbox" checked={status?.enabled ?? false} disabled={!status || busy || switchBlocked} onChange={(e) => void toggleSite(e.target.checked)} />{t('publicWiki.allowVisitors')}</label><span>{t('publicWiki.revision', { revision: status?.revision ?? '—' })}</span></div>
    <div className="publication-panel__list" aria-label="Wiki 页面列表">
      {files.length === 0 && <p>{t('publicWiki.noPages')}</p>}
      {files.map((sourcePath) => {
        const page = published.get(sourcePath);
        const checked = selected.has(sourcePath);
        return <div className="publication-page-row" data-testid="publication-page-row" key={sourcePath} data-page-id={page?.id} data-published={page ? 'true' : 'false'}>
          <label><input type="checkbox" checked={checked} disabled={busy || switchBlocked} onChange={(e) => toggle(sourcePath, e.target.checked)} /><span>{sourcePath}</span></label>
          {page ? <><span className="publication-page-row__status">{t('publicWiki.published')}</span><button type="button" data-testid={`publication-page-id-${sourcePath.endsWith('public-a.md') ? 'public-a' : sourcePath}`} data-page-id={page.id} onClick={() => void withdraw(page.id)} disabled={busy}>{t('publicWiki.withdraw')}</button></> : <span className="publication-page-row__status">{t('publicWiki.unpublished')}</span>}
        </div>;
      })}
    </div>
    <footer className="publication-panel__actions"><button type="button" data-testid="publication-preview" disabled={!selected.size || busy || switchBlocked} onClick={() => void createPreview()}>{busy ? t('publicWiki.processing') : t('publicWiki.preview')}</button></footer>
    {preview && <section className="publication-preview" aria-label="发布预览">
      <h3>{t('publicWiki.confirm')} · {preview.pages.length}</h3><p>{t('publicWiki.revision', { revision: preview.pageCount })} · {preview.totalBytes} bytes</p>
      {preview.warnings.map((warning) => <p className="publication-panel__warning" key={warning}>{warning}</p>)}
      <div data-testid="publication-preview-content">{preview.pages.map((page) => <article key={page.id}><h4>{page.title}</h4><p>{page.sourcePath}</p><pre>{page.markdown}</pre>{page.warnings.map((warning) => <p key={warning}>{warning}</p>)}</article>)}</div>
      <button type="button" data-testid="publication-commit" disabled={busy} onClick={() => void commit()}>{t('publicWiki.confirm')}</button>
    </section>}
  </section>;
}
