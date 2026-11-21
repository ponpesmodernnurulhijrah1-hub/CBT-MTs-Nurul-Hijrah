/**
 * Single source of truth for the application release version.
 * Both client (`useAppUpdater`) and server (`/api/version`) read this exact constant
 * so updates are ONLY triggered when an intentional release change is deployed.
 */
export const APP_VERSION = '2026.11.21-v6';
