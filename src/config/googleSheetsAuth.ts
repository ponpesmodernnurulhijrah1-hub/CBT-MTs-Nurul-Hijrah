import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'] as const;

const WORKSPACE_APP_NAME = 'google-workspace-auth';

let workspaceAppInstance: FirebaseApp | null = null;
let workspaceAuthInstance: Auth | null = null;

function getWorkspaceAuth(): Auth {
  if (workspaceAuthInstance) return workspaceAuthInstance;
  const existing = getApps().find((app) => app.name === WORKSPACE_APP_NAME);
  workspaceAppInstance = existing ?? initializeApp(firebaseAppletConfig, WORKSPACE_APP_NAME);
  workspaceAuthInstance = getAuth(workspaceAppInstance);
  return workspaceAuthInstance;
}

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Strict in-memory access token cache (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleSheetsAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  const auth = getWorkspaceAuth();
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const signInWithGoogleSheets = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  const auth = getWorkspaceAuth();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh izin akses Google Sheets dari akun Google.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getGoogleSheetsAccessToken = (): string | null => cachedAccessToken;

export const clearGoogleSheetsToken = (): void => {
  cachedAccessToken = null;
};

export const signOutGoogleSheets = async (): Promise<void> => {
  const auth = getWorkspaceAuth();
  cachedAccessToken = null;
  await auth.signOut();
};
