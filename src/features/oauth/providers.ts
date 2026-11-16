import type { BuiltInOAuthProvider } from '@/services/api';
import { getPluginTitle, resolvePluginAssetURL } from '@/features/plugins/pluginResources';
import type { PluginListEntry } from '@/types';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';

export type ThemedIcon = string | { light: string; dark: string };

/** 设备码流程会返回 user_code；浏览器流程依赖回调（本地自动 / 远程手动粘贴）。 */
export type OAuthFlowKind = 'device' | 'browser';

export interface BuiltInOAuthProviderCard {
  kind: 'builtin';
  id: BuiltInOAuthProvider;
  /** 磁贴短名：品牌名是常量（与仪表盘 providerLabel 一致），区域站点走 i18n。 */
  label: string | { key: string };
  /** 对话框标题，沿用 `auth_login.<id>_oauth_title`。 */
  titleKey: string;
  icon: ThemedIcon;
  flow: OAuthFlowKind;
  /** 区分同品牌的不同站点，磁贴副行展示。 */
  domain?: string;
}

export interface PluginOAuthProviderCard {
  kind: 'plugin';
  id: string;
  title: string;
  icon: string;
}

export type OAuthProviderCard = BuiltInOAuthProviderCard | PluginOAuthProviderCard;

export const OAUTH_PROVIDERS: BuiltInOAuthProviderCard[] = [
  {
    kind: 'builtin',
    id: 'codex',
    label: 'Codex',
    titleKey: 'auth_login.codex_oauth_title',
    icon: iconCodex,
    flow: 'browser',
  },
  {
    kind: 'builtin',
    id: 'anthropic',
    label: 'Claude',
    titleKey: 'auth_login.anthropic_oauth_title',
    icon: iconClaude,
    flow: 'browser',
  },
  {
    kind: 'builtin',
    id: 'antigravity',
    label: 'Antigravity',
    titleKey: 'auth_login.antigravity_oauth_title',
    icon: iconAntigravity,
    flow: 'browser',
  },
];

const BUILTIN_PROVIDER_IDS = new Set<string>(OAUTH_PROVIDERS.map((provider) => provider.id));

/** 后端接受手动回调提交的内置提供商；插件提供商一律允许。 */
export const CALLBACK_SUPPORTED = new Set<string>([
  'codex',
  'anthropic',
  'antigravity',
]);

export const supportsManualCallback = (provider: OAuthProviderCard): boolean =>
  provider.kind === 'plugin' || CALLBACK_SUPPORTED.has(provider.id);

export const resolveThemedIcon = (icon: ThemedIcon, theme: 'light' | 'dark'): string =>
  typeof icon === 'string' ? icon : icon[theme];

/**
 * 一个插件可能声明多个登录入口（各自带标题与图标），每个入口一张卡；
 * v8.0.49 之前只有单个 `oauth_provider`，那时仍然只出一张卡。
 */
export const buildPluginOAuthProviderCards = (
  plugins: PluginListEntry[],
  apiBase: string
): PluginOAuthProviderCard[] => {
  const seenProviders = new Set(BUILTIN_PROVIDER_IDS);
  return plugins.flatMap((plugin) => {
    if (!plugin.supportsOAuth || !plugin.effectiveEnabled) return [];
    const declared = plugin.oauthProviders?.length
      ? plugin.oauthProviders
      : plugin.oauthProvider
        ? [plugin.oauthProvider]
        : [];
    const pluginTitle = getPluginTitle(plugin);
    const pluginLogo = plugin.logo || plugin.metadata?.logo || '';
    return declared.flatMap((provider) => {
      if (seenProviders.has(provider)) return [];
      seenProviders.add(provider);
      const entry = plugin.oauthProviderEntries?.find((item) => item.identifier === provider);
      return [
        {
          kind: 'plugin' as const,
          id: provider,
          title: entry?.name?.trim() || pluginTitle,
          icon: resolvePluginAssetURL(entry?.logo?.trim() || pluginLogo, apiBase),
        },
      ];
    });
  });
};
