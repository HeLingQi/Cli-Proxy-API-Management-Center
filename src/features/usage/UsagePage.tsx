import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table/Table';
import {
  IconCheckCircle2,
  IconAlertTriangle,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconSearch,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { Meter } from '@/features/dashboard/components/Meter';
import { toneForSuccessRate } from '@/features/dashboard/utils';
import { useRevealGroup } from '@/hooks/motion';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageHistoryApi,
  type PricingCatalog,
  type PricingModel,
  type UsageEvent,
  type UsageSummary,
} from '@/services/api/usageHistory';
import { useAuthStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import {
  buildUsageDatePreset,
  isUsageDateRangeValid,
  pricingDraftToModel,
  resolveModelDisplayPrices,
  type PricingDraft,
} from './model';
import styles from './UsagePage.module.scss';

type UsageView = 'summary' | 'events' | 'pricing';
type EventStatusFilter = 'all' | 'success' | 'failed';

type MetaSegment = {
  key: string;
  text: string;
  tone?: 'default' | 'ok' | 'danger' | 'muted';
};

const emptyPricingDraft: PricingDraft = {
  provider: '',
  model: '',
  input: '0',
  output: '0',
  cacheRead: '0',
  cacheWrite: '0',
};

const todayUTC = () => new Date().toISOString().slice(0, 10);
const formatNumber = (value: number, locale: string) => value.toLocaleString(locale);
const formatUSD = (micros: number, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2,
    maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
const formatPrice = (value: number | null, locale: string) =>
  value === null
    ? '—'
    : `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value)}`;

function UsageShell({
  view,
  meta,
  actions,
  toolbarExtra,
  children,
}: {
  view: UsageView;
  meta?: MetaSegment[];
  actions?: ReactNode;
  toolbarExtra?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const revealRef = useRevealGroup<HTMLElement>();
  const tabs: Array<{ view: UsageView; path: string }> = [
    { view: 'summary', path: '/usage' },
    { view: 'events', path: '/usage/events' },
    { view: 'pricing', path: '/usage/pricing' },
  ];

  const toneClass: Record<NonNullable<MetaSegment['tone']>, string> = {
    default: styles.metaDefault,
    ok: styles.metaOk,
    danger: styles.metaDanger,
    muted: styles.metaMuted,
  };

  return (
    <div className={styles.page}>
      <header className={styles.header} ref={revealRef}>
        <div className={styles.copy}>
          <h1 className={styles.title} data-reveal>
            {t('usage.title')}
          </h1>
          <p className={styles.meta} data-reveal>
            {meta && meta.length > 0 ? (
              meta.map((segment, index) => (
                <Fragment key={segment.key}>
                  {index > 0 && (
                    <span className={styles.metaDot} aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span className={toneClass[segment.tone ?? 'default']}>{segment.text}</span>
                </Fragment>
              ))
            ) : (
              <span className={styles.metaMuted}>{t('usage.description')}</span>
            )}
          </p>
        </div>
        {actions ? (
          <div className={styles.actions} data-reveal>
            {actions}
          </div>
        ) : null}
      </header>

      <section className={styles.workbench}>
        <div className={styles.toolbar}>
          <nav className={styles.segmented} aria-label={t('usage.tabs_label')}>
            {tabs.map((tab) => (
              <NavLink
                key={tab.view}
                to={tab.path}
                end={tab.view === 'summary'}
                className={`${styles.segment} ${view === tab.view ? styles.segmentActive : ''}`}
                aria-current={view === tab.view ? 'page' : undefined}
              >
                {t(`usage.tabs.${tab.view}`)}
              </NavLink>
            ))}
          </nav>
          {toolbarExtra ? <div className={styles.toolbarRight}>{toolbarExtra}</div> : null}
        </div>

        {children}
      </section>
    </div>
  );
}

export function UsageSummaryPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [from, setFrom] = useState(todayUTC);
  const [to, setTo] = useState(todayUTC);
  const [range, setRange] = useState(() => ({ from: todayUTC(), to: todayUTC() }));
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [knownKeys, setKnownKeys] = useState<Array<{ fp: string; masked: string }>>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError('');
    try {
      const data = await usageHistoryApi.getSummary(range.from, range.to, selectedKey || undefined);
      setSummary(data);
      if (data.api_keys && data.api_keys.length > 0) {
        setKnownKeys((prev) => {
          const map = new Map(prev.map((k) => [k.fp, k.masked]));
          for (const item of data.api_keys ?? []) {
            map.set(item.api_key_fingerprint, item.api_key_masked || item.api_key_fingerprint);
          }
          return Array.from(map.entries()).map(([fp, masked]) => ({ fp, masked }));
        });
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError, t('usage.load_error')));
    } finally {
      setLoading(false);
    }
  }, [connected, range.from, range.to, selectedKey, t]);

  useHeaderRefresh(load, connected);
  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (days: number) => {
    const next = buildUsageDatePreset(days);
    setFrom(next.from);
    setTo(next.to);
    setError('');
    if (range.from === next.from && range.to === next.to) void load();
    else setRange(next);
  };

  const activePreset = useMemo(() => {
    for (const days of [1, 7, 30]) {
      const preset = buildUsageDatePreset(days);
      if (from === preset.from && to === preset.to) return days;
    }
    return null;
  }, [from, to]);

  const totals = summary?.totals;
  const requestCount = totals?.requests ?? 0;
  const successRate =
    totals && requestCount > 0 ? (totals.success / requestCount) * 100 : null;
  const successTone = toneForSuccessRate(successRate);

  const tileAccents = {
    good: 'var(--viz-success)',
    warning: 'var(--amber-color)',
    critical: 'var(--viz-failure)',
    idle: 'var(--text-quaternary)',
  } as const;

  const metaSegments = useMemo<MetaSegment[]>(() => {
    const items: MetaSegment[] = [
      {
        key: 'range',
        text: range.from === range.to ? `${range.from} UTC` : `${range.from} → ${range.to} UTC`,
        tone: 'default',
      },
    ];
    if (selectedKey) {
      const activeItem = knownKeys.find((k) => k.fp === selectedKey);
      items.push({
        key: 'filter_key',
        text: `${t('usage.summary.filtering_key')}: ${activeItem?.masked || selectedKey.slice(0, 16)}`,
        tone: 'ok',
      });
    }
    if (totals) {
      items.push({
        key: 'requests',
        text: `${formatNumber(totals.requests, i18n.language)} ${t('usage.metrics.requests')}`,
        tone: totals.requests > 0 ? 'ok' : 'muted',
      });
      if (totals.failed > 0) {
        items.push({
          key: 'failed',
          text: `${formatNumber(totals.failed, i18n.language)} ${t('usage.columns.failed')}`,
          tone: 'danger',
        });
      }
    }
    items.push({
      key: 'utc',
      text: t('usage.summary.utc_note'),
      tone: 'muted',
    });
    return items;
  }, [i18n.language, knownKeys, range.from, range.to, selectedKey, t, totals]);

  const metrics = totals
    ? [
        {
          key: 'requests',
          label: t('usage.metrics.requests'),
          value: formatNumber(totals.requests, i18n.language),
          hint: t('usage.summary.success_hint', {
            success: formatNumber(totals.success, i18n.language),
            failed: formatNumber(totals.failed, i18n.language),
          }),
          accent: tileAccents[successTone],
          meter: successRate,
          tone: successTone,
        },
        {
          key: 'tokens',
          label: t('usage.metrics.tokens'),
          value: formatNumber(totals.total_tokens, i18n.language),
          hint: t('usage.summary.tokens_hint', {
            input: formatNumber(totals.input_tokens, i18n.language),
            output: formatNumber(totals.output_tokens, i18n.language),
          }),
          accent: totals.total_tokens > 0 ? 'var(--viz-success)' : 'var(--border-hover)',
          meter: null,
          tone: undefined,
        },
        {
          key: 'cost',
          label: t('usage.metrics.cost'),
          value: formatUSD(totals.effective_cost_usd_micros, i18n.language),
          hint: t('usage.summary.cost_hint'),
          accent:
            totals.effective_cost_usd_micros > 0 ? 'var(--amber-color)' : 'var(--border-hover)',
          meter: null,
          tone: undefined,
        },
        {
          key: 'latency',
          label: t('usage.metrics.latency'),
          value:
            requestCount > 0
              ? `${formatNumber(Math.round(totals.latency_total_ms / requestCount), i18n.language)} ms`
              : '—',
          hint: t('usage.summary.ttft_hint', {
            value:
              requestCount > 0
                ? formatNumber(Math.round(totals.ttft_total_ms / requestCount), i18n.language)
                : '—',
          }),
          accent: 'var(--border-hover)',
          meter: null,
          tone: undefined,
        },
      ]
    : [];

  const dateFilterBar = (
    <form
      className={styles.dateBar}
      onSubmit={(event) => {
        event.preventDefault();
        if (!isUsageDateRangeValid(from, to)) {
          setError(t('usage.summary.invalid_range'));
          return;
        }
        setError('');
        if (range.from === from && range.to === to) void load();
        else setRange({ from, to });
      }}
    >
      {knownKeys.length > 0 && (
        <select
          className={styles.keySelect}
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
          aria-label={t('usage.columns.api_key')}
        >
          <option value="">{t('usage.summary.all_keys')}</option>
          {knownKeys.map((k) => (
            <option key={k.fp} value={k.fp}>
              {k.masked}
            </option>
          ))}
        </select>
      )}
      <div className={styles.presetGroup} role="group">
        {([1, 7, 30] as const).map((days) => (
          <button
            key={days}
            type="button"
            className={`${styles.presetBtn} ${activePreset === days ? styles.presetBtnActive : ''}`}
            onClick={() => applyPreset(days)}
            disabled={!connected || loading}
          >
            {days === 1 ? '1D' : `${days}D`}
          </button>
        ))}
      </div>
      <div className={styles.dateCapsule}>
        <input
          className={styles.dateInput}
          type="date"
          aria-label={t('usage.summary.from')}
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <span className={styles.dateSep} aria-hidden="true">
          →
        </span>
        <input
          className={styles.dateInput}
          type="date"
          aria-label={t('usage.summary.to')}
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      <button
        type="submit"
        className={styles.applyBtn}
        disabled={!connected || loading}
      >
        {loading ? <LoadingSpinner size={13} /> : null}
        {t('usage.summary.apply')}
      </button>
    </form>
  );

  return (
    <UsageShell view="summary" meta={metaSegments} toolbarExtra={dateFilterBar}>
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}
      {loading && !summary ? (
        <>
          <div className={styles.statsRow} aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} height={132} rounded={14} />
            ))}
          </div>
          <Skeleton height={220} rounded={16} />
        </>
      ) : summary ? (
        <>
          {selectedKey ? (
            <div className={styles.activeKeyFilterBanner}>
              <div className={styles.activeKeyFilterInfo}>
                <IconKey size={14} className={styles.activeKeyFilterIcon} />
                <span>{t('usage.summary.filtering_key')}:</span>
                <strong className={styles.mono}>
                  {knownKeys.find((k) => k.fp === selectedKey)?.masked || selectedKey}
                </strong>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelectedKey('')}
              >
                {t('usage.summary.clear_key_filter')}
              </Button>
            </div>
          ) : null}

          <section className={styles.statsRow} aria-label={t('usage.summary.metrics_label')}>
            {metrics.map((metric) => (
              <article
                className={styles.statTile}
                key={metric.key}
                style={{ '--tile-accent': metric.accent } as CSSProperties}
              >
                <span className={styles.statLabel}>{metric.label}</span>
                <strong className={styles.statValue}>{metric.value}</strong>
                {metric.meter !== null && metric.meter !== undefined && (
                  <Meter
                    value={metric.meter}
                    tone={metric.tone}
                    ariaLabel={metric.label}
                    className={styles.statMeter}
                  />
                )}
                <span className={styles.statHint}>{metric.hint}</span>
              </article>
            ))}
          </section>

          {!selectedKey && summary.api_keys && summary.api_keys.length > 0 ? (
            <section className={styles.panel}>
              <header className={styles.panelHead}>
                <div className={styles.panelHeadCopy}>
                  <span className={styles.eyebrow}>{t('usage.summary.utc_note')}</span>
                  <h2 className={styles.panelTitle}>{t('usage.summary.api_keys_title')}</h2>
                </div>
              </header>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('usage.columns.api_key')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.requests')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.success')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.failed')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.input_tokens')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.output_tokens')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.tokens')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.cost')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.latency')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.api_keys.map((keyItem) => {
                    const reqCount = keyItem.requests;
                    const avgLatency =
                      reqCount > 0 ? Math.round(keyItem.latency_total_ms / reqCount) : null;
                    return (
                      <TableRow key={keyItem.api_key_fingerprint}>
                        <TableCell>
                          <div className={styles.keyIdentityCell}>
                            <IconKey size={14} className={styles.keyCellIcon} />
                            <span className={styles.keyChip} title={keyItem.api_key_fingerprint}>
                              {keyItem.api_key_masked || keyItem.api_key_fingerprint.slice(0, 16)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {formatNumber(keyItem.requests, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={`${styles.mono} ${styles.textSuccess}`}>
                          {formatNumber(keyItem.success, i18n.language)}
                        </TableCell>
                        <TableCell
                          alignRight
                          className={`${styles.mono} ${keyItem.failed > 0 ? styles.textDanger : styles.textMuted}`}
                        >
                          {formatNumber(keyItem.failed, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {formatNumber(keyItem.input_tokens, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {formatNumber(keyItem.output_tokens, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {formatNumber(keyItem.total_tokens, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {formatUSD(keyItem.effective_cost_usd_micros, i18n.language)}
                        </TableCell>
                        <TableCell alignRight className={styles.mono}>
                          {avgLatency !== null ? `${formatNumber(avgLatency, i18n.language)} ms` : '—'}
                        </TableCell>
                        <TableCell alignRight>
                          <div className={styles.keyActions}>
                            <button
                              type="button"
                              className={styles.keyActionBtn}
                              onClick={() => setSelectedKey(keyItem.api_key_fingerprint)}
                              title={t('usage.summary.filter_by_key')}
                            >
                              {t('usage.summary.filter_by_key')}
                            </button>
                            <NavLink
                              to={`/usage/events?api_key_fingerprint=${encodeURIComponent(keyItem.api_key_fingerprint)}`}
                              className={styles.keyActionLink}
                              title={t('usage.summary.view_key_events')}
                            >
                              {t('usage.summary.view_key_events')}
                            </NavLink>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          ) : null}

          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div className={styles.panelHeadCopy}>
                <span className={styles.eyebrow}>{t('usage.summary.utc_note')}</span>
                <h2 className={styles.panelTitle}>{t('usage.summary.daily_title')}</h2>
              </div>
            </header>

            {summary.days.length === 0 ? (
              <EmptyState
                title={t('usage.events.empty')}
                description={t('usage.events.empty_desc')}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('usage.columns.date')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.requests')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.success')}</TableHead>
                    <TableHead alignRight>{t('usage.columns.failed')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.tokens')}</TableHead>
                    <TableHead alignRight>{t('usage.metrics.cost')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.days.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell className={styles.mono}>{day.date}</TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatNumber(day.requests, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={`${styles.mono} ${styles.textSuccess}`}>
                        {formatNumber(day.success, i18n.language)}
                      </TableCell>
                      <TableCell
                        alignRight
                        className={`${styles.mono} ${day.failed > 0 ? styles.textDanger : styles.textMuted}`}
                      >
                        {formatNumber(day.failed, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatNumber(day.total_tokens, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatUSD(day.effective_cost_usd_micros, i18n.language)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      ) : null}
    </UsageShell>
  );
}

export function UsageEventsPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [searchParams, setSearchParams] = useSearchParams();
  const apiKeyFilter = searchParams.get('api_key_fingerprint') || '';
  const [items, setItems] = useState<UsageEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>('all');

  const setApiKeyFilter = useCallback(
    (fp: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (fp) next.set('api_key_fingerprint', fp);
        else next.delete('api_key_fingerprint');
        return next;
      });
    },
    [setSearchParams]
  );

  const load = useCallback(
    async (before?: number) => {
      if (!connected) return;
      if (before) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const page = await usageHistoryApi.getEvents(before, 50, apiKeyFilter || undefined);
        setItems((current) => (before ? [...current, ...page.items] : page.items));
        setNextBefore(page.next_before);
      } catch (loadError) {
        setError(getErrorMessage(loadError, t('usage.load_error')));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [connected, apiKeyFilter, t]
  );

  const refresh = useCallback(() => load(), [load]);
  useHeaderRefresh(refresh, connected);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === 'success' && item.failed) return false;
      if (statusFilter === 'failed' && !item.failed) return false;
      if (!query) return true;
      return (
        item.provider?.toLowerCase().includes(query) ||
        item.model?.toLowerCase().includes(query) ||
        item.request_id?.toLowerCase().includes(query) ||
        item.trace_id?.toLowerCase().includes(query) ||
        item.api_key_masked?.toLowerCase().includes(query) ||
        item.api_key_fingerprint?.toLowerCase().includes(query)
      );
    });
  }, [items, search, statusFilter]);

  const metaSegments = useMemo<MetaSegment[]>(() => {
    const failedCount = items.filter((item) => item.failed).length;
    const segments: MetaSegment[] = [
      {
        key: 'total',
        text: `${formatNumber(items.length, i18n.language)} ${t('usage.events.title')}`,
        tone: items.length > 0 ? 'ok' : 'muted',
      },
    ];
    if (apiKeyFilter) {
      segments.push({
        key: 'filter_key',
        text: `${t('usage.summary.filtering_key')}: ${apiKeyFilter.slice(0, 16)}`,
        tone: 'ok',
      });
    }
    if (failedCount > 0) {
      segments.push({
        key: 'failed',
        text: `${formatNumber(failedCount, i18n.language)} ${t('usage.events.failed')}`,
        tone: 'danger',
      });
    }
    segments.push({
      key: 'redacted',
      text: t('usage.events.redacted_note'),
      tone: 'muted',
    });
    return segments;
  }, [apiKeyFilter, i18n.language, items, t]);

  const eventsToolbar = (
    <div className={styles.filterRow}>
      <div className={styles.segmented} role="group" aria-label={t('usage.columns.status')}>
        {(
          [
            ['all', t('auth_files.filter_all')],
            ['success', t('usage.events.success')],
            ['failed', t('usage.events.failed')],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`${styles.segment} ${statusFilter === mode ? styles.segmentActive : ''}`}
            aria-pressed={statusFilter === mode}
            onClick={() => setStatusFilter(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      {apiKeyFilter && (
        <div className={styles.activeFilterChip}>
          <IconKey size={13} aria-hidden="true" />
          <span>{apiKeyFilter.slice(0, 16)}</span>
          <button
            type="button"
            className={styles.clearFilterChip}
            onClick={() => setApiKeyFilter('')}
            aria-label={t('common.close')}
          >
            <IconX size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.searchBox}>
        <IconSearch size={15} className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.searchInput}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`${t('usage.columns.provider_model')} / ${t('usage.columns.api_key')} / ${t('usage.columns.request_id')}`}
          aria-label={t('usage.columns.provider_model')}
        />
        {search && (
          <button
            type="button"
            className={styles.clearSearch}
            onClick={() => setSearch('')}
            aria-label={t('common.close')}
          >
            <IconX size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <UsageShell view="events" meta={metaSegments} toolbarExtra={eventsToolbar}>
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <Skeleton height={280} rounded={16} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title={t('usage.events.empty')}
          description={t('usage.events.empty_desc')}
          action={
            search || statusFilter !== 'all' || apiKeyFilter ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setApiKeyFilter('');
                }}
              >
                {t('auth_files.filter_all')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <span className={styles.eyebrow}>{t('usage.events.redacted_note')}</span>
              <h2 className={styles.panelTitle}>{t('usage.events.title')}</h2>
            </div>
          </header>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage.columns.time')}</TableHead>
                <TableHead>{t('usage.columns.status')}</TableHead>
                <TableHead>{t('usage.columns.api_key')}</TableHead>
                <TableHead>{t('usage.columns.provider_model')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.tokens')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.latency')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.cost')}</TableHead>
                <TableHead>{t('usage.columns.request_id')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow key={item.sequence}>
                  <TableCell className={`${styles.nowrap} ${styles.mono} ${styles.textSecondary}`}>
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    }).format(new Date(item.timestamp))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`${styles.statusBadge} ${item.failed ? styles.statusFailed : styles.statusSuccess}`}
                    >
                      {item.failed ? (
                        <IconAlertTriangle size={13} />
                      ) : (
                        <IconCheckCircle2 size={13} />
                      )}
                      {item.failed ? t('usage.events.failed') : t('usage.events.success')}
                      {item.failure_status_code ? ` · ${item.failure_status_code}` : ''}
                    </span>
                  </TableCell>
                  <TableCell className={styles.mono}>
                    <span className={styles.keyChip} title={item.api_key_fingerprint || ''}>
                      {item.api_key_masked || (item.api_key_fingerprint ? item.api_key_fingerprint.slice(0, 16) : '—')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className={styles.identityCell}>
                      <span className={styles.providerChip}>{item.provider || '—'}</span>
                      <span className={styles.modelPrimary}>{item.model || '—'}</span>
                    </div>
                  </TableCell>
                  <TableCell alignRight className={styles.mono}>
                    {formatNumber(item.total_tokens, i18n.language)}
                  </TableCell>
                  <TableCell alignRight className={styles.mono}>
                    {formatNumber(item.latency_ms, i18n.language)} ms
                  </TableCell>
                  <TableCell alignRight className={styles.mono}>
                    {formatUSD(item.effective_cost_usd_micros, i18n.language)}
                  </TableCell>
                  <TableCell
                    className={`${styles.mono} ${styles.requestId}`}
                    title={item.request_id || item.trace_id || ''}
                  >
                    {item.request_id || item.trace_id || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {nextBefore && (
            <div className={styles.loadMore}>
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={() => void load(nextBefore)}
              >
                {t('usage.events.load_more')}
              </Button>
            </div>
          )}
        </section>
      )}
    </UsageShell>
  );
}

export function UsagePricingPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [catalog, setCatalog] = useState<PricingCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<PricingDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<PricingModel | null>(null);
  const [expandedTiers, setExpandedTiers] = useState<Set<string>>(() => new Set());

  const toggleTierExpanded = (key: string) => {
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError('');
    try {
      setCatalog(await usageHistoryApi.getPricingModels());
    } catch (loadError) {
      setError(getErrorMessage(loadError, t('usage.load_error')));
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(load, connected);
  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    if (!catalog) return;
    setSyncing(true);
    try {
      const next = await usageHistoryApi.syncPricingModels(catalog.revision);
      setCatalog(next);
      showNotification(
        t('usage.pricing.sync_success', {
          matched: next.sync.matched,
          unmatched: next.sync.unmatched.length,
        }),
        'success'
      );
    } catch (syncError) {
      showNotification(getErrorMessage(syncError, t('usage.pricing.sync_error')), 'error');
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const openEditor = (model?: PricingModel) => {
    setEditing(Boolean(model));
    if (!model) {
      setDraft({ ...emptyPricingDraft });
      return;
    }
    const resolved = resolveModelDisplayPrices(model);
    setDraft({
      provider: model.provider,
      model: model.model,
      input: String(resolved.input ?? model.base_prices.input),
      output: String(resolved.output ?? model.base_prices.output),
      cacheRead: String(resolved.cacheRead ?? model.base_prices.cache_read),
      cacheWrite: String(resolved.cacheWrite ?? model.base_prices.cache_write),
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !catalog) return;
    const model = pricingDraftToModel(draft);
    if (!model) {
      showNotification(t('usage.pricing.invalid'), 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await usageHistoryApi.putPricingModel(catalog.revision, model);
      setCatalog(next);
      setDraft(null);
      showNotification(t('usage.pricing.saved'), 'success');
    } catch (saveError) {
      showNotification(getErrorMessage(saveError, t('usage.pricing.save_error')), 'error');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting || !catalog) return;
    setSaving(true);
    try {
      const next = await usageHistoryApi.deletePricingModel(
        catalog.revision,
        deleting.provider,
        deleting.model
      );
      setCatalog(next);
      setDeleting(null);
      showNotification(t('usage.pricing.deleted'), 'success');
    } catch (deleteError) {
      showNotification(getErrorMessage(deleteError, t('usage.pricing.delete_error')), 'error');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const filteredModels = useMemo(() => {
    if (!catalog) return [];
    const query = search.trim().toLowerCase();
    if (!query) return catalog.models;
    return catalog.models.filter(
      (model) =>
        model.provider.toLowerCase().includes(query) ||
        model.model.toLowerCase().includes(query)
    );
  }, [catalog, search]);

  const metaSegments = useMemo<MetaSegment[]>(() => {
    if (!catalog) {
      return [{ key: 'desc', text: t('usage.pricing.description'), tone: 'muted' }];
    }
    const dynamicCount = catalog.models.filter((item) => Boolean(item.expression)).length;
    const segments: MetaSegment[] = [
      {
        key: 'count',
        text: `${formatNumber(catalog.models.length, i18n.language)} ${t('usage.pricing.title')}`,
        tone: catalog.models.length > 0 ? 'ok' : 'muted',
      },
    ];
    if (dynamicCount > 0) {
      segments.push({
        key: 'dynamic',
        text: `${formatNumber(dynamicCount, i18n.language)} ${t('usage.pricing.dynamic')}`,
        tone: 'default',
      });
    }
    segments.push({
      key: 'rev',
      text: `rev ${catalog.revision}`,
      tone: 'muted',
    });
    return segments;
  }, [catalog, i18n.language, t]);

  const headerActions = (
    <>
      <button
        type="button"
        className={styles.ghostAction}
        onClick={() => void sync()}
        disabled={!connected || !catalog || saving || syncing}
      >
        <IconRefreshCw size={14} className={syncing ? styles.spinning : undefined} />
        {t('usage.pricing.sync')}
      </button>
      <button
        type="button"
        className={styles.primaryAction}
        onClick={() => openEditor()}
        disabled={!connected || !catalog || syncing}
      >
        <IconPlus size={15} />
        {t('usage.pricing.add')}
      </button>
    </>
  );

  const searchBar = (
    <div className={styles.searchBox}>
      <IconSearch size={15} className={styles.searchIcon} aria-hidden="true" />
      <input
        className={styles.searchInput}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={`${t('usage.columns.provider')} / ${t('usage.columns.model')}`}
        aria-label={t('usage.columns.model')}
      />
      {search && (
        <button
          type="button"
          className={styles.clearSearch}
          onClick={() => setSearch('')}
          aria-label={t('common.close')}
        >
          <IconX size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <UsageShell
      view="pricing"
      meta={metaSegments}
      actions={headerActions}
      toolbarExtra={searchBar}
    >
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}
      {loading && !catalog ? (
        <Skeleton height={280} rounded={16} />
      ) : catalog && filteredModels.length === 0 ? (
        <EmptyState
          title={t('usage.pricing.empty')}
          description={t('usage.pricing.empty_desc')}
          action={
            search ? (
              <Button variant="secondary" size="sm" onClick={() => setSearch('')}>
                {t('auth_files.filter_all')}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => openEditor()}>
                {t('usage.pricing.add')}
              </Button>
            )
          }
        />
      ) : catalog ? (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div className={styles.panelHeadCopy}>
              <span className={styles.eyebrow}>USD / 1M TOKENS</span>
              <h2 className={styles.panelTitle}>{t('usage.pricing.title')}</h2>
              <p className={styles.panelDescription}>{t('usage.pricing.description')}</p>
            </div>
          </header>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage.columns.provider')}</TableHead>
                <TableHead>{t('usage.columns.model')}</TableHead>
                <TableHead alignRight>{t('usage.pricing.input')}</TableHead>
                <TableHead alignRight>{t('usage.pricing.output')}</TableHead>
                <TableHead alignRight>{t('usage.pricing.cache_read')}</TableHead>
                <TableHead alignRight>{t('usage.pricing.cache_write')}</TableHead>
                <TableHead alignRight>{t('usage.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredModels.map((model) => {
                const modelKey = `${model.provider}/${model.model}`;
                const display = resolveModelDisplayPrices(model);
                const isExpanded = expandedTiers.has(modelKey);
                const hasMultipleTiers = display.tiers.length > 1;

                return (
                  <Fragment key={modelKey}>
                    <TableRow className={isExpanded ? styles.parentRowExpanded : undefined}>
                      <TableCell>
                        <span className={styles.providerChip}>{model.provider}</span>
                      </TableCell>
                      <TableCell>
                        <div className={styles.modelCell}>
                          <div className={styles.modelHeader}>
                            <span className={styles.modelPrimary}>{model.model}</span>
                            {display.isDynamic && (
                              <span
                                className={styles.dynamicTag}
                                title={model.expression}
                              >
                                {display.isConditional
                                  ? t('usage.pricing.tiered')
                                  : t('usage.pricing.dynamic')}
                              </span>
                            )}
                            {hasMultipleTiers && (
                              <button
                                type="button"
                                className={styles.tierToggleBtn}
                                onClick={() => toggleTierExpanded(modelKey)}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded
                                  ? t('common.collapse')
                                  : `${display.tiers.length} ${t('usage.pricing.pricing_tiers')}`}
                              </button>
                            )}
                          </div>
                          {model.expression && (
                            <code className={styles.expression} title={model.expression}>
                              {model.expression}
                            </code>
                          )}
                        </div>
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatPrice(display.input, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatPrice(display.output, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatPrice(display.cacheRead, i18n.language)}
                      </TableCell>
                      <TableCell alignRight className={styles.mono}>
                        {formatPrice(display.cacheWrite, i18n.language)}
                      </TableCell>
                      <TableCell alignRight>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => openEditor(model)}
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                          >
                            <IconPencil size={15} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            onClick={() => setDeleting(model)}
                            aria-label={t('common.delete')}
                            title={t('common.delete')}
                          >
                            <IconTrash2 size={15} />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded &&
                      display.tiers.map((tier) => (
                        <TableRow
                          key={`${modelKey}/tier/${tier.name}`}
                          className={styles.subTierRow}
                        >
                          <TableCell className={styles.subTierIndentCell}>
                            <span className={styles.tierSubMarker}>└</span>
                          </TableCell>
                          <TableCell>
                            <div className={styles.subTierIdentity}>
                              <span className={styles.tierBadge}>{tier.name}</span>
                            </div>
                          </TableCell>
                          <TableCell alignRight className={`${styles.mono} ${styles.subTierValue}`}>
                            {formatPrice(tier.input, i18n.language)}
                          </TableCell>
                          <TableCell alignRight className={`${styles.mono} ${styles.subTierValue}`}>
                            {formatPrice(tier.output, i18n.language)}
                          </TableCell>
                          <TableCell alignRight className={`${styles.mono} ${styles.subTierValue}`}>
                            {formatPrice(tier.cacheRead, i18n.language)}
                          </TableCell>
                          <TableCell alignRight className={`${styles.mono} ${styles.subTierValue}`}>
                            {formatPrice(tier.cacheWrite, i18n.language)}
                          </TableCell>
                          <TableCell alignRight />
                        </TableRow>
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <Modal
        open={Boolean(draft)}
        title={editing ? t('usage.pricing.edit') : t('usage.pricing.add')}
        onClose={() => setDraft(null)}
        closeDisabled={saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="pricing-form" loading={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <form id="pricing-form" className={styles.pricingForm} onSubmit={save}>
            <Input
              label={t('usage.columns.provider')}
              value={draft.provider}
              disabled={editing}
              required
              onChange={(event) => setDraft({ ...draft, provider: event.target.value })}
            />
            <Input
              label={t('usage.columns.model')}
              value={draft.model}
              disabled={editing}
              required
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            />
            <p className={styles.formHint}>{t('usage.pricing.unit_hint')}</p>
            <div className={styles.priceGrid}>
              {(
                [
                  ['input', 'input'],
                  ['output', 'output'],
                  ['cacheRead', 'cache_read'],
                  ['cacheWrite', 'cache_write'],
                ] as const
              ).map(([field, key]) => (
                <Input
                  key={field}
                  label={t(`usage.pricing.${key}`)}
                  type="number"
                  min="0"
                  step="0.000001"
                  value={draft[field]}
                  required
                  onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                />
              ))}
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(deleting)}
        title={t('usage.pricing.delete_title')}
        onClose={() => setDeleting(null)}
        closeDisabled={saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={saving} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>
          {t('usage.pricing.delete_confirm', {
            provider: deleting?.provider,
            model: deleting?.model,
          })}
        </p>
      </Modal>
    </UsageShell>
  );
}
