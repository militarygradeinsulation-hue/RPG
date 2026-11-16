import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { GameStateSnapshot, LeaderboardRecord } from '../types/game';

const app = initializeApp(firebaseConfig);
function createFirestoreDb() {
  try {
    if (typeof window !== 'undefined') {
      return initializeFirestore(
        app,
        {
          experimentalForceLongPolling: true,
        },
        firebaseConfig.firestoreDatabaseId
      );
    }
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}
export const db = createFirestoreDb();
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function validateFirestoreConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const msg = error instanceof Error ? error.message : String(error);
    if (code === 'unavailable' || msg.includes('the client is offline')) {
      return false;
    }
    return true;
  }
}

export function subscribeAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle(): Promise<User> {
  const res = await signInWithPopup(auth, googleProvider);
  return res.user;
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'slot_1';
}

export async function saveGameToCloud(snapshot: GameStateSnapshot): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to sync to cloud.');
  const slotId = sanitizeId(snapshot.slotId);
  const docPath = `users/${user.uid}/saves/${slotId}`;
  const kingdomHealth = Math.round(
    Object.values(snapshot.biomes).reduce((acc, b) => acc + b.health, 0) / 4
  );

  const biomeHealthMap: Record<string, number> = {};
  Object.values(snapshot.biomes).forEach((b) => {
    biomeHealthMap[b.id] = Math.round(b.health);
  });

  const factionMap: Record<string, number> = {};
  Object.values(snapshot.factions).forEach((f) => {
    factionMap[f.id] = Math.round(f.reputation);
  });

  const questMap: Record<string, { status: string; step: number; choice: string }> = {};
  snapshot.quests.forEach((q) => {
    questMap[q.id] = { status: q.status, step: q.step, choice: q.chosenPath || '' };
  });

  const outpostMap: Record<string, number> = {};
  snapshot.outposts.forEach((o) => {
    outpostMap[o.id] = o.level;
  });

  const sealMap: Record<string, string> = {};
  snapshot.seals.forEach((s) => {
    sealMap[s.id] = s.status;
  });

  const payload = {
    ownerId: user.uid,
    slotId,
    slotName: snapshot.slotName.slice(0, 64),
    playerLevel: Math.max(1, Math.min(99, snapshot.player.level)),
    kingdomHealth: Math.max(0, Math.min(100, kingdomHealth)),
    moralAlignment: Math.max(-100, Math.min(100, Math.round(snapshot.player.moralAlignment))),
    elapsedSeconds: Math.max(0, Math.round(snapshot.elapsedSeconds)),
    season: snapshot.season,
    weather: snapshot.weather,
    playerState: {
      hp: Math.round(snapshot.player.hp),
      maxHp: Math.round(snapshot.player.maxHp),
      mana: Math.round(snapshot.player.mana),
      xp: Math.round(snapshot.player.xp),
      gold: Math.round(snapshot.player.gold),
      x: Number(snapshot.player.x.toFixed(2)),
      y: Number(snapshot.player.y.toFixed(2)),
      z: Number(snapshot.player.z.toFixed(2)),
      companionId: snapshot.player.companionId || '',
      equippedWeapon: snapshot.player.equippedWeapon,
      equippedRelic: snapshot.player.equippedRelic || '',
    },
    biomeHealth: biomeHealthMap,
    factions: factionMap,
    inventory: snapshot.inventory.slice(0, 40).map((i) => ({ id: i.id, qty: i.qty })),
    quests: questMap,
    outposts: outpostMap,
    seals: sealMap,
    skills: snapshot.unlockedSkills.slice(0, 24),
    journal: snapshot.discoveredJournal.slice(0, 30),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', user.uid, 'saves', slotId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function loadCloudSaves(): Promise<
  Array<{
    slotId: string;
    slotName: string;
    playerLevel: number;
    kingdomHealth: number;
    moralAlignment: number;
    elapsedSeconds: number;
    season: string;
    weather: string;
    playerState: Record<string, unknown>;
    biomeHealth: Record<string, number>;
    factions: Record<string, number>;
    inventory: { id: string; qty: number }[];
    quests: Record<string, { status: string; step: number; choice?: string }>;
    outposts: Record<string, number>;
    seals: Record<string, string>;
    skills: string[];
    journal: string[];
  }>
> {
  const user = auth.currentUser;
  if (!user) return [];
  const colPath = `users/${user.uid}/saves`;
  try {
    const q = query(collection(db, 'users', user.uid, 'saves'), where('ownerId', '==', user.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as never);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function submitLeaderboardScore(snapshot: GameStateSnapshot): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with Google to submit to the global leaderboard.');

  const kingdomHealth = Math.round(
    Object.values(snapshot.biomes).reduce((acc, b) => acc + b.health, 0) / 4
  );
  const sealsRestored = snapshot.seals.filter((s) => s.status !== 'corrupted').length;
  const speedBonus = Math.max(0, 600 - Math.floor(snapshot.elapsedSeconds / 3));
  const restorationScore = Math.min(
    1000000,
    kingdomHealth * 45 + sealsRestored * 600 + snapshot.player.level * 120 + speedBonus
  );

  const moralPath: 'Light' | 'Balanced' | 'Shadow' =
    snapshot.player.moralAlignment >= 18
      ? 'Light'
      : snapshot.player.moralAlignment <= -18
        ? 'Shadow'
        : 'Balanced';

  const docPath = `leaderboard/${user.uid}`;
  try {
    await setDoc(doc(db, 'leaderboard', user.uid), {
      ownerId: user.uid,
      displayName: (user.displayName || user.email?.split('@')[0] || 'Warden').slice(0, 40),
      restorationScore,
      kingdomHealth,
      elapsedSeconds: Math.max(0, Math.round(snapshot.elapsedSeconds)),
      moralPath,
      playerLevel: Math.max(1, Math.min(99, snapshot.player.level)),
      sealsRestored,
      isPublic: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardRecord[]> {
  const colPath = 'leaderboard';
  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('isPublic', '==', true),
      orderBy('restorationScore', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId || ''),
        displayName: String(data.displayName || 'Warden'),
        restorationScore: Number(data.restorationScore || 0),
        kingdomHealth: Number(data.kingdomHealth || 0),
        elapsedSeconds: Number(data.elapsedSeconds || 0),
        moralPath: (data.moralPath as 'Light' | 'Balanced' | 'Shadow') || 'Balanced',
        playerLevel: Number(data.playerLevel || 1),
        sealsRestored: Number(data.sealsRestored || 0),
      };
    });
  } catch (error) {
    // Fallback without composite index if index isn't ready
    try {
      const qSimple = query(collection(db, 'leaderboard'), where('isPublic', '==', true), limit(25));
      const snap = await getDocs(qSimple);
      return snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId || ''),
            displayName: String(data.displayName || 'Warden'),
            restorationScore: Number(data.restorationScore || 0),
            kingdomHealth: Number(data.kingdomHealth || 0),
            elapsedSeconds: Number(data.elapsedSeconds || 0),
            moralPath: (data.moralPath as 'Light' | 'Balanced' | 'Shadow') || 'Balanced',
            playerLevel: Number(data.playerLevel || 1),
            sealsRestored: Number(data.sealsRestored || 0),
          };
        })
        .sort((a, b) => b.restorationScore - a.restorationScore);
    } catch (innerErr) {
      handleFirestoreError(innerErr, OperationType.LIST, colPath);
    }
  }
}
