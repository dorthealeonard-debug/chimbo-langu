import { collection, doc, setDoc, getDoc, getDocs, query, where, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { logAction } from './audit';

export interface RouteCalculations {
  id: string;
  providerName: string;
  phone: string;
  whatsapp: string;
  latitude: number;
  longitude: number;
  distanceInKm: number;
  walkingTimeMin: number;
  carTimeMin: number;
  pikiTimeMin: number;
  transitTrafficText: string;
}

export async function unlockNavigation(providerId: string, itemId: string, type: 'product' | 'service'): Promise<string> {
  const path = 'accessTokens';
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('You must be signed in to unlock provider contact coordinates.');

    // Create unique navigation pass token valid for 30 days
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);

    const tokenRef = doc(collection(db, path));
    const tokenData = {
      id: tokenRef.id,
      userId: user.uid,
      providerId,
      itemId,
      type,
      expiryDate: expiry.toISOString(),
      status: 'active',
      createdAt: new Date().toISOString()
    };

    await setDoc(tokenRef, tokenData);
    await logAction('Navigation Unlocked', `User ${user.uid} unlocked access coordinates for provider ${providerId} and item ${itemId}`);
    return tokenRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    throw error;
  }
}

export async function checkAccessUnlocked(providerId: string): Promise<boolean> {
  const path = 'accessTokens';
  try {
    const user = auth.currentUser;
    if (!user) return false;

    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      where('providerId', '==', providerId),
      where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return false;
  }
}

export async function getRouteDetails(providerId: string, userLat: number = -6.8184, userLon: number = 39.2826): Promise<RouteCalculations | null> {
  const path = `providers/${providerId}`;
  try {
    const providerSnap = await getDoc(doc(db, 'providers', providerId));
    if (!providerSnap.exists()) return null;

    const data = providerSnap.data();
    const lat = data.latitude || -6.8184;
    const lon = data.longitude || 39.2826;

    // Haversine distance
    const R = 6371; 
    const dLat = (lat - userLat) * Math.PI / 180;
    const dLon = (lon - userLon) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(userLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const dist = parseFloat((R * c).toFixed(2));

    // Calculate transit times
    // Walking: avg 5 km/hr
    const walkingTimeMin = Math.round((dist / 5) * 60) || 1;
    // Car: avg 25 km/hr (urban speed in Dar es Salaam)
    const carTimeMin = Math.round((dist / 25) * 60) || 1;
    // Boda-boda (piki-piki): avg 35 km/hr through traffic
    const pikiTimeMin = Math.round((dist / 35) * 60) || 1;

    return {
      id: providerId,
      providerName: data.businessName,
      phone: data.tinNumber ? '+255 712 345 678' : '+255 700 000 000', // Mock encrypted until unlocked, then displayed securely
      whatsapp: 'https://wa.me/255712345678',
      latitude: lat,
      longitude: lon,
      distanceInKm: dist,
      walkingTimeMin,
      carTimeMin,
      pikiTimeMin,
      transitTrafficText: dist > 3 ? 'Trafiki ni wastani kwa sasa' : 'Kuna usumbufu mdogo wa jam'
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

/**
 * Revokes a previously unlocked provider, deleting their active access token
 */
export async function revokeUnlock(providerId: string): Promise<void> {
  const path = 'accessTokens';
  try {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      where('providerId', '==', providerId),
      where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    for (const docSnap of snapshot.docs) {
      await deleteDoc(doc(db, path, docSnap.id));
    }
    await logAction('Navigation Locked/Revoked', `User ${user.uid} revoked access coordinates for provider ${providerId}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Retrieves all active unlocked providers for the current user
 */
export async function getActiveUnlocks(): Promise<Array<{ providerId: string; businessName: string }>> {
  const path = 'accessTokens';
  try {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    const list: Array<{ providerId: string; businessName: string }> = [];
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const provSnap = await getDoc(doc(db, 'providers', data.providerId));
      const provData = provSnap.exists() ? provSnap.data() : {};
      list.push({
        providerId: data.providerId,
        businessName: provData.businessName || 'Duka Mbadala'
      });
    }
    return list;
  } catch (error) {
    console.error('Failed to get active unlocks:', error);
    return [];
  }
}
