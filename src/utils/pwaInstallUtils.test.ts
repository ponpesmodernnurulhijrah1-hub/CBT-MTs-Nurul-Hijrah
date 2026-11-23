import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallContext, resolveInstallAvailability } from './pwaInstallUtils';

test('detectInstallContext identifies standalone, iOS, iPadOS, Android, and in-app WebViews', () => {
  const androidChrome = detectInstallContext({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
    matchMediaStandalone: false,
    isInIframe: false,
    isSecureContext: true,
  });
  assert.equal(androidChrome.isAndroid, true);
  assert.equal(androidChrome.isIOS, false);
  assert.equal(androidChrome.isInAppBrowser, false);
  assert.equal(androidChrome.isStandalone, false);
  assert.equal(androidChrome.browserKind, 'chrome');

  const whatsappWebView = detectInstallContext({
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.10',
    maxTouchPoints: 5,
    isSecureContext: true,
  });
  assert.equal(whatsappWebView.isInAppBrowser, true);
  assert.equal(whatsappWebView.isAndroid, true);
  assert.equal(whatsappWebView.browserKind, 'webview');

  const iPadSafari = detectInstallContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    maxTouchPoints: 5,
    navigatorStandalone: false,
    isSecureContext: true,
  });
  assert.equal(iPadSafari.isIOS, true);
  assert.equal(iPadSafari.browserKind, 'safari-ios');

  const edgeDesktop = detectInstallContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    isSecureContext: true,
  });
  assert.equal(edgeDesktop.browserKind, 'edge');

  const firefoxAndroid = detectInstallContext({
    userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
    isSecureContext: true,
  });
  assert.equal(firefoxAndroid.browserKind, 'firefox');

  const installedPwa = detectInstallContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0',
    matchMediaStandalone: true,
    isSecureContext: true,
  });
  assert.equal(installedPwa.isStandalone, true);
});

test('resolveInstallAvailability prioritizes installed -> native_prompt -> open_in_browser -> insecure -> ios_safari -> shortcut menu', () => {
  const baseContext = detectInstallContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36',
    isSecureContext: true,
  });

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: true,
      context: { ...baseContext, isStandalone: true },
    }),
    'installed'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: true,
      context: baseContext,
    }),
    'native_prompt'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: false,
      context: { ...baseContext, isEmbeddedIframe: true },
    }),
    'open_in_browser'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: false,
      context: { ...baseContext, isInAppBrowser: true },
    }),
    'open_in_browser'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: false,
      context: { ...baseContext, isSecureContext: false },
    }),
    'insecure_context'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: false,
      context: { ...baseContext, isIOS: true, isAndroid: false },
    }),
    'ios_safari'
  );

  assert.equal(
    resolveInstallAvailability({
      hasDeferredPrompt: false,
      context: baseContext,
    }),
    'browser_menu_shortcut'
  );
});
