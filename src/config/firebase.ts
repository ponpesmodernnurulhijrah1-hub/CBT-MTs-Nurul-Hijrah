import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

import { APP_VERSION } from './version';
export { APP_VERSION };

export const firebaseConfig = {
  apiKey: 'AIzaSyDW4jsS43wIbo6DqsPBxHv9CppqHkEQV_Y',
  authDomain: 'cbt-mas-nurul-hijrah.firebaseapp.com',
  databaseURL: 'https://cbt-mas-nurul-hijrah-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'cbt-mas-nurul-hijrah',
  storageBucket: 'cbt-mas-nurul-hijrah.firebasestorage.app',
  messagingSenderId: '677195675269',
  appId: '1:677195675269:web:02e6168d5f97ee05751bec',
  measurementId: 'G-99TVYEBXGE',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
    experimentalAutoDetectLongPolling: true,
    ignoreUndefinedProperties: true,
  });
} catch {
  firestoreInstance = getFirestore(app);
}

export const db = firestoreInstance;
