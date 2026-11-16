import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table/Table';
import { IconPencil, IconPlus, IconTrash2 } from '@/components/ui/icons';
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
import { isUsageDateRangeValid, pricingDraftToModel, type PricingDraft } from './model';
import styles from './UsagePage.module.scss';

type UsageView = 'summary' | 'events' | 'pricing';

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
const formatPrice = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);

function UsageShell({ view, children }: { view: UsageView; children: ReactNode }) {
  const { t } = useTranslation();
  const tabs: Array<{ view: UsageView; path: string }> = [
    { view: 'summary', path: '/usage' },
    { view: 'events', path: '/usage/events' },
    { view: 'pricing', path: '/usage/pricing' },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('usage.title')}</h1>
          <p className={styles.description}>{t('usage.description')}</p>
        </div>
        <nav className={styles.tabs} aria-label={t('usage.tabs_label')}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.view}
              to={tab.path}
              end={tab.view === 'summary'}
              className={`${styles.tab} ${view === tab.view ? styles.tabActive : ''}`}
              aria-current={view === tab.view ? 'page' : undefined}
            >
              {t(`usage.tabs.${tab.view}`)}
            </NavLink>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

export function UsageSummaryPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [from, setFrom] = useState(todayUTC);
  const [to, setTo] = useState(todayUTC);
  const [range, setRange] = useState(() => ({ from: todayUTC(), to: todayUTC() }));
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError('');
    try {
      setSummary(await usageHistoryApi.getSummary(range.from, range.to));
    } catch (loadError) {
      setError(getErrorMessage(loadError, t('usage.load_error')));
    } finally {
      setLoading(false);
    }
  }, [connected, range.from, range.to, t]);

  useHeaderRefresh(load, connected);
  useEffect(() => {
    void load();
  }, [load]);

  const totals = summary?.totals;
  const requestCount = totals?.requests ?? 0;
  const metrics = totals
    ? [
        {
          label: t('usage.metrics.requests'),
          value: formatNumber(totals.requests, i18n.language),
          hint: t('usage.summary.success_hint', {
            success: formatNumber(totals.success, i18n.language),
            failed: formatNumber(totals.failed, i18n.language),
          }),
        },
        {
          label: t('usage.metrics.tokens'),
          value: formatNumber(totals.total_tokens, i18n.language),
          hint: t('usage.summary.tokens_hint', {
            input: formatNumber(totals.input_tokens, i18n.language),
            output: formatNumber(totals.output_tokens, i18n.language),
          }),
        },
        {
          label: t('usage.metrics.cost'),
          value: formatUSD(totals.effective_cost_usd_micros, i18n.language),
          hint: t('usage.summary.cost_hint'),
        },
        {
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
        },
      ]
    : [];

  return (
    <UsageShell view="summary">
      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isUsageDateRangeValid(from, to)) {
            setError(t('usage.summary.invalid_range'));
            return;
          }
          if (range.from === from && range.to === to) void load();
          else setRange({ from, to });
        }}
      >
        <Input
          label={t('usage.summary.from')}
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <Input
          label={t('usage.summary.to')}
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
        <Button type="submit" loading={loading} disabled={!connected}>
          {t('usage.summary.apply')}
        </Button>
      </form>

      {error && <div className="error-box">{error}</div>}
      {loading && !summary ? (
        <div className={styles.loading}>
          <LoadingSpinner />
        </div>
      ) : summary ? (
        <>
          <section className={styles.metrics} aria-label={t('usage.summary.metrics_label')}>
            {metrics.map((metric) => (
              <article className={styles.metric} key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </article>
            ))}
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2>{t('usage.summary.daily_title')}</h2>
              <span>{t('usage.summary.utc_note')}</span>
            </div>
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
                    <TableCell alignRight>{formatNumber(day.requests, i18n.language)}</TableCell>
                    <TableCell alignRight>{formatNumber(day.success, i18n.language)}</TableCell>
                    <TableCell alignRight>{formatNumber(day.failed, i18n.language)}</TableCell>
                    <TableCell alignRight>
                      {formatNumber(day.total_tokens, i18n.language)}
                    </TableCell>
                    <TableCell alignRight>
                      {formatUSD(day.effective_cost_usd_micros, i18n.language)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </>
      ) : null}
    </UsageShell>
  );
}

