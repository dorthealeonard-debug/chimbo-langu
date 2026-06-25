import { auth, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile } from './types';

export type AppView = 
  | 'home' 
  | 'search' 
  | 'detail' 
  | 'access' 
  | 'saved' 
  | 'navigation' 
  | 'onboarding' 
  | 'provider-dashboard' 
  | 'admin-dashboard' 
  | 'admin-provider-review' 
  | 'admin-reports' 
  | 'admin-fraud'
  | 'auth';

export interface AppState {
  currentView: AppView;
  currentUser: User | null;
  userProfile: UserProfile | null;
  selectedProductId: string | null;
  selectedProviderId: string | null;
  activeSearchQuery: string;
  userLocation: { lat: number; lon: number };
  savedProductIds: string[];
  selectedRouteProductIds: string[];
  isLoggingIn?: boolean;
  firestoreError?: {
    collectionName: string;
    documentPath: string;
    operationType: string;
    uid: string | null;
    role: string;
    error: string;
  } | null;
}

// Default state: Home page, center coordinate at Kariakoo Market, Dar es Salaam
export const state: AppState = {
  currentView: 'home',
  currentUser: null,
  userProfile: null,
  selectedProductId: null,
  selectedProviderId: null,
  activeSearchQuery: 'Samsung A56',
  userLocation: { lat: -6.8184, lon: 39.2826 },
  savedProductIds: [],
  selectedRouteProductIds: [],
  isLoggingIn: false,
  firestoreError: null
};

// Set up simple local state listeners
type StateListener = () => void;
const listeners = new Set<StateListener>();

export function subscribeToState(listener: StateListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyStateChange() {
  listeners.forEach(l => l());
}

export function navigateTo(view: AppView, productId: string | null = null, providerId: string | null = null) {
  state.currentView = view;
  if (productId) state.selectedProductId = productId;
  if (providerId) state.selectedProviderId = providerId;
  notifyStateChange();
}

// Saved / favorites tracker
export function toggleSaveProduct(productId: string) {
  const index = state.savedProductIds.indexOf(productId);
  if (index === -1) {
    state.savedProductIds.push(productId);
  } else {
    state.savedProductIds.splice(index, 1);
  }
  notifyStateChange();
}

export function isProductSaved(productId: string): boolean {
  return state.savedProductIds.includes(productId);
}

// Date/Timestamp formatting helper to normalize Firestore fields to ISO strings
export function formatDateToString(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val && typeof val.toDate === 'function') return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (val && typeof val.seconds === 'number') {
    return new Date(val.seconds * 1000).toISOString();
  }
  return String(val);
}

// Role redirection helper
export function getRedirectViewForRole(role: string | undefined): AppView {
  const r = role?.toLowerCase() || 'customer';
  switch (r) {
    case 'provider':
      return 'provider-dashboard';
    case 'staff':
    case 'admin':
    case 'superadmin':
      return 'admin-dashboard';
    case 'customer':
    default:
      return 'home';
  }
}

