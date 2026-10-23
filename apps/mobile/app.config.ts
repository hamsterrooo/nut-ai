import type { ExpoConfig } from 'expo/config'

/**
 * App configuration.
 *
 * Every identity string lives in ONE place so the eventual rename is a one-file
 * change rather than a grep across the codebase. `Nut AI` was chosen over the
 * research documents' working codename `Tally`.
 */
const NAME = 'Nut AI'
const SLUG = 'nut-ai'
const BUNDLE_ID = 'com.nutai.app'
const SCHEME = 'nutai'

const config: ExpoConfig = {
  name: NAME,
  slug: SLUG,
  version: '0.1.0',
  // The mark: a white peanut silhouette inside four scan-frame corners on
  // near-black. Source of truth is assets/icon.svg; the PNGs are rendered
  // from it (rsvg-convert), never hand-edited.
  icon: './assets/icon.png',
  orientation: 'portrait',
  // Deep links carry widget taps and notification actions straight to a screen.
  scheme: SCHEME,
  userInterfaceStyle: 'automatic',
  // No `newArchEnabled` flag: the New Architecture is the default in SDK 57 and
  // the option was removed from ExpoConfig entirely. Setting it is now a
  // typecheck error, which is how this was caught.

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    infoPlist: {
      // Required by App Store review, and true: the app talks only to HTTPS
      // APIs (the vendor the user named, or Open Food Facts), which are exempt, so
      // there is no non-exempt encryption to declare.
      ITSAppUsesNonExemptEncryption: false,
      // Polish-only app: declaring the localization makes iOS render its own UI (alert
      // buttons, share sheet, document picker, keyboard) in Polish instead of English.
      CFBundleDevelopmentRegion: 'pl',
      CFBundleLocalizations: ['pl'],
      NSCameraUsageDescription:
        'Nut AI używa aparatu do fotografowania posiłków i skanowania kodów kreskowych. Zdjęcia zostają na urządzeniu, chyba że podczas konfiguracji wybierzesz dostawcę w chmurze.',
      NSPhotoLibraryUsageDescription:
        'Nut AI może odczytać zdjęcie posiłku, które już zrobiono. Zdjęcia zostają na urządzeniu, chyba że podczas konfiguracji wybierzesz dostawcę w chmurze.',
      NSFaceIDUsageDescription:
        'Nut AI używa Face ID wyłącznie przy odsłanianiu lub edycji zapisanego klucza API, nigdy przy zapisywaniu posiłku.',
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0B0B0F' },
    permissions: ['android.permission.CAMERA'],
    // No Google Play Services dependency: all notifications are local, there is
    // no push token and no FCM. Preserving that keeps F-Droid viable, which
    // matters for an AGPL project.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },

  plugins: [
    'expo-router',
    ['expo-camera', { cameraPermission: 'Nut AI używa aparatu do fotografowania posiłków i skanowania kodów kreskowych.' }],
    'expo-secure-store',
    'expo-sqlite',
    // Every builder signs with their own free Apple ID — see the plugin doc
    // comment for why this can only ever set the MODE (automatic), never a team.
    './plugins/withAutomaticSigning',
  ],

  experiments: { typedRoutes: true },

  extra: {
    // NEVER put an API key here. Keys are written only from runtime user input
    // into expo-secure-store — never from EXPO_PUBLIC_*, app config, .env, or EAS
    // secrets. Anything in `extra` ships in the bundle and is readable by anyone.
    bundleId: BUNDLE_ID,
  },
}

export default config
