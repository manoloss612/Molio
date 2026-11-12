import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import type { PublicGraph, PublicPage, PublicSite as PublicSiteDto } from '@molio/contracts';
import { publicApi, PublicationApiError } from '../../api/publication';
import { translate, type Locale } from '../../i18n';
import './public.css';

function renderPublicMarkdown(markdown: string, revision: number): string {
  const linked = markdown
    .replace(/\]\(molio-page:([0-9a-f-]{36})\)/gi, `](/public/wiki/$1?revision=${revision})`)
    .replace(/\]\(molio-asset:([0-9a-f-]{36})\)/gi, `](/api/public/assets/$1?revision=${revision})`)
    .replace(/\]\(molio-unavailable:\)/g, '](#unavailable)');
  const rendered = marked.parse(linked, { async: false, gfm: true }) as string;
  const safe = DOMPurify.sanitize(rendered, { FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio', 'source', 'svg', 'math'], FORBID_ATTR: ['style', 'onerror', 'onclick'] });
  const doc = new DOMParser().parseFromString(safe, 'text/html');
  for (const image of doc.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? '';
    if (!/^\/api\/public\/assets\/[0-9a-f-]{36}\?revision=\d+$/i.test(src)) image.remove();
  }
  return doc.body.innerHTML;
}

function publicLocale(): Locale {
  try { return window.localStorage.getItem('molio.locale') === 'en' ? 'en' : 'zh'; }
  catch { return 'zh'; }
}

export function PublicSite() {
  const locale = publicLocale();
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
  const location = useLocation();
  const pageId = location.pathname.match(/^\/public\/wiki\/([^/]+)$/)?.[1];
  const isGraph = location.pathname === '/public/graph';
  const [site, setSite] = useState<PublicSiteDto | null>(null);
  const [page, setPage] = useState<PublicPage | null>(null);
  const [graph, setGraph] = useState<PublicGraph | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setPage(null); setGraph(null);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const current = await publicApi.site();
          if (!active) return;
          setSite(current);
          if (!current.enabled) throw new Error(t('publicWiki.closed'));
          if (pageId && !current.pages.some((item) => item.id === pageId)) throw new Error(t('publicWiki.unavailable'));
          try {
            if (isGraph) setGraph(await publicApi.graph(current.revision));
            else if (pageId) setPage(await publicApi.page(pageId, current.revision));
            break;
          } catch (error) {
            if (attempt === 0 && error instanceof PublicationApiError && error.status === 404) continue;
            throw error;
          }
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '页面暂时无法访问。');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [location.pathname, pageId]);

  const html = useMemo(() => page && site ? renderPublicMarkdown(page.markdown, site.revision) : '', [page, site]);
  const titles = new Map((site?.pages ?? []).map((item) => [item.id, item.title]));
  const title = page?.title ?? '公开 Wiki';
  return <main className="public-shell" data-testid="public-site">
    <header className="public-header"><Link className="public-brand" to="/public/wiki">Molio <span>{t('publicWiki.title')}</span></Link><nav aria-label="公开站点导航"><Link to="/public/wiki">{t('nav.knowledge')}</Link><Link to="/public/graph" aria-label={t('publicWiki.graph')}>{t('publicWiki.graph')}</Link></nav></header>
    <div className="public-layout"><aside className="public-sidebar"><h2>{t('publicWiki.visitorPages')}</h2>{site?.pages.map((item) => <Link key={item.id} to={`/public/wiki/${item.id}`}>{item.title}</Link>)}</aside>
      <section className="public-content">
        {loading ? <p role="status">{t('publicWiki.loading')}</p> : error ? <p role="alert">{error}</p> : isGraph && graph ? <>
          <h1>{t('publicWiki.graphTitle')}</h1><p className="public-revision">{t('publicWiki.revision', { revision: graph.revision })}</p>
          <div className="public-graph" data-testid="public-graph">
            <svg className="public-graph__canvas" viewBox="0 0 720 420" role="img" aria-label={t('publicWiki.graphTitle')}>
              {(() => {
                const points = new Map(graph.nodes.map((node, index) => {
                  const angle = graph.nodes.length < 2 ? 0 : (Math.PI * 2 * index / graph.nodes.length) - Math.PI / 2;
                  const radius = Math.min(155, 35 + graph.nodes.length * 18);
                  return [node.id, { x: 360 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius }] as const;
                }));
                return <>
                  <g className="public-graph__edges">{graph.edges.map((edge) => {
                    const source = points.get(edge.source); const target = points.get(edge.target);
                    return source && target ? <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null;
                  })}</g>
                  {graph.nodes.map((node) => {
                    const point = points.get(node.id)!;
                    return <a key={node.id} href={`/public/wiki/${node.id}`} data-testid={`public-graph-node-${node.id}`}>
                      <circle cx={point.x} cy={point.y} r="12" />
                      <text x={point.x} y={point.y + 34} textAnchor="middle">{node.title.length > 16 ? `${node.title.slice(0, 16)}…` : node.title}</text>
                    </a>;
                  })}
                </>;
              })()}
            </svg>
            <ul>{graph.nodes.map((node) => <li key={node.id}><Link to={`/public/wiki/${node.id}`}>{node.title}</Link><span>{graph.edges.filter((edge) => edge.source === node.id).map((edge) => titles.get(edge.target)).filter(Boolean).join('、') || t('publicWiki.noOutgoing')}</span></li>)}</ul>
          </div>
        </> : page ? <article data-testid="public-wiki-page"><p className="public-revision">{t('publicWiki.revision', { revision: page.revision })}</p><h1>{title}</h1><div className="public-markdown" dangerouslySetInnerHTML={{ __html: html }} /></article> : !pageId ? <section><p className="public-revision">{t('publicWiki.revision', { revision: site?.revision ?? 0 })}</p><h1>{t('publicWiki.title')}</h1><ul>{site?.pages.map((item) => <li key={item.id}><Link to={`/public/wiki/${item.id}`}>{item.title}</Link></li>)}</ul></section> : <p role="alert">{t('publicWiki.unavailable')}</p>}
      </section>
    </div>
  </main>;
}