// Initialize Auth Listener
export function initAppState() {
  onAuthStateChanged(auth, async (user) => {
    state.firestoreError = null;
    state.currentUser = user;
    let role: UserProfile['role'] = 'customer';
    let targetView: AppView = 'home';

    try {
      if (user) {
        // Ensure user profile exists or seed it in Firestore
        const userRef = doc(db, 'users', user.uid);
        let userSnap;
        try {
          userSnap = await getDoc(userRef);
        } catch (err: any) {
          console.log(
            "Collection:",
            "users",
            "UID:",
            auth.currentUser?.uid,
            "Role:",
            role
          );
          console.log("Diag details: " + JSON.stringify({
            operation: "get",
            path: `users/${user.uid}`,
            error: err.message || String(err)
          }));
          state.firestoreError = {
            collectionName: "users",
            documentPath: `users/${user.uid}`,
            operationType: "get",
            uid: user.uid,
            role: role,
            error: err.message || String(err)
          };
          throw err;
        }

        const email = user.email || '';
        let initialRole: 'customer' | 'provider' | 'staff' | 'admin' | 'superadmin' = 'customer';
        if (email === 'dorthealeonard@gmail.com' || email === 'admin@chimbo.com' || (email.endsWith('@chimbo.com') && !email.startsWith('customer') && !email.startsWith('provider')) || email.toLowerCase().includes('admin')) {
          initialRole = 'admin';
        } else if (email.toLowerCase().includes('staff')) {
          initialRole = 'staff';
        }

        if (userSnap.exists()) {
          const uProfile = userSnap.data() as UserProfile;
          console.log("[Auth Diagnostic] Existing user document keys:", Object.keys(uProfile), "data:", JSON.stringify(uProfile));
          
          // Normalize date fields from legacy Timestamp objects to standard strings
          uProfile.createdAt = formatDateToString(uProfile.createdAt) || new Date().toISOString();
          if (uProfile.passExpiresAt) uProfile.passExpiresAt = formatDateToString(uProfile.passExpiresAt);
          if (uProfile.trialExpiresAt) uProfile.trialExpiresAt = formatDateToString(uProfile.trialExpiresAt);
          
          role = uProfile.role || 'customer';
          
          // Auto-upgrade existing test users to admin/staff if their email matches criteria
          if (role !== initialRole && initialRole !== 'customer') {
            role = initialRole;
            uProfile.role = initialRole as any;
            const cleanProfile: UserProfile = {
              id: user.uid,
              name: uProfile.name || user.displayName || 'Mteja Mwaminifu',
              phoneNumber: uProfile.phoneNumber || user.phoneNumber || '',
              email: email,
              role: initialRole,
              createdAt: uProfile.createdAt,
              passType: uProfile.passType || 'none',
              passExpiresAt: uProfile.passExpiresAt || '',
              trialExpiresAt: uProfile.trialExpiresAt || '',
              routeHistory: uProfile.routeHistory || [],
              savedProviders: uProfile.savedProviders || []
            };
            if (uProfile.status) cleanProfile.status = uProfile.status;

            try {
              await setDoc(userRef, cleanProfile);
            } catch (err: any) {
              console.log(
                "Collection:",
                "users",
                "UID:",
                auth.currentUser?.uid,
                "Role:",
                role
              );
              console.log("Diag details: " + JSON.stringify({
                operation: "set (merge: role)",
                path: `users/${user.uid}`,
                error: err.message || String(err)
              }));
              state.firestoreError = {
                collectionName: "users",
                documentPath: `users/${user.uid}`,
                operationType: "set (merge: role)",
                uid: user.uid,
                role: role,
                error: err.message || String(err)
              };
              throw err;
            }
            console.log(`[Auth Diagnostic] Auto-upgraded role to ${initialRole} for user ${email}`);
          }

          // Initialize trial for existing users if missing pass fields
          if (!uProfile.passType || uProfile.passType === 'none') {
            const trialExpiry = new Date();
            trialExpiry.setDate(trialExpiry.getDate() + 7);

            try {
              await setDoc(userRef, {
                passType: 'free_trial',
                passExpiresAt: trialExpiry.toISOString(),
                trialExpiresAt: trialExpiry.toISOString(),
                routeHistory: uProfile.routeHistory || [],
                savedProviders: uProfile.savedProviders || []
              }, { merge: true });
              
              uProfile.passType = 'free_trial';
              uProfile.passExpiresAt = trialExpiry.toISOString();
              uProfile.trialExpiresAt = trialExpiry.toISOString();
              uProfile.routeHistory = uProfile.routeHistory || [];
              uProfile.savedProviders = uProfile.savedProviders || [];
            } catch (err: any) {
              console.warn(
                "[Auth Diagnostic Warning] Trial initialization failed but continuing app load:",
                err
              );
              // Set local fallback fields so the app functions in-memory
              uProfile.passType = 'free_trial';
              uProfile.passExpiresAt = trialExpiry.toISOString();
              uProfile.trialExpiresAt = trialExpiry.toISOString();
              uProfile.routeHistory = uProfile.routeHistory || [];
              uProfile.savedProviders = uProfile.savedProviders || [];
            }
          }
          state.userProfile = uProfile;
        } else {
          const trialExpiry = new Date();
          trialExpiry.setDate(trialExpiry.getDate() + 7);
          const newProfile: UserProfile = {
            id: user.uid,
            name: user.displayName || (initialRole === 'admin' ? 'Administrator' : initialRole === 'staff' ? 'Field Staff' : 'Mteja Mwaminifu'),
            phoneNumber: user.phoneNumber || '',
            email: email,
            role: initialRole,
            createdAt: new Date().toISOString(),
            passType: 'free_trial',
            passExpiresAt: trialExpiry.toISOString(),
            trialExpiresAt: trialExpiry.toISOString(),
            routeHistory: [],
            savedProviders: []
          };
          try {
            await setDoc(userRef, newProfile);
          } catch (err: any) {
            console.log(
              "Collection:",
              "users",
              "UID:",
              auth.currentUser?.uid,
              "Role:",
              initialRole
            );
            state.firestoreError = {
              collectionName: "users",
              documentPath: `users/${user.uid}`,
              operationType: "set (create)",
              uid: user.uid,
              role: initialRole,
              error: err.message || String(err)
            };
            throw err;
          }
          state.userProfile = newProfile;
          role = initialRole;
        }
        targetView = getRedirectViewForRole(role);
      } else {
        state.userProfile = null;
        targetView = 'home';
      }

      console.log(`[Auth Diagnostic] UID: ${user?.uid || 'Guest'}, Role: ${role}, Redirect Target: ${targetView}`);

      // Immediately route user to their dashboard if they loaded the app at 'home'
      // or if they are on 'auth' and we are not in an explicit login flow transition.
      if (!state.isLoggingIn) {
        if (state.currentView === 'auth' || (state.currentView === 'home' && targetView !== 'home')) {
          state.currentView = targetView;
        }
      }
    } catch (err: any) {
      console.error("[Auth Diagnostic Error] Failed during startup:", err);
      if (!state.firestoreError) {
        state.firestoreError = {
          collectionName: "users",
          documentPath: user ? `users/${user.uid}` : "unknown",
          operationType: "startup",
          uid: user ? user.uid : null,
          role: role,
          error: err.message || String(err)
        };
      }
    } finally {
      notifyStateChange();
    }
  });

  // Auto-seeding is strictly disabled per user directive. Starting with an empty database.
}

(window as any).appState = { state, navigateTo, getRedirectViewForRole, auth, db };
