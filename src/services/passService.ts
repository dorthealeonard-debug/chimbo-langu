import { db, auth } from '../firebase';
import { doc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { state, notifyStateChange } from '../appState';
import { UserProfile, RouteHistoryEntry } from '../types';
import { processMobilePayment } from './payment';
import { unlockNavigation, checkAccessUnlocked } from './navigation';

/**
 * Checks if the user has an active access pass (free trial, daily, or weekly pass)
 */
export function checkPassActive(profile: UserProfile | null): boolean {
  if (!profile) return false;
  if (!profile.passType || profile.passType === 'none') return false;
  if (!profile.passExpiresAt) return false;
  
  const expiry = new Date(profile.passExpiresAt);
  const now = new Date();
  return expiry > now;
}

/**
 * Simulates purchasing a Daily or Weekly pass and registers it in Firestore.
 */
export async function purchasePass(
  passType: 'daily' | 'weekly',
  carrier: 'M-Pesa' | 'Tigo Pesa' | 'Airtel Money' | 'Card'
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !state.userProfile) {
    throw new Error('Authentication is required to purchase a pass.');
  }

  const amount = passType === 'daily' ? 1000 : 5000;
  
  // 1. Process payment entry in Firestore
  await processMobilePayment('system', amount, carrier);

  // 2. Calculate expiration
  const expiresAt = new Date();
  if (passType === 'daily') {
    expiresAt.setDate(expiresAt.getDate() + 1); // 24 hours
  } else {
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days
  }

  // 3. Update local state and Firestore user document
  const userRef = doc(db, 'users', user.uid);
  const updatedProfileData = {
    passType,
    passExpiresAt: expiresAt.toISOString(),
    routeHistory: state.userProfile.routeHistory || [],
    savedProviders: state.userProfile.savedProviders || []
  };

  await setDoc(userRef, updatedProfileData, { merge: true });

  // Sync state
  state.userProfile = {
    ...state.userProfile,
    ...updatedProfileData
  };
  notifyStateChange();
}

/**
 * Appends a route to the user's route history and generates accessTokens for providers
 */
export async function recordRouteInHistory(
  providerIds: string[],
  totalDistance: number,
  totalDuration: number
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !state.userProfile) return;

  const historyRef = state.userProfile.routeHistory || [];
  
  // Create history entry
  const newEntry: RouteHistoryEntry = {
    id: `route-${Math.floor(100000 + Math.random() * 900000)}`,
    providerIds,
    timestamp: new Date().toISOString(),
    totalDistance,
    totalDuration
  };

  const updatedHistory = [newEntry, ...historyRef];

  // Update user document
  const userRef = doc(db, 'users', user.uid);
  await setDoc(userRef, { routeHistory: updatedHistory }, { merge: true });

  // Unlock navigation tokens for each provider so their phone/address become visible
  for (const providerId of providerIds) {
    try {
      const isAlreadyUnlocked = await checkAccessUnlocked(providerId);
      if (!isAlreadyUnlocked) {
        await unlockNavigation(providerId, 'route-gen', 'product');
      }
    } catch (e) {
      console.warn(`Failed to auto-unlock details for provider ${providerId}:`, e);
    }
  }

  // Sync state
  state.userProfile.routeHistory = updatedHistory;
  notifyStateChange();
}

/**
 * Calculates the activation date of the user's active pass dynamically
 */
export function getPassActivationDate(profile: UserProfile): Date {
  if (!profile.passExpiresAt) return new Date(0);
  const expiry = new Date(profile.passExpiresAt);
  
  if (profile.passType === 'daily') {
    return new Date(expiry.getTime() - 24 * 60 * 60 * 1000);
  } else if (profile.passType === 'weekly') {
    return new Date(expiry.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (profile.passType === 'free_trial') {
    const trialExpiry = profile.trialExpiresAt ? new Date(profile.trialExpiresAt) : expiry;
    return new Date(trialExpiry.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(0);
}

/**
 * Checks if the user has reached their selection limit for the active pass
 */
export async function checkSelectionLimit(profile: UserProfile | null): Promise<{ allowed: boolean; limit: number; count: number }> {
  if (!profile) return { allowed: false, limit: 0, count: 0 };
  
  // Free trial has no selection limits
  if (profile.passType === 'free_trial') {
    return { allowed: true, limit: 999, count: 0 };
  }
  
  const limitVal = profile.passType === 'daily' ? 3 : (profile.passType === 'weekly' ? 7 : 0);
  if (limitVal === 0) return { allowed: false, limit: 0, count: 0 };
  
  const activationDate = getPassActivationDate(profile);
  
  // Fetch user's accessTokens created after activationDate
  const tokensSnap = await getDocs(query(
    collection(db, 'accessTokens'),
    where('userId', '==', profile.id)
  ));
  
  let count = 0;
  tokensSnap.forEach(d => {
    const data = d.data();
    if (data.createdAt) {
      const created = new Date(data.createdAt);
      if (created >= activationDate) {
        count++;
      }
    }
  });
  
  return {
    allowed: count < limitVal,
    limit: limitVal,
    count
  };
}
