export type BrowserKind =
  | 'chrome'
  | 'edge'
  | 'safari-ios'
  | 'safari-mac'
  | 'samsung'
  | 'firefox'
  | 'webview'
  | 'other';

export interface InstallContextInput {
  userAgent?: string;
  maxTouchPoints?: number;
  matchMediaStandalone?: boolean;
  navigatorStandalone?: boolean;
  isInIframe?: boolean;
  isSecureContext?: boolean;
}

export interface InstallContext {
  isStandalone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isInAppBrowser: boolean;
  isEmbeddedIframe: boolean;
  isSecureContext: boolean;
  browserKind: BrowserKind;
}

export type InstallAvailabilityMode =
  | 'installed'
  | 'native_prompt'
  | 'open_in_browser'
  | 'ios_safari'
  | 'insecure_context'
  | 'browser_menu_shortcut';

export interface InstallAvailabilityInput {
  hasDeferredPrompt: boolean;
  context: InstallContext;
}

const IN_APP_BROWSER_RE =
  /whatsapp|instagram|fban|fbav|fb_iab|line\/|tiktok|musical_ly|micromessenger|gsa\/|; wv\)/i;

export function detectBrowserKind(
  userAgent: string,
  isIOS: boolean,
  isInAppBrowser: boolean
): BrowserKind {
  const ua = (userAgent || '').toLowerCase();
  if (isInAppBrowser) return 'webview';
  if (/samsungbrowser\//.test(ua)) return 'samsung';
  if (/edg\/|edga\/|edgios\//.test(ua)) return 'edge';
  if (/firefox\/|fxios\//.test(ua)) return 'firefox';
  if (isIOS) {
    if (/crios\//.test(ua)) return 'chrome';
    return 'safari-ios';
  }
  if (/chrome\/|chromium\//.test(ua) && !/opr\/|opera/.test(ua)) return 'chrome';
  if (/safari\//.test(ua) && !/chrome\/|chromium\//.test(ua)) return 'safari-mac';
  return 'other';
}

/**
 * Detects runtime browser & OS capabilities affecting PWA installation and shortcut creation.
 */
export function detectInstallContext(input: InstallContextInput): InstallContext {
  const ua = (input.userAgent || '').toLowerCase();
  const maxTouch = input.maxTouchPoints ?? 0;

  const isStandalone = Boolean(input.matchMediaStandalone || input.navigatorStandalone);
  const isIPadDesktopMode = ua.includes('macintosh') && maxTouch > 1;
  const isIOS = /iphone|ipad|ipod/.test(ua) || isIPadDesktopMode;
  const isAndroid = ua.includes('android');
  const isInAppBrowser = IN_APP_BROWSER_RE.test(ua);
  const browserKind = detectBrowserKind(ua, isIOS, isInAppBrowser);

  return {
    isStandalone,
    isIOS,
    isAndroid,
    isInAppBrowser,
    isEmbeddedIframe: Boolean(input.isInIframe),
    isSecureContext: input.isSecureContext ?? true,
    browserKind,
  };
}

/**
 * Classifies the exact installation / shortcut guidance path the UI should present.
 */
export function resolveInstallAvailability(
  input: InstallAvailabilityInput
): InstallAvailabilityMode {
  const { hasDeferredPrompt, context } = input;

  if (context.isStandalone) {
    return 'installed';
  }
  if (hasDeferredPrompt) {
    return 'native_prompt';
  }
  if (context.isEmbeddedIframe || context.isInAppBrowser) {
    return 'open_in_browser';
  }
  if (!context.isSecureContext) {
    return 'insecure_context';
  }
  if (context.isIOS) {
    return 'ios_safari';
  }
  return 'browser_menu_shortcut';
}
