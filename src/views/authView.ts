import { state, navigateTo } from '../appState';
import { auth, db, loginWithGoogle } from '../firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  updateProfile
} from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { UserProfile } from '../types';

let emailMode: 'login' | 'register' = 'login';
let errorMessage = '';
let successMessage = '';
let authLoading = false;

const tempFields = {
  email: '',
  password: '',
  name: ''
};

/**
 * Handles post-login routing based on User Type, Provider Status, and Subscription Status.
 * This is the official routing engine of CHIMBO.
 */
export async function determineAndRouteUser(user: any) {
  state.isLoggingIn = true;
  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    let role = 'customer';
    if (userSnap.exists()) {
      role = userSnap.data()?.role || 'customer';
    }

    // Admins and staff go directly to the Admin Dashboard
    if (role === 'admin' || role === 'superadmin' || role === 'staff') {
      state.isLoggingIn = false;
      navigateTo('admin-dashboard');
      return;
    }

    // Check provider profile
    const provRef = doc(db, 'providers', user.uid);
    const provSnap = await getDoc(provRef);
    if (!provSnap.exists()) {
      // No provider profile -> Open Customer Portal
      state.isLoggingIn = false;
      navigateTo('home');
      return;
    }

    const provider = provSnap.data();
    const status = provider?.status || provider?.providerStatus || 'not_registered';

    if (status === 'draft') {
      // Open Continue Registration page
      state.isLoggingIn = false;
      navigateTo('onboarding');
      return;
    }

    if (status === 'pending' || status === 'documents_under_review' || status === 'field_verification') {
      // Open Provider Status page (Status Tracker)
      state.isLoggingIn = false;
      navigateTo('onboarding');
      return;
    }

    if (status === 'approved') {
      // Show Portal Selection (rendered on Profile page)
      state.isLoggingIn = false;
      navigateTo('auth');
      return;
    }

    if (status === 'rejected') {
      // Show rejection reason (Status Tracker)
      state.isLoggingIn = false;
      navigateTo('onboarding');
      return;
    }

    if (status === 'suspended') {
      // Disable Provider Portal (Status Tracker / Lockout)
      state.isLoggingIn = false;
      navigateTo('onboarding');
      return;
    }

    // Fallback
    state.isLoggingIn = false;
    navigateTo('home');
  } catch (err) {
    console.error('[Routing Error] Failed to determine route on login:', err);
    state.isLoggingIn = false;
    navigateTo('home');
  }
}