export function UsageEventsPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [items, setItems] = useState<UsageEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (before?: number) => {
      if (!connected) return;
      if (before) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const page = await usageHistoryApi.getEvents(before);
        setItems((current) => (before ? [...current, ...page.items] : page.items));
        setNextBefore(page.next_before);
      } catch (loadError) {
        setError(getErrorMessage(loadError, t('usage.load_error')));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [connected, t]
  );

  const refresh = useCallback(() => load(), [load]);
  useHeaderRefresh(refresh, connected);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <UsageShell view="events">
      {error && <div className="error-box">{error}</div>}
      {loading ? (
        <div className={styles.loading}>
          <LoadingSpinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('usage.events.empty')} description={t('usage.events.empty_desc')} />
      ) : (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>{t('usage.events.title')}</h2>
            <span>{t('usage.events.redacted_note')}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage.columns.time')}</TableHead>
                <TableHead>{t('usage.columns.status')}</TableHead>
                <TableHead>{t('usage.columns.provider_model')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.tokens')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.latency')}</TableHead>
                <TableHead alignRight>{t('usage.metrics.cost')}</TableHead>
                <TableHead>{t('usage.columns.request_id')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.sequence}>
                  <TableCell className={styles.nowrap}>
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    }).format(new Date(item.timestamp))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`${styles.status} ${item.failed ? styles.statusFailed : styles.statusSuccess}`}
                    >
                      {item.failed ? t('usage.events.failed') : t('usage.events.success')}
                      {item.failure_status_code ? ` · ${item.failure_status_code}` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className={styles.stack}>
                      <strong>{item.provider || '—'}</strong>
                      <span>{item.model || '—'}</span>
                    </div>
                  </TableCell>
                  <TableCell alignRight>{formatNumber(item.total_tokens, i18n.language)}</TableCell>
                  <TableCell alignRight>
                    {formatNumber(item.latency_ms, i18n.language)} ms
                  </TableCell>
                  <TableCell alignRight>
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
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<PricingDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<PricingModel | null>(null);

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

  const openEditor = (model?: PricingModel) => {
    setEditing(Boolean(model));
    setDraft(
      model
        ? {
            provider: model.provider,
            model: model.model,
            input: String(model.base_prices.input),
            output: String(model.base_prices.output),
            cacheRead: String(model.base_prices.cache_read),
            cacheWrite: String(model.base_prices.cache_write),
          }
        : { ...emptyPricingDraft }
    );
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

  return (
    <UsageShell view="pricing">
      <div className={styles.pricingToolbar}>
        <div>
          <h2>{t('usage.pricing.title')}</h2>
          <p>{t('usage.pricing.description')}</p>
        </div>
        <Button onClick={() => openEditor()} disabled={!connected || !catalog}>
          <span className={styles.buttonLabel}>
            <IconPlus size={16} />
            {t('usage.pricing.add')}
          </span>
        </Button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {loading && !catalog ? (
        <div className={styles.loading}>
          <LoadingSpinner />
        </div>
      ) : catalog && catalog.models.length === 0 ? (
        <EmptyState
          title={t('usage.pricing.empty')}
          description={t('usage.pricing.empty_desc')}
          action={
            <Button variant="secondary" onClick={() => openEditor()}>
              {t('usage.pricing.add')}
            </Button>
          }
        />
      ) : catalog ? (
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
            {catalog.models.map((model) => (
              <TableRow key={`${model.provider}/${model.model}`}>
                <TableCell>{model.provider}</TableCell>
                <TableCell className={styles.mono}>{model.model}</TableCell>
                <TableCell alignRight>
                  {formatPrice(model.base_prices.input, i18n.language)}
                </TableCell>
                <TableCell alignRight>
                  {formatPrice(model.base_prices.output, i18n.language)}
                </TableCell>
                <TableCell alignRight>
                  {formatPrice(model.base_prices.cache_read, i18n.language)}
                </TableCell>
                <TableCell alignRight>
                  {formatPrice(model.base_prices.cache_write, i18n.language)}
                </TableCell>
                <TableCell alignRight>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      onClick={() => openEditor(model)}
                      aria-label={t('common.edit')}
                    >
                      <IconPencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(model)}
                      aria-label={t('common.delete')}
                    >
                      <IconTrash2 size={16} />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