export async function renderAuthView(): Promise<string> {
  const user = state.currentUser;
  
  // ==========================================
  // CASE A: USER IS LOGGED IN (Renders Profile / Account Details)
  // ==========================================
  if (user) {
    // 1. Fetch provider document to check status
    const provRef = doc(db, 'providers', user.uid);
    let provider: any = null;
    try {
      const provSnap = await getDoc(provRef);
      provider = provSnap.exists() ? provSnap.data() : null;
    } catch (e) {
      console.error("Failed to fetch provider doc in profile:", e);
    }
    
    // 2. Fetch subscription to determine subscription status
    let subscriptionStatusText = 'None';
    try {
      const subQ = query(collection(db, 'subscriptions'), where('providerId', '==', user.uid));
      const subSnapshot = await getDocs(subQ);
      let activeSub: any = null;
      subSnapshot.forEach(docSnap => {
        activeSub = { id: docSnap.id, ...docSnap.data() };
      });
      
      let isTrialExpired = false;
      if (provider?.trialExpiresAt) {
        const expiry = new Date(provider.trialExpiresAt);
        if (new Date() > expiry) {
          isTrialExpired = true;
        }
      }
      
      const isSubscriptionActive = activeSub && activeSub.status === 'active' && new Date() <= new Date(activeSub.expiresAt);
      if (isSubscriptionActive) {
        subscriptionStatusText = 'Active';
      } else if (provider?.trialExpiresAt && !isTrialExpired) {
        subscriptionStatusText = `Active (Trial Ends ${new Date(provider.trialExpiresAt).toLocaleDateString('sw-TZ')})`;
      } else if (provider?.trialExpiresAt && isTrialExpired && !isSubscriptionActive) {
        subscriptionStatusText = 'Expired';
      }
    } catch (e) {
      console.error("Failed to fetch subscription in profile:", e);
    }

    // Determine Provider Status
    let providerStatusText: 'Not Registered' | 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected' | 'Suspended' = 'Not Registered';
    let providerStatusVal = provider?.status || provider?.providerStatus || 'not_registered';
    if (provider) {
      if (providerStatusVal === 'draft' || providerStatusVal === 'profile_incomplete' || providerStatusVal === 'unverified') {
        providerStatusText = 'Draft';
      } else if (providerStatusVal === 'pending' || providerStatusVal === 'documents_under_review' || providerStatusVal === 'field_verification') {
        providerStatusText = 'Pending Approval';
      } else if (providerStatusVal === 'approved' || providerStatusVal === 'active_provider') {
        providerStatusText = 'Approved';
      } else if (providerStatusVal === 'rejected') {
        providerStatusText = 'Rejected';
      } else if (providerStatusVal === 'suspended') {
        providerStatusText = 'Suspended';
      }
    }

    // Determine Verification Status
    let verificationStatusText = 'Not Verified';
    if (provider) {
      if (provider.isVerified || provider.verificationStatus === 'approved') {
        verificationStatusText = 'Verified';
      } else if (provider.verificationStatus === 'pending' || provider.verificationStatus === 'under_review') {
        verificationStatusText = 'Under Review';
      } else if (provider.verificationStatus === 'changes_requested') {
        verificationStatusText = 'Changes Requested';
      }
    }

    // Membership Pass formatting
    const passType = state.userProfile?.passType || 'none';
    let membershipText = 'Free Pass';
    if (passType === 'daily') membershipText = 'Daily Pass';
    else if (passType === 'weekly') membershipText = 'Weekly Pass';
    else if (passType === 'free_trial') membershipText = 'Free Trial Pass';

    // Generate dynamic action drawer
    let actionDrawerHtml = '';
    if (providerStatusText === 'Not Registered') {
      actionDrawerHtml = `
        <div class="stitch-card-sm shadow-premium" style="border: 1.5px solid rgba(79, 70, 229, 0.15); background: linear-gradient(135deg, rgba(79, 70, 229, 0.04) 0%, rgba(79, 70, 229, 0.01) 100%); padding: 16px; border-radius: var(--radius-xl); text-align: center; gap: 8px; width: 100%; display: flex; flex-direction: column; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-primary); background: rgba(79, 70, 229, 0.05); padding: var(--spacing-xs); border-radius: 50%;">storefront</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-primary); margin: 0;">Kuwa Muuzaji (Become a Provider)</h3>
          <p class="stitch-body-xs" style="color: var(--color-outline); font-weight: 500; max-width: 240px; margin: 0 auto; line-height: 1.4;">Sajili biashara au duka lako sasa uifikie hadhira kubwa ya Kariakoo.</p>
          <button id="start-provider-reg-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; margin-top: 6px;">Anza Usajili wa Duka</button>
        </div>
      `;
    } else if (providerStatusText === 'Draft') {
      actionDrawerHtml = `
        <div class="stitch-card-sm shadow-premium" style="border: 1.5px solid rgba(245, 158, 11, 0.2); background: linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(245, 158, 11, 0.01) 100%); padding: 16px; border-radius: var(--radius-xl); text-align: center; gap: 8px; width: 100%; display: flex; flex-direction: column; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: #f59e0b; background: rgba(245, 158, 11, 0.05); padding: var(--spacing-xs); border-radius: 50%;">edit_document</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: #d97706; margin: 0;">Endelea na Usajili (Draft)</h3>
          <p class="stitch-body-xs" style="color: var(--color-outline); font-weight: 500; max-width: 240px; margin: 0 auto; line-height: 1.4;">Una rasimu ya usajili ambayo haijakamilika.</p>
          <button id="resume-provider-reg-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; margin-top: 6px; background: #f59e0b; border-color: #f59e0b;">Endelea na Usajili</button>
        </div>
      `;
    } else if (providerStatusText === 'Pending Approval') {
      actionDrawerHtml = `
        <div class="stitch-card-sm shadow-premium" style="border: 1.5px solid rgba(79, 70, 229, 0.15); background: rgba(255, 255, 255, 0.85); padding: 16px; border-radius: var(--radius-xl); text-align: center; gap: 8px; width: 100%; display: flex; flex-direction: column; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-primary); background: rgba(79, 70, 229, 0.05); padding: var(--spacing-xs); border-radius: 50%;">hourglass_empty</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-primary); margin: 0;">Uhakiki Unasubiriwa</h3>
          <p class="stitch-body-xs" style="color: var(--color-outline); font-weight: 700; text-transform: uppercase; font-size: 9.5px; margin-top: 2px;">Status: Inasubiri Ukaguzi</p>
          
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 6px;">
            <button id="resume-provider-reg-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px;">Fuatilia Hali ya Usajili</button>
            <button id="open-customer-portal-btn" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; background: white; border: 1.5px solid rgba(226, 232, 240, 0.8);">Fungua Customer Portal</button>
          </div>
        </div>
      `;
    } else if (providerStatusText === 'Approved') {
      actionDrawerHtml = `
        <div class="stitch-flex stitch-flex-col" style="gap: 10px; width: 100%;">
          <div style="text-align: center; margin-bottom: 4px;">
            <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 13.5px; font-weight: 900; color: var(--color-secondary); margin: 0; display: flex; align-items: center; justify-content: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 18px; font-variation-settings: 'FILL' 1;">verified</span>
              <span>Akaunti Imethibitishwa!</span>
            </h3>
            <p style="font-size: 10px; color: var(--color-outline); margin: 2px 0 0 0;">Chagua portal ya kutumia hapa chini:</p>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%;">
            <button id="open-customer-portal-btn" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 42px; border-radius: var(--radius-full); font-weight: 800; font-size: 11.5px; display: flex; align-items: center; justify-content: center; gap: 4px; background: white; border: 1.5px solid rgba(226, 232, 240, 0.8);">
              <span class="material-symbols-outlined" style="font-size: 16px;">search</span>
              <span>Mteja Portal</span>
            </button>
            <button id="open-provider-portal-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 42px; border-radius: var(--radius-full); font-weight: 800; font-size: 11.5px; display: flex; align-items: center; justify-content: center; gap: 4px; background: linear-gradient(135deg, var(--color-primary) 0%, #6366f1 100%); border: none;">
              <span class="material-symbols-outlined" style="font-size: 16px;">storefront</span>
              <span>Muuzaji Portal</span>
            </button>
          </div>
        </div>
      `;
    } else if (providerStatusText === 'Rejected') {
      actionDrawerHtml = `
        <div class="stitch-card-sm shadow-premium" style="border: 1.5px solid rgba(239, 68, 68, 0.2); background: linear-gradient(135deg, rgba(239, 68, 68, 0.04) 0%, rgba(239, 68, 68, 0.01) 100%); padding: 16px; border-radius: var(--radius-xl); text-align: center; gap: 8px; width: 100%; display: flex; flex-direction: column; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-error); background: rgba(239, 68, 68, 0.05); padding: var(--spacing-xs); border-radius: 50%;">gpp_maybe</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; color: var(--color-error); margin: 0;">Maombi Yamekataliwa (Rejected)</h3>
          <p class="stitch-body-xs" style="color: var(--color-on-surface); font-weight: bold; margin-top: 2px; line-height: 1.4; font-size: 10.5px;">Sababu: <span style="color: var(--color-error); font-weight: 500;">${provider?.adminNotes || 'Nyaraka hazijakidhi vigezo.'}</span></p>
          
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 6px;">
            <button id="edit-resubmit-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; background-color: var(--color-error); border-color: var(--color-error);">Rekebisha & Tuma Upya</button>
            <button id="open-customer-portal-btn" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; background: white; border: 1.5px solid rgba(226, 232, 240, 0.8);">Fungua Customer Portal</button>
          </div>
        </div>
      `;
    } else if (providerStatusText === 'Suspended') {
      actionDrawerHtml = `
        <div class="stitch-card-sm shadow-premium" style="border: 1.5px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.02); padding: 16px; border-radius: var(--radius-xl); text-align: center; gap: 8px; width: 100%; display: flex; flex-direction: column; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-error); background: rgba(239, 68, 68, 0.05); padding: var(--spacing-xs); border-radius: 50%;">block</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; color: var(--color-error); margin: 0;">Akaunti ya Muuzaji Imesimamishwa</h3>
          <p class="stitch-body-xs" style="color: var(--color-outline); font-weight: 500; line-height: 1.4; font-size: 10px;">Akaunti yako imesimamishwa kwa kukiuka taratibu. Portal ya Muuzaji haipatikani.</p>
          <button id="open-customer-portal-btn" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; margin-top: 4px; background: white; border: 1.5px solid rgba(226, 232, 240, 0.8);">Fungua Customer Portal</button>
        </div>
      `;
    }

    const role = state.userProfile?.role || 'customer';
    const isSystemStaff = role === 'admin' || role === 'superadmin' || role === 'staff';

    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content" style="justify-content: center;">
          <h1 class="stitch-title-medium" style="font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 15px; color: var(--color-primary);">Wasifu Wangu / Profile</h1>
        </div>
      </header>
      
      <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 100px; font-family: var(--font-sans);">
        <div class="stitch-card glass-card" style="gap: var(--spacing-md); margin-top: var(--spacing-sm); border: 1.5px solid rgba(226, 232, 240, 0.8); background: rgba(255,255,255,0.85); backdrop-filter: blur(12px);">
          
          <!-- Profile Picture & Core Info -->
          <div class="stitch-flex stitch-flex-col stitch-align-center" style="gap: var(--spacing-sm); text-align: center;">
            ${user.photoURL ? `
              <img src="${user.photoURL}" style="width: 68px; height: 68px; border-radius: var(--radius-full); object-fit: cover; box-shadow: var(--shadow-sm); border: 2px solid var(--color-primary);" />
            ` : `
              <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 68px; height: 68px; border-radius: var(--radius-full); background: linear-gradient(135deg, var(--color-primary), #818cf8); color: white; font-weight: var(--font-weight-black); font-size: 22px; text-transform: uppercase; box-shadow: var(--shadow-sm); font-family: 'Space Grotesk', sans-serif;">
                ${(state.userProfile?.name || user.displayName || 'U').substring(0, 2)}
              </div>
            `}
            <div>
              <h2 class="stitch-title-medium" style="font-size: 15px; font-weight: 900; margin: 0;">${state.userProfile?.name || user.displayName || 'System User'}</h2>
              <p class="stitch-body-xs" style="color: var(--color-outline); font-weight: 500; margin-top: 2px;">${user.email || 'Hakuna barua pepe'}</p>
            </div>
          </div>
          
          <!-- User Details Table -->
          <div style="border-top: 1px solid rgba(226, 232, 240, 0.6); padding-top: var(--spacing-sm); display: flex; flex-direction: column; gap: var(--spacing-xs);">
            
            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.4);">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Account Type</span>
              <span class="stitch-badge" style="font-size: 8.5px; font-weight: 900; background-color: rgba(79, 70, 229, 0.08); color: var(--color-primary); border: none; padding: 2px 8px; margin: 0; text-transform: uppercase;">Customer Account</span>
            </div>

            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.4);">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Membership</span>
              <span style="font-weight: 800; color: var(--color-on-surface); font-size: 11px;">${membershipText}</span>
            </div>

            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.4);">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Customer Status</span>
              <span style="font-weight: 800; color: #10b981; font-size: 11px; display: flex; align-items: center; gap: 4px;">
                <span style="width: 6px; height: 6px; background-color: #10b981; border-radius: 50%; display: inline-block;"></span>
                Active
              </span>
            </div>

            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.4);">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Provider Status</span>
              <span class="stitch-badge" style="font-size: 8.5px; font-weight: 900; text-transform: uppercase; background-color: ${
                providerStatusText === 'Approved' ? 'rgba(16, 185, 129, 0.1)' :
                providerStatusText === 'Pending Approval' ? 'rgba(245, 158, 11, 0.1)' :
                providerStatusText === 'Rejected' || providerStatusText === 'Suspended' ? 'rgba(239, 68, 68, 0.1)' :
                'rgba(226, 232, 240, 0.8)'
              }; color: ${
                providerStatusText === 'Approved' ? '#10b981' :
                providerStatusText === 'Pending Approval' ? '#f59e0b' :
                providerStatusText === 'Rejected' || providerStatusText === 'Suspended' ? '#ef4444' :
                'var(--color-outline)'
              }; border: none; margin: 0; padding: 2px 6px;">${providerStatusText}</span>
            </div>

            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.4);">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Verification Status</span>
              <span style="font-weight: 800; color: var(--color-on-surface); font-size: 11px;">${verificationStatusText}</span>
            </div>

            <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 6px 0;">
              <span style="font-weight: 800; color: var(--color-outline); text-transform: uppercase; font-size: 8.5px;">Subscription Status</span>
              <span style="font-weight: 800; color: var(--color-on-surface); font-size: 11px;">${subscriptionStatusText}</span>
            </div>
            
          </div>

          <!-- Dynamic Action Drawer -->
          <div style="margin-top: 4px; border-top: 1px solid rgba(226, 232, 240, 0.6); padding-top: 14px;">
            ${actionDrawerHtml}
          </div>

          <!-- Admin Panel Link -->
          ${isSystemStaff || user?.email === 'dorthealeonard@gmail.com' || user?.email === 'admin@chimbo.com' ? `
            <button id="go-admin-db-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; margin-top: 8px; height: 42px; border-radius: var(--radius-full); font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: none;">
              <span class="material-symbols-outlined" style="font-size: 18px;">security</span>
              <span>Fungua Dashboard ya Admin</span>
            </button>
          ` : ''}

          <button id="auth-logout-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; color: var(--color-error); font-weight: 800; font-size: 12px; margin-top: 12px; height: 40px; border: 1.5px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-full); background: rgba(239, 68, 68, 0.02);">
            Ondoka Kwenye Akaunti (Logout)
          </button>
        </div>
      </main>
      ${renderGlobalNavbar('profile')}
    `;
  }

  // ==========================================
  // CASE B: USER IS NOT LOGGED IN (Renders Clean Login / Register form)
  // ==========================================
  return `
    <header class="stitch-header glass-card">
      <div class="stitch-header-content">
        <button id="auth-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: var(--radius-full); border: 1.5px solid rgba(226, 232, 240, 0.5);">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px;">arrow_back</span>
        </button>
        <h1 class="stitch-title-medium" style="font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 15px; color: var(--color-primary);">Utambulisho / Auth</h1>
        <div style="width: 36px;"></div>
      </div>
    </header>

    <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 80px; font-family: var(--font-sans);">
      
      <!-- Status Messages -->
      ${errorMessage ? `
        <div class="stitch-card-sm animate-fade-in" style="background-color: var(--color-error-container); border: 1.5px solid var(--color-error); padding: 10px; border-radius: var(--radius-lg); flex-direction: row; align-items: center; gap: 8px; color: var(--color-error); margin-bottom: 12px;">
          <span class="material-symbols-outlined" style="font-size: 18px;">error</span>
          <span style="font-size: 11px; font-weight: 800; line-height: 1.4;">${errorMessage}</span>
        </div>
      ` : ''}
      
      ${successMessage ? `
        <div class="stitch-card-sm animate-fade-in" style="background-color: var(--color-secondary-container); border: 1.5px solid var(--color-secondary); padding: 10px; border-radius: var(--radius-lg); flex-direction: row; align-items: center; gap: 8px; color: var(--color-secondary); margin-bottom: 12px;">
          <span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span>
          <span style="font-size: 11px; font-weight: 800; line-height: 1.4;">${successMessage}</span>
        </div>
      ` : ''}

      <!-- Production Login Card -->
      <div class="stitch-card glass-card" style="gap: var(--spacing-md); border: 1.5px solid rgba(79, 70, 229, 0.1); background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px); padding: var(--spacing-md);">
        
        <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 4px;">
          <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 48px; height: 48px; border-radius: var(--radius-full); background: rgba(79, 70, 229, 0.08); color: var(--color-primary); border: 1px solid rgba(79, 70, 229, 0.15);">
            <span class="material-symbols-outlined" style="font-size: 24px;">lock_open</span>
          </div>
          <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-primary); margin: 4px 0 0 0;">
            ${emailMode === 'login' ? 'Ingia Chimbo (Log In)' : 'Sajili Akaunti Mpya'}
          </h2>
          <p style="font-size: 11px; color: var(--color-outline); max-width: 250px; line-height: 1.45; margin: 0;">
            ${emailMode === 'login' 
              ? 'Weka barua pepe na neno lako la siri kuendelea na CHIMBO.' 
              : 'Jaza fomu hapa chini upate akaunti salama ya kutafuta au kusajili duka.'}
          </p>
        </div>

        <div class="stitch-flex stitch-flex-col" style="gap: 10px;">
          ${emailMode === 'register' ? `
            <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
              <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="email-name-input">Jina Kamili (Full Name) <span style="color: var(--color-error);">*</span></label>
              <input id="email-name-input" class="stitch-input-raw" type="text" placeholder="e.g. Bakari Juma" value="${tempFields.name}" style="height: 38px; font-size: 12px;"/>
            </div>
          ` : ''}

          <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
            <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="email-username-input">Barua Pepe (Email Address) <span style="color: var(--color-error);">*</span></label>
            <input id="email-username-input" class="stitch-input-raw" type="email" placeholder="e.g. bakari.juma@gmail.com" value="${tempFields.email}" style="height: 38px; font-size: 12px;"/>
          </div>

          <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
            <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="email-password-input">Neno la Siri (Password) <span style="color: var(--color-error);">*</span></label>
            <input id="email-password-input" class="stitch-input-raw" type="password" placeholder="Weka password (herufi 6+)" value="${tempFields.password}" style="height: 38px; font-size: 12px;"/>
          </div>
        </div>

        <button id="email-action-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 42px; border-radius: var(--radius-full); font-weight: 800; font-size: 12.5px; opacity: ${authLoading ? '0.7' : '1'}; pointer-events: ${authLoading ? 'none' : 'auto'}; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: var(--shadow-sm);">
          ${authLoading ? `
            <span class="animate-spin material-symbols-outlined" style="font-size: 18px;">refresh</span>
            <span>Inashughulikiwa...</span>
          ` : `
            <span class="material-symbols-outlined" style="font-size: 18px;">login</span>
            <span>${emailMode === 'login' ? 'Ingia Kwenye Akaunti' : 'Sajili Akaunti Mpya'}</span>
          `}
        </button>

        <button id="toggle-email-mode-btn" class="stitch-btn stitch-btn-flat active-scale" style="font-size: 11px; width: 100%; color: var(--color-primary); background: none; border: none; font-weight: 800; text-decoration: none;">
          ${emailMode === 'login' ? 'Je, huna akaunti? Jisajili Sasa' : 'Tayari una akaunti? Ingia Hapa'}
        </button>
      </div>

      <!-- Federated Login (Google) -->
      <div style="position: relative; display: flex; align-items: center; justify-content: center; margin: 20px 0;">
        <div style="position: absolute; inset: 0; display: flex; align-items: center;">
          <div style="width: 100%; border-top: 1.5px solid rgba(226, 232, 240, 0.6);"></div>
        </div>
        <span style="position: relative; padding: 0 12px; background: var(--color-surface); font-size: 9.5px; color: var(--color-outline); font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;">Au / Alternatively</span>
      </div>

      <button id="auth-google-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 42px; font-weight: 800; font-size: 12px; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); background: white; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: var(--shadow-sm);">
        <svg style="width: 16px; height: 16px;" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        <span>Ingia na Google</span>
      </button>

    </main>

    ${renderGlobalNavbar('profile')}
  `;
}

export function bindAuthEvents() {
  const backBtn = document.getElementById('auth-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));

  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      state.isLoggingIn = true;
      errorMessage = '';
      try {
        await loginWithGoogle();
        successMessage = 'Umeingia kikamilifu na Google!';
        const currentUser = auth.currentUser;
        if (currentUser) {
          setTimeout(async () => {
            await determineAndRouteUser(currentUser);
          }, 1000);
        } else {
          state.isLoggingIn = false;
          navigateTo('home');
        }
      } catch (e: any) {
        state.isLoggingIn = false;
        errorMessage = 'Kuingia na Google imefeli: ' + (e.message || String(e));
        navigateTo('auth');
      }
    });
  }

  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await auth.signOut();
        successMessage = 'Umetolewa kwenye akaunti kwa usalama.';
        errorMessage = '';
        setTimeout(() => {
          navigateTo('home');
        }, 800);
      } catch (e: any) {
        errorMessage = 'Ondoka imefeli: ' + (e.message || String(e));
        navigateTo('auth');
      }
    });
  }

  const toggleBtn = document.getElementById('toggle-email-mode-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      emailMode = emailMode === 'login' ? 'register' : 'login';
      errorMessage = '';
      successMessage = '';
      navigateTo('auth');
    });
  }

  const emailActionBtn = document.getElementById('email-action-btn');
  if (emailActionBtn) {
    emailActionBtn.addEventListener('click', async () => {
      errorMessage = '';
      successMessage = '';
      
      const emailInput = document.getElementById('email-username-input') as HTMLInputElement;
      const pwdInput = document.getElementById('email-password-input') as HTMLInputElement;
      
      const email = emailInput?.value.trim() || '';
      const password = pwdInput?.value.trim() || '';
      
      tempFields.email = email;
      tempFields.password = password;

      if (!email || !password) {
        errorMessage = 'Tafadhali jaza barua pepe na password kwa ukamili.';
        navigateTo('auth');
        return;
      }

      if (password.length < 6) {
        errorMessage = 'Neno la siri (Password) lazima liwe na angalau herufi 6.';
        navigateTo('auth');
        return;
      }

      authLoading = true;
      navigateTo('auth');

      if (emailMode === 'register') {
        const nameInput = document.getElementById('email-name-input') as HTMLInputElement;
        const name = nameInput?.value.trim() || 'Mtumiaji wa CHIMBO';
        
        tempFields.name = name;

        state.isLoggingIn = true;
        try {
          const credential = await createUserWithEmailAndPassword(auth, email, password);
          const user = credential.user;
          
          await updateProfile(user, { displayName: name });
          
          const userRef = doc(db, 'users', user.uid);
          const newProfile: UserProfile = {
            id: user.uid,
            name,
            email,
            phoneNumber: '',
            role: 'customer',
            createdAt: new Date().toISOString()
          };
          await setDoc(userRef, newProfile);
          
          // STRICT SECURITY RULE: Sign out immediately to prevent automatic dashboard login
          await auth.signOut();
          state.userProfile = null;
          state.currentUser = null;
          
          successMessage = 'Akaunti yako imesajiliwa! Tafadhali ingia kutumia barua pepe na password yako sasa.';
          authLoading = false;
          emailMode = 'login';
          state.isLoggingIn = false;
          
          setTimeout(() => {
            navigateTo('auth');
          }, 1200);
        } catch (e: any) {
          state.isLoggingIn = false;
          console.error(e);
          errorMessage = 'Usajili umefeli: ' + (e.message || String(e));
          authLoading = false;
          navigateTo('auth');
        }
      } else {
        state.isLoggingIn = true;
        try {
          const credential = await signInWithEmailAndPassword(auth, email, password);
          const user = credential.user;
          
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            state.userProfile = userSnap.data() as UserProfile;
          } else {
            const fallbackProfile: UserProfile = {
              id: user.uid,
              name: user.displayName || 'Mteja Mwaminifu',
              email: user.email || '',
              phoneNumber: '',
              role: 'customer',
              createdAt: new Date().toISOString()
            };
            await setDoc(userRef, fallbackProfile);
            state.userProfile = fallbackProfile;
          }
          
          successMessage = 'Umeingia kikamilifu kwenye akaunti!';
          authLoading = false;
          
          setTimeout(async () => {
            await determineAndRouteUser(user);
          }, 1000);
        } catch (e: any) {
          state.isLoggingIn = false;
          console.error(e);
          errorMessage = 'Ingia imefeli: Barua pepe au neno la siri si sahihi.';
          authLoading = false;
          navigateTo('auth');
        }
      }
    });
  }

  // --- Dynamic Action Drawer click events ---
  const startProviderRegBtn = document.getElementById('start-provider-reg-btn');
  if (startProviderRegBtn) {
    startProviderRegBtn.addEventListener('click', () => navigateTo('onboarding'));
  }

  const resumeProviderRegBtn = document.getElementById('resume-provider-reg-btn');
  if (resumeProviderRegBtn) {
    resumeProviderRegBtn.addEventListener('click', () => navigateTo('onboarding'));
  }

  const openCustomerPortalBtn = document.getElementById('open-customer-portal-btn');
  if (openCustomerPortalBtn) {
    openCustomerPortalBtn.addEventListener('click', () => navigateTo('home'));
  }

  const openProviderPortalBtn = document.getElementById('open-provider-portal-btn');
  if (openProviderPortalBtn) {
    openProviderPortalBtn.addEventListener('click', () => navigateTo('provider-dashboard'));
  }

  const editResubmitBtn = document.getElementById('edit-resubmit-btn');
  if (editResubmitBtn) {
    editResubmitBtn.addEventListener('click', async () => {
      // Calls the global startOnboardingEdit helper defined in onboardingView.ts
      if ((window as any).startOnboardingEdit) {
        await (window as any).startOnboardingEdit();
      } else {
        navigateTo('onboarding');
      }
    });
  }

  const goAdminBtn = document.getElementById('go-admin-db-btn');
  if (goAdminBtn) {
    goAdminBtn.addEventListener('click', () => navigateTo('admin-dashboard'));
  }

  bindNavbarEvents();
}
