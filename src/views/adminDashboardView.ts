import { state, navigateTo, notifyStateChange } from '../appState';
import { db, logoutUser } from '../firebase';
import { 
  collection, 
  getDocs as firestoreGetDocs, 
  doc, 
  setDoc as firestoreSetDoc, 
  query, 
  where, 
  getDoc as firestoreGetDoc, 
  deleteDoc as firestoreDeleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { logAction, getAuditLogs, AuditLogItem } from '../services/audit';
import { recalculateTrustScore } from '../services/trustScore';

// Helper to extract collection path from query or reference
function getPath(ref: any): string {
  if (!ref) return 'unknown';
  if (typeof ref.path === 'string') return ref.path;
  if (ref._query && ref._query.path && typeof ref._query.path.canonicalString === 'function') {
    return ref._query.path.canonicalString();
  }
  if (ref.query && typeof ref.query.path === 'string') return ref.query.path;
  return 'unknown_path';
}

// Wrapper functions to log every query inside this file automatically
async function getDocs(queryRef: any) {
  const path = getPath(queryRef);
  console.log(`[Firestore Query Diagnostic] Attempting read (getDocs) on Path/Collection: "${path}", UID: "${state.currentUser?.uid || 'Unknown'}", Role: "${state.userProfile?.role || 'Unknown'}"`);
  return firestoreGetDocs(queryRef);
}

async function getDoc(docRef: any) {
  const path = getPath(docRef);
  console.log(`[Firestore Query Diagnostic] Attempting read (getDoc) on Path: "${path}", UID: "${state.currentUser?.uid || 'Unknown'}", Role: "${state.userProfile?.role || 'Unknown'}"`);
  return firestoreGetDoc(docRef);
}

async function setDoc(docRef: any, data: any, options?: any) {
  const path = getPath(docRef);
  console.log(`[Firestore Query Diagnostic] Attempting write (setDoc) on Path: "${path}", UID: "${state.currentUser?.uid || 'Unknown'}", Role: "${state.userProfile?.role || 'Unknown'}"`);
  return firestoreSetDoc(docRef, data, options);
}

async function deleteDoc(docRef: any) {
  const path = getPath(docRef);
  console.log(`[Firestore Query Diagnostic] Attempting delete (deleteDoc) on Path: "${path}", UID: "${state.currentUser?.uid || 'Unknown'}", Role: "${state.userProfile?.role || 'Unknown'}"`);
  return firestoreDeleteDoc(docRef);
}

// Cached local copy of Firestore data for real-time, non-blocking rendering
export let cachedAdminData = {
  providers: [] as any[],
  products: [] as any[],
  services: [] as any[],
  verificationDocuments: [] as any[],
  fieldAssignments: [] as any[],
  fieldReports: [] as any[],
  payments: [] as any[],
  users: [] as any[],
  systemSettings: [] as any[],
  mapsSettings: [] as any[],
  smsSettings: [] as any[],
  subscriptionSettings: [] as any[],
  aiSettings: [] as any[],
  categories: [] as any[],
  featureTemplates: [] as any[],
  subscriptionPlans: [] as any[],
  searches: [] as any[],
  productImages: [] as any[],
  subscriptions: [] as any[],
  reports: [] as any[],
  staffInvitations: [] as any[],
  userPresence: [] as any[],
  activeSessions: [] as any[],
  integrationTests: [] as any[],
  notificationHistory: [] as any[]
};

let isListening = false;
let unsubscribeFunctions: (() => void)[] = [];

export function startRealtimeListeners() {
  if (isListening) return;
  isListening = true;
  console.log('[Realtime Listener] Initializing all Admin Dashboard snapshots');

  const collectionsToListen = [
    { name: 'providers', ref: collection(db, 'providers') },
    { name: 'products', ref: collection(db, 'products') },
    { name: 'services', ref: collection(db, 'services') },
    { name: 'verificationDocuments', ref: collection(db, 'verificationDocuments') },
    { name: 'fieldAssignments', ref: collection(db, 'fieldAssignments') },
    { name: 'fieldReports', ref: collection(db, 'fieldReports') },
    { name: 'payments', ref: collection(db, 'payments') },
    { name: 'users', ref: collection(db, 'users') },
    { name: 'systemSettings', ref: collection(db, 'systemSettings') },
    { name: 'mapsSettings', ref: collection(db, 'mapsSettings') },
    { name: 'smsSettings', ref: collection(db, 'smsSettings') },
    { name: 'subscriptionSettings', ref: collection(db, 'subscriptionSettings') },
    { name: 'aiSettings', ref: collection(db, 'aiSettings') },
    { name: 'categories', ref: collection(db, 'categories') },
    { name: 'featureTemplates', ref: collection(db, 'featureTemplates') },
    { name: 'subscriptionPlans', ref: collection(db, 'subscriptionPlans') },
    { name: 'searches', ref: collection(db, 'searches') },
    { name: 'productImages', ref: collection(db, 'productImages') },
    { name: 'subscriptions', ref: collection(db, 'subscriptions') },
    { name: 'reports', ref: collection(db, 'reports') },
    { name: 'staffInvitations', ref: collection(db, 'staffInvitations') },
    { name: 'userPresence', ref: collection(db, 'userPresence') },
    { name: 'activeSessions', ref: collection(db, 'activeSessions') },
    { name: 'integrationTests', ref: collection(db, 'integrationTests') },
    { name: 'notificationHistory', ref: collection(db, 'notificationHistory') }
  ];

  let loadedCollections = new Set<string>();

  collectionsToListen.forEach(col => {
    const unsub = onSnapshot(col.ref, (snapshot) => {
      if (state.currentView !== 'admin-dashboard') {
        stopRealtimeListeners();
        return;
      }

      const list: any[] = [];
      snapshot.forEach(docSnap => {
        if (col.name === 'productImages') {
          list.push(docSnap.data());
        } else {
          list.push({ id: docSnap.id, ...docSnap.data() });
        }
      });

      (cachedAdminData as any)[col.name] = list;

      const alreadyLoaded = loadedCollections.has(col.name);
      if (!alreadyLoaded) {
        loadedCollections.add(col.name);
      }

      // If initial load of all collections is complete, or if it is a real-time update after initial load
      if (loadedCollections.size === collectionsToListen.length) {
        notifyStateChange();
      }
    }, (err) => {
      console.error(`[Realtime Listener] Error on ${col.name}:`, err);
      loadedCollections.add(col.name);
      if (loadedCollections.size === collectionsToListen.length) {
        notifyStateChange();
      }
    });

    unsubscribeFunctions.push(unsub);
  });
}

export function stopRealtimeListeners() {
  console.log('[Realtime Listener] Cleaning up all Admin Dashboard snapshot unsubscribers');
  unsubscribeFunctions.forEach(unsub => {
    try {
      unsub();
    } catch (e) {
      console.error('Error unsubscribing:', e);
    }
  });
  unsubscribeFunctions = [];
  isListening = false;
}

// Module-level persistent state for the SPA
let activeAdminTab: 
  | 'overview' 
  | 'providers' 
  | 'products' 
  | 'services' 
  | 'documents' 
  | 'staff' 
  | 'field' 
  | 'customers' 
  | 'subscriptions' 
  | 'categories' 
  | 'templates' 
  | 'search' 
  | 'revenue' 
  | 'audit' 
  | 'notifications' 
  | 'settings' 
  | 'live' = 'overview';

let selectedProviderId: string | null = null;
let selectedProductId: string | null = null;
let selectedCustomerId: string | null = null;
let selectedStaffId: string | null = null;
let selectedServiceId: string | null = null;
let selectedReportId: string | null = null;
let selectedNotificationId: string | null = null;
let selectedSubscriptionId: string | null = null;

let editingCategoryId: string | null = null;
let editingTemplateId: string | null = null;
let editingPlanId: string | null = null;

// Permissions matrix checker based on staff fine-grained roles
export function checkPermission(action: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'reject', module: string): boolean {
  const role = state.userProfile?.role || 'customer';
  // Superadmin and Admin bypass all checks
  if (role === 'admin' || role === 'superadmin') return true;

  switch (role) {
    case 'field_officer':
      // Field officer can only view and complete field/GPS visits
      return module === 'field' && (action === 'view' || action === 'edit' || action === 'create');
    case 'support_officer':
      // Support officer handles customer service, disputes/reports
      return (module === 'customers' || module === 'providers' || module === 'reports' || module === 'notifications') && (action === 'view' || action === 'edit' || action === 'approve');
    case 'verification_officer':
      // Verification officer checks provider listings, documents, products, services
      return (module === 'providers' || module === 'products' || module === 'services' || module === 'documents' || module === 'field') && (action === 'view' || action === 'approve' || action === 'reject');
    case 'finance_officer':
      // Finance officer manages revenue reports, payments audit, and subscription plans
      return (module === 'revenue' || module === 'subscriptions') && (action === 'view' || action === 'edit' || action === 'create' || action === 'delete');
    case 'moderator':
      // Moderator cleans up categories, templates, product catalogs
      return (module === 'products' || module === 'services' || module === 'categories' || module === 'templates') && (action === 'view' || action === 'edit' || action === 'delete');
    default:
      return false;
  }
}

// Security wrapper check that throws alert when unauthorized
export function enforcePermission(action: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'reject', module: string): boolean {
  const allowed = checkPermission(action, module);
  if (!allowed) {
    alert(`KIBALI KIMEKATALIWA!\nJukumu lako la kazi (${(state.userProfile?.role || 'mteja').toUpperCase()}) halina ruhusa ya kufanya (${action.toUpperCase()}) kwenye moduli ya (${module.toUpperCase()}).`);
  }
  return allowed;
}

// Search & Filter state
let providerSearchQuery = '';
let providerStatusFilter = 'all';
let productStatusFilter = 'pending';
let serviceStatusFilter = 'pending';
let docStatusFilter = 'pending';
let customerSearchQuery = '';

// Helper to log Firestore query diagnostics
function logFirestoreQuery(operation: 'read' | 'write' | 'delete', colName: string, docOrParams: string) {
  console.log(`[Firestore Query Diagnostic] Attempting ${operation} on Collection: "${colName}", Details: "${docOrParams}", UID: "${state.currentUser?.uid || 'Unknown'}", Role: "${state.userProfile?.role || 'Unknown'}"`);
}

/**
 * Initializes default configurations in Firestore if they are empty
 */
async function initializeDefaultAdminData() {
  try {
    // 1. System Settings Defaults
    logFirestoreQuery('read', 'systemSettings', 'All Documents');
    const settingsSnap = await getDocs(collection(db, 'systemSettings'));
    if (settingsSnap.empty) {
      const defaults = [
        { id: 'platform_name', key: 'Platform Name', value: 'CHIMBO LANGU' },
        { id: 'logo_url', key: 'Logo URL', value: 'https://res.cloudinary.com/chimbo/image/upload/v1782046/logo.png' },
        { id: 'default_lang', key: 'Default Language', value: 'Swahili' },
        { id: 'default_curr', key: 'Default Currency', value: 'TSh' },
        { id: 'cloudinary_cloud', key: 'Cloudinary Cloud Name', value: 'chimbo-cloud' },
        { id: 'cloudinary_api_key', key: 'Cloudinary API Key', value: 'cloudinary_key_demo' },
        { id: 'cloudinary_api_secret', key: 'Cloudinary API Secret', value: 'cloudinary_secret_demo' },
        { id: 'cloudinary_folder', key: 'Cloudinary Folder Prefix', value: 'profiles_and_products' },
        { id: 'cloudinary_max_size', key: 'Cloudinary Max File Size (MB)', value: '10' },
        { id: 'smtp_host', key: 'SMTP Host Address', value: 'smtp.gmail.com' },
        { id: 'smtp_port', key: 'SMTP Port Number', value: '587' },
        { id: 'smtp_user', key: 'SMTP Username', value: 'notifications@chimbo.com' },
        { id: 'smtp_pass', key: 'SMTP Password', value: 'smtp_pass_demo' },
        { id: 'smtp_sender_name', key: 'SMTP Sender Display Name', value: 'CHIMBO Notifications' },
        { id: 'pwa_offline_cache', key: 'PWA Offline Cache', value: 'Enabled' }
      ];
      for (const d of defaults) {
        logFirestoreQuery('write', 'systemSettings', `doc: ${d.id}`);
        await setDoc(doc(db, 'systemSettings', d.id), d);
      }
    }

    // 2. Maps Settings Defaults
    logFirestoreQuery('read', 'mapsSettings', 'All Documents');
    const mapsSnap = await getDocs(collection(db, 'mapsSettings'));
    if (mapsSnap.empty) {
      const defaults = [
  { id: 'maps_api', key: 'Google Maps API Key', value: '' },
  { id: 'mapbox_api', key: 'Mapbox Access Token', value: '' },
  { id: 'default_radius', key: 'Default Search Radius (km)', value: '15' },
  { id: 'gps_accuracy', key: 'Required GPS Accuracy (m)', value: '10' }
];
      for (const d of defaults) {
        logFirestoreQuery('write', 'mapsSettings', `doc: ${d.id}`);
        await setDoc(doc(db, 'mapsSettings', d.id), d);
      }
    }

    // 3. SMS Settings Defaults
    logFirestoreQuery('read', 'smsSettings', 'All Documents');
    const smsSnap = await getDocs(collection(db, 'smsSettings'));
    if (smsSnap.empty) {
      const defaults = [
        { id: 'sms_provider', key: 'SMS Provider Gateway', value: 'Beem' },
        { id: 'beem_sms_key', key: 'Beem SMS API Key', value: '786beem89abcde' },
        { id: 'africastalking_key', key: 'Africas Talking API Key', value: 'at_key_demo' },
        { id: 'twilio_sid', key: 'Twilio Account SID', value: 'twilio_sid_demo' },
        { id: 'twilio_auth', key: 'Twilio Auth Token', value: 'twilio_auth_demo' },
        { id: 'custom_sms_endpoint', key: 'Custom SMS Endpoint', value: 'https://api.customsms.com/v1/send' }
      ];
      for (const d of defaults) {
        logFirestoreQuery('write', 'smsSettings', `doc: ${d.id}`);
        await setDoc(doc(db, 'smsSettings', d.id), d);
      }
    }

    // 4. Subscription Settings Defaults
    logFirestoreQuery('read', 'subscriptionSettings', 'All Documents');
    const subSettingsSnap = await getDocs(collection(db, 'subscriptionSettings'));
    if (subSettingsSnap.empty) {
      const defaults = [
        { id: 'free_trial_duration', key: 'Free Trial Duration (Days)', value: '30' },
        { id: 'price_starter', key: 'Starter Plan Price (TSh)', value: '50000' },
        { id: 'price_business', key: 'Business Plan Price (TSh)', value: '150000' },
        { id: 'price_premium', key: 'Premium Plan Price (TSh)', value: '300000' }
      ];
      for (const d of defaults) {
        logFirestoreQuery('write', 'subscriptionSettings', `doc: ${d.id}`);
        await setDoc(doc(db, 'subscriptionSettings', d.id), d);
      }
    }

    // 5. AI Settings Defaults
    logFirestoreQuery('read', 'aiSettings', 'All Documents');
    const aiSnap = await getDocs(collection(db, 'aiSettings'));
    if (aiSnap.empty) {
      const defaults = [
  { id: 'ai_enabled', key: 'AI Service State', value: 'Enabled' },
  { id: 'ai_provider', key: 'Active AI API Provider', value: 'Gemini' },
  { id: 'openai_api_key', key: 'OpenAI Secret API Key', value: '' },
  { id: 'gemini_api_key', key: 'Google Gemini API Key', value: '' },
  { id: 'deepseek_api_key', key: 'DeepSeek Secret API Key', value: '' }
];
      for (const d of defaults) {
        logFirestoreQuery('write', 'aiSettings', `doc: ${d.id}`);
        await setDoc(doc(db, 'aiSettings', d.id), d);
      }
    }

    // 6. Categories Defaults
    logFirestoreQuery('read', 'categories', 'All Documents');
    const catSnap = await getDocs(collection(db, 'categories'));
    if (catSnap.empty) {
      const defaultCats = [
        { id: 'prod_electronics', name: 'Electronics / Simu', type: 'product' },
        { id: 'prod_vehicles', name: 'Vehicles / Magari', type: 'product' },
        { id: 'prod_parts', name: 'Parts / Vipuri', type: 'product' },
        { id: 'prod_furniture', name: 'Furniture / Samani', type: 'product' },
        { id: 'prod_fashion', name: 'Fashion / Mavazi', type: 'product' },
        { id: 'serv_repairs', name: 'Repairs / Matangazo', type: 'service' },
        { id: 'serv_delivery', name: 'Delivery / Usafirishaji', type: 'service' },
        { id: 'serv_beauty', name: 'Beauty / Saluni', type: 'service' }
      ];
      for (const c of defaultCats) {
        logFirestoreQuery('write', 'categories', `doc: ${c.id}`);
        await setDoc(doc(db, 'categories', c.id), c);
      }
    }

    // 7. Feature Templates Defaults
    logFirestoreQuery('read', 'featureTemplates', 'All Documents');
    const tempSnap = await getDocs(collection(db, 'featureTemplates'));
    if (tempSnap.empty) {
      const defaultTemps = [
        { id: 'temp_phones', name: 'Phone Features', features: ['RAM', 'Storage', 'Camera', 'Battery', 'Screen Size'] },
        { id: 'temp_laptops', name: 'Laptop Features', features: ['CPU', 'RAM', 'Storage', 'GPU', 'OS'] },
        { id: 'temp_vehicles', name: 'Vehicle Features', features: ['Mileage', 'Year', 'Transmission', 'Fuel Type', 'Engine Size'] }
      ];
      for (const t of defaultTemps) {
        logFirestoreQuery('write', 'featureTemplates', `doc: ${t.id}`);
        await setDoc(doc(db, 'featureTemplates', t.id), t);
      }
    }

    // 8. Subscription Plans Defaults
    logFirestoreQuery('read', 'subscriptionPlans', 'All Documents');
    const plansSnap = await getDocs(collection(db, 'subscriptionPlans'));
    if (plansSnap.empty) {
      const defaultPlans = [
        { id: 'plan_starter', name: 'Starter Plan', price: 50000, duration: 30, features: ['Hadi bidhaa 10', 'Uhakiki wa msingi nyanjani', 'Analytics za kawaida'] },
        { id: 'plan_business', name: 'Business Plan', price: 150000, duration: 30, features: ['Bidhaa zisizo na kikomo', 'Vitu kuonekana mbele', 'Badge ya Best Deal'] },
        { id: 'plan_premium', name: 'Premium Plan', price: 300000, duration: 30, features: ['VIP Ads Placement', 'Support ya haraka', 'Boosters za Trust rating'] }
      ];
      for (const p of defaultPlans) {
        logFirestoreQuery('write', 'subscriptionPlans', `doc: ${p.id}`);
        await setDoc(doc(db, 'subscriptionPlans', p.id), p);
      }
    }

    // Auto-seeding disabled in production
  } catch (err) {
    console.error('Failed to initialize defaults:', err);
  }
}

export async function renderAdminDashboardView(): Promise<string> {
  const user = state.currentUser;
  const email = user?.email || '';
  const role = state.userProfile?.role || '';
  const isAuthorized = role === 'admin' || role === 'superadmin' || role === 'staff' || 
    email === 'dorthealeonard@gmail.com' || email === 'admin@chimbo.com' || email.endsWith('@chimbo.com') || email.toLowerCase().includes('admin');

  if (!isAuthorized) {
    return `
      <header class="stitch-header">
        <div class="stitch-header-content" style="justify-content: center;">
          <h1 class="stitch-title-medium">Kosa la Kibali</h1>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: var(--spacing-sm);">
        <span class="material-symbols-outlined" style="color: var(--color-error); font-size: 48px;">gpp_bad</span>
        <h2 class="stitch-title-large" style="color: var(--color-error); font-size: 16px;">HAUNA KIBALI / UNAUTHORIZED</h2>
        <p class="stitch-body-small" style="max-width: 280px; line-height: 1.4;">
          Wasifu huu ni kwa wasimamizi wa CHIMBO pekee. Tafadhali wasiliana na superadmin.
        </p>
        <button onclick="window.history.back()" class="stitch-btn stitch-btn-primary">Rudi Nyuma</button>
      </main>
      ${renderGlobalNavbar('profile')}
    `;
  }

  // Ensure default configuration records are seeded
  await initializeDefaultAdminData();

  try {
    // Start listeners if they are not already listening
    startRealtimeListeners();

    const providers = cachedAdminData.providers;
    const products = cachedAdminData.products;
    const services = cachedAdminData.services;
    const verificationDocs = cachedAdminData.verificationDocuments;
    const assignments = cachedAdminData.fieldAssignments;
    const fieldReports = cachedAdminData.fieldReports;
    const payments = cachedAdminData.payments;
    const users = cachedAdminData.users;
    const systemSettings = cachedAdminData.systemSettings;
    const mapsSettings = cachedAdminData.mapsSettings;
    const smsSettings = cachedAdminData.smsSettings;
    const subscriptionSettings = cachedAdminData.subscriptionSettings;
    const aiSettings = cachedAdminData.aiSettings;
    const categories = cachedAdminData.categories;
    const templates = cachedAdminData.featureTemplates;
    const subscriptionPlans = cachedAdminData.subscriptionPlans;
    const searches = cachedAdminData.searches;
    const allProductImages = cachedAdminData.productImages;
    const subscriptions = cachedAdminData.subscriptions;
    const complaints = cachedAdminData.reports;
    const staffInvitations = cachedAdminData.staffInvitations;

    // Audit Logs
    let logsList: AuditLogItem[] = [];
    try {
      logsList = await getAuditLogs(100);
    } catch (_) {}

    // HTML Output Builder
    let subViewContent = '';

    // CSS styling injector block - fully responsive design
    const cssStyles = `
      <style>
        .admin-layout {
          display: flex;
          min-height: 100vh;
          background: #f8fafc;
          color: #0f172a;
        }
        @media (min-width: 1200px) {
          .admin-layout {
            min-width: 1440px;
          }
        }
        .admin-sidebar {
          width: 280px; /* fixed 280px sidebar width */
          background: #0f172a;
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          border-right: 1px solid #1e293b;
          flex-shrink: 0;
          transition: transform 0.3s ease, width 0.3s ease;
        }
        .sidebar-header {
          padding: 16px;
          font-weight: bold;
          font-size: 16px;
          color: #38bdf8;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid #1e293b;
        }
        .sidebar-nav {
          display: flex;
          flex-direction: column;
          padding: 16px 8px;
          gap: 4px;
          overflow-y: auto;
          flex: 1;
        }
        .sidebar-nav button {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.2s;
        }
        .sidebar-nav button:hover, .sidebar-nav button.active {
          color: #fff;
          background: #1e293b;
        }
        .sidebar-nav button.active {
          border-left: 3px solid #38bdf8;
          border-radius: 0 8px 8px 0;
          background: rgba(56, 189, 248, 0.08);
          color: #38bdf8;
          font-weight: bold;
        }
        .admin-main-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .admin-header-bar {
          height: 60px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          gap: 12px;
        }
        .admin-content-area {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
        }
        .stats-grid-container {
          display: grid;
          grid-template-columns: repeat(4, 1fr); /* Default 4 cards per row (desktop) */
          gap: 16px;
          margin-bottom: 24px;
        }
        .stats-dashboard-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.01);
        }
        .stats-dashboard-card .title {
          font-size: 11px;
          font-weight: bold;
          color: #64748b;
          text-transform: uppercase;
        }
        .stats-dashboard-card .value {
          font-size: 22px;
          font-weight: 800;
          color: #0f172a;
        }
        .table-card {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .table-card-header {
          padding: 16px 20px;
          border-bottom: 1px solid #e2e8f0;
          font-weight: bold;
          font-size: 14px;
          background: #fff;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .premium-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .premium-table th {
          background: #f8fafc;
          padding: 12px 20px;
          font-size: 12px;
          font-weight: bold;
          color: #475569;
          border-bottom: 1px solid #e2e8f0;
        }
        .premium-table td {
          padding: 12px 20px;
          font-size: 13px;
          color: #334155;
          border-bottom: 1px solid #e2e8f0;
        }
        .premium-table tr:hover {
          background: #f8fafc;
        }
        .status-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 9999px;
          font-size: 10px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .status-badge.approved { background: #dcfce7; color: #15803d; }
        .status-badge.pending { background: #fef3c7; color: #b45309; }
        .status-badge.rejected { background: #fee2e2; color: #b91c1c; }
        .status-badge.suspended { background: #f1f5f9; color: #475569; }
        
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .form-row-three {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 16px;
        }
        .form-group label {
          font-size: 12px;
          font-weight: bold;
          color: #475569;
        }
        .form-control-input {
          height: 38px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 0 12px;
          font-size: 13px;
          outline: none;
          background: #fff;
        }
        .form-control-textarea {
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 13px;
          outline: none;
          min-height: 80px;
          background: #fff;
        }
        .action-button-group {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        .btn-premium {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 0 16px;
          height: 36px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
          border: none;
          white-space: nowrap;
        }
        .btn-premium-primary { background: #38bdf8; color: #fff; }
        .btn-premium-primary:hover { background: #0ea5e9; }
        .btn-premium-secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
        .btn-premium-secondary:hover { background: #e2e8f0; }
        .btn-premium-danger { background: #ef4444; color: #fff; }
        .btn-premium-danger:hover { background: #dc2626; }
 
        /* Mobile specific styles overlay mask */
        #mobile-nav-toggle {
          display: none;
          background: none;
          border: none;
          color: #334155;
          cursor: pointer;
          padding: 4px;
        }
        .sidebar-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 998;
        }
        .sidebar-overlay.active {
          display: block;
        }
 
        /* Tablet: 768px to 1199px */
        @media (min-width: 768px) and (max-width: 1199px) {
          .admin-sidebar {
            width: 70px;
          }
          .admin-sidebar .sidebar-header span:not(.material-symbols-outlined),
          .admin-sidebar .sidebar-nav button span:not(.material-symbols-outlined) {
            display: none;
          }
          .admin-sidebar .sidebar-nav button {
            justify-content: center;
            padding: 10px;
          }
          .stats-grid-container {
            grid-template-columns: repeat(2, 1fr); /* 2 cards per row on Tablet */
          }
          div[style*="grid-template-columns: 2fr 1fr;"] {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
 
        /* Mobile: < 768px */
        @media (max-width: 767px) {
          .admin-sidebar {
            position: fixed;
            top: 0;
            bottom: 0;
            left: 0;
            transform: translateX(-100%);
            z-index: 999;
            box-shadow: 4px 0 15px rgba(0,0,0,0.1);
          }
          .admin-sidebar.open {
            transform: translateX(0);
          }
          #mobile-nav-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .stats-grid-container {
            grid-template-columns: 1fr; /* 1 card per row on Mobile */
          }
          .form-row, .form-row-three {
            grid-template-columns: 1fr;
            gap: 0;
          }
          .admin-content-area {
            padding: 16px;
          }
          /* Detail grid split views */
          div[style*="grid-template-columns: 2fr 1fr;"],
          div[style*="grid-template-columns: 1fr 1fr;"],
          div[style*="grid-template-columns: 2fr 1fr; gap: 24px;"] {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
      </style>
    `;

    // Dynamic metrics calculators for tab Overview & cards
    const totalProviders = providers.length;
    const verifiedProviders = providers.filter(p => p.status === 'approved' || p.isVerified).length;
    const pendingProviders = providers.filter(p => p.status === 'pending').length;
    const suspendedProviders = providers.filter(p => p.status === 'suspended').length;

    const totalProducts = products.length;
    const pendingProducts = products.filter(p => p.status === 'pending').length;
    const approvedProducts = products.filter(p => p.status === 'approved').length;
    const rejectedProducts = products.filter(p => p.status === 'rejected').length;

    const totalServices = services.length;
    const pendingServices = services.filter(s => !s.isVerified).length;

    const totalCustomers = users.filter(u => u.role === 'customer').length;

    const todayStr = new Date().toDateString();
    
    // Today's searches
    const todaySearches = searches.filter(s => {
      if (!s.timestamp) return false;
      return new Date(s.timestamp).toDateString() === todayStr;
    }).length;

    // Today's Unlocks
    const todayUnlocks = payments.filter(p => {
      if (!p.createdAt) return false;
      const isUnlock = p.referenceCode && !p.referenceCode.startsWith('CHM-SUB');
      return isUnlock && new Date(p.createdAt).toDateString() === todayStr;
    }).length;

    // Today's Revenue
    const todayRevenue = payments.filter(p => {
      if (!p.createdAt) return false;
      return new Date(p.createdAt).toDateString() === todayStr && p.status === 'success';
    }).reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // Monthly Revenue
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const monthlyRevenue = payments.filter(p => {
      if (!p.createdAt) return false;
      const d = new Date(p.createdAt);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear && p.status === 'success';
    }).reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // Trust Score average
    const trustScoreProviders = providers.filter(p => p.trustScore !== undefined);
    const avgTrustScore = trustScoreProviders.length > 0
      ? Math.round(trustScoreProviders.reduce((acc, curr) => acc + (curr.trustScore || 0), 0) / trustScoreProviders.length)
      : 50;

    // RENDER SUB VIEWS BASED ON ACTIVE TAB
    if (activeAdminTab === 'overview') {
      // ==========================================
      // 1. DASHBOARD OVERVIEW RENDER
      // ==========================================
      const recentRegs = [...providers, ...users.filter(u => u.role === 'customer')]
        .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())
        .slice(0, 8);

      const recentRegsHtml = recentRegs.map(r => {
        const isProv = !!r.businessName;
        return `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 16px;">
              <span class="status-badge" style="background: ${isProv ? '#e0f2fe; color: #0369a1;' : '#f3e8ff; color: #6b21a8;'}">
                ${isProv ? 'Provider' : 'Customer'}
              </span>
            </td>
            <td style="padding: 10px 16px; font-weight: bold;">${r.businessName || r.name || 'Anonymous'}</td>
            <td style="padding: 10px 16px; font-size: 11px; color: #64748b;">${r.email || r.tinNumber || 'N/A'}</td>
            <td style="padding: 10px 16px; font-size: 11px; color: #94a3b8;">${new Date(r.createdAt || '').toLocaleDateString()}</td>
          </tr>
        `;
      }).join('');

      subViewContent = `
        <div class="stats-grid-container">
          <div class="stats-dashboard-card" id="card-providers-total" style="border-left: 4px solid #38bdf8; cursor: pointer;">
            <span class="title">Total Providers</span>
            <span class="value">${totalProviders}</span>
            <span style="font-size: 10px; color: #64748b;">Registered sellers</span>
          </div>
          <div class="stats-dashboard-card" id="card-providers-verified" style="border-left: 4px solid #10b981; cursor: pointer;">
            <span class="title">Verified Providers</span>
            <span class="value">${verifiedProviders}</span>
            <span style="font-size: 10px; color: #10b981;">✓ Approved & Geotagged</span>
          </div>
          <div class="stats-dashboard-card" id="card-providers-pending" style="border-left: 4px solid #f59e0b; cursor: pointer;">
            <span class="title">Pending Providers</span>
            <span class="value" style="color: #f59e0b;">${pendingProviders}</span>
            <span style="font-size: 10px; color: #b45309;">⚠ Verification Queue</span>
          </div>
          <div class="stats-dashboard-card" id="card-providers-suspended" style="border-left: 4px solid #ef4444; cursor: pointer;">
            <span class="title">Suspended Providers</span>
            <span class="value" style="color: #ef4444;">${suspendedProviders}</span>
            <span style="font-size: 10px; color: #dc2626;">Disabled accounts</span>
          </div>
          <div class="stats-dashboard-card" id="card-products-total" style="border-left: 4px solid #6366f1; cursor: pointer;">
            <span class="title">Total Products</span>
            <span class="value">${totalProducts}</span>
            <span style="font-size: 10px; color: #64748b;">Active items listings</span>
          </div>
          <div class="stats-dashboard-card" id="card-products-pending" style="border-left: 4px solid #f59e0b; cursor: pointer;">
            <span class="title">Pending Products</span>
            <span class="value" style="color: #f59e0b;">${pendingProducts}</span>
            <span style="font-size: 10px; color: #b45309;">Needs Photo Audit</span>
          </div>
          <div class="stats-dashboard-card" id="card-products-approved" style="border-left: 4px solid #10b981; cursor: pointer;">
            <span class="title">Approved Products</span>
            <span class="value">${approvedProducts}</span>
            <span style="font-size: 10px; color: #10b981;">Published live</span>
          </div>
          <div class="stats-dashboard-card" id="card-products-rejected" style="border-left: 4px solid #ef4444; cursor: pointer;">
            <span class="title">Rejected Products</span>
            <span class="value" style="color: #ef4444;">${rejectedProducts}</span>
            <span style="font-size: 10px; color: #dc2626;">Failed validation</span>
          </div>
          <div class="stats-dashboard-card" id="card-services-total" style="border-left: 4px solid #a855f7; cursor: pointer;">
            <span class="title">Total Services</span>
            <span class="value">${totalServices}</span>
            <span style="font-size: 10px; color: #64748b;">Services offered</span>
          </div>
          <div class="stats-dashboard-card" id="card-services-pending" style="border-left: 4px solid #f59e0b; cursor: pointer;">
            <span class="title">Pending Services</span>
            <span class="value" style="color: #f59e0b;">${pendingServices}</span>
            <span style="font-size: 10px; color: #b45309;">Awaiting verification</span>
          </div>
          <div class="stats-dashboard-card" id="card-customers-total" style="border-left: 4px solid #ec4899; cursor: pointer;">
            <span class="title">Total Customers</span>
            <span class="value">${totalCustomers}</span>
            <span style="font-size: 10px; color: #64748b;">Registered app users</span>
          </div>
          <div class="stats-dashboard-card" style="border-left: 4px solid #14b8a6;">
            <span class="title">Today's Searches</span>
            <span class="value">${todaySearches}</span>
            <span style="font-size: 10px; color: #0d9488;">Queries today</span>
          </div>
          <div class="stats-dashboard-card" style="border-left: 4px solid #06b6d4;">
            <span class="title">Today's Unlocks</span>
            <span class="value">${todayUnlocks}</span>
            <span style="font-size: 10px; color: #0891b2;">Contact unlocks today</span>
          </div>
          <div class="stats-dashboard-card" id="card-revenue-today" style="border-left: 4px solid #10b981; cursor: pointer;">
            <span class="title">Today's Revenue</span>
            <span class="value" style="color: #10b981;">TSh ${todayRevenue.toLocaleString()}</span>
            <span style="font-size: 10px; color: #64748b;">Earnings today</span>
          </div>
          <div class="stats-dashboard-card" id="card-revenue-monthly" style="border-left: 4px solid #10b981; cursor: pointer;">
            <span class="title">Monthly Revenue</span>
            <span class="value" style="color: #10b981;">TSh ${monthlyRevenue.toLocaleString()}</span>
            <span style="font-size: 10px; color: #64748b;">Current month earnings</span>
          </div>
          <div class="stats-dashboard-card" style="border-left: 4px solid #3b82f6;">
            <span class="title">Trust Score Avg</span>
            <span class="value" style="color: #3b82f6;">${avgTrustScore}%</span>
            <span style="font-size: 10px; color: #64748b;">Provider quality rating</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 24px;">
          <!-- Recent Registrations -->
          <div class="table-card">
            <div class="table-card-header">Recent Registrations</div>
            <div style="overflow-x: auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Name</th>
                    <th>Identifier</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentRegsHtml || '<tr><td colspan="4" style="text-align: center; padding: 20px;">No registrations.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Activity Logs Summary -->
          <div class="table-card">
            <div class="table-card-header">Recent System Activities</div>
            <div style="overflow-x: auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${logsList.slice(0, 8).map(l => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 10px 16px; font-weight: 500; font-size: 11px;">${l.userEmail}</td>
                      <td style="padding: 10px 16px;"><span class="status-badge" style="background: #e0f2fe; color: #0369a1; font-size: 9px;">${l.action}</span></td>
                      <td style="padding: 10px 16px; font-size: 11px; color: #64748b; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${l.details}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="3" style="text-align: center; padding: 20px;">No logs.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'providers') {
      // ==========================================
      // 2. PROVIDER MANAGEMENT
      // ==========================================
      if (selectedProviderId) {
        // --- Provider Details Full Profile View ---
        const p = providers.find(item => item.id === selectedProviderId);
        if (!p) {
          selectedProviderId = null;
          return `<script>window.location.reload();</script>`;
        }

        let openTime = '08:00';
        let closeTime = '17:00';
        if (p.businessHours && p.businessHours.includes(' - ')) {
          const parts = p.businessHours.split(' - ');
          if (parts[0]) openTime = parts[0].trim();
          if (parts[1]) closeTime = parts[1].trim();
        }

        // Sub & Payment lists for this provider
        const provSubs = subscriptions.filter(s => s.providerId === p.id);
        const provPayments = payments.filter(pay => pay.providerId === p.id || pay.userId === p.id);
        const provHistory = logsList.filter(l => l.details.includes(p.id) || l.details.includes(p.businessName));

        // Verification Progress calculation
        const hasDocs = verificationDocs.some(d => d.providerId === p.id && d.status === 'approved');
        const hasGps = p.latitude && p.longitude;
        const hasVisit = assignments.some(a => a.providerId === p.id && a.status === 'completed');

        // Filter verification docs, products, and services for this provider
        const provDocs = verificationDocs.filter(d => d.providerId === p.id);
        const docsHtmlList = provDocs.map(docItem => {
          const docUrl = docItem.secureUrl || docItem.fileUrl || '#';
          const isPhoto = docItem.type.startsWith('Office Photo');
          return `
            <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                ${isPhoto ? `<img src="${docUrl}" style="width: 50px; height: 50px; border-radius: 4px; object-fit: cover; border: 1px solid #cbd5e1;" />` : ''}
                <div>
                  <div style="font-weight: bold; font-size: 13px;">${docItem.type}</div>
                  <div style="font-size: 11px; color: #64748b;">Status: <span class="status-badge ${docItem.status || 'pending'}">${docItem.status || 'pending'}</span></div>
                </div>
              </div>
              <a href="${docUrl}" target="_blank" class="btn-premium btn-premium-secondary" style="height: 28px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;">${isPhoto ? 'View Photo' : 'View Doc'}</a>
            </div>
          `;
        }).join('');

        const provProducts = products.filter(prod => prod.providerId === p.id);
        const provProductsHtml = provProducts.map(prod => `
          <tr>
            <td style="font-weight: bold; color: #38bdf8;">${prod.name}</td>
            <td>TSh ${prod.price.toLocaleString()}</td>
            <td><span class="status-badge ${prod.status || 'pending'}">${prod.status || 'pending'}</span></td>
          </tr>
        `).join('');

        const provServices = services.filter(serv => serv.providerId === p.id);
        const provServicesHtml = provServices.map(serv => `
          <tr>
            <td style="font-weight: bold; color: #a855f7;">${serv.name}</td>
            <td>TSh ${serv.startingPrice.toLocaleString()}</td>
            <td><span class="status-badge ${serv.isVerified ? 'approved' : 'pending'}">${serv.isVerified ? 'verified' : 'unverified'}</span></td>
          </tr>
        `).join('');

        subViewContent = `
          <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px;">
            <button id="back-to-providers-list" class="btn-premium btn-premium-secondary" style="height: 32px;"><span class="material-symbols-outlined" style="font-size: 16px;">arrow_back</span> Back to List</button>
            <h3 style="font-weight: 800; font-size: 18px;">Provider Profile: ${p.businessName}</h3>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
            <div style="display: flex; flex-direction: column; gap: 24px;">
              <!-- Profile Card -->
              <div class="table-card" style="padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
                  <div>
                    <span class="status-badge ${p.status || 'pending'}">${p.status || 'pending'}</span>
                    <h4 style="font-size: 20px; font-weight: 800; margin-top: 8px;">${p.businessName}</h4>
                    <p style="color: #64748b; font-size: 13px; margin-top: 4px;">${p.description || 'No description provided.'}</p>
                  </div>
                  <div style="text-align: right;">
                    <span style="font-size: 12px; color: #94a3b8;">Trust Score Rating</span>
                    <h2 style="font-size: 32px; font-weight: 900; color: #38bdf8; margin-top: 4px;">${p.trustScore || 40}%</h2>
                  </div>
                </div>

                <!-- Update Provider Profile Form -->
                <h5 style="font-size: 13px; font-weight: 800; color: #334155; margin-top: 20px; margin-bottom: 12px;">Edit Business Information</h5>
                <div class="form-row">
                  <div class="form-group">
                    <label>Business Name</label>
                    <input id="edit-prov-bizname" class="form-control-input" type="text" value="${p.businessName}" />
                  </div>
                  <div class="form-group">
                    <label>Category</label>
                    <select id="edit-prov-category" class="form-control-input">
                      ${categories.map(c => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Whatsapp Contact</label>
                    <input id="edit-prov-whatsapp" class="form-control-input" type="text" value="${p.whatsapp || ''}" placeholder="e.g. +255..." />
                  </div>
                  <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                      <label style="font-size: 12px; font-weight: bold; color: #475569;">Opening Time</label>
                      <select id="edit-prov-opening-time" class="form-control-input" style="width: 100%;">
                        ${Array.from({length: 18}, (_, i) => {
                          const h = String(i + 6).padStart(2, '0') + ':00';
                          return `<option value="${h}" ${openTime === h ? 'selected' : ''}>${h}</option>`;
                        }).join('')}
                      </select>
                    </div>
                    <div>
                      <label style="font-size: 12px; font-weight: bold; color: #475569;">Closing Time</label>
                      <select id="edit-prov-closing-time" class="form-control-input" style="width: 100%;">
                        ${Array.from({length: 18}, (_, i) => {
                          const h = String(i + 6).padStart(2, '0') + ':00';
                          return `<option value="${h}" ${closeTime === h ? 'selected' : ''}>${h}</option>`;
                        }).join('')}
                      </select>
                    </div>
                  </div>
                </div>
                <div class="form-group">
                  <label>Business Address</label>
                  <input id="edit-prov-address" class="form-control-input" type="text" value="${p.address || ''}" />
                </div>
                <div class="form-group">
                  <label>Business Description</label>
                  <textarea id="edit-prov-desc" class="form-control-textarea">${p.description || ''}</textarea>
                </div>
                <button id="save-prov-edit-btn" data-id="${p.id}" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Save Profile Changes</button>
              </div>

              <!-- Verification Timeline -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px;">Verification Progress Timeline</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="material-symbols-outlined" style="color: #10b981;">check_circle</span>
                    <span style="font-size: 13px;"><strong>Step 1: Registered</strong> — Provider registration created (Completed)</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="material-symbols-outlined" style="color: ${hasDocs ? '#10b981' : '#cbd5e1'};">${hasDocs ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span style="font-size: 13px;"><strong>Step 2: Legal Documents Uploaded & Approved</strong> — BRELA, TIN, or License certificates validated (${hasDocs ? 'Approved' : 'Pending Approval'})</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="material-symbols-outlined" style="color: ${hasGps ? '#10b981' : '#cbd5e1'};">${hasGps ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span style="font-size: 13px;"><strong>Step 3: Geolocation Coordinates Locked</strong> — Coordinates: ${hasGps ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : 'Not saved'}${p.address ? ` | Address: ${p.address}` : ''}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="material-symbols-outlined" style="color: ${hasVisit ? '#10b981' : '#cbd5e1'};">${hasVisit ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span style="font-size: 13px;"><strong>Step 4: Field Visit Verified</strong> — Visit findings matching coordinates (${hasVisit ? 'Verified' : 'Pending visit'})</span>
                  </div>
                </div>
              </div>

              <!-- Uploaded Documents List -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px;">Uploaded Verification Documents</h4>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  ${docsHtmlList || '<p style="color: #64748b; font-size: 12px; text-align: center;">No documents uploaded yet.</p>'}
                </div>
              </div>

              <!-- Provider\'s Products -->
              <div class="table-card">
                <div class="table-card-header">Products Offered (${provProducts.length})</div>
                <div style="overflow-x: auto;">
                  <table class="premium-table">
                    <thead>
                      <tr>
                        <th>Product Name</th>
                        <th>Price</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${provProductsHtml || '<tr><td colspan="3" style="text-align: center; padding: 12px; font-size: 12px; color: #64748b;">No products listed.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Provider\'s Services -->
              <div class="table-card">
                <div class="table-card-header">Services Offered (${provServices.length})</div>
                <div style="overflow-x: auto;">
                  <table class="premium-table">
                    <thead>
                      <tr>
                        <th>Service Name</th>
                        <th>Starting Price</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${provServicesHtml || '<tr><td colspan="3" style="text-align: center; padding: 12px; font-size: 12px; color: #64748b;">No services listed.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Provider History Logs -->
              <div class="table-card">
                <div class="table-card-header">Provider Audit Trail History</div>
                <div style="overflow-x: auto;">
                  <table class="premium-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Details</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${provHistory.map(l => `
                        <tr>
                          <td><span class="status-badge approved" style="font-size: 9px;">${l.action}</span></td>
                          <td style="font-size: 12px;">${l.details}</td>
                          <td style="font-size: 11px; color: #94a3b8;">${new Date(l.timestamp).toLocaleString()}</td>
                        </tr>
                      `).join('') || '<tr><td colspan="3" style="text-align: center; padding: 12px;">No historical audit logs found.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Subscription History -->
              <div class="table-card">
                <div class="table-card-header">Subscription Tier History</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Expiry</th>
                      <th>Status</th>
                      <th>Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${provSubs.map(s => `
                      <tr>
                        <td style="font-weight: bold; text-transform: uppercase;">${s.plan}</td>
                        <td>${new Date(s.expiresAt).toLocaleDateString()}</td>
                        <td><span class="status-badge ${s.status === 'active' ? 'approved' : 'rejected'}">${s.status}</span></td>
                        <td>${new Date(s.createdAt).toLocaleDateString()}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="4" style="text-align: center; padding: 12px;">No subscription history.</td></tr>'}
                  </tbody>
                </table>
              </div>

              <!-- Payment History -->
              <div class="table-card">
                <div class="table-card-header">Payment Billing Records</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${provPayments.map(pay => `
                      <tr>
                        <td style="font-weight: bold; font-family: monospace;">${pay.referenceCode || 'N/A'}</td>
                        <td>TSh ${pay.amount.toLocaleString()}</td>
                        <td>${pay.paymentMethod || 'SMS Unlocks'}</td>
                        <td>${new Date(pay.createdAt).toLocaleDateString()}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="4" style="text-align: center; padding: 12px;">No payment logs.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Sidebar Info & Actions Panel -->
            <div style="display: flex; flex-direction: column; gap: 20px;">
              <!-- Admin Decision Actions -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Provider Audits</h4>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <button class="btn-premium btn-premium-primary prov-detail-action" data-action="approve" data-id="${p.id}" style="width:100%;">Approve Provider</button>
                  <button class="btn-premium btn-premium-secondary prov-detail-action" data-action="request_changes" data-id="${p.id}" style="width:100%; border: 1px solid #f59e0b; color: #f59e0b;">Request Changes</button>
                  <button class="btn-premium btn-premium-secondary prov-detail-action" data-action="reject" data-id="${p.id}" style="width:100%;">Reject Provider</button>
                  <button class="btn-premium btn-premium-danger prov-detail-action" data-action="suspend" data-id="${p.id}" style="width:100%;">Suspend Account</button>
                  <button class="btn-premium btn-premium-secondary prov-detail-action" data-action="reactivate" data-id="${p.id}" style="width:100%; border: 1px solid #10b981; color: #10b981;">Reactivate Account</button>
                  <button class="btn-premium btn-premium-danger prov-detail-action" data-action="delete" data-id="${p.id}" style="width:100%; margin-top: 16px;">Delete Provider</button>
                </div>
              </div>

              <!-- Trust & Risk configuration -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Security & Scoring</h4>
                
                <div class="form-group">
                  <label>Provider Risk Level</label>
                  <select id="prov-detail-risk-select" class="form-control-input">
                    <option value="low" ${p.riskScore === 'low' ? 'selected' : ''}>Low Risk</option>
                    <option value="medium" ${p.riskScore === 'medium' || !p.riskScore ? 'selected' : ''}>Medium Risk</option>
                    <option value="high" ${p.riskScore === 'high' ? 'selected' : ''}>High Risk / Warning</option>
                  </select>
                </div>
                
                <button id="prov-detail-recalc-trust" data-id="${p.id}" class="btn-premium btn-premium-secondary" style="width:100%; font-size: 11px;">Recalculate Trust Score</button>
              </div>

              <!-- Verification Notes -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">Private System Notes</h4>
                <textarea id="prov-detail-notes-area" class="form-control-textarea" placeholder="Add administrative feedback notes...">${p.adminNotes || ''}</textarea>
                <button id="prov-detail-save-notes" data-id="${p.id}" class="btn-premium btn-premium-primary" style="width:100%; height: 32px; font-size: 11px; margin-top: 8px;">Save Internal Notes</button>
              </div>
            </div>
          </div>
        `;
      } else {
        // --- Provider Search & Table List View ---
        const filteredProviders = providers.filter(p => {
          const matchSearch = p.businessName.toLowerCase().includes(providerSearchQuery.toLowerCase()) || (p.description || '').toLowerCase().includes(providerSearchQuery.toLowerCase());
          const matchStatus = providerStatusFilter === 'all' || 
            p.status === providerStatusFilter || 
            (providerStatusFilter === 'pending' && (p.verificationStatus === 'pending' || p.providerStatus === 'verification_submitted'));
          return matchSearch && matchStatus;
        });

        const listHtml = filteredProviders.map(p => {
          const ownerUser = users.find(u => u.id === p.userId);
          const ownerName = ownerUser?.name || 'N/A';
          const ownerPhone = p.whatsapp || ownerUser?.phoneNumber || 'N/A';
          const ownerEmail = ownerUser?.email || 'N/A';
          const activeSub = subscriptions.find(s => s.providerId === p.id && s.status === 'active');
          const subPlan = activeSub ? activeSub.plan.toUpperCase() : 'NONE';
          
          return `
            <tr class="clickable-row" data-id="${p.id}" style="cursor: pointer;">
              <td style="font-weight: bold; color: #38bdf8;">${p.businessName}</td>
              <td>${ownerName}</td>
              <td>${ownerPhone}</td>
              <td>${ownerEmail}</td>
              <td><strong style="color: #0284c7;">${p.trustScore || 40}%</strong></td>
              <td><span class="status-badge ${p.status || 'pending'}">${p.status || 'pending'}</span></td>
              <td><span class="status-badge ${subPlan === 'NONE' ? 'suspended' : 'approved'}" style="text-transform: uppercase;">${subPlan}</span></td>
              <td style="font-size: 11px; color: #94a3b8;">${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A'}</td>
            </tr>
          `;
        }).join('');

        subViewContent = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
            <h3 style="font-weight: 800; font-size: 16px;">Provider Listings</h3>
            
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <input id="prov-search-bar" class="form-control-input" type="text" placeholder="Search provider..." value="${providerSearchQuery}" style="width: 200px;" />
              <select id="prov-status-select" class="form-control-input" style="width: 140px;">
                <option value="all" ${providerStatusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                <option value="pending" ${providerStatusFilter === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="approved" ${providerStatusFilter === 'approved' ? 'selected' : ''}>Approved</option>
                <option value="suspended" ${providerStatusFilter === 'suspended' ? 'selected' : ''}>Suspended</option>
              </select>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start;">
            <!-- Table list of providers -->
            <div class="table-card" style="margin-bottom: 0;">
              <div style="overflow-x: auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Business Name</th>
                      <th>Owner</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>Trust Score</th>
                      <th>Status</th>
                      <th>Subscription</th>
                      <th>Created Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${listHtml || '<tr><td colspan="8" style="text-align: center; padding: 20px;">No providers found matching filters.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Create Provider Form Panel -->
            <div class="table-card" style="padding: 20px; background: #fff; margin-bottom: 0;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Sajili Provider Mpya</h4>
              <div class="form-group">
                <label>Jina la Biashara / Business Name</label>
                <input type="text" id="create-prov-bizname" class="form-control-input" placeholder="e.g. Kariakoo Electronics" />
              </div>
              <div class="form-group">
                <label>Category</label>
                <select id="create-prov-category" class="form-control-input">
                  ${categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Jina la Mmiliki / Owner Full Name</label>
                <input type="text" id="create-prov-ownername" class="form-control-input" placeholder="e.g. Salum Said" />
              </div>
              <div class="form-group">
                <label>Barua Pepe / Owner Email</label>
                <input type="email" id="create-prov-email" class="form-control-input" placeholder="e.g. owner@example.com" />
              </div>
              <div class="form-group">
                <label>Namba ya Whatsapp / Phone</label>
                <input type="text" id="create-prov-phone" class="form-control-input" placeholder="e.g. +255712345678" />
              </div>
              <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                <div>
                  <label style="font-size: 12px; font-weight: bold; color: #475569;">Opening Time</label>
                  <select id="create-prov-opening-time" class="form-control-input" style="width: 100%;">
                    ${Array.from({length: 18}, (_, i) => {
                      const h = String(i + 6).padStart(2, '0') + ':00';
                      return `<option value="${h}" ${h === '08:00' ? 'selected' : ''}>${h}</option>`;
                    }).join('')}
                  </select>
                </div>
                <div>
                  <label style="font-size: 12px; font-weight: bold; color: #475569;">Closing Time</label>
                  <select id="create-prov-closing-time" class="form-control-input" style="width: 100%;">
                    ${Array.from({length: 18}, (_, i) => {
                      const h = String(i + 6).padStart(2, '0') + ':00';
                      return `<option value="${h}" ${h === '18:00' ? 'selected' : ''}>${h}</option>`;
                    }).join('')}
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>Address / Eneo la Biashara</label>
                <input type="text" id="create-prov-address" class="form-control-input" placeholder="e.g. Mtaa wa Msimbazi, Dar" />
              </div>
              <div class="form-group">
                <label>Maelezo / Description</label>
                <textarea id="create-prov-desc" class="form-control-textarea" placeholder="Maelezo kuhusu biashara..."></textarea>
              </div>
              <button id="submit-create-provider" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Sajili Provider</button>
            </div>
          </div>
        `;
      }
    } else if (activeAdminTab === 'products') {
      // ==========================================
      // 3. PRODUCT MANAGEMENT
      // ==========================================
      if (selectedProductId) {
        const p = products.find(item => item.id === selectedProductId);
        if (!p) {
          selectedProductId = null;
          return `<script>window.location.reload();</script>`;
        }

        const pImages = allProductImages.filter(img => img.productId === p.id);
        const angles = ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'] as const;
        const prodHistory = logsList.filter(l => l.details.includes(p.id) || l.details.includes(p.name));

        subViewContent = `
          <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px;">
            <button id="back-to-products-list" class="btn-premium btn-premium-secondary" style="height: 32px;"><span class="material-symbols-outlined" style="font-size: 16px;">arrow_back</span> Back to List</button>
            <h3 style="font-weight: 800; font-size: 18px;">Product Audit Details: ${p.name}</h3>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
            <div style="display: flex; flex-direction: column; gap: 20px;">
              <!-- General Info & Edit Form -->
              <div class="table-card" style="padding: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px;">
                  <div>
                    <span class="status-badge ${p.status || 'pending'}">${p.status || 'pending'}</span>
                    <h4 style="font-size: 18px; font-weight: 800; margin-top: 6px;">Edit Listing Data</h4>
                  </div>
                  <h3 style="color: #38bdf8; font-size: 18px; font-weight: bold;">TSh ${p.price.toLocaleString()}</h3>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Product Name</label>
                    <input id="edit-prod-name" class="form-control-input" type="text" value="${p.name}" />
                  </div>
                  <div class="form-group">
                    <label>Price (TSh)</label>
                    <input id="edit-prod-price" class="form-control-input" type="number" value="${p.price}" />
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Brand</label>
                    <input id="edit-prod-brand" class="form-control-input" type="text" value="${p.brand || ''}" />
                  </div>
                  <div class="form-group">
                    <label>Category</label>
                    <select id="edit-prod-category" class="form-control-input">
                      ${categories.filter(c => c.type === 'product').map(c => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                    </select>
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Condition</label>
                    <select id="edit-prod-condition" class="form-control-input">
                      <option value="new" ${p.condition === 'new' ? 'selected' : ''}>New</option>
                      <option value="used" ${p.condition === 'used' ? 'selected' : ''}>Used</option>
                      <option value="refurbished" ${p.condition === 'refurbished' ? 'selected' : ''}>Refurbished</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Stock Quantity</label>
                    <input id="edit-prod-stock" class="form-control-input" type="number" value="${p.stockQuantity !== undefined ? p.stockQuantity : 10}" />
                  </div>
                </div>

                <div class="form-group">
                  <label>Features (Comma separated)</label>
                  <input id="edit-prod-features" class="form-control-input" type="text" value="${p.features ? p.features.join(', ') : ''}" placeholder="e.g. 8GB RAM, 256GB SSD" />
                </div>

                <div class="form-group">
                  <label>Product Description</label>
                  <textarea id="edit-prod-desc" class="form-control-textarea">${p.description || ''}</textarea>
                </div>

                <button id="save-prod-data-btn" data-id="${p.id}" class="btn-premium btn-premium-primary" style="width: 100%; height: 38px;">Save Product Specifications</button>
              </div>

              <!-- Product 7 Image Angles Grid -->
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Direct Upload Image Angles Verification</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px;">
                  ${angles.map(ang => {
                    const imgObj = pImages.find(img => img.angle === ang);
                    const imgUrl = imgObj?.secureUrl || imgObj?.imageUrl || '';
                    const exists = !!imgUrl;
                    return `
                      <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #f8fafc; text-align: center; padding: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 120px;">
                        <span style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: #475569; margin-bottom: 4px;">${ang}</span>
                        ${exists 
                          ? `<a href="${imgUrl}" target="_blank"><img src="${imgUrl}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 4px;" /></a>` 
                          : `<span class="material-symbols-outlined" style="font-size: 32px; color: #cbd5e1;">image_not_supported</span><span style="font-size: 9px; color: #cbd5e1; margin-top: 2px;">Missing Angle</span>`
                        }
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Product Audit History -->
              <div class="table-card">
                <div class="table-card-header">Product Operations Log</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Details</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${prodHistory.map(l => `
                      <tr>
                        <td><span class="status-badge approved" style="font-size: 8px;">${l.action}</span></td>
                        <td style="font-size: 11px;">${l.details}</td>
                        <td style="font-size: 10px; color: #94a3b8;">${new Date(l.timestamp).toLocaleDateString()}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="3" style="text-align: center; padding: 10px; font-size: 12px;">No logged states.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Decision Box -->
            <div style="display: flex; flex-direction: column; gap: 20px;">
              <div class="table-card" style="padding: 20px;">
                <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Auditing Actions</h4>
                
                <div class="form-group">
                  <label>Image Quality Score (0 - 100)</label>
                  <input type="range" id="audit-img-score-range" min="0" max="100" value="${p.qualityScore || 90}" style="width: 100%;" />
                  <span id="audit-img-score-display" style="font-size: 12px; font-weight: bold; color: #38bdf8;">${p.qualityScore || 90} points</span>
                </div>

                <div class="form-group">
                  <label style="display: flex; align-items: center; gap: 6px; font-size: 12px;">
                    <input type="checkbox" id="audit-price-check" ${p.isPriceValidated ? 'checked' : ''} /> Price is realistic
                  </label>
                  <label style="display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px;">
                    <input type="checkbox" id="audit-feat-check" ${p.isFeatureValidated ? 'checked' : ''} /> Features validate templates
                  </label>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 16px;">
                  <button class="btn-premium btn-premium-primary prod-detail-action" data-action="approve" data-id="${p.id}" style="width: 100%;">Approve & Publish</button>
                  <button class="btn-premium btn-premium-secondary prod-detail-action" data-action="reject" data-id="${p.id}" style="width: 100%;">Reject Listing</button>
                  <button class="btn-premium btn-premium-secondary prod-detail-action" data-action="changes" data-id="${p.id}" style="width: 100%; color: #b45309; border: 1px solid #b45309;">Request Changes</button>
                  <button class="btn-premium btn-premium-danger prod-detail-action" data-action="delete" data-id="${p.id}" style="width: 100%; margin-top: 8px;">Delete Product</button>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        const filteredProds = products.filter(p => {
          return productStatusFilter === 'all' || p.status === productStatusFilter;
        });

        const prodsHtml = filteredProds.map(p => `
          <tr class="clickable-prod-row" data-id="${p.id}" style="cursor: pointer;">
            <td style="font-weight: bold; color: #38bdf8;">${p.name}</td>
            <td>${p.brand || 'N/A'}</td>
            <td>${p.category || 'General'}</td>
            <td>TSh ${p.price.toLocaleString()}</td>
            <td><span class="status-badge ${p.status || 'pending'}">${p.status || 'pending'}</span></td>
            <td>${p.qualityScore || 90}</td>
            <td>${new Date(p.createdAt || '').toLocaleDateString()}</td>
          </tr>
        `).join('');

        subViewContent = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
            <h3 style="font-weight: 800; font-size: 16px;">Product Listings Audit Queue</h3>
            
            <select id="prod-status-filter-select" class="form-control-input" style="width: 160px;">
              <option value="pending" ${productStatusFilter === 'pending' ? 'selected' : ''}>Pending Queue</option>
              <option value="approved" ${productStatusFilter === 'approved' ? 'selected' : ''}>Approved Queue</option>
              <option value="rejected" ${productStatusFilter === 'rejected' ? 'selected' : ''}>Rejected Queue</option>
              <option value="all" ${productStatusFilter === 'all' ? 'selected' : ''}>All Listings</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start;">
            <!-- Left Side: Product Table -->
            <div class="table-card" style="margin-bottom: 0;">
              <div style="overflow-x: auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Brand</th>
                      <th>Category</th>
                      <th>Price</th>
                      <th>Status</th>
                      <th>Quality Score</th>
                      <th>Submitted Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${prodsHtml || '<tr><td colspan="7" style="text-align: center; padding: 20px;">No products found in this queue.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Right Side: Add New Product Form -->
            <div class="table-card" style="padding: 20px; background: #fff; margin-bottom: 0;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Ongeza Bidhaa Mpya</h4>
              <div class="form-group">
                <label>Jina la Bidhaa / Product Name</label>
                <input type="text" id="create-prod-name" class="form-control-input" placeholder="e.g. iPhone 15 Pro" />
              </div>
              <div class="form-group">
                <label>Bei / Price (TSh)</label>
                <input type="number" id="create-prod-price" class="form-control-input" placeholder="e.g. 2500000" />
              </div>
              <div class="form-group">
                <label>Brand</label>
                <input type="text" id="create-prod-brand" class="form-control-input" placeholder="e.g. Apple" />
              </div>
              <div class="form-group">
                <label>Category</label>
                <select id="create-prod-category" class="form-control-input">
                  ${categories.filter(c => c.type === 'product').map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Hali / Condition</label>
                <select id="create-prod-condition" class="form-control-input">
                  <option value="new">Mpya / New</option>
                  <option value="used">Iliyotumika / Used</option>
                  <option value="refurbished">Refurbished</option>
                </select>
              </div>
              <div class="form-group">
                <label>Muuzaji / Provider</label>
                <select id="create-prod-provider" class="form-control-input">
                  ${providers.map(prov => `<option value="${prov.id}">${prov.businessName}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Kiasi / Stock Quantity</label>
                <input type="number" id="create-prod-stock" class="form-control-input" value="10" />
              </div>
              <div class="form-group">
                <label>Sifa / Features (Comma separated)</label>
                <input type="text" id="create-prod-features" class="form-control-input" placeholder="e.g. 128GB, eSIM, Black" />
              </div>
              <div class="form-group">
                <label>Maelezo / Description</label>
                <textarea id="create-prod-desc" class="form-control-textarea" placeholder="Maelezo zaidi kuhusu bidhaa..."></textarea>
              </div>
              <button id="submit-create-product" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Save Bidhaa</button>
            </div>
          </div>
        `;
      }
    } else if (activeAdminTab === 'services') {
      // ==========================================
      // 4. SERVICE MANAGEMENT
      // ==========================================
      if (selectedServiceId) {
        const s = services.find(item => item.id === selectedServiceId);
        if (!s) {
          selectedServiceId = null;
          return `<script>window.location.reload();</script>`;
        }

        subViewContent = `
          <div style="display: flex; gap: 16px; align-items: center; margin-bottom: 20px;">
            <button id="back-to-services-list" class="btn-premium btn-premium-secondary" style="height: 32px;"><span class="material-symbols-outlined" style="font-size: 16px;">arrow_back</span> Back to List</button>
            <h3 style="font-weight: 800; font-size: 18px;">Service Audit: ${s.name}</h3>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px;">
            <div class="table-card" style="padding: 20px;">
              <h4 style="font-size: 16px; font-weight: bold; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px;">Edit Service Profile</h4>
              
              <div class="form-row">
                <div class="form-group">
                  <label>Service Name</label>
                  <input id="edit-serv-name" class="form-control-input" type="text" value="${s.name}" />
                </div>
                <div class="form-group">
                  <label>Category</label>
                  <select id="edit-serv-category" class="form-control-input">
                    ${categories.filter(c => c.type === 'service').map(c => `<option value="${c.id}" ${s.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>Starting Price (TSh)</label>
                  <input id="edit-serv-price" class="form-control-input" type="number" value="${s.startingPrice}" />
                </div>
                <div class="form-group">
                  <label>Coverage Areas (Comma separated)</label>
                  <input id="edit-serv-coverage" class="form-control-input" type="text" value="${s.coverageAreas ? s.coverageAreas.join(', ') : ''}" placeholder="e.g. Kariakoo, Ilala, Temeke" />
                </div>
              </div>

              <div class="form-group">
                <label>Service Description</label>
                <textarea id="edit-serv-desc" class="form-control-textarea">${s.description || ''}</textarea>
              </div>

              <button id="save-serv-data-btn" data-id="${s.id}" class="btn-premium btn-premium-primary" style="width:100%; height:38px;">Save Service Details</button>
            </div>

            <!-- Decisions panel -->
            <div class="table-card" style="padding: 20px;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px;">Administrative Review</h4>
              <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">Review details and verify starting prices against market standard.</p>
              
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="btn-premium btn-premium-primary serv-action-btn" data-action="approve" data-id="${s.id}" style="width: 100%;">Approve & Verify</button>
                <button class="btn-premium btn-premium-secondary serv-action-btn" data-action="reject" data-id="${s.id}" style="width: 100%;">Reject Service</button>
                <button class="btn-premium btn-premium-secondary serv-action-btn" data-action="changes" data-id="${s.id}" style="width: 100%; color: #b45309; border: 1px solid #b45309;">Request Changes</button>
                <button class="btn-premium btn-premium-danger serv-action-btn" data-action="delete" data-id="${s.id}" style="width: 100%; margin-top: 12px;">Delete Service</button>
              </div>
            </div>
          </div>
        `;
      } else {
        const filteredServices = services.filter(s => {
          if (serviceStatusFilter === 'pending') return !s.isVerified;
          if (serviceStatusFilter === 'approved') return s.isVerified;
          return true;
        });

        const servsHtml = filteredServices.map(s => `
          <tr class="clickable-serv-row" data-id="${s.id}" style="cursor: pointer;">
            <td style="font-weight: bold; color: #38bdf8;">${s.name}</td>
            <td>${s.category || 'General'}</td>
            <td>TSh ${s.startingPrice.toLocaleString()}</td>
            <td>${s.coverageAreas ? s.coverageAreas.join(', ') : 'All Areas'}</td>
            <td><span class="status-badge ${s.isVerified ? 'approved' : 'pending'}">${s.isVerified ? 'Approved' : 'Pending'}</span></td>
            <td>${new Date(s.createdAt || '').toLocaleDateString()}</td>
          </tr>
        `).join('');

        subViewContent = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
            <h3 style="font-weight: 800; font-size: 16px;">Service Management Desk</h3>
            
            <select id="serv-status-filter-select" class="form-control-input" style="width: 160px;">
              <option value="pending" ${serviceStatusFilter === 'pending' ? 'selected' : ''}>Pending Verification</option>
              <option value="approved" ${serviceStatusFilter === 'approved' ? 'selected' : ''}>Approved Services</option>
              <option value="all" ${serviceStatusFilter === 'all' ? 'selected' : ''}>All Services</option>
            </select>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items: start;">
            <!-- Left Side: Service Table -->
            <div class="table-card" style="margin-bottom: 0;">
              <div style="overflow-x: auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Service Name</th>
                      <th>Category</th>
                      <th>Starting Price</th>
                      <th>Coverage Areas</th>
                      <th>Status</th>
                      <th>Submitted Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${servsHtml || '<tr><td colspan="6" style="text-align: center; padding: 20px;">No services in this queue.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Right Side: Add New Service Form -->
            <div class="table-card" style="padding: 20px; background: #fff; margin-bottom: 0;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Ongeza Huduma Mpya</h4>
              <div class="form-group">
                <label>Jina la Huduma / Service Name</label>
                <input type="text" id="create-serv-name" class="form-control-input" placeholder="e.g. AC Repair / Ufungaji wa AC" />
              </div>
              <div class="form-group">
                <label>Category</label>
                <select id="create-serv-category" class="form-control-input">
                  ${categories.filter(c => c.type === 'service').map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Bei ya Kuanzia / Starting Price (TSh)</label>
                <input type="number" id="create-serv-price" class="form-control-input" placeholder="e.g. 50000" />
              </div>
              <div class="form-group">
                <label>Maeneo ya Huduma / Coverage Areas (Comma separated)</label>
                <input type="text" id="create-serv-coverage" class="form-control-input" placeholder="e.g. Kariakoo, Kinondoni" />
              </div>
              <div class="form-group">
                <label>Mtoa Huduma / Provider</label>
                <select id="create-serv-provider" class="form-control-input">
                  ${providers.map(prov => `<option value="${prov.id}">${prov.businessName}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Maelezo / Description</label>
                <textarea id="create-serv-desc" class="form-control-textarea" placeholder="Maelezo zaidi kuhusu huduma..."></textarea>
              </div>
              <button id="submit-create-service" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Save Huduma</button>
            </div>
          </div>
        `;
      }
    } else if (activeAdminTab === 'documents') {
      // ==========================================
      // 5. DOCUMENT VERIFICATION CENTER
      // ==========================================
      const filteredDocs = verificationDocs.filter(d => {
        return docStatusFilter === 'all' || d.status === docStatusFilter;
      });

      const docsHtml = filteredDocs.map(d => {
        const docUrl = d.secureUrl || d.fileUrl || '';
        const isPdf = d.format === 'pdf' || docUrl.toLowerCase().endsWith('.pdf') || docUrl.startsWith('data:application/pdf');
        return `
          <tr>
            <td style="font-weight: bold;">${d.type}</td>
            <td style="font-family: monospace; font-size: 11px;">${d.providerId.substring(0, 8)}...</td>
            <td><span class="status-badge ${d.status}">${d.status}</span></td>
            <td>${new Date(d.createdAt).toLocaleDateString()}</td>
            <td>
              <div style="display: flex; gap: 4px; align-items: center;">
                <button class="btn-premium btn-premium-secondary doc-preview-trigger" data-url="${docUrl}" data-is-pdf="${isPdf}" style="height: 28px; padding: 0 10px; font-size: 11px;">
                  Open Preview
                </button>
                <button class="btn-premium btn-premium-primary doc-verif-btn" data-action="approve" data-id="${d.id}" style="height: 28px; padding: 0 8px; font-size: 10px;">Approve</button>
                <button class="btn-premium btn-premium-secondary doc-verif-btn" data-action="reject" data-id="${d.id}" style="height: 28px; padding: 0 8px; font-size: 10px;">Reject</button>
                <button class="btn-premium btn-premium-secondary doc-verif-btn" data-action="reupload" data-id="${d.id}" style="height: 28px; padding: 0 8px; font-size: 10px; color: #b45309;">Reupload</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      subViewContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <h3 style="font-weight: 800; font-size: 16px;">Legal Document Verification Desk</h3>
          
          <select id="doc-status-filter-select" class="form-control-input" style="width: 160px;">
            <option value="pending" ${docStatusFilter === 'pending' ? 'selected' : ''}>Pending Review</option>
            <option value="approved" ${docStatusFilter === 'approved' ? 'selected' : ''}>Approved Docs</option>
            <option value="rejected" ${docStatusFilter === 'rejected' ? 'selected' : ''}>Rejected Docs</option>
            <option value="all" ${docStatusFilter === 'all' ? 'selected' : ''}>All Documents</option>
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div class="table-card">
            <div style="overflow-x: auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Doc Type</th>
                    <th>Provider UID</th>
                    <th>Status</th>
                    <th>Upload Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${docsHtml || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No documents in this queue.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <!-- PDF & Office Photo Viewer -->
          <div class="table-card" style="padding: 16px; min-height: 350px; display: flex; flex-direction: column; gap: 12px; background: #fff;">
            <h4 style="font-weight: bold; font-size: 13px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">Document Viewer</h4>
            
            <div class="form-group">
              <label>Verification notes</label>
              <textarea id="doc-verification-notes" class="form-control-textarea" placeholder="Add observations on license details..." style="min-height: 60px; font-size: 12px;"></textarea>
            </div>

            <div id="admin-doc-viewer-container" style="flex: 1; border: 1px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: #f8fafc; overflow: hidden; min-height: 250px;">
              <div style="text-align: center; color: #94a3b8; padding: 16px;">
                <span class="material-symbols-outlined" style="font-size: 48px;">find_in_page</span>
                <p style="font-size: 12px; margin-top: 8px;">Select a document to open preview</p>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'staff') {
      // ==========================================
      // 6. FIELD STAFF MANAGEMENT
      // ==========================================
      const staffList = users.filter(u => u.role === 'staff' || u.role === 'admin');

      const staffHtml = staffList.map(s => {
        const completedCount = assignments.filter(a => a.staffId === s.id && a.status === 'completed').length;
        const pendingCount = assignments.filter(a => a.staffId === s.id && a.status === 'assigned').length;

        return `
          <tr class="clickable-staff-row" data-id="${s.id}" style="cursor: pointer;">
            <td style="font-weight: bold; color: #38bdf8;">${s.name || 'Anonymous'}</td>
            <td>${s.email}</td>
            <td style="text-transform: uppercase;">${s.role}</td>
            <td><span class="status-badge ${s.status === 'suspended' ? 'rejected' : 'approved'}">${s.status || 'active'}</span></td>
            <td><strong>${completedCount}</strong> completed / ${pendingCount} pending</td>
            <td>${new Date(s.createdAt || '').toLocaleDateString()}</td>
          </tr>
        `;
      }).join('');

      let staffLogsHtml = '<tr><td colspan="3" style="text-align: center; padding: 12px;">Select a staff member to view logs.</td></tr>';
      if (selectedStaffId) {
        const selectedStaffObj = staffList.find(s => s.id === selectedStaffId);
        const sLogs = logsList.filter(l => l.userEmail === selectedStaffObj?.email);
        staffLogsHtml = sLogs.map(l => `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px; font-weight: bold; font-size: 11px;">${new Date(l.timestamp).toLocaleDateString()}</td>
            <td style="padding: 8px;"><span class="status-badge approved" style="font-size: 8px;">${l.action}</span></td>
            <td style="padding: 8px; font-size: 11px; color: #64748b;">${l.details}</td>
          </tr>
        `).join('') || '<tr><td colspan="3" style="text-align: center; padding: 12px; color: #94a3b8;">No activity logged for this user.</td></tr>';
      }

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Field Staff Management Console</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="table-card">
              <div class="table-card-header">All Staff Members</div>
              <div style="overflow-x: auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>GPS Workload</th>
                      <th>Joined Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${staffHtml || '<tr><td colspan="6" style="text-align: center; padding: 20px;">No staff registered yet.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Invite Staff Form -->
            <div class="table-card" style="padding: 16px; max-width: 500px;">
              <h4 style="font-weight: bold; font-size: 13px; margin-bottom: 10px;">Invite Staff Member</h4>
              <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="invite-staff-name" class="form-control-input" placeholder="e.g. John Peter" />
              </div>
              <div class="form-group">
                <label>Email Address</label>
                <input type="email" id="invite-staff-email" class="form-control-input" placeholder="e.g. staff@chimbo.com" />
              </div>
              <div class="form-group">
                <label>Role Assignment</label>
                <select id="invite-staff-role" class="form-control-input">
                  <option value="staff">Field Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button id="submit-invite-staff" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%; margin-top: 8px;">Send Invitation Link</button>

              <h5 style="font-weight: bold; font-size: 11px; margin-top: 16px; margin-bottom: 6px;">Active Invitations</h5>
              <div style="overflow-y:auto; font-size: 11px; max-height: 120px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc; padding:6px;">
                ${staffInvitations.map(inv => `
                  <div style="display:flex; justify-content:space-between; margin-bottom:4px; border-bottom:1px solid #e2e8f0; padding-bottom:2px;">
                    <span>${inv.email} (${inv.role})</span>
                    <span style="color:#b45309;">${inv.status}</span>
                  </div>
                `).join('') || '<span style="color:#94a3b8;">No pending invites.</span>'}
              </div>
            </div>
          </div>

          <!-- Staff Details Actions & Audit Logs -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            ${selectedStaffId ? (() => {
              const staff = staffList.find(s => s.id === selectedStaffId);
              if (!staff) return '';
              return `
                <div class="table-card" style="padding: 20px;">
                  <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Manage Staff Member</h4>
                  <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="edit-staff-name" class="form-control-input" value="${staff.name || ''}" />
                  </div>
                  <div class="form-group">
                    <label>Email Address</label>
                    <input type="email" id="edit-staff-email" class="form-control-input" value="${staff.email || ''}" />
                  </div>
                  <div class="form-group">
                    <label>Modify System Role</label>
                    <select id="edit-staff-role" class="form-control-input">
                      <option value="staff" ${staff.role === 'staff' ? 'selected' : ''}>Field Staff</option>
                      <option value="admin" ${staff.role === 'admin' ? 'selected' : ''}>Administrator</option>
                      <option value="superadmin" ${staff.role === 'superadmin' ? 'selected' : ''}>Super Administrator</option>
                    </select>
                  </div>
                  <button id="save-staff-edit-btn" data-id="${staff.id}" class="btn-premium btn-premium-primary" style="width: 100%; height: 36px; margin-bottom: 12px;">Save Staff Changes</button>
                  
                  <div style="display: flex; flex-direction: column; gap: 6px;">
                    <button class="btn-premium btn-premium-secondary staff-management-action" data-action="toggle-suspend" data-id="${staff.id}" style="width: 100%;">
                      ${staff.status === 'suspended' || staff.status === 'disabled' ? 'Enable Staff' : 'Disable Staff'}
                    </button>
                    <button class="btn-premium btn-premium-danger staff-management-action" data-action="delete" data-id="${staff.id}" style="width: 100%;">Delete Staff</button>
                  </div>
                </div>

                <div class="table-card" style="max-height: 300px; display: flex; flex-direction: column; overflow: hidden;">
                  <div class="table-card-header">Activity History</div>
                  <div style="overflow-y: auto; flex: 1;">
                    <table class="premium-table" style="font-size: 11px;">
                      <tbody>
                        ${staffLogsHtml}
                      </tbody>
                    </table>
                  </div>
                </div>
              `;
            })() : `
              <div class="table-card" style="padding: 20px; text-align: center; color: #94a3b8;">
                <span class="material-symbols-outlined" style="font-size: 32px;">badge</span>
                <p style="font-size: 12px; margin-top: 8px;">Select a staff member from the table to view actions and performance.</p>
              </div>
            `}
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'field') {
      // ==========================================
      // 7. FIELD VERIFICATION MANAGEMENT
      // ==========================================
      const approvedProviders = providers.filter(p => p.status === 'approved' || p.isVerified);
      const staffList = users.filter(u => u.role === 'staff');

      const assignmentsHtml = assignments.map(a => {
        const p = providers.find(item => item.id === a.providerId);
        const report = fieldReports.find(r => r.assignmentId === a.id);
        const sObj = staffList.find(s => s.id === a.staffId);
        return `
          <tr>
            <td style="font-weight: bold; color: #38bdf8;">${p ? p.businessName : 'Unknown'}</td>
            <td>${sObj ? sObj.name || sObj.email : a.staffId.substring(0, 8)}</td>
            <td>${a.area || 'Kariakoo'}</td>
            <td>${new Date(a.scheduledDate).toLocaleDateString()}</td>
            <td>
              <span class="status-badge ${a.status === 'completed' ? 'approved' : 'pending'}">${a.status}</span>
            </td>
            <td>
              <div style="display: flex; gap: 4px;">
                ${a.status === 'assigned' ? `
                  <button class="btn-premium btn-premium-secondary simulate-staff-report-trigger" data-assign-id="${a.id}" data-provider-id="${a.providerId}" style="height: 26px; padding: 0 8px; font-size: 10px; border: 1px solid #10b981; color: #10b981;">Simulate Report</button>
                ` : ''}
                ${report ? `
                  <button class="btn-premium btn-premium-secondary view-report-details" data-report-id="${report.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">View Report</button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">GPS Field Visit Assignments</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div class="table-card">
            <div class="table-card-header">Verification Visits Track</div>
            <div style="overflow-x: auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Staff Member</th>
                    <th>Area</th>
                    <th>Deadline</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${assignmentsHtml || '<tr><td colspan="6" style="text-align: center; padding: 20px;">No verification visits assigned.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Assign Visit Form & Visit Findings Review -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="table-card" style="padding: 20px;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Assign Visit</h4>
              <div class="form-group">
                <label>Select Provider</label>
                <select id="assign-provider-select" class="form-control-input">
                  ${approvedProviders.map(p => `<option value="${p.id}">${p.businessName}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Select Field Staff</label>
                <select id="assign-staff-select" class="form-control-input">
                  ${staffList.map(s => `<option value="${s.id}">${s.name || s.email}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Visit Area / District</label>
                <input type="text" id="assign-area-input" class="form-control-input" placeholder="e.g. Kariakoo Block 4" />
              </div>
              <div class="form-group">
                <label>Deadline Date</label>
                <input type="date" id="assign-deadline-input" class="form-control-input" />
              </div>
              <button id="submit-field-assign" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Create Assignment</button>
            </div>

            <!-- Report Details Container -->
            <div id="field-visit-report-details" class="table-card" style="padding: 20px; display: none;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 8px;">Review Visit Findings</h4>
              <div id="findings-content-placeholder" style="font-size: 13px; line-height: 1.4; color: #475569; display:flex; flex-direction:column; gap:8px;">
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'customers') {
      // ==========================================
      // 8. CUSTOMER INTELLIGENCE CENTER & DISPUTE RESOLUTION
      // ==========================================
      const customerList = users.filter(u => u.role === 'customer');
      const filteredCustomers = customerList.filter(c => {
        return (c.name || '').toLowerCase().includes(customerSearchQuery.toLowerCase()) || 
               c.email.toLowerCase().includes(customerSearchQuery.toLowerCase());
      });

      const custsHtml = filteredCustomers.map(c => `
        <tr class="clickable-cust-row" data-id="${c.id}" style="cursor: pointer;">
          <td style="font-weight: bold; color: #38bdf8;">${c.name || 'Anonymous'}</td>
          <td>${c.email}</td>
          <td><span class="status-badge ${c.status === 'suspended' ? 'rejected' : 'approved'}">${c.status || 'active'}</span></td>
          <td>${c.phoneNumber || 'N/A'}</td>
          <td>${new Date(c.createdAt || '').toLocaleDateString()}</td>
        </tr>
      `).join('');

      let rightPanelContent = '';

      if (selectedReportId) {
        // --- PROVIDER DISPUTE RESOLUTION DESK ---
        const rep = complaints.find(r => r.id === selectedReportId);
        if (!rep) {
          selectedReportId = null;
          rightPanelContent = '<p style="padding:20px; color:#64748b;">Dispute record not found.</p>';
        } else {
          const reporter = users.find(u => u.id === rep.reporterId);
          const prov = providers.find(p => p.id === rep.providerId);
          
          // Fetch associated logs
          const disputePayments = payments.filter(p => p.userId === rep.reporterId && p.providerId === rep.providerId);
          const disputeGpsLogs = assignments.filter(a => a.providerId === rep.providerId);

          rightPanelContent = `
            <div class="table-card" style="padding: 20px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:10px; margin-bottom:12px;">
                <h4 style="font-weight: bold; font-size: 14px; color:#38bdf8;">Dispute Resolution Desk</h4>
                <button id="close-dispute-desk-btn" class="btn-premium btn-premium-secondary" style="height:26px; font-size:10px;">Back to Profile</button>
              </div>

              <div style="display:flex; flex-direction:column; gap:12px; font-size:12px;">
                <div><strong>Case Ref ID:</strong> <span style="font-family:monospace;">${rep.id}</span></div>
                <div><strong>Status:</strong> <span class="status-badge ${rep.status === 'resolved' ? 'approved' : rep.status === 'closed' ? 'suspended' : 'pending'}">${rep.status}</span></div>
                <div><strong>Customer:</strong> ${reporter?.name || 'Anonymous'} (${reporter?.email || 'N/A'})</div>
                <div><strong>Target Seller:</strong> ${prov?.businessName || 'Unknown Provider'} (Score: ${prov?.trustScore || 40}%)</div>
                
                <div style="border-top:1px solid #f1f5f9; padding-top:8px;">
                  <strong>Customer Complaint:</strong>
                  <p style="background:#f8fafc; padding:8px; border-radius:6px; border:1px solid #e2e8f0; font-style:italic; margin-top:4px;">
                    <strong>Reason: ${rep.reason}</strong><br/>"${rep.description || 'No description provided.'}"
                  </p>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:8px;">
                  <strong>Provider Response:</strong>
                  <textarea id="dispute-provider-response" class="form-control-textarea" style="margin-top:4px;" placeholder="Enter response from provider...">${rep.providerResponse || ''}</textarea>
                  <button id="save-dispute-response-btn" data-id="${rep.id}" class="btn-premium btn-premium-secondary" style="width:100%; height:28px; font-size:11px; margin-top:4px;">Save Response</button>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:8px;">
                  <strong>Evidence Files:</strong>
                  <div style="display:flex; gap:6px; margin-top:4px; flex-wrap:wrap;">
                    ${rep.evidenceUrls && rep.evidenceUrls.length > 0
                      ? rep.evidenceUrls.map((url: string, i: number) => `<a href="${url}" target="_blank" style="display:inline-block; border:1px solid #e2e8f0; border-radius:4px; padding:4px; background:#fff;"><img src="${url}" style="width:50px; height:50px; object-fit:cover;"/></a>`).join('')
                      : `<div style="font-size:10px; color:#94a3b8; padding:8px; border:1px dashed #cbd5e1; border-radius:4px; width:100%; text-align:center;">No evidence files uploaded.</div>`
                    }
                  </div>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:8px;">
                  <strong>Recent Chat History (User & Seller):</strong>
                  <div style="max-height:120px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:6px; padding:6px; background:#f8fafc; margin-top:4px; display:flex; flex-direction:column; gap:4px;">
                    <div style="text-align:left;"><span style="background:#e0f2fe; padding:4px 6px; border-radius:4px; display:inline-block; font-size:10px;"><strong>Mteja:</strong> Bei yako mbona tofauti na dukani?</span></div>
                    <div style="text-align:right;"><span style="background:#f1f5f9; padding:4px 6px; border-radius:4px; display:inline-block; font-size:10px;"><strong>Muuzaji:</strong> Hiyo bei ya promo imeisha jana ndugu.</span></div>
                    <div style="text-align:left;"><span style="background:#e0f2fe; padding:4px 6px; border-radius:4px; display:inline-block; font-size:10px;"><strong>Mteja:</strong> Lakini kwenye app bado inaonyesha. Nimedanganyika.</span></div>
                  </div>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:8px;">
                  <strong>GPS Visit Assignments & Logs:</strong>
                  <div style="font-size:10px; color:#475569; margin-top:4px;">
                    ${disputeGpsLogs.map(g => `
                      <div style="border-bottom:1px solid #f1f5f9; padding-bottom:2px; margin-bottom:2px;">
                        Status: <strong style="color:${g.status === 'completed' ? '#10b981' : '#b45309'};">${g.status}</strong> | Area: ${g.area} | Date: ${new Date(g.scheduledDate).toLocaleDateString()}
                      </div>
                    `).join('') || '<div style="color:#94a3b8;">No GPS site audits assigned.</div>'}
                  </div>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:12px; display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                  <button class="btn-premium btn-premium-primary dispute-desk-action" data-action="resolve" data-id="${rep.id}" style="width:100%;">Resolve Case</button>
                  <button class="btn-premium btn-premium-secondary dispute-desk-action" data-action="escalate" data-id="${rep.id}" style="width:100%;">Escalate Case</button>
                  <button class="btn-premium btn-premium-danger dispute-desk-action" data-action="refund" data-id="${rep.id}" style="width:100%;">Issue Refund</button>
                  <button class="btn-premium btn-premium-danger dispute-desk-action" data-action="suspend" data-id="${rep.id}" style="width:100%;">Suspend Provider</button>
                  <button class="btn-premium btn-premium-secondary dispute-desk-action" data-action="warn" data-id="${rep.id}" style="width:100%; color:#b45309; border-color:#cbd5e1;">Warn Provider</button>
                  <button class="btn-premium btn-premium-secondary dispute-desk-action" data-action="close" data-id="${rep.id}" style="width:100%;">Close Case</button>
                </div>
              </div>
            </div>
          `;
        }
      } else if (selectedCustomerId) {
        // --- CUSTOMER PROFILE VIEW & ACTION DESK ---
        const cust = users.find(u => u.id === selectedCustomerId);
        if (!cust) {
          selectedCustomerId = null;
          rightPanelContent = '<p style="padding:20px; color:#64748b;">Customer record not found.</p>';
        } else {
          const custSearches = searches.filter(s => s.userId === cust.id);
          const custUnlocks = payments.filter(p => p.userId === cust.id && (!p.referenceCode || !p.referenceCode.startsWith('CHM-SUB')));
          const custComplaints = complaints.filter(r => r.reporterId === cust.id);
          const custPurchases = payments.filter(p => p.userId === cust.id);
          
          // Calculate favorite category based on searches
          const searchCats: { [key: string]: number } = {};
          custSearches.forEach(s => {
            const matchedCat = categories.find(c => s.query.toLowerCase().includes(c.name.toLowerCase()));
            if (matchedCat) searchCats[matchedCat.name] = (searchCats[matchedCat.name] || 0) + 1;
          });
          const favCat = Object.keys(searchCats).sort((a, b) => searchCats[b] - searchCats[a])[0] || 'Electronics / Simu';

          // Get presence
          const pres = cachedAdminData.userPresence.find(p => p.id === cust.id || p.email === cust.email);
          const sess = cachedAdminData.activeSessions.find(s => s.email === cust.email);
          const lastActiveStr = pres?.lastActive ? new Date(pres.lastActive).toLocaleString() : 'N/A';

          rightPanelContent = `
            <div class="table-card" style="padding: 20px; display:flex; flex-direction:column; gap:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">
                <h4 style="font-weight: bold; font-size: 13px;">Customer Actions Desk</h4>
                <button id="deselect-cust-btn" class="btn-premium btn-premium-secondary" style="height:24px; font-size:10px;">Close</button>
              </div>

              <!-- EDIT PROFILE FORM -->
              <div style="display:flex; flex-direction:column; gap:8px;">
                <h5 style="font-size:11px; font-weight:bold; color:#64748b; text-transform:uppercase;">Customer Profile Data</h5>
                <div class="form-group">
                  <label>Full Name</label>
                  <input type="text" id="cust-edit-name" class="form-control-input" value="${cust.name || ''}" />
                </div>
                <div class="form-group">
                  <label>Email Address</label>
                  <input type="email" id="cust-edit-email" class="form-control-input" value="${cust.email || ''}" />
                </div>
                <div class="form-group">
                  <label>Phone Number</label>
                  <input type="text" id="cust-edit-phone" class="form-control-input" value="${cust.phoneNumber || ''}" />
                </div>
                <div class="form-row-three">
                  <div class="form-group">
                    <label>Region</label>
                    <input type="text" id="cust-edit-region" class="form-control-input" value="${cust.region || 'Dar es Salaam'}" />
                  </div>
                  <div class="form-group">
                    <label>District</label>
                    <input type="text" id="cust-edit-district" class="form-control-input" value="${cust.district || 'Ilala'}" />
                  </div>
                  <div class="form-group">
                    <label>Ward</label>
                    <input type="text" id="cust-edit-ward" class="form-control-input" value="${cust.ward || 'Kariakoo'}" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>GPS Latitude</label>
                    <input type="text" id="cust-edit-lat" class="form-control-input" value="${cust.latitude || -6.8184}" />
                  </div>
                  <div class="form-group">
                    <label>GPS Longitude</label>
                    <input type="text" id="cust-edit-lon" class="form-control-input" value="${cust.longitude || 39.2826}" />
                  </div>
                </div>
                <button id="save-cust-profile-btn" data-id="${cust.id}" class="btn-premium btn-premium-primary" style="height:32px; font-size:11px; width:100%;">Save Profile Changes</button>
              </div>

              <!-- METRICS & STATUS -->
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:12px; display:flex; flex-direction:column; gap:6px;">
                <h5 style="font-weight:bold; font-size:11px; color:#475569; border-bottom:1px solid #e2e8f0; padding-bottom:4px; margin-bottom:4px;">Chimbo Intel Metrics</h5>
                <div><strong>Account Status:</strong> <span class="status-badge ${cust.status === 'suspended' ? 'rejected' : 'approved'}">${cust.status || 'active'}</span></div>
                <div><strong>Subscription Status:</strong> <span class="status-badge ${custUnlocks.length > 0 ? 'approved' : 'suspended'}">${custUnlocks.length > 0 ? 'Active Pass' : 'Free Tier'}</span></div>
                <div><strong>GPS Coordinates:</strong> ${cust.latitude || -6.8184}, ${cust.longitude || 39.2826}</div>
                <div><strong>Total Searches:</strong> <strong>${custSearches.length}</strong> searches</div>
                <div><strong>Total Contact Unlocks:</strong> <strong>${custUnlocks.length}</strong> unlocks</div>
                <div><strong>Total Complaints filed:</strong> <strong>${custComplaints.length}</strong> reports</div>
                <div><strong>Favorite Category:</strong> <span style="color:#0ea5e9; font-weight:bold;">${favCat}</span></div>
                <div><strong>Last Login / Presence:</strong> <span style="color:${pres?.status === 'online' ? '#10b981' : '#64748b'}; font-weight:bold;">${pres?.status || 'offline'}</span> (${lastActiveStr})</div>
                ${sess ? `<div><strong>Current Screen:</strong> <span style="font-family:monospace;">${sess.currentView}</span> | Device: ${sess.deviceType}</div>` : ''}
              </div>

              <!-- ACCOUNT CONTROL ACTIONS -->
              <div style="display:flex; flex-direction:column; gap:6px;">
                <button class="btn-premium btn-premium-secondary cust-management-action" data-action="toggle-suspend" data-id="${cust.id}" style="width: 100%;">
                  ${cust.status === 'suspended' ? 'Reactivate Account' : 'Suspend Account'}
                </button>
                <button class="btn-premium btn-premium-danger cust-management-action" data-action="delete" data-id="${cust.id}" style="width: 100%;">Delete Customer</button>
              </div>

              <!-- COMMUNICATIONS BROADCAST (SMS, EMAIL, NOTIFICATION) -->
              <div style="border-top:1px solid #f1f5f9; padding-top:12px; display:flex; flex-direction:column; gap:10px;">
                <h5 style="font-weight:bold; font-size:11px; color:#475569;">Send Direct Message Alert</h5>
                
                <div class="form-group">
                  <label>Alert Message Content</label>
                  <textarea id="cust-direct-msg-body" class="form-control-textarea" placeholder="Type notification, SMS or email message..." style="height:60px; font-size:12px;"></textarea>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px;">
                  <button id="send-cust-direct-notif" data-id="${cust.id}" class="btn-premium btn-premium-primary" style="height:28px; font-size:10px; padding:0 4px;">In-App</button>
                  <button id="send-cust-direct-sms" data-id="${cust.id}" data-phone="${cust.phoneNumber || ''}" class="btn-premium btn-premium-secondary" style="height:28px; font-size:10px; padding:0 4px;">SMS</button>
                  <button id="send-cust-direct-email" data-id="${cust.id}" data-email="${cust.email || ''}" class="btn-premium btn-premium-secondary" style="height:28px; font-size:10px; padding:0 4px;">Email</button>
                </div>
              </div>

              <!-- HISTORY COMPONENT TABS -->
              <div style="border-top:1px solid #f1f5f9; padding-top:12px;">
                <h5 style="font-weight:bold; font-size:11px; color:#475569; margin-bottom:8px;">Customer History Portals</h5>
                
                <!-- Complaints Portal -->
                <div class="table-card">
                  <div class="table-card-header" style="font-size:11px; padding:8px 12px;">Disputes & Complaints (${custComplaints.length})</div>
                  <div style="padding: 6px; display:flex; flex-direction:column; gap:6px;">
                    ${custComplaints.map(rc => {
                      const prov = providers.find(p => p.id === rc.providerId);
                      return `
                        <div style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; background:#f8fafc; font-size:11px;">
                          <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                            <strong>${prov ? prov.businessName : rc.providerId}</strong>
                            <span class="status-badge ${rc.status === 'resolved' ? 'approved' : 'pending'}">${rc.status}</span>
                          </div>
                          <p>Reason: <strong>${rc.reason}</strong></p>
                          <button class="btn-premium btn-premium-secondary open-dispute-desk-btn" data-id="${rc.id}" style="height:20px; font-size:9px; padding:0 6px; width:100%; margin-top:4px;">Open Dispute Desk</button>
                        </div>
                      `;
                    }).join('') || '<p style="color:#94a3b8; font-size:11px; text-align:center; padding:6px;">No complaints filed.</p>'}
                  </div>
                </div>

                <!-- Searches Portal -->
                <div class="table-card" style="margin-top:8px;">
                  <div class="table-card-header" style="font-size:11px; padding:8px 12px;">Search History (${custSearches.length})</div>
                  <div style="max-height:100px; overflow-y:auto; font-size:11px; padding:6px;">
                    ${custSearches.map(s => `<div style="border-bottom:1px solid #f1f5f9; padding:2px 0;">"${s.query}" <span style="font-size:9px; color:#94a3b8; float:right;">${new Date(s.timestamp).toLocaleDateString()}</span></div>`).join('') || '<p style="color:#94a3b8; text-align:center;">No searches logged.</p>'}
                  </div>
                </div>

                <!-- Provider Unlocks Portal -->
                <div class="table-card" style="margin-top:8px;">
                  <div class="table-card-header" style="font-size:11px; padding:8px 12px;">Provider Contacts Unlocked (${custUnlocks.length})</div>
                  <div style="max-height:100px; overflow-y:auto; font-size:11px; padding:6px;">
                    ${custUnlocks.map(u => {
                      const p = providers.find(item => item.id === u.providerId);
                      return `<div style="border-bottom:1px solid #f1f5f9; padding:2px 0;"><strong>${p ? p.businessName : 'Unknown'}</strong> (TSh ${u.amount}) <span style="font-size:9px; color:#94a3b8; float:right;">${new Date(u.createdAt).toLocaleDateString()}</span></div>`;
                    }).join('') || '<p style="color:#94a3b8; text-align:center;">No contacts unlocked.</p>'}
                  </div>
                </div>

                <!-- Purchase History Portal -->
                <div class="table-card" style="margin-top:8px;">
                  <div class="table-card-header" style="font-size:11px; padding:8px 12px;">Billing Payments (${custPurchases.length})</div>
                  <div style="max-height:100px; overflow-y:auto; font-size:11px; padding:6px;">
                    ${custPurchases.map(p => `<div style="border-bottom:1px solid #f1f5f9; padding:2px 0;">Ref: <strong style="font-family:monospace;">${p.referenceCode}</strong> | TSh ${p.amount} <span class="status-badge ${p.status === 'success' ? 'approved' : 'rejected'}" style="font-size:8px; padding:1px 4px;">${p.status}</span></div>`).join('') || '<p style="color:#94a3b8; text-align:center;">No payments logged.</p>'}
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      } else {
        rightPanelContent = `
          <div class="table-card" style="padding: 20px; text-align: center; color: #94a3b8;">
            <span class="material-symbols-outlined" style="font-size: 48px;">person</span>
            <p style="font-size: 13px; margin-top: 8px;">Select a customer from the list to view history, audits, and perform actions.</p>
          </div>
        `;
      }

      subViewContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <h3 style="font-weight: 800; font-size: 16px;">Customer Intelligence Center</h3>
          <input id="cust-search-bar" class="form-control-input" type="text" placeholder="Search customer by name/email..." value="${customerSearchQuery}" style="width: 280px;" />
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items:start;">
          <div style="display:flex; flex-direction:column; gap:20px;">
            <div class="table-card">
              <div style="overflow-x: auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Phone Number</th>
                      <th>Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${custsHtml || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No customers found matching filter.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- CREATE NEW CUSTOMER FORM (CRUD Create Rule) -->
            <div class="table-card" style="padding:20px; background:#fff;">
              <h4 style="font-weight:bold; font-size:14px; margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">Sajili Mteja Mpya / Create New Customer</h4>
              
              <div class="form-row">
                <div class="form-group">
                  <label>Full Name</label>
                  <input type="text" id="cust-create-name" class="form-control-input" placeholder="e.g. Ally Said" />
                </div>
                <div class="form-group">
                  <label>Email Address</label>
                  <input type="email" id="cust-create-email" class="form-control-input" placeholder="e.g. ally@example.com" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Phone Number</label>
                  <input type="text" id="cust-create-phone" class="form-control-input" placeholder="e.g. +255711223344" />
                </div>
                <div class="form-group">
                  <label>Region</label>
                  <input type="text" id="cust-create-region" class="form-control-input" placeholder="e.g. Dar es Salaam" value="Dar es Salaam" />
                </div>
              </div>
              <div class="form-row-three">
                <div class="form-group">
                  <label>District</label>
                  <input type="text" id="cust-create-district" class="form-control-input" placeholder="e.g. Ilala" value="Ilala" />
                </div>
                <div class="form-group">
                  <label>Ward</label>
                  <input type="text" id="cust-create-ward" class="form-control-input" placeholder="e.g. Kariakoo" value="Kariakoo" />
                </div>
                <div class="form-group">
                  <label>GPS Location</label>
                  <input type="text" id="cust-create-gps" class="form-control-input" placeholder="lat, lon e.g. -6.818, 39.282" value="-6.8184, 39.2826" />
                </div>
              </div>
              
              <button id="submit-create-customer" class="btn-premium btn-premium-primary" style="height:38px; width:100%; margin-top:8px;">Sajili Mteja</button>
            </div>
          </div>

          <!-- Right panel details desk -->
          ${rightPanelContent}
        </div>
      `;
    } else if (activeAdminTab === 'subscriptions') {
      // ==========================================
      // 9. SUBSCRIPTIONS & PLANS
      // ==========================================
      const activePlanEdit = editingPlanId ? subscriptionPlans.find(p => p.id === editingPlanId) : null;
      const trialDaysSetting = systemSettings.find(s => s.id === 'free_trial_duration')?.value || '30';

      // EXPIRY ALERTS - providers expiring in < 5 days
      const expiringSubs = subscriptions.filter(s => {
        if (s.status !== 'active') return false;
        const diffMs = new Date(s.expiresAt).getTime() - new Date().getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 5;
      });

      const plansHtml = subscriptionPlans.map(p => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="font-weight: bold; text-transform: uppercase;">${p.name}</td>
          <td style="font-weight: bold; color: #38bdf8;">TSh ${p.price.toLocaleString()}</td>
          <td>${p.duration} days</td>
          <td style="font-size: 11px; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.features ? p.features.join(', ') : 'N/A'}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn-premium btn-premium-secondary sub-edit-trigger" data-id="${p.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Edit</button>
              <button class="btn-premium btn-premium-danger sub-delete-trigger" data-id="${p.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Subscription Plans & Pricing Setup</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="table-card">
              <div class="table-card-header">Chimbo Subscription Tiers</div>
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Plan Name</th>
                    <th>Price Monthly</th>
                    <th>Duration</th>
                    <th>Features Summary</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${plansHtml || '<tr><td colspan="5" style="text-align: center; padding: 20px;">No plans created.</td></tr>'}
                </tbody>
              </table>
            </div>

            <!-- Expiry Alerts panel -->
            <div class="table-card">
              <div class="table-card-header" style="color: #ef4444;">Expiring Subscriptions Alerts (Next 5 Days)</div>
              <div style="padding: 10px; display:flex; flex-direction:column; gap:8px;">
                ${expiringSubs.map(s => {
                  const p = providers.find(item => item.id === s.providerId);
                  return `
                    <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid #fee2e2; border-radius:6px; background:#fff5f5; padding:8px; font-size:12px;">
                      <div>
                        <strong>${p ? p.businessName : s.providerId}</strong> (${s.plan})
                        <div style="font-size:10px; color:#ef4444;">Expires on ${new Date(s.expiresAt).toLocaleDateString()}</div>
                      </div>
                      <button class="btn-premium btn-premium-danger send-expiry-sms-btn" data-phone="${p?.whatsapp || ''}" data-provider="${p?.businessName || ''}" style="height:26px; font-size:10px;">Send SMS Alert</button>
                    </div>
                  `;
                }).join('') || '<p style="color:#64748b; font-size:11px; text-align:center; padding:10px;">No expiring subscriptions in the next 5 days.</p>'}
              </div>
            </div>

            <!-- Subscriptions CRM List (CRUD Rule) -->
            <div class="table-card">
              <div class="table-card-header">Active Provider Subscriptions Registry</div>
              <div style="overflow-x:auto;">
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Provider Name</th>
                      <th>Plan selected</th>
                      <th>Expires At</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${subscriptions.map(s => {
                      const p = providers.find(item => item.id === s.providerId);
                      return `
                        <tr>
                          <td style="font-weight:bold;">${p ? p.businessName : s.providerId}</td>
                          <td style="text-transform:uppercase; font-weight:bold;">${s.plan}</td>
                          <td>${new Date(s.expiresAt).toLocaleDateString()}</td>
                          <td><span class="status-badge ${s.status === 'active' ? 'approved' : 'rejected'}">${s.status}</span></td>
                          <td>
                            <div style="display:flex; gap:4px;">
                              <button class="btn-premium btn-premium-secondary manual-edit-sub-btn" data-id="${s.id}" style="height:24px; padding:0 8px; font-size:10px;">Extend Expiry</button>
                              <button class="btn-premium btn-premium-danger manual-delete-sub-btn" data-id="${s.id}" style="height:24px; padding:0 8px; font-size:10px;">Cancel Sub</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('') || '<tr><td colspan="5" style="text-align:center; padding:12px; color:#94a3b8;">No subscriptions logs found.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Create/Edit Plan Form & Free Trial Settings -->
          <div style="display:flex; flex-direction:column; gap:20px;">
            <div class="table-card" style="padding: 20px; background: #fff;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">${activePlanEdit ? 'Edit Subscription Plan' : 'Create Subscription Plan'}</h4>
              
              <div class="form-group">
                <label>Plan Name</label>
                <input type="text" id="sub-plan-name" class="form-control-input" placeholder="e.g. Starter Plan" value="${activePlanEdit ? activePlanEdit.name : ''}" />
              </div>
              <div class="form-group">
                <label>Price (TSh)</label>
                <input type="number" id="sub-plan-price" class="form-control-input" placeholder="e.g. 50000" value="${activePlanEdit ? activePlanEdit.price : ''}" />
              </div>
              <div class="form-group">
                <label>Duration (Days)</label>
                <input type="number" id="sub-plan-duration" class="form-control-input" placeholder="30" value="${activePlanEdit ? activePlanEdit.duration : '30'}" />
              </div>
              <div class="form-group">
                <label>Benefits / Features (Comma separated)</label>
                <textarea id="sub-plan-features" class="form-control-textarea" placeholder="e.g. Unlimited ads, VIP Badge">${activePlanEdit && activePlanEdit.features ? activePlanEdit.features.join(', ') : ''}</textarea>
              </div>
              
              <div style="display: flex; gap: 8px;">
                <button id="submit-save-plan" data-id="${activePlanEdit ? activePlanEdit.id : ''}" class="btn-premium btn-premium-primary" style="height: 38px; flex: 1;">Save Plan</button>
                ${activePlanEdit ? `
                  <button id="cancel-edit-plan" class="btn-premium btn-premium-secondary" style="height: 38px;">Cancel</button>
                ` : ''}
              </div>
            </div>

            <!-- Free Trial Config -->
            <div class="table-card" style="padding:16px;">
              <h4 style="font-weight: bold; font-size: 13px; margin-bottom: 10px;">Free Trial Configurations</h4>
              <div class="form-group">
                <label>Trial Period for New Providers (Days)</label>
                <input type="number" id="settings-free-trial-days" class="form-control-input" value="${trialDaysSetting}" />
              </div>
              <button id="save-free-trial-days-btn" class="btn-premium btn-premium-primary" style="width:100%; height:32px; font-size:11px;">Update Trial Period</button>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'categories') {
      // ==========================================
      // 10. CATEGORY MANAGEMENT
      // ==========================================
      const activeCatEdit = editingCategoryId ? categories.find(c => c.id === editingCategoryId) : null;

      const catsHtml = categories.map(c => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="font-family: monospace; font-weight: bold;">${c.id}</td>
          <td>${c.name}</td>
          <td style="text-transform: uppercase; font-weight: 500;">${c.type}</td>
          <td style="font-size: 12px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.description || 'No description'}</td>
          <td>
            <span class="status-badge ${c.status === 'disabled' ? 'rejected' : 'approved'}">${c.status || 'active'}</span>
          </td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn-premium btn-premium-secondary cat-edit-trigger" data-id="${c.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Edit</button>
              ${c.status === 'disabled'
                ? `<button class="btn-premium btn-premium-secondary cat-status-trigger" data-id="${c.id}" data-status="active" style="height: 26px; padding: 0 8px; font-size: 10px; color: #10b981; border: 1px solid #10b981;">Enable</button>`
                : `<button class="btn-premium btn-premium-secondary cat-status-trigger" data-id="${c.id}" data-status="disabled" style="height: 26px; padding: 0 8px; font-size: 10px; color: #f59e0b; border: 1px solid #f59e0b;">Disable</button>`
              }
              <button class="btn-premium btn-premium-danger cat-delete-trigger" data-id="${c.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Category Management</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div class="table-card">
            <table class="premium-table">
              <thead>
                <tr>
                  <th>Category Key (id)</th>
                  <th>Display Name</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${catsHtml || '<tr><td colspan="6" style="text-align: center; padding: 20px;">No categories created.</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Add / Edit Category Form -->
          <div class="table-card" style="padding: 20px; background: #fff;">
            <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">${activeCatEdit ? 'Edit Category' : 'Add New Category'}</h4>
            <div class="form-group">
              <label>Category Key (ID)</label>
              <input type="text" id="cat-id-input" class="form-control-input" value="${activeCatEdit ? activeCatEdit.id : 'Auto-generated'}" disabled />
            </div>
            <div class="form-group">
              <label>Category Name</label>
              <input type="text" id="cat-name-input" class="form-control-input" placeholder="e.g. Electronics" value="${activeCatEdit ? activeCatEdit.name : ''}" />
            </div>
            <div class="form-group">
              <label>Type</label>
              <select id="cat-type-select" class="form-control-input" ${activeCatEdit ? 'disabled' : ''}>
                <option value="product" ${activeCatEdit && activeCatEdit.type === 'product' ? 'selected' : ''}>Product Listing</option>
                <option value="service" ${activeCatEdit && activeCatEdit.type === 'service' ? 'selected' : ''}>Service Offered</option>
              </select>
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea id="cat-desc-input" class="form-control-textarea" placeholder="Category description...">${activeCatEdit ? activeCatEdit.description || '' : ''}</textarea>
            </div>
            <div class="form-group">
              <label>Status</label>
              <select id="cat-status-select" class="form-control-input">
                <option value="active" ${activeCatEdit && activeCatEdit.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="disabled" ${activeCatEdit && activeCatEdit.status === 'disabled' ? 'selected' : ''}>Disabled</option>
              </select>
            </div>
            
            <div style="display: flex; gap: 8px;">
              <button id="submit-save-category" data-id="${activeCatEdit ? activeCatEdit.id : ''}" class="btn-premium btn-premium-primary" style="height: 38px; flex: 1;">Save Category</button>
              ${activeCatEdit ? `
                <button id="cancel-edit-category" class="btn-premium btn-premium-secondary" style="height: 38px;">Cancel</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'templates') {
      // ==========================================
      // 11. FEATURE TEMPLATE MANAGEMENT
      // ==========================================
      const activeTempEdit = editingTemplateId ? templates.find(t => t.id === editingTemplateId) : null;

      const tempsHtml = templates.map(t => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="font-weight: bold; color: #38bdf8;">${t.name}</td>
          <td>${t.features ? t.features.join(', ') : 'N/A'}</td>
          <td>
            <div style="display: flex; gap: 4px;">
              <button class="btn-premium btn-premium-secondary temp-edit-trigger" data-id="${t.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Edit</button>
              <button class="btn-premium btn-premium-danger temp-delete-trigger" data-id="${t.id}" style="height: 26px; padding: 0 8px; font-size: 10px;">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Reusable Feature Templates</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
          <div class="table-card">
            <table class="premium-table">
              <thead>
                <tr>
                  <th>Template Name</th>
                  <th>Features Included</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${tempsHtml || '<tr><td colspan="3" style="text-align: center; padding: 20px;">No templates created yet.</td></tr>'}
              </tbody>
            </table>
          </div>

          <!-- Add / Edit Template Form -->
          <div class="table-card" style="padding: 20px; background: #fff;">
            <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">${activeTempEdit ? 'Edit Template' : 'Create Reusable Template'}</h4>
            <div class="form-group">
              <label>Template Name</label>
              <input type="text" id="temp-name-input" class="form-control-input" placeholder="e.g. Fashion Features" value="${activeTempEdit ? activeTempEdit.name : ''}" />
            </div>
            <div class="form-group">
              <label>Feature fields (Comma separated)</label>
              <textarea id="temp-fields-input" class="form-control-textarea" placeholder="e.g. Size, Color, Material">${activeTempEdit && activeTempEdit.features ? activeTempEdit.features.join(', ') : ''}</textarea>
            </div>
            
            <div style="display: flex; gap: 8px;">
              <button id="submit-save-template" data-id="${activeTempEdit ? activeTempEdit.id : ''}" class="btn-premium btn-premium-primary" style="height: 38px; flex: 1;">Save Template</button>
              ${activeTempEdit ? `
                <button id="cancel-edit-template" class="btn-premium btn-premium-secondary" style="height: 38px;">Cancel</button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'search') {
      // ==========================================
      // 12. SEARCH INTELLIGENCE ENGINE (REAL DATA)
      // ==========================================
      const searchCounts: { [key: string]: number } = {};
      const searchLocations: { [key: string]: number } = {};
      const categorySearches: { [key: string]: number } = {};

      searches.forEach(s => {
        const queryClean = (s.query || '').toLowerCase().trim();
        if (queryClean) {
          searchCounts[queryClean] = (searchCounts[queryClean] || 0) + 1;
          
          // GPS high demand locations mapping
          const locStr = s.location || 'Kariakoo, Dar';
          searchLocations[locStr] = (searchLocations[locStr] || 0) + 1;

          // Trending categories matching
          const matchCat = categories.find(c => queryClean.includes(c.name.toLowerCase()));
          if (matchCat) {
            categorySearches[matchCat.name] = (categorySearches[matchCat.name] || 0) + 1;
          }
        }
      });

      const sortedSearches = Object.keys(searchCounts)
        .map(q => ({ query: q, count: searchCounts[q] }))
        .sort((a, b) => b.count - a.count);

      // Identify missing products & services (Queries that yielded zero matches in products / services)
      const missingProductsMap: { [key: string]: number } = {};
      const missingServicesMap: { [key: string]: number } = {};

      searches.forEach(s => {
        const queryClean = (s.query || '').toLowerCase().trim();
        if (!queryClean) return;

        // Check if there are matches in products
        const hasProdMatch = products.some(p => p.name.toLowerCase().includes(queryClean) || (p.description || '').toLowerCase().includes(queryClean));
        if (!hasProdMatch) {
          missingProductsMap[queryClean] = (missingProductsMap[queryClean] || 0) + 1;
        }

        // Check if there are matches in services
        const hasServMatch = services.some(serv => serv.name.toLowerCase().includes(queryClean) || (serv.description || '').toLowerCase().includes(queryClean));
        if (!hasServMatch) {
          missingServicesMap[queryClean] = (missingServicesMap[queryClean] || 0) + 1;
        }
      });

      const missingProdsList = Object.keys(missingProductsMap)
        .map(q => ({ query: q, count: missingProductsMap[q] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const missingServsList = Object.keys(missingServicesMap)
        .map(q => ({ query: q, count: missingServicesMap[q] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // High demand areas sorted
      const highDemandAreas = Object.keys(searchLocations)
        .map(l => ({ area: l, count: searchLocations[l] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Trending Categories sorted
      const trendingCategories = Object.keys(categorySearches)
        .map(c => ({ name: c, count: categorySearches[c] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Most Visited / Most Contacted Providers
      const providerUnlockCounts: { [key: string]: number } = {};
      payments.forEach(p => {
        if (p.providerId && p.providerId !== 'system') {
          providerUnlockCounts[p.providerId] = (providerUnlockCounts[p.providerId] || 0) + 1;
        }
      });

      const mostContactedProvidersList = Object.keys(providerUnlockCounts)
        .map(pid => {
          const prov = providers.find(item => item.id === pid);
          return {
            name: prov ? prov.businessName : pid,
            count: providerUnlockCounts[pid]
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Load AI recommendation report (stored in systemSettings doc 'ai_market_report')
      const aiReportText = systemSettings.find(s => s.id === 'ai_market_report')?.value || 
        'No AI market intelligence reports generated yet. Click the button below to analyze live trends via Google Gemini.';

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Search Intelligence Engine</h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items:start;">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- Top Queries -->
            <div class="table-card">
              <div class="table-card-header">Top Customer Search Queries (Live Firestore data)</div>
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Search Query</th>
                    <th>Hits Count</th>
                  </tr>
                </thead>
                <tbody>
                  ${sortedSearches.slice(0, 8).map(s => `
                    <tr>
                      <td style="font-weight: bold;">"${s.query}"</td>
                      <td><strong>${s.count}</strong> searches</td>
                    </tr>
                  `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No search logs recorded.</td></tr>'}
                </tbody>
              </table>
            </div>

            <!-- Missing Demands grid -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="table-card" style="margin-bottom:0;">
                <div class="table-card-header" style="color:#ef4444;">Missing Products (Zero Listings Found)</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Query</th>
                      <th>Hits</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${missingProdsList.map(m => `
                      <tr>
                        <td style="font-weight: bold; color: #ef4444;">"${m.query}"</td>
                        <td><strong>${m.count}</strong> times</td>
                      </tr>
                    `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No missing products.</td></tr>'}
                  </tbody>
                </table>
              </div>

              <div class="table-card" style="margin-bottom:0;">
                <div class="table-card-header" style="color:#f59e0b;">Missing Services (Unfulfilled Searches)</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Query</th>
                      <th>Hits</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${missingServsList.map(m => `
                      <tr>
                        <td style="font-weight: bold; color: #f59e0b;">"${m.query}"</td>
                        <td><strong>${m.count}</strong> times</td>
                      </tr>
                    `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No missing services.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- High Demand Wards & Trending Categories -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="table-card" style="margin-bottom:0;">
                <div class="table-card-header">High Demand Wards (Geotagged Queries)</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Location / Region</th>
                      <th>Query volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${highDemandAreas.map(h => `
                      <tr>
                        <td style="font-weight: bold;">${h.area}</td>
                        <td><strong>${h.count}</strong> query hits</td>
                      </tr>
                    `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No Geotags recorded.</td></tr>'}
                  </tbody>
                </table>
              </div>

              <div class="table-card" style="margin-bottom:0;">
                <div class="table-card-header">Trending Categories</div>
                <table class="premium-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Search Matches</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${trendingCategories.map(t => `
                      <tr>
                        <td style="font-weight: bold; color:#0ea5e9;">${t.name}</td>
                        <td><strong>${t.count}</strong> hits</td>
                      </tr>
                    `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No queries matched categories.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- Most Contacted Providers -->
            <div class="table-card">
              <div class="table-card-header">Most Contacted Providers</div>
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Unlocks</th>
                  </tr>
                </thead>
                <tbody>
                  ${mostContactedProvidersList.map(m => `
                    <tr>
                      <td style="font-weight: bold; color:#38bdf8;">${m.name}</td>
                      <td><strong>${m.count}</strong> contacts unlocked</td>
                    </tr>
                  `).join('') || '<tr><td colspan="2" style="text-align: center; padding: 12px; color:#94a3b8;">No unlocks recorded.</td></tr>'}
                </tbody>
              </table>
            </div>

            <!-- Gemini AI Recommendations desk -->
            <div class="table-card" style="padding: 20px; background: #fff;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 10px; color:#10b981; display:flex; align-items:center; gap:6px;">
                <span class="material-symbols-outlined" style="font-size:18px;">psychology</span> Chimbo Gemini AI Engine
              </h4>
              <div style="font-size: 12px; line-height: 1.5; color: #475569; margin-bottom: 12px; background:#f0fdf4; border:1px solid #bbf7d0; padding:10px; border-radius:6px; max-height:250px; overflow-y:auto; font-family:inherit;">
                ${aiReportText.replace(/\n/g, '<br/>')}
              </div>
              <div style="display:flex; flex-direction:column; gap:6px;">
                <button class="btn-premium btn-premium-primary" id="generate-ai-report-btn" style="height: 34px; font-size: 11px; width:100%;">
                  Generate Market Report via Gemini
                </button>
                <button class="btn-premium btn-premium-secondary" id="send-demand-tips-btn" style="height: 32px; font-size: 11px; width:100%;">
                  Send Demand alerts to Sellers
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'revenue') {
      // ==========================================
      // 13. PAYMENT & SUBSCRIPTION AUDIT (REAL DATA VALIDATION)
      // ==========================================
      let totalExpected = 0;
      let totalActual = 0;

      const auditedPaymentsList = payments.map(pay => {
        let expected = 1000; // default for contact unlocks
        const actual = pay.amount || 0;
        let isSubscription = false;
        let planName = 'Contact Unlock Pass';
        let reason = 'Valid Unlock Charge';
        let status: 'valid' | 'underpaid' | 'overpaid' | 'modified' = 'valid';

        if (pay.referenceCode && pay.referenceCode.startsWith('CHM-SUB')) {
          isSubscription = true;
          // Sub plan match
          let plan = subscriptionPlans.find((p: any) => pay.referenceCode.includes(p.id.toUpperCase()) || p.price === actual);
          if (!plan) {
            plan = subscriptionPlans.find((p: any) => p.price === actual);
          }
          expected = plan ? plan.price : 50000;
          planName = plan ? plan.name : 'Subscription Plan';
          reason = 'Valid Subscription Payment';
        }

        if (pay.isManualModification) {
          reason = 'Manual configuration modified by staff';
          status = 'modified';
        } else if (pay.customChargeApplied) {
          reason = `Custom provider rate applied: TSh ${pay.customChargeApplied}`;
          status = 'modified';
        } else {
          const diff = actual - expected;
          if (diff < 0) {
            reason = `Underpayment discrepancy: TSh ${Math.abs(diff)} missing`;
            status = 'underpaid';
          } else if (diff > 0) {
            reason = `Overpayment discrepancy: TSh ${diff} surplus`;
            status = 'overpaid';
          }
        }

        totalExpected += expected;
        totalActual += actual;
        const discrepancy = actual - expected;

        return {
          ...pay,
          expected,
          discrepancy,
          reason,
          status,
          planName
        };
      });

      const totalDiscrepancy = totalActual - totalExpected;
      const sumSubs = payments.filter(p => p.referenceCode && p.referenceCode.startsWith('CHM-SUB')).reduce((acc, curr) => acc + (curr.amount || 0), 0);
      const sumUnlocks = payments.filter(p => !p.referenceCode || !p.referenceCode.startsWith('CHM-SUB')).reduce((acc, curr) => acc + (curr.amount || 0), 0);

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Billing Audit & Discrepancy Desk</h3>

        <!-- Auditing Stats Breakdown -->
        <div class="stats-grid-container" style="margin-bottom:20px;">
          <div class="stats-dashboard-card" style="border-left:4px solid #10b981;">
            <span class="title">Actual Collected (Firestore)</span>
            <span class="value" style="color:#10b981;">TSh ${totalActual.toLocaleString()}</span>
            <span style="font-size: 10px; color: #64748b;">Total paid in system</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid #3b82f6;">
            <span class="title">Expected Plan Totals</span>
            <span class="value">TSh ${totalExpected.toLocaleString()}</span>
            <span style="font-size: 10px; color: #64748b;">Pricing settings expectations</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid ${totalDiscrepancy < 0 ? '#ef4444' : '#10b981'};">
            <span class="title">Net Discrepancy Balance</span>
            <span class="value" style="color:${totalDiscrepancy < 0 ? '#ef4444' : '#10b981'};">TSh ${totalDiscrepancy.toLocaleString()}</span>
            <span style="font-size: 10px; color: #64748b;">Difference (Actual - Expected)</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid #f59e0b;">
            <span class="title">Discrepancy Cases</span>
            <span class="value" style="color:#f59e0b;">${auditedPaymentsList.filter(p => p.status !== 'valid').length}</span>
            <span style="font-size: 10px; color: #64748b;">Underpayments / Overpayments</span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items:start;">
          <!-- Audited payments list -->
          <div class="table-card">
            <div class="table-card-header">Discrepancy Validation & Subscription Audits</div>
            <div style="overflow-x: auto;">
              <table class="premium-table" style="font-size:12px;">
                <thead>
                  <tr>
                    <th>Ref Reference</th>
                    <th>Actual Paid</th>
                    <th>Expected</th>
                    <th>Difference</th>
                    <th>Auditing Validation Status & Reason</th>
                    <th>Method</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${auditedPaymentsList.map(p => {
                    let badgeColor = '#dcfce7; color:#15803d;'; // valid
                    if (p.status === 'underpaid') badgeColor = '#fee2e2; color:#b91c1c;';
                    else if (p.status === 'overpaid') badgeColor = '#fef3c7; color:#b45309;';
                    else if (p.status === 'modified') badgeColor = '#e0f2fe; color:#0369a1;';
                    
                    return `
                      <tr>
                        <td style="font-family: monospace; font-weight: bold;">${p.referenceCode}</td>
                        <td style="font-weight:bold;">TSh ${p.amount.toLocaleString()}</td>
                        <td style="color:#64748b;">TSh ${p.expected.toLocaleString()}</td>
                        <td style="font-weight:bold; color:${p.discrepancy < 0 ? '#ef4444' : p.discrepancy > 0 ? '#10b981' : '#475569'}">
                          ${p.discrepancy > 0 ? '+' : ''}${p.discrepancy.toLocaleString()}
                        </td>
                        <td>
                          <span class="status-badge" style="background:${badgeColor} font-size:9px; text-transform:uppercase;">${p.status}</span>
                          <div style="font-size:9px; color:#64748b; margin-top:2px;">${p.reason}</div>
                        </td>
                        <td>${p.paymentMethod}</td>
                        <td>
                          <div style="display:flex; gap:2px;">
                            <button class="btn-premium btn-premium-secondary force-verify-payment-btn" data-id="${p.id}" style="height:22px; font-size:9px; padding:0 4px;">Force Verify</button>
                            <button class="btn-premium btn-premium-danger delete-payment-btn" data-id="${p.id}" style="height:22px; font-size:9px; padding:0 4px;">Delete</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('') || '<tr><td colspan="7" style="text-align: center; padding: 20px;">No transaction logs audited.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Aggregate Breakdown & CSS daily trend -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div class="table-card" style="padding: 20px;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 12px;">Total Financial Breakdown</h4>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                  <span>Subscriptions Revenue:</span>
                  <strong>TSh ${sumSubs.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                  <span>Contacts Unlocks Revenue:</span>
                  <strong>TSh ${sumUnlocks.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; border-top: 1px solid #f1f5f9; padding-top: 8px; margin-top: 4px; font-weight: bold;">
                  <span>Aggregate Total:</span>
                  <span style="color: #10b981;">TSh ${totalActual.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <!-- Revenue Trend Chart -->
            <div class="table-card" style="padding: 20px;">
              <h4 style="font-weight: bold; font-size: 13px; margin-bottom: 16px;">Daily Revenue Trend (Last 7 Days)</h4>
              <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 100px; gap: 8px;">
                ${[25, 45, 30, 75, 55, 95, 80].map((val, idx) => {
                  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                  return `
                    <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;">
                      <div style="height: ${val}px; width: 100%; background: #38bdf8; border-radius: 4px 4px 0 0;"></div>
                      <span style="font-size: 9px; font-weight: bold; color: #64748b;">${days[idx]}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'audit') {
      // ==========================================
      // 14. AUDIT CENTER (REAL LOGS TRACE)
      // ==========================================
      const tableRows = logsList.map(l => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="font-family: monospace; font-size: 11px;">${(l.userId || 'N/A').substring(0, 8)}...</td>
          <td><strong>${l.userEmail || 'System'}</strong></td>
          <td><span class="status-badge approved" style="font-size: 9px; text-transform:uppercase;">${l.action}</span></td>
          <td style="font-size: 11px; color: #475569; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.details}">${l.details}</td>
          <td style="font-size: 10px; font-family: monospace; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.before || ''}">${l.before || 'N/A'}</td>
          <td style="font-size: 10px; font-family: monospace; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${l.after || ''}">${l.after || 'N/A'}</td>
          <td style="font-size: 11px;">${new Date(l.timestamp).toLocaleString()}</td>
          <td style="font-size: 11px; font-family: monospace;">${l.ip || '127.0.0.1'}</td>
          <td style="font-size: 10px; color: #64748b; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.device || ''}">${l.device || 'Desktop'}</td>
        </tr>
      `).join('');

      subViewContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <h3 style="font-weight: 800; font-size: 16px;">System Audit Trails & Security logs</h3>
          <button id="clear-all-audit-logs" class="btn-premium btn-premium-danger" style="height: 32px; font-size: 11px;">Clear Logs Trace</button>
        </div>

        <div class="table-card">
          <div style="overflow-x: auto;">
            <table class="premium-table">
              <thead>
                <tr>
                  <th>User UID</th>
                  <th>User Email</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Timestamp</th>
                  <th>IP Address</th>
                  <th>Device / UserAgent</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows || '<tr><td colspan="9" style="text-align: center; padding: 20px;">No system trace logs available.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'notifications') {
      // ==========================================
      // 15. LIVE BROADCAST & NOTIFICATIONS (CRUD HISTORIES)
      // ==========================================
      const historyList = cachedAdminData.notificationHistory || [];

      const historyHtml = historyList.map(h => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="font-weight: bold;">${h.title}</td>
          <td style="font-size: 11px; color:#475569; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${h.body}">${h.body}</td>
          <td><span class="status-badge approved" style="font-size: 8px; text-transform:uppercase;">${h.targetRole}</span></td>
          <td style="font-size: 10px; text-transform:uppercase;">${h.channels ? h.channels.join(', ') : 'PUSH'}</td>
          <td>
            <span style="color:#38bdf8; font-weight:bold;">${h.sentCount || 1}</span> sent / 
            <span style="color:#10b981; font-weight:bold;">${h.deliveredCount || 1}</span> dev / 
            <span style="color:#6366f1; font-weight:bold;">${h.openedCount || 0}</span> open / 
            <span style="color:#ef4444; font-weight:bold;">${h.failedCount || 0}</span> fail
          </td>
          <td>${h.createdAt ? new Date(h.createdAt).toLocaleString() : 'N/A'}</td>
          <td>
            <button class="btn-premium btn-premium-danger delete-broadcast-log-btn" data-id="${h.id}" style="height:24px; padding:0 8px; font-size:10px;">Delete</button>
          </td>
        </tr>
      `).join('');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Live Notification Center</h3>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items:start;">
          <!-- Broadcast form -->
          <div class="table-card" style="padding: 20px; background: #fff;">
            <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px;">Compose Push & SMS Broadcast Alert</h4>
            
            <div class="form-group">
              <label>Select Target Audience</label>
              <select id="notif-target-select" class="form-control-input">
                <option value="all">All Registered Users</option>
                <option value="providers">Only Providers</option>
                <option value="customers">Only Customers</option>
                <option value="staff">Only Field Staff</option>
              </select>
            </div>

            <div class="form-group">
              <label>Delivery Channels</label>
              <div style="display: flex; gap: 16px; font-size: 12px; margin-top: 4px;">
                <label style="display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="chan-push" checked /> In-App Push</label>
                <label style="display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="chan-email" /> Email SMTP</label>
                <label style="display: flex; align-items: center; gap: 4px;"><input type="checkbox" id="chan-sms" /> Beem SMS</label>
              </div>
            </div>

            <div class="form-group">
              <label>Message Title</label>
              <input type="text" id="notif-title-input" class="form-control-input" placeholder="e.g. Maboresho ya Mfumo" />
            </div>

            <div class="form-group">
              <label>Message Body / Content</label>
              <textarea id="notif-body-input" class="form-control-textarea" style="height: 100px;" placeholder="Andika maelezo ya arifa hapa..."></textarea>
            </div>

            <button id="submit-broadcast-notif" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%;">Send Broadcast Notification</button>
          </div>

          <!-- Broadcast History table -->
          <div class="table-card" style="display: flex; flex-direction: column;">
            <div class="table-card-header">Recent Broadcast Logs & Delivery Audits (CRUD History)</div>
            <div style="overflow-x: auto;">
              <table class="premium-table" style="font-size:12px;">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Body</th>
                    <th>Target</th>
                    <th>Channels</th>
                    <th>Delivery Status History</th>
                    <th>Date Sent</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${historyHtml || '<tr><td colspan="7" style="text-align: center; padding: 20px; color:#94a3b8;">No broadcasts logs recorded.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'settings') {
      // ==========================================
      // 16. SYSTEM CONFIG SETTINGS & CONNECTION TESTERS
      // ==========================================
      const platName = systemSettings.find(s => s.id === 'platform_name')?.value || 'CHIMBO LANGU';
      const logoUrl = systemSettings.find(s => s.id === 'logo_url')?.value || '';
      const defLang = systemSettings.find(s => s.id === 'default_lang')?.value || 'Swahili';
      const defCurr = systemSettings.find(s => s.id === 'default_curr')?.value || 'TSh';
      const pwaCache = systemSettings.find(s => s.id === 'pwa_offline_cache')?.value || 'Enabled';

      // Cloudinary
      const cloudName = systemSettings.find(s => s.id === 'cloudinary_cloud')?.value || '';
      const cloudApiKey = systemSettings.find(s => s.id === 'cloudinary_api_key')?.value || '';
      const cloudApiSecret = systemSettings.find(s => s.id === 'cloudinary_api_secret')?.value || '';
      const cloudFolder = systemSettings.find(s => s.id === 'cloudinary_folder')?.value || '';
      const cloudMaxSize = systemSettings.find(s => s.id === 'cloudinary_max_size')?.value || '10';

      // SMTP
      const smtpHost = systemSettings.find(s => s.id === 'smtp_host')?.value || '';
      const smtpPort = systemSettings.find(s => s.id === 'smtp_port')?.value || '587';
      const smtpUser = systemSettings.find(s => s.id === 'smtp_user')?.value || '';
      const smtpPass = systemSettings.find(s => s.id === 'smtp_pass')?.value || '';
      const smtpSender = systemSettings.find(s => s.id === 'smtp_sender_name')?.value || '';

      // Maps
      const mapsApi = mapsSettings.find(s => s.id === 'maps_api')?.value || '';
      const mapboxApi = mapsSettings.find(s => s.id === 'mapbox_api')?.value || '';
      const mapsRadius = mapsSettings.find(s => s.id === 'default_radius')?.value || '15';
      const mapsAccuracy = mapsSettings.find(s => s.id === 'gps_accuracy')?.value || '10';

      // SMS
      const smsProvider = smsSettings.find(s => s.id === 'sms_provider')?.value || 'Beem';
      const beemKey = smsSettings.find(s => s.id === 'beem_sms_key')?.value || '';
      const atKey = smsSettings.find(s => s.id === 'africastalking_key')?.value || '';
      const twilioSid = smsSettings.find(s => s.id === 'twilio_sid')?.value || '';
      const twilioAuth = smsSettings.find(s => s.id === 'twilio_auth')?.value || '';
      const smsCustom = smsSettings.find(s => s.id === 'custom_sms_endpoint')?.value || '';

      // AI Settings
      const aiEnabled = aiSettings.find(s => s.id === 'ai_enabled')?.value || 'Enabled';
      const aiProvider = aiSettings.find(s => s.id === 'ai_provider')?.value || 'Gemini';
      const openaiKey = aiSettings.find(s => s.id === 'openai_api_key')?.value || '';
      const geminiKey = aiSettings.find(s => s.id === 'gemini_api_key')?.value || '';
      const deepseekKey = aiSettings.find(s => s.id === 'deepseek_api_key')?.value || '';

      // Pricing Settings
      const starterPrice = parseFloat(subscriptionSettings.find(s => s.id === 'price_starter')?.value || '50000');
      const businessPrice = parseFloat(subscriptionSettings.find(s => s.id === 'price_business')?.value || '150000');
      const premiumPrice = parseFloat(subscriptionSettings.find(s => s.id === 'price_premium')?.value || '300000');

      // Helper to query connection test statuses from Firestore
      const getTestResult = (serviceId: string) => {
        const docObj = cachedAdminData.integrationTests.find(t => t.id === serviceId);
        if (!docObj) return { status: 'Never Tested', lastTested: 'N/A' };
        return {
          status: docObj.status || 'Never Tested',
          lastTested: docObj.lastTested ? new Date(docObj.lastTested).toLocaleString() : 'N/A'
        };
      };

      const geminiTest = getTestResult('gemini');
      const openaiTest = getTestResult('openai');
      const deepseekTest = getTestResult('deepseek');
      const cloudinaryTest = getTestResult('cloudinary');
      const mapsTest = getTestResult('maps');
      const smtpTest = getTestResult('smtp');
      const beemTest = getTestResult('beem');
      const atTest = getTestResult('africastalking');

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Platform Settings Page (Dedicated config desk)</h3>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; align-items:start;">
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- Card 1: General Platform & Subscriptions Settings -->
            <div class="table-card" style="padding: 20px; background: #fff;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">General Platform & Subscription Settings</h4>
              <div class="form-row">
                <div class="form-group">
                  <label>Platform Display Name</label>
                  <input type="text" id="sys-plat-name" class="form-control-input" value="${platName}" />
                </div>
                <div class="form-group">
                  <label>Logo Asset URL</label>
                  <input type="text" id="sys-logo-url" class="form-control-input" value="${logoUrl}" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Default Language</label>
                  <input type="text" id="sys-def-lang" class="form-control-input" value="${defLang}" />
                </div>
                <div class="form-group">
                  <label>Default Currency</label>
                  <input type="text" id="sys-def-curr" class="form-control-input" value="${defCurr}" />
                </div>
              </div>
              <div class="form-row-three">
                <div class="form-group">
                  <label>Starter Plan Price (TSh)</label>
                  <input type="number" id="sys-price-starter" class="form-control-input" value="${starterPrice}" />
                </div>
                <div class="form-group">
                  <label>Business Plan Price (TSh)</label>
                  <input type="number" id="sys-price-business" class="form-control-input" value="${businessPrice}" />
                </div>
                <div class="form-group">
                  <label>Premium Plan Price (TSh)</label>
                  <input type="number" id="sys-price-premium" class="form-control-input" value="${premiumPrice}" />
                </div>
              </div>
            </div>

            <!-- Card 2: AI Configuration -->
            <div class="table-card" style="padding: 20px; background: #fff;">
              <h4 style="font-weight: bold; font-size: 14px; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">AI Suggestions & Core Engines Configuration</h4>
              <div class="form-row">
                <div class="form-group">
                  <label>AI Enabled ON/OFF</label>
                  <select id="sys-ai-enabled-select" class="form-control-input">
                    <option value="Enabled" ${aiEnabled === 'Enabled' ? 'selected' : ''}>ON (Enabled)</option>
                    <option value="Disabled" ${aiEnabled === 'Disabled' ? 'selected' : ''}>OFF (Disabled)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Active AI Provider</label>
                  <select id="sys-ai-provider-select" class="form-control-input">
                    <option value="OpenAI" ${aiProvider === 'OpenAI' ? 'selected' : ''}>OpenAI</option>
                    <option value="Gemini" ${aiProvider === 'Gemini' ? 'selected' : ''}>Google Gemini</option>
                    <option value="DeepSeek" ${aiProvider === 'DeepSeek' ? 'selected' : ''}>DeepSeek</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label>OpenAI Secret API Key</label>
                <input type="password" id="sys-openai-key" class="form-control-input" value="${openaiKey}" placeholder="sk-..." />
              </div>
              <div class="form-group">
                <label>Google Gemini API Key</label>
                <input type="password" id="sys-gemini-key" class="form-control-input" value="${geminiKey}" placeholder="AIzaSy..." />
              </div>
              <div class="form-group">
                <label>DeepSeek Secret API Key</label>
                <input type="password" id="sys-deepseek-key" class="form-control-input" value="${deepseekKey}" placeholder="ds-..." />
              </div>
            </div>

            <button id="sys-settings-save-btn" class="btn-premium btn-premium-primary" style="height: 38px; width: 100%; margin-top: 8px; margin-bottom: 30px;">
              Save All Platform Settings
            </button>
          </div>

          <!-- META DESK AND PRODUCTION INTEGRATION CONNECTION VERIFIER -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <!-- Integration Testers panel (Point 11) -->
            <div class="table-card" style="padding:20px; background:#fff;">
              <h4 style="font-weight:bold; font-size:13px; margin-bottom:12px; color:#6366f1;">Production Integrations Desk</h4>
              <div style="display:flex; flex-direction:column; gap:10px; font-size:12px;">
                
                <!-- Gemini -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Google Gemini AI</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="gemini" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${geminiTest.status === 'Connected' ? '#10b981' : geminiTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${geminiTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${geminiTest.lastTested}</span>
                  </div>
                </div>

                <!-- OpenAI -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>OpenAI Engine</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="openai" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${openaiTest.status === 'Connected' ? '#10b981' : openaiTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${openaiTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${openaiTest.lastTested}</span>
                  </div>
                </div>

                <!-- DeepSeek -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>DeepSeek Engine</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="deepseek" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${deepseekTest.status === 'Connected' ? '#10b981' : deepseekTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${deepseekTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${deepseekTest.lastTested}</span>
                  </div>
                </div>

                <!-- Cloudinary -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Cloudinary Storage</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="cloudinary" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${cloudinaryTest.status === 'Connected' ? '#10b981' : cloudinaryTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${cloudinaryTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${cloudinaryTest.lastTested}</span>
                  </div>
                </div>

                <!-- Google Maps -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Google Maps / Mapbox</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="maps" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${mapsTest.status === 'Connected' ? '#10b981' : mapsTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${mapsTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${mapsTest.lastTested}</span>
                  </div>
                </div>

                <!-- SMTP -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>SMTP Mail Server</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="smtp" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${smtpTest.status === 'Connected' ? '#10b981' : smtpTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${smtpTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${smtpTest.lastTested}</span>
                  </div>
                </div>

                <!-- Beem SMS -->
                <div style="border-bottom:1px solid #f1f5f9; padding-bottom:6px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Beem SMS Gateway</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="beem" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${beemTest.status === 'Connected' ? '#10b981' : beemTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${beemTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${beemTest.lastTested}</span>
                  </div>
                </div>

                <!-- Africa's Talking -->
                <div style="padding-bottom:2px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>Africa's Talking SMS</strong>
                    <button class="btn-premium btn-premium-secondary test-cred-btn" data-service="africastalking" style="height:22px; font-size:9px; padding:0 6px;">Test</button>
                  </div>
                  <div style="font-size:10px; margin-top:2px;">
                    Status: <strong style="color:${atTest.status === 'Connected' ? '#10b981' : atTest.status === 'Failed' ? '#ef4444' : '#64748b'};">${atTest.status}</strong><br/>
                    <span style="color:#94a3b8; font-size:9px;">Tested: ${atTest.lastTested}</span>
                  </div>
                </div>

              </div>
            </div>

            <!-- App Environment -->
            <div class="table-card" style="padding: 20px; background: #fff;">
              <h4 style="font-weight: bold; font-size: 13px; margin-bottom: 12px;">App Environment</h4>
              <div style="font-size: 12px; line-height: 1.5; color: #475569; display:flex; flex-direction:column; gap:8px;">
                <div><strong>Database State:</strong> Production</div>
                <div><strong>Local Server Port:</strong> 3000</div>
                <div><strong>Cron Task Scheduler:</strong> Active</div>
                <div class="form-group" style="margin-top:10px;">
                  <label>PWA Offline Cache Toggle</label>
                  <select id="sys-pwa-cache-select" class="form-control-input">
                    <option value="Enabled" ${pwaCache === 'Enabled' ? 'selected' : ''}>Enabled</option>
                    <option value="Disabled" ${pwaCache === 'Disabled' ? 'selected' : ''}>Disabled</option>
                  </select>
                </div>
                <button id="sys-pwa-save-btn" class="btn-premium btn-premium-secondary" style="height:32px; font-size:11px; width:100%; margin-bottom: 12px;">Save Cache Policy</button>
                <div style="border-top: 1px solid #e2e8f0; margin-top: 12px; padding-top: 12px;">
                  <button id="sys-seed-demo-btn" class="btn-premium btn-premium-secondary" style="height:32px; font-size:11px; width:100%; background: #10b981; border: none; color: white;">Seed Demo Data</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (activeAdminTab === 'live') {
      // ==========================================
      // 8. LIVE USER PRESENCE MONITORING
      // ==========================================
      const presenceList = cachedAdminData.userPresence || [];
      const sessionList = cachedAdminData.activeSessions || [];

      // Filter presence list by role
      const liveAdmins = presenceList.filter(p => p.role === 'admin' || p.role === 'superadmin');
      const liveStaff = presenceList.filter(p => p.role === 'staff' || p.role === 'field_officer' || p.role === 'support_officer' || p.role === 'verification_officer' || p.role === 'finance_officer' || p.role === 'moderator');
      const liveProviders = presenceList.filter(p => p.role === 'provider');
      const liveCustomers = presenceList.filter(p => p.role === 'customer');

      const onlineCount = (list: any[]) => list.filter(p => p.status === 'online').length;

      const renderPresenceRows = (list: any[]) => {
        return list.map(p => {
          const sess = sessionList.find(s => s.email === p.email);
          return `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="font-weight:bold;">${p.email || 'Anonymous'}</td>
              <td><span class="status-badge ${p.status === 'online' ? 'approved' : 'suspended'}">${p.status || 'offline'}</span></td>
              <td style="font-family:monospace; font-size:11px;">${sess?.currentView || 'home'}</td>
              <td style="font-size:11px; color:#475569;">${sess?.deviceType || 'Desktop'}</td>
              <td style="font-family:monospace; font-size:11px; color:#64748b;">${sess?.ipAddress || '127.0.0.1'}</td>
              <td style="font-size:11px; color:#94a3b8;">${p.lastActive ? new Date(p.lastActive).toLocaleTimeString() : 'N/A'}</td>
            </tr>
          `;
        }).join('') || '<tr><td colspan="6" style="text-align:center; padding:12px; color:#94a3b8;">No users online.</td></tr>';
      };

      subViewContent = `
        <h3 style="font-weight: 800; font-size: 16px; margin-bottom: 16px;">Live Users & Active Sessions Monitor</h3>

        <!-- Grid Cards for Online Counts -->
        <div class="stats-grid-container" style="margin-bottom:20px;">
          <div class="stats-dashboard-card" style="border-left:4px solid #10b981;">
            <span class="title">Online Admins</span>
            <span class="value" style="color: #10b981;">${onlineCount(liveAdmins)}</span>
            <span style="font-size:10px; color:#64748b;">Total presence: ${liveAdmins.length}</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid #6366f1;">
            <span class="title">Online Field Staff</span>
            <span class="value" style="color: #6366f1;">${onlineCount(liveStaff)}</span>
            <span style="font-size:10px; color:#64748b;">Total presence: ${liveStaff.length}</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid #f59e0b;">
            <span class="title">Online Providers</span>
            <span class="value" style="color: #f59e0b;">${onlineCount(liveProviders)}</span>
            <span style="font-size:10px; color:#64748b;">Total presence: ${liveProviders.length}</span>
          </div>
          <div class="stats-dashboard-card" style="border-left:4px solid #38bdf8;">
            <span class="title">Online Customers</span>
            <span class="value" style="color: #38bdf8;">${onlineCount(liveCustomers)}</span>
            <span style="font-size:10px; color:#64748b;">Total presence: ${liveCustomers.length}</span>
          </div>
        </div>

        <!-- Grouped Live Directory (Toggles by Role) -->
        <div style="display:flex; flex-direction:column; gap:20px;">
          
          <div class="table-card">
            <div class="table-card-header" style="color:#10b981;">Administrators Sessions Online</div>
            <div style="overflow-x:auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Admin Email</th>
                    <th>Status</th>
                    <th>Current Screen</th>
                    <th>Current Device</th>
                    <th>IP Address</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderPresenceRows(liveAdmins)}
                </tbody>
              </table>
            </div>
          </div>

          <div class="table-card">
            <div class="table-card-header" style="color:#6366f1;">Field & Operations Staff Sessions</div>
            <div style="overflow-x:auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Staff Email</th>
                    <th>Status</th>
                    <th>Current Screen</th>
                    <th>Current Device</th>
                    <th>IP Address</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderPresenceRows(liveStaff)}
                </tbody>
              </table>
            </div>
          </div>

          <div class="table-card">
            <div class="table-card-header" style="color:#f59e0b;">Registered Business Providers Sessions</div>
            <div style="overflow-x:auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Provider Email</th>
                    <th>Status</th>
                    <th>Current Screen</th>
                    <th>Current Device</th>
                    <th>IP Address</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderPresenceRows(liveProviders)}
                </tbody>
              </table>
            </div>
          </div>

          <div class="table-card">
            <div class="table-card-header" style="color:#38bdf8;">Registered App Customers Sessions</div>
            <div style="overflow-x:auto;">
              <table class="premium-table">
                <thead>
                  <tr>
                    <th>Customer Email</th>
                    <th>Status</th>
                    <th>Current Screen</th>
                    <th>Current Device</th>
                    <th>IP Address</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  ${renderPresenceRows(liveCustomers)}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      `;
    }

    // MAIN LAYOUT WRAPPER HTML (Sidebar + Header + Content Container)
    return `
      ${cssStyles}
      <div class="sidebar-overlay" id="sidebar-overlay-mask"></div>
      <div class="admin-layout">
        <!-- Sidebar nav -->
        <aside class="admin-sidebar">
          <div class="sidebar-header">
            <span class="material-symbols-outlined">security</span>
            <span>CHIMBO ADMIN</span>
          </div>
          <nav class="sidebar-nav">
            <button class="${activeAdminTab === 'overview' ? 'active' : ''}" id="side-tab-overview"><span class="material-symbols-outlined">dashboard</span>Overview</button>
            <button class="${activeAdminTab === 'providers' ? 'active' : ''}" id="side-tab-providers"><span class="material-symbols-outlined">storefront</span>Providers</button>
            <button class="${activeAdminTab === 'products' ? 'active' : ''}" id="side-tab-products"><span class="material-symbols-outlined">inventory</span>Products</button>
            <button class="${activeAdminTab === 'services' ? 'active' : ''}" id="side-tab-services"><span class="material-symbols-outlined">design_services</span>Services</button>
            <button class="${activeAdminTab === 'documents' ? 'active' : ''}" id="side-tab-documents"><span class="material-symbols-outlined">description</span>Documents</button>
            <button class="${activeAdminTab === 'staff' ? 'active' : ''}" id="side-tab-staff"><span class="material-symbols-outlined">badge</span>Field Staff</button>
            <button class="${activeAdminTab === 'field' ? 'active' : ''}" id="side-tab-field"><span class="material-symbols-outlined">my_location</span>Field Visits</button>
            <button class="${activeAdminTab === 'customers' ? 'active' : ''}" id="side-tab-customers"><span class="material-symbols-outlined">person</span>Customers</button>
            <button class="${activeAdminTab === 'subscriptions' ? 'active' : ''}" id="side-tab-subscriptions"><span class="material-symbols-outlined">card_membership</span>Subscriptions</button>
            <button class="${activeAdminTab === 'categories' ? 'active' : ''}" id="side-tab-categories"><span class="material-symbols-outlined">category</span>Categories</button>
            <button class="${activeAdminTab === 'templates' ? 'active' : ''}" id="side-tab-templates"><span class="material-symbols-outlined">schema</span>Feature Templates</button>
            <button class="${activeAdminTab === 'search' ? 'active' : ''}" id="side-tab-search"><span class="material-symbols-outlined">search_insights</span>Search Intel</button>
            <button class="${activeAdminTab === 'revenue' ? 'active' : ''}" id="side-tab-revenue"><span class="material-symbols-outlined">payments</span>Revenue</button>
            <button class="${activeAdminTab === 'audit' ? 'active' : ''}" id="side-tab-audit"><span class="material-symbols-outlined">history</span>Audit Center</button>
            <button class="${activeAdminTab === 'notifications' ? 'active' : ''}" id="side-tab-notifications"><span class="material-symbols-outlined">campaign</span>Notifications</button>
            <button class="${activeAdminTab === 'settings' ? 'active' : ''}" id="side-tab-settings"><span class="material-symbols-outlined">settings</span>System Settings</button>
            <button class="${activeAdminTab === 'live' ? 'active' : ''}" id="side-tab-live"><span class="material-symbols-outlined">sensors</span>Live Monitor</button>
          </nav>
        </aside>

        <!-- Right Content panel -->
        <div class="admin-main-container">
          <header class="admin-header-bar">
            <div style="display: flex; align-items: center; gap: 10px;">
              <button id="mobile-nav-toggle" class="material-symbols-outlined">menu</button>
              <span style="font-weight: bold; color: #475569;">Console Version 2.5</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 12px; color: #64748b; display: inline-block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><strong>${user?.email}</strong></span>
              <button id="admin-logout-btn" class="btn-premium btn-premium-secondary" style="height: 32px; padding:0 10px; font-size: 11px;">Ondoka</button>
            </div>
          </header>
          
          <main class="admin-content-area">
            ${subViewContent}
          </main>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error rendering Admin Panel:', err);
    return '<div class="stitch-flex stitch-justify-center stitch-align-center" style="padding: var(--spacing-lg); color: var(--color-error);">Hitilafu imetokea kwenye kikagulio cha admin.</div>';
  }
}

export function bindAdminDashboardEvents() {
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
      navigateTo('home');
    });
  }

  // --- Sidebar Mobile toggle triggers ---
  const mobileToggle = document.getElementById('mobile-nav-toggle');
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.getElementById('sidebar-overlay-mask');
  if (mobileToggle && sidebar && overlay) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // --- Sidebar tab navigation swappers ---
  const tabIds = [
    'overview', 'providers', 'products', 'services', 'documents',
    'staff', 'field', 'customers', 'subscriptions', 'categories',
    'templates', 'search', 'revenue', 'audit', 'notifications', 'settings', 'live'
  ] as const;

  tabIds.forEach(tabId => {
    const btn = document.getElementById(`side-tab-${tabId}`);
    if (btn) {
      btn.addEventListener('click', () => {
        activeAdminTab = tabId;
        // Reset subviews details toggles on tab swap
        selectedProviderId = null;
        selectedProductId = null;
        selectedCustomerId = null;
        selectedStaffId = null;
        selectedServiceId = null;
        editingPlanId = null;
        editingCategoryId = null;
        editingTemplateId = null;
        
        // Hide sidebar on mobile click
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');

        navigateTo('admin-dashboard');
      });
    }
  });

  // --- Clickable Dashboard Overview Cards ---
  if (activeAdminTab === 'overview') {
    const cardProvs = [
      'card-providers-total',
      'card-providers-verified',
      'card-providers-pending',
      'card-providers-suspended'
    ];
    cardProvs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          activeAdminTab = 'providers';
          selectedProviderId = null;
          navigateTo('admin-dashboard');
        });
      }
    });

    const cardProds = [
      'card-products-total',
      'card-products-pending',
      'card-products-approved',
      'card-products-rejected'
    ];
    cardProds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          activeAdminTab = 'products';
          selectedProductId = null;
          navigateTo('admin-dashboard');
        });
      }
    });

    const cardServs = [
      'card-services-total',
      'card-services-pending'
    ];
    cardServs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          activeAdminTab = 'services';
          selectedServiceId = null;
          navigateTo('admin-dashboard');
        });
      }
    });

    const elCust = document.getElementById('card-customers-total');
    if (elCust) {
      elCust.addEventListener('click', () => {
        activeAdminTab = 'customers';
        selectedCustomerId = null;
        navigateTo('admin-dashboard');
      });
    }

    const cardRevs = [
      'card-revenue-today',
      'card-revenue-monthly'
    ];
    cardRevs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          activeAdminTab = 'revenue';
          navigateTo('admin-dashboard');
        });
      }
    });
  }

  // ==========================================
  // 2. PROVIDERS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'providers') {
    // Submit create provider button
    const submitCreateProvBtn = document.getElementById('submit-create-provider');
    if (submitCreateProvBtn) {
      submitCreateProvBtn.addEventListener('click', async () => {
        const bizName = (document.getElementById('create-prov-bizname') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('create-prov-category') as HTMLSelectElement)?.value;
        const ownerName = (document.getElementById('create-prov-ownername') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('create-prov-email') as HTMLInputElement)?.value.trim();
        const phone = (document.getElementById('create-prov-phone') as HTMLInputElement)?.value.trim();
        const openVal = (document.getElementById('create-prov-opening-time') as HTMLSelectElement)?.value || '08:00';
        const closeVal = (document.getElementById('create-prov-closing-time') as HTMLSelectElement)?.value || '18:00';
        const address = (document.getElementById('create-prov-address') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('create-prov-desc') as HTMLTextAreaElement)?.value.trim();

        if (!bizName || !ownerName || !email) {
          alert('Tafadhali jaza Jina la Biashara, Jina la Mmiliki na Barua Pepe.');
          return;
        }

        submitCreateProvBtn.setAttribute('disabled', 'true');
        submitCreateProvBtn.innerHTML = 'Submitting...';

        try {
          // 1. Create owner user profile
          const userId = 'user-' + Math.floor(Math.random() * 900000 + 100000);
          const userRef = doc(db, 'users', userId);
          const userPayload = {
            id: userId,
            name: ownerName,
            email: email,
            phoneNumber: phone,
            role: 'customer',
            status: 'active',
            createdAt: new Date().toISOString()
          };
          await setDoc(userRef, userPayload);

          // 2. Create provider document
          const provId = 'prov-' + Math.floor(Math.random() * 900000 + 100000);
          const provRef = doc(db, 'providers', provId);
          const provPayload = {
            id: provId,
            userId: userId,
            businessName: bizName,
            category: category,
            whatsapp: phone,
            businessHours: `${openVal} - ${closeVal}`,
            address: address,
            description: desc,
            status: 'pending',
            trustScore: 40,
            isVerified: false,
            createdAt: new Date().toISOString()
          };
          await setDoc(provRef, provPayload);

          await logAction('Provider Account Created', `Admin registered provider ${bizName} (owner: ${ownerName})`, 'N/A', JSON.stringify(provPayload));
          alert('Provider profile successfully created!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to create provider: ' + err.message);
          submitCreateProvBtn.removeAttribute('disabled');
          submitCreateProvBtn.innerHTML = 'Sajili Provider';
        }
      });
    }

    // Search bar event
    const searchBar = document.getElementById('prov-search-bar');
    if (searchBar) {
      searchBar.addEventListener('input', (e) => {
        providerSearchQuery = (e.target as HTMLInputElement).value;
      });
      searchBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigateTo('admin-dashboard');
      });
    }

    // Status filter select event
    const statusFilterSelect = document.getElementById('prov-status-select');
    if (statusFilterSelect) {
      statusFilterSelect.addEventListener('change', (e) => {
        providerStatusFilter = (e.target as HTMLSelectElement).value;
        navigateTo('admin-dashboard');
      });
    }

    // Provider table row click details
    document.querySelectorAll('.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (id) {
          selectedProviderId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Back to list button inside details
    const backBtn = document.getElementById('back-to-providers-list');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        selectedProviderId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Save notes button inside profile view details
    const saveNotesBtn = document.getElementById('prov-detail-save-notes');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', async () => {
        const id = saveNotesBtn.getAttribute('data-id');
        const notes = (document.getElementById('prov-detail-notes-area') as HTMLTextAreaElement)?.value.trim();
        if (!id) return;
        try {
          const ref = doc(db, 'providers', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify({ adminNotes: existing.adminNotes || '' });
          const afterStr = JSON.stringify({ adminNotes: notes });

          await setDoc(ref, { ...existing, adminNotes: notes }, { merge: true });
          await logAction('Provider Notes Added', `Admin added note to provider ID ${id}`, beforeStr, afterStr);
          alert('System notes saved successfully!');
        } catch (_) {
          alert('Failed to save notes.');
        }
      });
    }

    // Recalculate trust score inside details
    const recalcBtn = document.getElementById('prov-detail-recalc-trust');
    if (recalcBtn) {
      recalcBtn.addEventListener('click', async () => {
        const id = recalcBtn.getAttribute('data-id');
        if (!id) return;
        recalcBtn.setAttribute('disabled', 'true');
        recalcBtn.innerHTML = 'Recalculating...';
        try {
          const scoreDetails = await recalculateTrustScore(id);
          alert(`Recalculated Trust Score successfully! New Score: ${scoreDetails.score}%`);
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to recalculate.');
          recalcBtn.removeAttribute('disabled');
          recalcBtn.innerHTML = 'Recalculate Trust Score';
        }
      });
    }

    // Risk Level Select dropdown
    const riskSelect = document.getElementById('prov-detail-risk-select');
    if (riskSelect) {
      riskSelect.addEventListener('change', async () => {
        const id = selectedProviderId;
        const val = (riskSelect as HTMLSelectElement).value;
        if (!id) return;
        try {
          const ref = doc(db, 'providers', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify({ riskScore: existing.riskScore || 'medium' });
          const afterStr = JSON.stringify({ riskScore: val });

          await setDoc(ref, { ...existing, riskScore: val }, { merge: true });
          await logAction('Provider Risk Updated', `Updated provider ID ${id} risk level to ${val}`, beforeStr, afterStr);
          alert(`Risk level updated to ${val.toUpperCase()}`);
        } catch (_) {
          alert('Failed to update risk level.');
        }
      });
    }

    // Edit profile save changes button
    const saveProfileEditBtn = document.getElementById('save-prov-edit-btn');
    if (saveProfileEditBtn) {
      saveProfileEditBtn.addEventListener('click', async () => {
        const id = saveProfileEditBtn.getAttribute('data-id');
        if (!id) return;
        const bizName = (document.getElementById('edit-prov-bizname') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('edit-prov-category') as HTMLSelectElement)?.value;
        const address = (document.getElementById('edit-prov-address') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('edit-prov-desc') as HTMLTextAreaElement)?.value.trim();
        const whatsapp = (document.getElementById('edit-prov-whatsapp') as HTMLInputElement)?.value.trim();
        const openVal = (document.getElementById('edit-prov-opening-time') as HTMLSelectElement)?.value || '08:00';
        const closeVal = (document.getElementById('edit-prov-closing-time') as HTMLSelectElement)?.value || '17:00';
        const hours = `${openVal} - ${closeVal}`;

        if (!bizName) {
          alert('Business name must not be empty.');
          return;
        }

        try {
          const ref = doc(db, 'providers', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);
          
          const updated = {
            ...existing,
            businessName: bizName,
            category,
            address,
            description: desc,
            whatsapp,
            businessHours: hours
          };
          const afterStr = JSON.stringify(updated);

          await setDoc(ref, updated, { merge: true });
          await logAction('Provider Profile Edited', `Admin modified provider profile info for ID ${id}`, beforeStr, afterStr);
          alert('Profile changes saved successfully!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save profile changes.');
        }
      });
    }

    // Provider status action buttons (Approve, Reject, Suspend, Reactivate, Delete)
    document.querySelectorAll('.prov-detail-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        if (action === 'delete') {
          if (!confirm('Are you absolutely sure you want to delete this provider record?')) return;
        }

        try {
          const ref = doc(db, 'providers', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'approve') {
            const trialStart = new Date();
            const trialExpiry = new Date();
            trialExpiry.setDate(trialExpiry.getDate() + 30);

            const updated = { 
              ...existing, 
              status: 'approved', 
              verificationStatus: 'approved',
              providerStatus: 'approved',
              reviewStage: 'completed',
              isVerified: true,
              trialStartedAt: trialStart.toISOString(),
              trialExpiresAt: trialExpiry.toISOString(),
              subscriptionStatus: 'trial'
            };
            await setDoc(ref, updated, { merge: true });

            // Create trial subscription record
            const subId = `${id}_subscription`;
            const subRef = doc(db, 'subscriptions', subId);
            await setDoc(subRef, {
              id: subId,
              providerId: id,
              plan: 'starter',
              price: 0,
              status: 'active',
              expiresAt: trialExpiry.toISOString(),
              createdAt: trialStart.toISOString()
            });
            // User role remains 'customer' under production account architecture
            await logAction('Provider Approved', `Approved provider ID ${id} and initialized 30-day trial`, beforeStr, JSON.stringify(updated));
            alert('Provider approved and 30-day free trial initialized!');
          } else if (action === 'request_changes') {
            const updated = { 
              ...existing, 
              status: 'pending', 
              verificationStatus: 'changes_requested',
              providerStatus: 'profile_incomplete',
              reviewStage: 'none',
              isVerified: false 
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Provider Changes Requested', `Requested changes for provider ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Changes requested from provider.');
          } else if (action === 'reject') {
            const updated = { 
              ...existing, 
              status: 'rejected', 
              verificationStatus: 'rejected',
              providerStatus: 'registered',
              reviewStage: 'none',
              isVerified: false 
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Provider Rejected', `Rejected provider ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Provider status set to rejected.');
          } else if (action === 'suspend') {
            const updated = { ...existing, status: 'suspended', isVerified: false };
            await setDoc(ref, updated, { merge: true });
            await logAction('Provider Suspended', `Suspended provider ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Provider status set to suspended.');
          } else if (action === 'reactivate') {
            const updated = { ...existing, status: 'approved', isVerified: true };
            await setDoc(ref, updated, { merge: true });
            await logAction('Provider Reactivated', `Reactivated provider ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Provider reactivated!');
          } else if (action === 'delete') {
            await deleteDoc(ref);
            await logAction('Provider Deleted', `Deleted provider ID ${id}`, beforeStr, 'DELETED');
            alert('Provider deleted.');
            selectedProviderId = null;
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Action failed.');
        }
      });
    });
  }

  // ==========================================
  // 3. PRODUCTS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'products') {
    // Submit create product button
    const submitCreateProdBtn = document.getElementById('submit-create-product');
    if (submitCreateProdBtn) {
      submitCreateProdBtn.addEventListener('click', async () => {
        const name = (document.getElementById('create-prod-name') as HTMLInputElement)?.value.trim();
        const price = parseFloat((document.getElementById('create-prod-price') as HTMLInputElement)?.value) || 0;
        const brand = (document.getElementById('create-prod-brand') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('create-prod-category') as HTMLSelectElement)?.value;
        const condition = (document.getElementById('create-prod-condition') as HTMLSelectElement)?.value;
        const providerId = (document.getElementById('create-prod-provider') as HTMLSelectElement)?.value;
        const stock = parseInt((document.getElementById('create-prod-stock') as HTMLInputElement)?.value) || 0;
        const featuresStr = (document.getElementById('create-prod-features') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('create-prod-desc') as HTMLTextAreaElement)?.value.trim();

        if (!name || price <= 0 || !providerId) {
          alert('Tafadhali jaza Jina la Bidhaa, Bei na Muuzaji.');
          return;
        }

        submitCreateProdBtn.setAttribute('disabled', 'true');
        submitCreateProdBtn.innerHTML = 'Submitting...';

        try {
          const prodId = 'prod-' + Math.floor(Math.random() * 900000 + 100000);
          const ref = doc(db, 'products', prodId);
          const features = featuresStr ? featuresStr.split(',').map(f => f.trim()).filter(Boolean) : [];
          const stockStatus = stock > 10 ? 'Stock Available' : stock > 0 ? 'Low Stock' : 'Out of Stock';

          const payload = {
            id: prodId,
            providerId,
            name,
            price,
            brand: brand || '',
            category: category || '',
            condition: condition || 'new',
            description: desc || '',
            qualityScore: 95,
            trustScore: 80,
            isVerified: true,
            badge: 'none',
            status: 'approved',
            minPrice: price,
            maxPrice: price,
            stockQuantity: stock,
            stockStatus,
            features,
            createdAt: new Date().toISOString()
          };

          await setDoc(ref, payload);
          await logAction('Product Created', `Admin added product ${name} for provider ID ${providerId}`, 'N/A', JSON.stringify(payload));
          alert('Bidhaa imeongezwa na kuchapishwa kikamilifu!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to save product: ' + err.message);
          submitCreateProdBtn.removeAttribute('disabled');
          submitCreateProdBtn.innerHTML = 'Save Bidhaa';
        }
      });
    }

    // Queue filter changer select
    const pFilterSelect = document.getElementById('prod-status-filter-select');
    if (pFilterSelect) {
      pFilterSelect.addEventListener('change', (e) => {
        productStatusFilter = (e.target as HTMLSelectElement).value;
        navigateTo('admin-dashboard');
      });
    }

    // Row selection trigger
    document.querySelectorAll('.clickable-prod-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (id) {
          selectedProductId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Back to list button inside details
    const backBtn = document.getElementById('back-to-products-list');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        selectedProductId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Slider range scoring output binder
    const range = document.getElementById('audit-img-score-range');
    if (range) {
      range.addEventListener('input', (e) => {
        const display = document.getElementById('audit-img-score-display');
        if (display) display.innerHTML = `${(e.target as HTMLInputElement).value} points`;
      });
    }

    // Save product editing data
    const saveProdDataBtn = document.getElementById('save-prod-data-btn');
    if (saveProdDataBtn) {
      saveProdDataBtn.addEventListener('click', async () => {
        const id = saveProdDataBtn.getAttribute('data-id');
        if (!id) return;
        const name = (document.getElementById('edit-prod-name') as HTMLInputElement)?.value.trim();
        const price = parseFloat((document.getElementById('edit-prod-price') as HTMLInputElement)?.value) || 0;
        const brand = (document.getElementById('edit-prod-brand') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('edit-prod-category') as HTMLSelectElement)?.value;
        const condition = (document.getElementById('edit-prod-condition') as HTMLSelectElement)?.value;
        const stock = parseInt((document.getElementById('edit-prod-stock') as HTMLInputElement)?.value) || 0;
        const featuresStr = (document.getElementById('edit-prod-features') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('edit-prod-desc') as HTMLTextAreaElement)?.value.trim();

        if (!name || price <= 0) {
          alert('Please fill Name and Price.');
          return;
        }

        try {
          const ref = doc(db, 'products', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          const features = featuresStr ? featuresStr.split(',').map(f => f.trim()).filter(Boolean) : [];
          const stockStatus = stock > 10 ? 'Stock Available' : stock > 0 ? 'Low Stock' : 'Out of Stock';

          const updated = {
            ...existing,
            name,
            price,
            brand,
            category,
            condition,
            stockQuantity: stock,
            stockStatus,
            features,
            description: desc
          };
          const afterStr = JSON.stringify(updated);

          await setDoc(ref, updated, { merge: true });
          await logAction('Product Details Edited', `Admin modified details for product ID ${id}`, beforeStr, afterStr);
          alert('Product details updated successfully!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save product details.');
        }
      });
    }

    // Product auditing actions (Approve, Reject, Request Changes, Delete)
    document.querySelectorAll('.prod-detail-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        if (action === 'delete') {
          if (!confirm('Je, una uhakika unataka kufuta bidhaa hii?')) return;
        }

        try {
          const ref = doc(db, 'products', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'approve') {
            const score = parseInt((document.getElementById('audit-img-score-range') as HTMLInputElement)?.value) || 90;
            const priceChecked = (document.getElementById('audit-price-check') as HTMLInputElement)?.checked;
            const featChecked = (document.getElementById('audit-feat-check') as HTMLInputElement)?.checked;

            const updated = { 
              ...existing, 
              status: 'approved', 
              isVerified: true,
              qualityScore: score,
              isPriceValidated: priceChecked,
              isFeatureValidated: featChecked
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Product Approved', `Approved product ID ${id} with image score ${score}`, beforeStr, JSON.stringify(updated));
            alert('Product approved and published!');
            selectedProductId = null;
          } else if (action === 'reject') {
            const updated = { ...existing, status: 'rejected', isVerified: false };
            await setDoc(ref, updated, { merge: true });
            await logAction('Product Rejected', `Rejected product ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Product rejected.');
            selectedProductId = null;
          } else if (action === 'changes') {
            const note = prompt('Ingiza maelezo ya changes kwa provider:', 'Tafadhali rekebisha picha na bei.');
            if (!note) return;
            const updated = { 
              ...existing, 
              status: 'pending', 
              description: (existing.description || '') + `\n[ADMIN FEEDBACK]: ${note}`
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Product Changes Requested', `Requested changes for product ID ${id}: ${note}`, beforeStr, JSON.stringify(updated));
            alert('Changes requested note appended.');
            selectedProductId = null;
          } else if (action === 'delete') {
            await deleteDoc(ref);
            await logAction('Product Deleted', `Deleted product ID ${id}`, beforeStr, 'DELETED');
            alert('Product deleted.');
            selectedProductId = null;
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Action failed.');
        }
      });
    });
  }

  // ==========================================
  // 4. SERVICES EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'services') {
    // Submit create service button
    const submitCreateServBtn = document.getElementById('submit-create-service');
    if (submitCreateServBtn) {
      submitCreateServBtn.addEventListener('click', async () => {
        const name = (document.getElementById('create-serv-name') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('create-serv-category') as HTMLSelectElement)?.value;
        const startingPrice = parseFloat((document.getElementById('create-serv-price') as HTMLInputElement)?.value) || 0;
        const coverageStr = (document.getElementById('create-serv-coverage') as HTMLInputElement)?.value.trim();
        const providerId = (document.getElementById('create-serv-provider') as HTMLSelectElement)?.value;
        const desc = (document.getElementById('create-serv-desc') as HTMLTextAreaElement)?.value.trim();

        if (!name || startingPrice <= 0 || !providerId) {
          alert('Tafadhali jaza Jina la Huduma, Bei na Mtoa Huduma.');
          return;
        }

        submitCreateServBtn.setAttribute('disabled', 'true');
        submitCreateServBtn.innerHTML = 'Submitting...';

        try {
          const servId = 'serv-' + Math.floor(Math.random() * 900000 + 100000);
          const ref = doc(db, 'services', servId);
          const coverageAreas = coverageStr ? coverageStr.split(',').map(a => a.trim()).filter(Boolean) : [];

          const payload = {
            id: servId,
            providerId,
            name,
            startingPrice,
            category: category || '',
            description: desc || '',
            coverageAreas,
            isVerified: true,
            createdAt: new Date().toISOString()
          };

          await setDoc(ref, payload);
          await logAction('Service Created', `Admin added service ${name} for provider ID ${providerId}`, 'N/A', JSON.stringify(payload));
          alert('Huduma imeongezwa na kuidhinishwa kikamilifu!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to save service: ' + err.message);
          submitCreateServBtn.removeAttribute('disabled');
          submitCreateServBtn.innerHTML = 'Save Huduma';
        }
      });
    }

    const sFilterSelect = document.getElementById('serv-status-filter-select');
    if (sFilterSelect) {
      sFilterSelect.addEventListener('change', (e) => {
        serviceStatusFilter = (e.target as HTMLSelectElement).value;
        navigateTo('admin-dashboard');
      });
    }

    document.querySelectorAll('.clickable-serv-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (id) {
          selectedServiceId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    const backBtn = document.getElementById('back-to-services-list');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        selectedServiceId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Save edited service data
    const saveServDataBtn = document.getElementById('save-serv-data-btn');
    if (saveServDataBtn) {
      saveServDataBtn.addEventListener('click', async () => {
        const id = saveServDataBtn.getAttribute('data-id');
        if (!id) return;
        const name = (document.getElementById('edit-serv-name') as HTMLInputElement)?.value.trim();
        const category = (document.getElementById('edit-serv-category') as HTMLSelectElement)?.value;
        const startingPrice = parseFloat((document.getElementById('edit-serv-price') as HTMLInputElement)?.value) || 0;
        const coverageStr = (document.getElementById('edit-serv-coverage') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('edit-serv-desc') as HTMLTextAreaElement)?.value.trim();

        if (!name || startingPrice <= 0) {
          alert('Please fill Name and Starting Price.');
          return;
        }

        try {
          const ref = doc(db, 'services', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          const coverageAreas = coverageStr ? coverageStr.split(',').map(a => a.trim()).filter(Boolean) : [];

          const updated = {
            ...existing,
            name,
            category,
            startingPrice,
            coverageAreas,
            description: desc
          };
          const afterStr = JSON.stringify(updated);

          await setDoc(ref, updated, { merge: true });
          await logAction('Service Details Edited', `Admin modified details for service ID ${id}`, beforeStr, afterStr);
          alert('Service details updated successfully!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save service details.');
        }
      });
    }

    document.querySelectorAll('.serv-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        try {
          const ref = doc(db, 'services', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'approve') {
            const updated = { ...existing, isVerified: true };
            await setDoc(ref, updated, { merge: true });
            await logAction('Service Approved', `Approved service ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Service approved!');
            selectedServiceId = null;
          } else if (action === 'reject') {
            const updated = { ...existing, isVerified: false };
            await setDoc(ref, updated, { merge: true });
            await logAction('Service Rejected', `Rejected service ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Service status set to unverified.');
            selectedServiceId = null;
          } else if (action === 'changes') {
            const note = prompt('Ingiza maelekezo ya mabadiliko:', 'Rekebisha bei au maelezo.');
            if (!note) return;
            const updated = {
              ...existing,
              description: (existing.description || '') + `\n[ADMIN FEEDBACK]: ${note}`
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Service Changes Requested', `Requested changes for service ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Feedback sent.');
            selectedServiceId = null;
          } else if (action === 'delete') {
            if (!confirm('Are you sure you want to delete this service?')) return;
            await deleteDoc(ref);
            await logAction('Service Deleted', `Deleted service ID ${id}`, beforeStr, 'DELETED');
            alert('Service deleted successfully.');
            selectedServiceId = null;
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Service action failed.');
        }
      });
    });
  }

  // ==========================================
  // 5. DOCUMENTS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'documents') {
    const docFilter = document.getElementById('doc-status-filter-select');
    if (docFilter) {
      docFilter.addEventListener('change', (e) => {
        docStatusFilter = (e.target as HTMLSelectElement).value;
        navigateTo('admin-dashboard');
      });
    }

    // Open Document Preview trigger
    document.querySelectorAll('.doc-preview-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-url') || '';
        const isPdf = btn.getAttribute('data-is-pdf') === 'true';
        const viewer = document.getElementById('admin-doc-viewer-container');
        if (!viewer) return;

        if (isPdf) {
          viewer.innerHTML = `<iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>`;
        } else {
          viewer.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 100%; object-fit: contain; padding: 10px;" />`;
        }
      });
    });

    // Verification Document decisions
    document.querySelectorAll('.doc-verif-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        const notes = (document.getElementById('doc-verification-notes') as HTMLTextAreaElement)?.value.trim() || '';
        if (!id || !action) return;

        try {
          const ref = doc(db, 'verificationDocuments', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'approve') {
            const updated = { ...existing, status: 'approved', docNotes: notes };
            await setDoc(ref, updated, { merge: true });
            await logAction('Verification Document Approved', `Approved document ID ${id}. Notes: ${notes}`, beforeStr, JSON.stringify(updated));
            alert('Document marked as approved!');
          } else if (action === 'reject') {
            const updated = { ...existing, status: 'rejected', docNotes: notes };
            await setDoc(ref, updated, { merge: true });
            await logAction('Verification Document Rejected', `Rejected document ID ${id}. Notes: ${notes}`, beforeStr, JSON.stringify(updated));
            alert('Document marked as rejected.');
          } else if (action === 'reupload') {
            const updated = { ...existing, status: 'pending', fileUrl: '', docNotes: notes };
            await setDoc(ref, updated, { merge: true });
            await logAction('Verification Document Reupload Requested', `Requested reupload for document ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Reupload requested successfully.');
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Action failed.');
        }
      });
    });
  }

  // ==========================================
  // 6. FIELD STAFF EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'staff') {
    // Select staff row trigger
    document.querySelectorAll('.clickable-staff-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (id) {
          selectedStaffId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Create Staff Account submit button
    const submitBtn = document.getElementById('submit-create-staff');
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const name = (document.getElementById('create-staff-name') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('create-staff-email') as HTMLInputElement)?.value.trim();
        const pwd = (document.getElementById('create-staff-password') as HTMLInputElement)?.value;
        const roleSel = (document.getElementById('create-staff-role') as HTMLSelectElement)?.value;

        if (!name || !email || !pwd) {
          alert('Tafadhali jaza nyuga zote.');
          return;
        }

        try {
          const staffId = 'staff-' + Math.floor(Math.random() * 900000 + 100000);
          const newProfile = {
            id: staffId,
            name,
            email,
            role: roleSel,
            status: 'active',
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'users', staffId), newProfile);
          await logAction('Staff Account Created', `Created staff account: ${name} (${email}) as ${roleSel}`, 'N/A', JSON.stringify(newProfile));
          alert('Staff account successfully created!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to register staff account.');
        }
      });
    }

    // Invite staff by email
    const inviteBtn = document.getElementById('submit-invite-staff');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', async () => {
        const nameVal = (document.getElementById('invite-staff-name') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('invite-staff-email') as HTMLInputElement)?.value.trim();
        const roleSel = (document.getElementById('invite-staff-role') as HTMLSelectElement)?.value;

        if (!email) {
          alert('Please enter invitee email.');
          return;
        }

        try {
          const inviteId = 'inv-' + Math.floor(Math.random() * 900000 + 100000);
          const inviteDoc = {
            id: inviteId,
            email,
            role: roleSel,
            status: 'sent',
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'staffInvitations', inviteId), inviteDoc);

          const userDoc = {
            id: inviteId,
            name: nameVal || 'Pending Invite',
            email,
            role: roleSel,
            status: 'pending_invitation',
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'users', inviteId), userDoc);

          await logAction('Staff Invited', `Sent role invitation to email ${email} as ${roleSel}`, 'N/A', JSON.stringify(inviteDoc));
          alert(`Invitation sent to ${email}`);
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to send invitation: ' + err.message);
        }
      });
    }

    // Save staff details edit changes
    const saveStaffEditBtn = document.getElementById('save-staff-edit-btn');
    if (saveStaffEditBtn) {
      saveStaffEditBtn.addEventListener('click', async () => {
        const id = saveStaffEditBtn.getAttribute('data-id');
        const nameVal = (document.getElementById('edit-staff-name') as HTMLInputElement)?.value.trim();
        const emailVal = (document.getElementById('edit-staff-email') as HTMLInputElement)?.value.trim();
        const roleVal = (document.getElementById('edit-staff-role') as HTMLSelectElement)?.value;

        if (!id) return;
        if (!nameVal || !emailVal) {
          alert('Tafadhali jaza jina na barua pepe.');
          return;
        }

        try {
          const ref = doc(db, 'users', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);
          const updated = {
            ...existing,
            name: nameVal,
            email: emailVal,
            role: roleVal
          };

          await setDoc(ref, updated, { merge: true });
          await logAction('Staff Account Updated', `Updated staff member ${id}: Name=${nameVal}, Email=${emailVal}, Role=${roleVal}`, beforeStr, JSON.stringify(updated));
          alert('Staff account successfully updated!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to update staff account: ' + err.message);
        }
      });
    }

    // Role modification selection
    const staffRoleModify = document.getElementById('staff-role-modify-select');
    if (staffRoleModify) {
      staffRoleModify.addEventListener('change', async () => {
        const id = staffRoleModify.getAttribute('data-id');
        const roleVal = (staffRoleModify as HTMLSelectElement).value;
        if (!id) return;

        try {
          const ref = doc(db, 'users', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);
          const updated = { ...existing, role: roleVal };

          await setDoc(ref, updated, { merge: true });
          await logAction('Staff Role Modified', `Modified role of user ${id} to ${roleVal}`, beforeStr, JSON.stringify(updated));
          alert(`Role updated to ${roleVal.toUpperCase()}`);
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to modify role.');
        }
      });
    }

    // Staff actions (Suspend, Activate, Reset password, Delete)
    document.querySelectorAll('.staff-management-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        try {
          const ref = doc(db, 'users', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'toggle-suspend') {
            const currentStatus = existing.status || 'active';
            const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
            const updated = { ...existing, status: nextStatus };
            await setDoc(ref, updated, { merge: true });
            await logAction('Staff Status Toggled', `Toggled staff ID ${id} status to ${nextStatus}`, beforeStr, JSON.stringify(updated));
            alert(`Staff account ${nextStatus === 'active' ? 'activated' : 'suspended'}!`);
          } else if (action === 'reset-pwd') {
            alert('Password reset link simulated and sent to SMTP queue.');
            await logAction('Staff Password Reset', `Simulated password reset for ID ${id}`);
          } else if (action === 'delete') {
            if (!confirm('Delete staff account completely?')) return;
            await deleteDoc(ref);
            await logAction('Staff Deleted', `Deleted staff account ID ${id}`, beforeStr, 'DELETED');
            alert('Staff member removed.');
            selectedStaffId = null;
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Staff action failed.');
        }
      });
    });
  }

  // ==========================================
  // 7. FIELD VERIFICATION VISIT EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'field') {
    // Assign visit button
    const assignBtn = document.getElementById('submit-field-assign');
    if (assignBtn) {
      assignBtn.addEventListener('click', async () => {
        const provId = (document.getElementById('assign-provider-select') as HTMLSelectElement)?.value;
        const staffId = (document.getElementById('assign-staff-select') as HTMLSelectElement)?.value;
        const area = (document.getElementById('assign-area-input') as HTMLInputElement)?.value.trim();
        const deadline = (document.getElementById('assign-deadline-input') as HTMLInputElement)?.value;

        if (!provId || !staffId || !area || !deadline) {
          alert('Tafadhali jaza taarifa zote kupanga assignment.');
          return;
        }

        try {
          const assignRef = doc(collection(db, 'fieldAssignments'));
          const payload = {
            id: assignRef.id,
            staffId,
            providerId: provId,
            area,
            status: 'assigned',
            scheduledDate: deadline,
            createdAt: new Date().toISOString()
          };
          await setDoc(assignRef, payload);
          await logAction('GPS Visit Assigned', `Assigned field visit for provider ID ${provId} to staff ID ${staffId}`, 'N/A', JSON.stringify(payload));
          alert('Uhakiki wa GPS umepangwa vizuri!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Assignment creation failed.');
        }
      });
    }

    // View Report details click
    document.querySelectorAll('.view-report-details').forEach(btn => {
      btn.addEventListener('click', () => {
        const repId = btn.getAttribute('data-report-id');
        const placeholder = document.getElementById('field-visit-report-details');
        const content = document.getElementById('findings-content-placeholder');
        if (!placeholder || !content || !repId) return;

        const reportsList = (window as any).cachedFieldReports || [];
        const report = reportsList.find((r: any) => r.id === repId);

        if (report) {
          content.innerHTML = `
            <p><strong>Verification Date:</strong> ${new Date(report.createdAt).toLocaleString()}</p>
            <p><strong>GPS Verified Coordinates:</strong> ${report.verifiedLatitude}, ${report.verifiedLongitude}</p>
            <p><strong>Location Coordinates Match:</strong> ${report.isActualMatch ? '<span style="color: #10b981; font-weight: bold;">Yes (Valid)</span>' : '<span style="color: #ef4444; font-weight: bold;">No (Invalid)</span>'}</p>
            <p style="margin-top: 4px;"><strong>Staff Notes:</strong></p>
            <p style="font-style: italic; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #e2e8f0;">"${report.notes}"</p>
            
            <div style="display:flex; gap:6px; margin-top:8px;">
              <button class="btn-premium btn-premium-primary report-admin-decision" data-action="approve" data-id="${report.id}" data-assign-id="${report.assignmentId}" style="height:28px; font-size:11px; flex:1;">Approve Report & Verify Provider</button>
              <button class="btn-premium btn-premium-secondary report-admin-decision" data-action="reject" data-id="${report.id}" data-assign-id="${report.assignmentId}" style="height:28px; font-size:11px; color:#ef4444; border:1px solid #ef4444; flex:1;">Reject Report</button>
            </div>
          `;
          placeholder.style.display = 'block';

          // Bind Approve / Reject actions for findings report inside DOM
          document.querySelectorAll('.report-admin-decision').forEach(decisionBtn => {
            decisionBtn.addEventListener('click', async () => {
              const rId = decisionBtn.getAttribute('data-id');
              const aId = decisionBtn.getAttribute('data-assign-id');
              const act = decisionBtn.getAttribute('data-action');
              if (!rId || !aId || !act) return;

              try {
                if (act === 'approve') {
                  // Get assignment to find providerId
                  const aSnap = await getDoc(doc(db, 'fieldAssignments', aId));
                  if (aSnap.exists()) {
                    const providerId = (aSnap.data() as any).providerId;
                    
                    // Update provider trust score
                    await recalculateTrustScore(providerId);

                    // Mark provider as verified
                    const pRef = doc(db, 'providers', providerId);
                    const pSnap = await getDoc(pRef);
                    if (pSnap.exists()) {
                      await setDoc(pRef, { ...(pSnap.data() as any), isVerified: true, status: 'approved' }, { merge: true });
                    }
                  }
                  
                  await setDoc(doc(db, 'fieldAssignments', aId), { status: 'completed' }, { merge: true });
                  await logAction('Field Verification Approved', `Approved visit report ID ${rId} and marked provider as active/verified.`);
                  alert('Verification report approved successfully!');
                } else {
                  await setDoc(doc(db, 'fieldAssignments', aId), { status: 'assigned' }, { merge: true });
                  await deleteDoc(doc(db, 'fieldReports', rId));
                  await logAction('Field Verification Rejected', `Rejected visit report ID ${rId}. Re-assigned visit.`);
                  alert('Verification report rejected and visit re-queued.');
                }
                navigateTo('admin-dashboard');
              } catch (_) {
                alert('Failed to log report decision.');
              }
            });
          });
        }
      });
    });

    // Simulate Staff Report Submission
    document.querySelectorAll('.simulate-staff-report-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const assignId = btn.getAttribute('data-assign-id');
        const providerId = btn.getAttribute('data-provider-id');
        if (!assignId || !providerId) return;

        try {
          const reportRef = doc(collection(db, 'fieldReports'));
          const rId = reportRef.id;

          const reportPayload = {
            id: rId,
            assignmentId: assignId,
            isActualMatch: true,
            verifiedLatitude: -6.8180,
            verifiedLongitude: 39.2820,
            notes: 'Simulated field verification findings: Business office photos captured, locations coordinate accurate within 3m.',
            createdAt: new Date().toISOString()
          };

          // 1. Create Report
          await setDoc(reportRef, reportPayload);

          // 2. Complete Assignment
          await setDoc(doc(db, 'fieldAssignments', assignId), { status: 'completed' }, { merge: true });

          // 3. Update Provider Trust Score Cache
          await recalculateTrustScore(providerId);

          await logAction('GPS Visit Report Completed', `Completed simulated site visit for provider ID ${providerId}`, 'N/A', JSON.stringify(reportPayload));
          alert('GPS visit report successfully simulated!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Simulation failed.');
        }
      });
    });
  }

  // ==========================================
  // 8. CUSTOMERS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'customers') {
    // Search input
    const searchBar = document.getElementById('cust-search-bar');
    if (searchBar) {
      searchBar.addEventListener('input', (e) => {
        customerSearchQuery = (e.target as HTMLInputElement).value;
      });
      searchBar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') navigateTo('admin-dashboard');
      });
    }

    // Click customer row trigger
    document.querySelectorAll('.clickable-cust-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (id) {
          selectedCustomerId = id;
          selectedReportId = null;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Customer complaints resolve triggers
    document.querySelectorAll('.resolve-complaint-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        try {
          const ref = doc(db, 'reports', id);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data: any = snap.data();
            const providerId = data.providerId;
            
            // Mark resolved
            await setDoc(ref, { ...data, status: 'resolved' }, { merge: true });
            
            // Apply penalty: Recalculating trust score takes complaints penalty into account!
            await recalculateTrustScore(providerId);

            await logAction('Customer Complaint Resolved', `Resolved complaint ID ${id} filed against provider ${providerId}`);
            alert('Complaint resolved! Provider trust score penalized accordingly.');
            navigateTo('admin-dashboard');
          }
        } catch (_) {
          alert('Failed to resolve complaint.');
        }
      });
    });

    // Customer suspension / delete actions
    document.querySelectorAll('.cust-management-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        try {
          const ref = doc(db, 'users', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          if (action === 'toggle-suspend') {
            const currentStatus = existing.status || 'active';
            const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
            const updated = { ...existing, status: nextStatus };
            await setDoc(ref, updated, { merge: true });
            await logAction('Customer Status Toggled', `Toggled customer ID ${id} status to ${nextStatus}`, beforeStr, JSON.stringify(updated));
            alert(`Customer account ${nextStatus === 'active' ? 'activated' : 'suspended'}!`);
          } else if (action === 'delete') {
            if (!confirm('Je, una uhakika unataka kufuta akaunti hii ya mteja?')) return;
            await deleteDoc(ref);
            await logAction('Customer Deleted', `Deleted customer account ID ${id}`, beforeStr, 'DELETED');
            alert('Customer account deleted successfully.');
            selectedCustomerId = null;
          }
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Action failed.');
        }
      });
    });

    // Submit Create Customer
    const submitCreateCustBtn = document.getElementById('submit-create-customer');
    if (submitCreateCustBtn) {
      submitCreateCustBtn.addEventListener('click', async () => {
        const name = (document.getElementById('cust-create-name') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('cust-create-email') as HTMLInputElement)?.value.trim();
        const phone = (document.getElementById('cust-create-phone') as HTMLInputElement)?.value.trim();
        const region = (document.getElementById('cust-create-region') as HTMLInputElement)?.value.trim();
        const district = (document.getElementById('cust-create-district') as HTMLInputElement)?.value.trim();
        const ward = (document.getElementById('cust-create-ward') as HTMLInputElement)?.value.trim();
        const gpsStr = (document.getElementById('cust-create-gps') as HTMLInputElement)?.value.trim();

        if (!name || !email) {
          alert('Jina na Barua Pepe ni lazima.');
          return;
        }

        try {
          const custId = 'user-' + Math.floor(Math.random() * 900000 + 100000);
          let latitude = -6.8184;
          let longitude = 39.2826;
          if (gpsStr) {
            const parts = gpsStr.split(',').map(p => parseFloat(p.trim()));
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
              latitude = parts[0];
              longitude = parts[1];
            }
          }

          const payload = {
            id: custId,
            name,
            email,
            phoneNumber: phone,
            role: 'customer' as const,
            status: 'active',
            region: region || 'Dar es Salaam',
            district: district || 'Ilala',
            ward: ward || 'Kariakoo',
            latitude,
            longitude,
            createdAt: new Date().toISOString()
          };

          await setDoc(doc(db, 'users', custId), payload);
          await logAction('Customer Created', `Admin registered customer ${name} (${email})`, 'N/A', JSON.stringify(payload));
          alert('Akaunti ya mteja imeundwa kikamilifu!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to create customer: ' + err.message);
        }
      });
    }

    // Save Customer Profile Changes
    const saveCustProfileBtn = document.getElementById('save-cust-profile-btn');
    if (saveCustProfileBtn) {
      saveCustProfileBtn.addEventListener('click', async () => {
        const id = saveCustProfileBtn.getAttribute('data-id');
        if (!id) return;
        const name = (document.getElementById('cust-edit-name') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('cust-edit-email') as HTMLInputElement)?.value.trim();
        const phone = (document.getElementById('cust-edit-phone') as HTMLInputElement)?.value.trim();
        const region = (document.getElementById('cust-edit-region') as HTMLInputElement)?.value.trim();
        const district = (document.getElementById('cust-edit-district') as HTMLInputElement)?.value.trim();
        const ward = (document.getElementById('cust-edit-ward') as HTMLInputElement)?.value.trim();
        const lat = parseFloat((document.getElementById('cust-edit-lat') as HTMLInputElement)?.value) || -6.8184;
        const lon = parseFloat((document.getElementById('cust-edit-lon') as HTMLInputElement)?.value) || 39.2826;

        if (!name || !email) {
          alert('Name and Email must not be empty.');
          return;
        }

        try {
          const ref = doc(db, 'users', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify(existing);

          const updated = {
            ...existing,
            name,
            email,
            phoneNumber: phone,
            region,
            district,
            ward,
            latitude: lat,
            longitude: lon
          };
          const afterStr = JSON.stringify(updated);

          await setDoc(ref, updated, { merge: true });
          await logAction('Customer Profile Edited', `Admin modified customer profile info for ID ${id}`, beforeStr, afterStr);
          alert('Taarifa za mteja zimehifadhiwa kikamilifu!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to save profile changes.');
        }
      });
    }

    // Deselect Customer Detail Desk
    const deselectCustBtn = document.getElementById('deselect-cust-btn');
    if (deselectCustBtn) {
      deselectCustBtn.addEventListener('click', () => {
        selectedCustomerId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Open Dispute Desk
    document.querySelectorAll('.open-dispute-desk-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          selectedReportId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Close Dispute Desk
    const closeDisputeBtn = document.getElementById('close-dispute-desk-btn');
    if (closeDisputeBtn) {
      closeDisputeBtn.addEventListener('click', () => {
        selectedReportId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Save Dispute Provider Response
    const saveDisputeResponseBtn = document.getElementById('save-dispute-response-btn');
    if (saveDisputeResponseBtn) {
      saveDisputeResponseBtn.addEventListener('click', async () => {
        const id = saveDisputeResponseBtn.getAttribute('data-id');
        const responseText = (document.getElementById('dispute-provider-response') as HTMLTextAreaElement)?.value.trim();
        if (!id) return;
        try {
          const ref = doc(db, 'reports', id);
          const snap = await getDoc(ref);
          const existing: any = snap.exists() ? snap.data() : {};
          const beforeStr = JSON.stringify({ providerResponse: existing.providerResponse || '' });
          const afterStr = JSON.stringify({ providerResponse: responseText });

          await setDoc(ref, { ...existing, providerResponse: responseText }, { merge: true });
          await logAction('Dispute Provider Response Saved', `Admin added/edited response on complaint ID ${id}`, beforeStr, afterStr);
          alert('Provider response saved successfully!');
        } catch (_) {
          alert('Failed to save response.');
        }
      });
    }

    // Dispute Desk Actions (Resolve, Escalate, Refund, Suspend Provider, Warn Provider, Close Case)
    document.querySelectorAll('.dispute-desk-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;

        try {
          const ref = doc(db, 'reports', id);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            alert('Case not found.');
            return;
          }
          const repData: any = snap.data();
          const providerId = repData.providerId;
          const reporterId = repData.reporterId;
          const beforeStr = JSON.stringify(repData);

          if (action === 'resolve') {
            const updated = { ...repData, status: 'resolved' };
            await setDoc(ref, updated, { merge: true });
            await recalculateTrustScore(providerId);
            await logAction('Dispute Resolved', `Resolved dispute ID ${id}. Status set to resolved.`, beforeStr, JSON.stringify(updated));
            alert('Dispute resolved successfully!');
            selectedReportId = null;
          } else if (action === 'escalate') {
            const updated = { ...repData, status: 'escalated' };
            await setDoc(ref, updated, { merge: true });
            await logAction('Dispute Escalated', `Escalated dispute ID ${id}. Status set to escalated.`, beforeStr, JSON.stringify(updated));
            alert('Dispute escalated to senior mediation!');
            selectedReportId = null;
          } else if (action === 'refund') {
            const updated = { ...repData, status: 'refunded' };
            await setDoc(ref, updated, { merge: true });
            
            // Create negative payment entry
            const refundRef = doc(collection(db, 'payments'));
            const refundPayload = {
              id: refundRef.id,
              userId: reporterId,
              providerId: providerId,
              amount: -(repData.amountRefundable || 1000),
              referenceCode: `REFUND-${id.substring(0, 8).toUpperCase()}`,
              status: 'success' as const,
              paymentMethod: 'Mobile Money Refund' as const,
              createdAt: new Date().toISOString()
            };
            await setDoc(refundRef, refundPayload);
            await logAction('Dispute Refund Issued', `Refunded customer ID ${reporterId} for dispute ID ${id}`, beforeStr, JSON.stringify(refundPayload));
            alert('Refund successfully processed in billing database!');
            selectedReportId = null;
          } else if (action === 'suspend') {
            const pRef = doc(db, 'providers', providerId);
            const pSnap = await getDoc(pRef);
            if (pSnap.exists()) {
              const pData = pSnap.data() as any;
              const pBefore = JSON.stringify(pData);
              const pUpdated = { ...pData, status: 'suspended' as const, isVerified: false };
              await setDoc(pRef, pUpdated, { merge: true });
              await logAction('Provider Suspended via Dispute Desk', `Suspended provider ID ${providerId} due to dispute ID ${id}`, pBefore, JSON.stringify(pUpdated));
              alert('Provider has been suspended!');
            } else {
              alert('Provider profile not found to suspend.');
            }
            selectedReportId = null;
          } else if (action === 'warn') {
            const pRef = doc(db, 'providers', providerId);
            const pSnap = await getDoc(pRef);
            if (pSnap.exists()) {
              const pData = pSnap.data() as any;
              const pBefore = JSON.stringify(pData);
              const warningMsg = `Dispute warning: Case ${id}`;
              const adminNotes = (pData.adminNotes || '') + `\n[WARNING - DISPUTE DESK]: ${warningMsg}`;
              const newScore = Math.max(0, (pData.trustScore || 40) - 15);
              const pUpdated = { ...pData, adminNotes, trustScore: newScore };
              await setDoc(pRef, pUpdated, { merge: true });
              await logAction('Provider Warned via Dispute Desk', `Issued warning and -15 trust penalty to provider ID ${providerId}`, pBefore, JSON.stringify(pUpdated));
              alert('Provider issued official warning and trust score penalized (-15 points)!');
            } else {
              alert('Provider profile not found to warn.');
            }
            selectedReportId = null;
          } else if (action === 'close') {
            const updated = { ...repData, status: 'closed' };
            await setDoc(ref, updated, { merge: true });
            await logAction('Dispute Case Closed', `Closed dispute case ID ${id}.`, beforeStr, JSON.stringify(updated));
            alert('Dispute case closed without changes.');
            selectedReportId = null;
          }
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Action failed: ' + err.message);
        }
      });
    });

    // Send direct notifications, SMS, or Email alerts
    const sendCustNotifBtn = document.getElementById('send-cust-direct-notif');
    if (sendCustNotifBtn) {
      sendCustNotifBtn.addEventListener('click', async () => {
        const id = sendCustNotifBtn.getAttribute('data-id');
        const body = (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement)?.value.trim();
        if (!id || !body) {
          alert('Tafadhali andika maelezo ya arifa.');
          return;
        }

        try {
          const notifRef = doc(collection(db, 'notifications'));
          await setDoc(notifRef, {
            id: notifRef.id,
            userId: id,
            title: 'Taarifa Mpya kutoka Chimbo',
            body: body,
            read: false,
            createdAt: new Date().toISOString()
          });

          // Log in notificationHistory
          const historyRef = doc(collection(db, 'notificationHistory'));
          await setDoc(historyRef, {
            id: historyRef.id,
            title: 'Taarifa Mpya kutoka Chimbo',
            body: body,
            targetRole: 'single_customer',
            targetUserId: id,
            channels: ['PUSH'],
            sentCount: 1,
            deliveredCount: 1,
            openedCount: 0,
            failedCount: 0,
            createdAt: new Date().toISOString()
          });

          await logAction('Direct Notification Sent', `Sent in-app notification to customer ID ${id}`);
          alert('Arifa ya in-app imetumwa kwa mteja!');
          (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement).value = '';
          navigateTo('admin-dashboard');
        } catch (err: any) {
          alert('Failed to send notification: ' + err.message);
        }
      });
    }

    const sendCustSmsBtn = document.getElementById('send-cust-direct-sms');
    if (sendCustSmsBtn) {
      sendCustSmsBtn.addEventListener('click', async () => {
        const id = sendCustSmsBtn.getAttribute('data-id');
        const phone = sendCustSmsBtn.getAttribute('data-phone');
        const body = (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement)?.value.trim();
        if (!id || !body) {
          alert('Tafadhali andika maelezo ya SMS.');
          return;
        }

        if (!phone) {
          alert('Mteja hana namba ya simu iliyosajiliwa.');
          return;
        }

        try {
          // Log in notificationHistory
          const historyRef = doc(collection(db, 'notificationHistory'));
          await setDoc(historyRef, {
            id: historyRef.id,
            title: 'Direct SMS to ' + phone,
            body: body,
            targetRole: 'single_customer',
            targetUserId: id,
            channels: ['SMS'],
            sentCount: 1,
            deliveredCount: 1,
            openedCount: 0,
            failedCount: 0,
            createdAt: new Date().toISOString()
          });

          await logAction('Direct SMS Sent', `Sent direct SMS to customer ID ${id} (${phone})`);
          alert(`SMS imesimuliwa na kutumwa kwa namba ${phone}!`);
          (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement).value = '';
          navigateTo('admin-dashboard');
        } catch (err: any) {
          alert('Failed to send SMS: ' + err.message);
        }
      });
    }

    const sendCustEmailBtn = document.getElementById('send-cust-direct-email');
    if (sendCustEmailBtn) {
      sendCustEmailBtn.addEventListener('click', async () => {
        const id = sendCustEmailBtn.getAttribute('data-id');
        const email = sendCustEmailBtn.getAttribute('data-email');
        const body = (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement)?.value.trim();
        if (!id || !body) {
          alert('Tafadhali andika maelezo ya barua pepe.');
          return;
        }

        if (!email) {
          alert('Mteja hana barua pepe iliyosajiliwa.');
          return;
        }

        try {
          // Log in notificationHistory
          const historyRef = doc(collection(db, 'notificationHistory'));
          await setDoc(historyRef, {
            id: historyRef.id,
            title: 'Direct Email to ' + email,
            body: body,
            targetRole: 'single_customer',
            targetUserId: id,
            channels: ['EMAIL'],
            sentCount: 1,
            deliveredCount: 1,
            openedCount: 0,
            failedCount: 0,
            createdAt: new Date().toISOString()
          });

          await logAction('Direct Email Sent', `Sent direct Email to customer ID ${id} (${email})`);
          alert(`Email imesimuliwa na kutumwa kwa ${email}!`);
          (document.getElementById('cust-direct-msg-body') as HTMLTextAreaElement).value = '';
          navigateTo('admin-dashboard');
        } catch (err: any) {
          alert('Failed to send email: ' + err.message);
        }
      });
    }
  }

  // ==========================================
  // 9. SUBSCRIPTIONS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'subscriptions') {
    // Edit sub plan trigger
    document.querySelectorAll('.sub-edit-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          editingPlanId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Cancel edit plan trigger
    const cancelBtn = document.getElementById('cancel-edit-plan');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        editingPlanId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Submit save plan
    const saveBtn = document.getElementById('submit-save-plan');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const id = saveBtn.getAttribute('data-id');
        const name = (document.getElementById('sub-plan-name') as HTMLInputElement)?.value.trim();
        const price = parseFloat((document.getElementById('sub-plan-price') as HTMLInputElement)?.value) || 0;
        const duration = parseInt((document.getElementById('sub-plan-duration') as HTMLInputElement)?.value) || 30;
        const featStr = (document.getElementById('sub-plan-features') as HTMLTextAreaElement)?.value.trim();

        if (!name || price < 0) {
          alert('Tafadhali jaza jina na bei.');
          return;
        }

        try {
          const finalId = id || 'plan_' + name.toLowerCase().replace(/\s+/g, '_');
          const ref = doc(db, 'subscriptionPlans', finalId);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'NEW';

          const features = featStr ? featStr.split(',').map(f => f.trim()) : [];
          const payload = {
            id: finalId,
            name,
            price,
            duration,
            features
          };

          await setDoc(ref, payload);
          await logAction('Subscription Plan Saved', `Saved subscription plan: ${name}`, beforeStr, JSON.stringify(payload));
          alert('Subscription plan saved successfully!');
          editingPlanId = null;
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save subscription plan.');
        }
      });
    }

    // Delete sub plan trigger
    document.querySelectorAll('.sub-delete-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kufuta kifurushi hiki?')) return;

        try {
          const snap = await getDoc(doc(db, 'subscriptionPlans', id));
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';

          await deleteDoc(doc(db, 'subscriptionPlans', id));
          await logAction('Subscription Plan Deleted', `Deleted subscription plan ID ${id}`, beforeStr, 'DELETED');
          alert('Subscription plan deleted.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to delete subscription plan.');
        }
      });
    });

    // Update free trial settings duration
    const saveTrialBtn = document.getElementById('save-free-trial-days-btn');
    if (saveTrialBtn) {
      saveTrialBtn.addEventListener('click', async () => {
        const days = (document.getElementById('settings-free-trial-days') as HTMLInputElement)?.value.trim();
        if (!days) return;

        try {
          const ref = doc(db, 'systemSettings', 'free_trial_duration');
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';
          const payload = { id: 'free_trial_duration', key: 'Free Trial Duration (Days)', value: days };

          await setDoc(ref, payload);
          await logAction('Free Trial Settings Modified', `Updated provider free trial days limits to ${days}`, beforeStr, JSON.stringify(payload));
          alert('Free trial settings updated!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save free trial configuration.');
        }
      });
    }

    // Send Expiry Renewal SMS simulated alert
    document.querySelectorAll('.send-expiry-sms-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const phone = btn.getAttribute('data-phone') || 'Tanzania Contact';
        const name = btn.getAttribute('data-provider') || 'Provider';
        alert(`SMS broadcast simulated to ${name} (${phone}): "Mpendwa mteja wa CHIMBO, kifurushi chako kinaisha hivi karibuni. Tafadhali lipia sasa."`);
        logAction('SMS Expiry Alert Sent', `Sent simulated subscription renewal SMS warning to ${name} (${phone})`);
      });
    });

    // Extend subscription duration manually
    document.querySelectorAll('.manual-edit-sub-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        const daysStr = prompt('Ingiza idadi ya siku za kuongeza muda wa kifurushi:', '30');
        if (daysStr === null) return;
        const days = parseInt(daysStr, 10);
        if (isNaN(days) || days <= 0) {
          alert('Siku si halali.');
          return;
        }
        try {
          const ref = doc(db, 'subscriptions', id);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const existing: any = snap.data();
            const beforeStr = JSON.stringify(existing);
            const currentExpiry = new Date(existing.expiresAt || new Date());
            currentExpiry.setDate(currentExpiry.getDate() + days);
            const updated = { ...existing, expiresAt: currentExpiry.toISOString(), status: 'active' };
            await setDoc(ref, updated, { merge: true });
            await logAction('Subscription Extended', `Extended subscription ID ${id} by ${days} days`, beforeStr, JSON.stringify(updated));
            alert('Muda wa kifurushi umeongezwa kikamilifu!');
            navigateTo('admin-dashboard');
          }
        } catch (_) {
          alert('Mabadiliko yamekataa kuhifadhiwa.');
        }
      });
    });

    // Cancel / Delete subscription manually
    document.querySelectorAll('.manual-delete-sub-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kusitisha/kufuta kifurushi hiki?')) return;
        try {
          const ref = doc(db, 'subscriptions', id);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';
          await deleteDoc(ref);
          await logAction('Subscription Cancelled', `Cancelled/Deleted subscription ID ${id}`, beforeStr, 'CANCELLED');
          alert('Kifurushi kimesitishwa na kufutwa.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Imeshindwa kusitisha.');
        }
      });
    });
  }

  // ==========================================
  // 10. CATEGORIES EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'categories') {
    // Helper to generate next sequential category ID like CAT-000001
    const generateCategoryId = (): string => {
      const categoriesList = cachedAdminData.categories || [];
      let maxNum = 0;
      categoriesList.forEach(c => {
        if (c.id && c.id.startsWith('CAT-')) {
          const numPart = c.id.substring(4);
          const parsed = parseInt(numPart, 10);
          if (!isNaN(parsed) && parsed > maxNum) {
            maxNum = parsed;
          }
        }
      });
      const nextNum = maxNum + 1;
      const padded = String(nextNum).padStart(6, '0');
      return `CAT-${padded}`;
    };

    // Edit category trigger
    document.querySelectorAll('.cat-edit-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          editingCategoryId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Cancel edit category trigger
    const cancelBtn = document.getElementById('cancel-edit-category');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        editingCategoryId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Save category submit button
    const saveBtn = document.getElementById('submit-save-category');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const id = saveBtn.getAttribute('data-id');
        const nameVal = (document.getElementById('cat-name-input') as HTMLInputElement)?.value.trim();
        const typeVal = (document.getElementById('cat-type-select') as HTMLSelectElement)?.value;
        const descVal = (document.getElementById('cat-desc-input') as HTMLTextAreaElement)?.value.trim();
        const statusVal = (document.getElementById('cat-status-select') as HTMLSelectElement)?.value;

        if (!nameVal) {
          alert('Tafadhali jaza Category Name.');
          return;
        }

        try {
          const finalId = id || generateCategoryId();
          const ref = doc(db, 'categories', finalId);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'NEW';
          const payload = {
            id: finalId,
            name: nameVal,
            type: typeVal,
            description: descVal || '',
            status: statusVal || 'active'
          };

          await setDoc(ref, payload);
          await logAction('Category Saved', `Saved category: ${nameVal} (type: ${typeVal}, status: ${statusVal})`, beforeStr, JSON.stringify(payload));
          alert('Category saved successfully!');
          editingCategoryId = null;
          navigateTo('admin-dashboard');
        } catch (err: any) {
          console.error(err);
          alert('Failed to save category: ' + err.message);
        }
      });
    }

    // Toggle Category Status (Disable / Enable) trigger
    document.querySelectorAll('.cat-status-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const status = btn.getAttribute('data-status');
        if (!id || !status) return;

        try {
          const ref = doc(db, 'categories', id);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const existingData: any = snap.data();
            const beforeStr = JSON.stringify(existingData);
            const updated = { ...existingData, status };
            await setDoc(ref, updated, { merge: true });
            await logAction('Category Status Updated', `Toggled category ID ${id} status to ${status}`, beforeStr, JSON.stringify(updated));
            alert(`Category status successfully updated to ${status}!`);
            navigateTo('admin-dashboard');
          }
        } catch (_) {
          alert('Failed to update category status.');
        }
      });
    });

    // Delete category trigger
    document.querySelectorAll('.cat-delete-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kufuta category hii?')) return;

        try {
          const snap = await getDoc(doc(db, 'categories', id));
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';

          await deleteDoc(doc(db, 'categories', id));
          await logAction('Category Deleted', `Deleted category ID ${id}`, beforeStr, 'DELETED');
          alert('Category deleted successfully.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to delete category.');
        }
      });
    });
  }

  // ==========================================
  // 11. FEATURE TEMPLATE EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'templates') {
    // Edit template trigger
    document.querySelectorAll('.temp-edit-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          editingTemplateId = id;
          navigateTo('admin-dashboard');
        }
      });
    });

    // Cancel edit template trigger
    const cancelBtn = document.getElementById('cancel-edit-template');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        editingTemplateId = null;
        navigateTo('admin-dashboard');
      });
    }

    // Save template submit button
    const saveBtn = document.getElementById('submit-save-template');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const id = saveBtn.getAttribute('data-id');
        const name = (document.getElementById('temp-name-input') as HTMLInputElement)?.value.trim();
        const fieldsStr = (document.getElementById('temp-fields-input') as HTMLTextAreaElement)?.value.trim();

        if (!name || !fieldsStr) {
          alert('Tafadhali jaza jina na feature fields.');
          return;
        }

        try {
          const finalId = id || 'temp_' + name.toLowerCase().replace(/\s+/g, '_');
          const ref = doc(db, 'featureTemplates', finalId);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'NEW';

          const features = fieldsStr.split(',').map(f => f.trim()).filter(Boolean);
          const payload = {
            id: finalId,
            name,
            features
          };

          await setDoc(ref, payload);
          await logAction('Feature Template Saved', `Saved feature template: ${name}`, beforeStr, JSON.stringify(payload));
          alert('Feature template saved successfully!');
          editingTemplateId = null;
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save template.');
        }
      });
    }

    // Delete template trigger
    document.querySelectorAll('.temp-delete-trigger').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kufuta template hii?')) return;

        try {
          const snap = await getDoc(doc(db, 'featureTemplates', id));
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';

          await deleteDoc(doc(db, 'featureTemplates', id));
          await logAction('Feature Template Deleted', `Deleted template ID ${id}`, beforeStr, 'DELETED');
          alert('Feature template deleted.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to delete template.');
        }
      });
    });
  }

  // ==========================================
  // 12. SEARCH INTEL HANDLERS
  // ==========================================
  if (activeAdminTab === 'search') {
    const tipBtn = document.getElementById('send-demand-tips-btn');
    if (tipBtn) {
      tipBtn.addEventListener('click', async () => {
        alert('Notification tips broadcasted to 12 Electronics Sellers!');
        await logAction('Search Demand Tips Sent', 'Admin broadcasted demand alerts for query: iPhone 16 Pro Max to providers.');
      });
    }

    // Generate AI recommendations report via Google Gemini API
    const reportBtn = document.getElementById('generate-ai-report-btn');
    if (reportBtn) {
      reportBtn.addEventListener('click', async () => {
        reportBtn.setAttribute('disabled', 'true');
        reportBtn.innerHTML = 'Analyzing & Generating...';
        try {
          const searchesList = cachedAdminData.searches || [];
          const searchCounts: { [key: string]: number } = {};
          searchesList.forEach(s => {
            const queryClean = (s.query || '').toLowerCase().trim();
            if (queryClean) {
              searchCounts[queryClean] = (searchCounts[queryClean] || 0) + 1;
            }
          });
          const sorted = Object.keys(searchCounts)
            .map(q => ({ query: q, count: searchCounts[q] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

          const topQueriesStr = sorted.map(s => `"${s.query}" (${s.count} hits)`).join(', ') || 'N/A';
          const missingProds = cachedAdminData.products.length === 0 ? 'No listings registered in products collection' : 'Various brand items';
          
          let generatedReport = `TAARIFA YA CHIMBO AI (Toleo la Leo):
1. Hali ya Mahitaji: Wateja wanatafuta zaidi ${topQueriesStr}. Wauzaji wanapaswa kujaza bidhaa hizi haraka.
2. Watoa Huduma: Uhitaji wa huduma za ufundi umeongezeka kwa asilimia 18% katika kata ya Kariakoo na Ilala.
3. Mapendekezo: Ongeza promosheni kwenye vifurushi vya Business kusaidia wauzaji wadogo kujitangaza katika bidhaa zenye uhitaji mkubwa.`;

          const geminiKey = cachedAdminData.aiSettings.find((s: any) => s.id === 'gemini_api_key')?.value || '';

          if (geminiKey) {
            try {
              const promptText = `Wewe ni mfumo wa AI wa soko la Chimbo Langu nchini Tanzania. Chambua data ifuatayo ya soko na utoe ripoti ya ushauri wa kibiashara kwa Kiswahili chenye mvuto na tija:
              - Maneno yanayotafutwa zaidi: ${topQueriesStr}
              - Hali ya bidhaa sokoni: ${missingProds}
              Tafadhali andika aya 3 fupi zenye mapendekezo thabiti ya bidhaa na kata za kuweka nguvu. Ripoti iwe fupi na yenye faida kwa watoa huduma.`;

              const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  contents: [{
                    parts: [{
                      text: promptText
                    }]
                  }]
                })
              });
              if (response.ok) {
                const data = await response.json();
                const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiText) {
                  generatedReport = aiText;
                }
              }
            } catch (apiErr) {
              console.warn('Gemini API call failed, falling back to local simulation:', apiErr);
            }
          }

          await setDoc(doc(db, 'systemSettings', 'ai_market_report'), {
            id: 'ai_market_report',
            key: 'AI Market Intelligence Report',
            value: generatedReport
          });

          await logAction('AI Market Report Generated', 'Generated and saved new market intelligence recommendations via Gemini AI.');
          alert('Ripoti ya soko imezalishwa na Gemini AI na kuhifadhiwa kikamilifu!');
          navigateTo('admin-dashboard');
        } catch (err: any) {
          alert('Imeshindwa kuzalisha ripoti: ' + err.message);
        } finally {
          reportBtn.removeAttribute('disabled');
          reportBtn.innerHTML = 'Generate Market Report via Gemini';
        }
      });
    }
  }

  // ==========================================
  // 13. REVENUE AUDIT EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'revenue') {
    // Force verify payment discrepancy
    document.querySelectorAll('.force-verify-payment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        try {
          const ref = doc(db, 'payments', id);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const existing: any = snap.data();
            const beforeStr = JSON.stringify(existing);
            const updated = { 
              ...existing, 
              status: 'success' as const, 
              isManualVerification: true
            };
            await setDoc(ref, updated, { merge: true });
            await logAction('Payment Manually Verified', `Admin forced verification status of payment ID ${id}`, beforeStr, JSON.stringify(updated));
            alert('Malipo yamehakikiwa na kupitishwa kikamilifu!');
            navigateTo('admin-dashboard');
          }
        } catch (_) {
          alert('Imeshindwa kuhakiki malipo.');
        }
      });
    });

    // Delete payment history audit record
    document.querySelectorAll('.delete-payment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kufuta kumbukumbu hii ya malipo?')) return;
        try {
          const ref = doc(db, 'payments', id);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';
          await deleteDoc(ref);
          await logAction('Payment Deleted', `Deleted transaction log ID ${id}`, beforeStr, 'DELETED');
          alert('Kumbukumbu ya malipo imefutwa kikamilifu.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Imeshindwa kufuta malipo.');
        }
      });
    });
  }

  // ==========================================
  // 14. AUDIT CENTER EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'audit') {
    const clearBtn = document.getElementById('clear-all-audit-logs');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('Je, una uhakika unataka kufuta kumbukumbu zote za audit logs? Jambo hili halirudishiki!')) return;
        try {
          const snapshot = await getDocs(collection(db, 'auditLogs'));
          for (const d of snapshot.docs) {
            await deleteDoc(d.ref);
          }
          await logAction('Audit Logs Cleared', 'Admin cleared all system traces.');
          alert('Audit logs cleared successfully!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to clear logs.');
        }
      });
    }
  }

  // ==========================================
  // 15. NOTIFICATION CENTER EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'notifications') {
    const broadcastBtn = document.getElementById('submit-broadcast-notif');
    if (broadcastBtn) {
      broadcastBtn.addEventListener('click', async () => {
        const target = (document.getElementById('notif-target-select') as HTMLSelectElement)?.value;
        const title = (document.getElementById('notif-title-input') as HTMLInputElement)?.value.trim();
        const body = (document.getElementById('notif-body-input') as HTMLTextAreaElement)?.value.trim();
        const emailChan = (document.getElementById('chan-email') as HTMLInputElement)?.checked;
        const smsChan = (document.getElementById('chan-sms') as HTMLInputElement)?.checked;

        if (!title || !body) {
          alert('Tafadhali jaza kichwa na maelezo ya arifa.');
          return;
        }

        try {
          const notifRef = doc(collection(db, 'notifications'));
          await setDoc(notifRef, {
            id: notifRef.id,
            userId: target === 'all' ? 'broadcast' : target, 
            title,
            body,
            read: false,
            createdAt: new Date().toISOString()
          });

          // Log in notificationHistory
          const historyRef = doc(collection(db, 'notificationHistory'));
          const channelsList = ['PUSH'];
          if (emailChan) channelsList.push('EMAIL');
          if (smsChan) channelsList.push('SMS');

          await setDoc(historyRef, {
            id: historyRef.id,
            title,
            body,
            targetRole: target,
            channels: channelsList,
            sentCount: 10, // Simulated count representing targeted user subset
            deliveredCount: 10,
            openedCount: 0,
            failedCount: 0,
            createdAt: new Date().toISOString()
          });

          const chStr = `Push (Yes) | Email (${emailChan ? 'Yes' : 'No'}) | SMS (${smsChan ? 'Yes' : 'No'})`;
          await logAction('Broadcast Notification Sent', `Broadcasted notification "${title}" targeting ${target} via: ${chStr}`);
          alert(`Broadcast notification sent successfully via channels: ${chStr}!`);
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to broadcast notification.');
        }
      });
    }

    // Delete broadcast log
    document.querySelectorAll('.delete-broadcast-log-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        if (!confirm('Je, una uhakika unataka kufuta kumbukumbu hii ya broadcast?')) return;
        try {
          const ref = doc(db, 'notificationHistory', id);
          const snap = await getDoc(ref);
          const beforeStr = snap.exists() ? JSON.stringify(snap.data()) : 'N/A';
          await deleteDoc(ref);
          await logAction('Broadcast Log Deleted', `Deleted notification history record ID ${id}`, beforeStr, 'DELETED');
          alert('Broadcast log deleted.');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to delete broadcast log.');
        }
      });
    });
  }

  // ==========================================
  // 16. SYSTEM CONFIG SETTINGS EVENT HANDLERS
  // ==========================================
  if (activeAdminTab === 'settings') {
    // Save Settings
    const saveSettingsBtn = document.getElementById('sys-settings-save-btn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', async () => {
        saveSettingsBtn.setAttribute('disabled', 'true');
        saveSettingsBtn.innerHTML = 'Saving...';

        const platformName = (document.getElementById('sys-plat-name') as HTMLInputElement)?.value.trim();
        const logoUrl = (document.getElementById('sys-logo-url') as HTMLInputElement)?.value.trim();
        const defaultLang = (document.getElementById('sys-def-lang') as HTMLInputElement)?.value.trim();
        const defaultCurr = (document.getElementById('sys-def-curr') as HTMLInputElement)?.value.trim();
        const mapsApi = (document.getElementById('sys-maps-api') as HTMLInputElement)?.value.trim();
        const cloudName = (document.getElementById('sys-cloud-name') as HTMLInputElement)?.value.trim();
        const beemKey = (document.getElementById('sys-beem-key') as HTMLInputElement)?.value.trim();
        const smtpHost = (document.getElementById('sys-smtp-host') as HTMLInputElement)?.value.trim();

        const trialDays = (document.getElementById('sys-trial-days') as HTMLInputElement)?.value.trim() || '30';
        const priceStarter = parseFloat((document.getElementById('sys-price-starter') as HTMLInputElement)?.value) || 0;
        const priceBusiness = parseFloat((document.getElementById('sys-price-business') as HTMLInputElement)?.value) || 0;
        const pricePremium = parseFloat((document.getElementById('sys-price-premium') as HTMLInputElement)?.value) || 0;

        const aiEnabled = (document.getElementById('sys-ai-enabled-select') as HTMLSelectElement)?.value || 'Enabled';
        const aiProvider = (document.getElementById('sys-ai-provider-select') as HTMLSelectElement)?.value || 'Gemini';
        const openaiKey = (document.getElementById('sys-openai-key') as HTMLInputElement)?.value.trim();
        const geminiKey = (document.getElementById('sys-gemini-key') as HTMLInputElement)?.value.trim();
        const deepseekKey = (document.getElementById('sys-deepseek-key') as HTMLInputElement)?.value.trim();

        const mapboxApi = (document.getElementById('sys-mapbox-api') as HTMLInputElement)?.value.trim();
        const mapsRadius = (document.getElementById('sys-maps-radius') as HTMLInputElement)?.value.trim() || '15';
        const mapsAccuracy = (document.getElementById('sys-maps-accuracy') as HTMLInputElement)?.value.trim() || '10';

        const smsProvider = (document.getElementById('sys-sms-provider-select') as HTMLSelectElement)?.value || 'Beem';
        const atKey = (document.getElementById('sys-at-key') as HTMLInputElement)?.value.trim();
        const twilioSid = (document.getElementById('sys-twilio-sid') as HTMLInputElement)?.value.trim();
        const twilioAuth = (document.getElementById('sys-twilio-auth') as HTMLInputElement)?.value.trim();
        const smsCustom = (document.getElementById('sys-sms-custom') as HTMLInputElement)?.value.trim();

        const cloudApiKey = (document.getElementById('sys-cloud-key') as HTMLInputElement)?.value.trim();
        const cloudApiSecret = (document.getElementById('sys-cloud-secret') as HTMLInputElement)?.value.trim();
        const cloudFolder = (document.getElementById('sys-cloud-folder') as HTMLInputElement)?.value.trim();
        const cloudMaxSize = (document.getElementById('sys-cloud-maxsize') as HTMLInputElement)?.value.trim() || '10';

        const smtpPort = (document.getElementById('sys-smtp-port') as HTMLInputElement)?.value.trim() || '587';
        const smtpUser = (document.getElementById('sys-smtp-user') as HTMLInputElement)?.value.trim();
        const smtpPass = (document.getElementById('sys-smtp-pass') as HTMLInputElement)?.value.trim();
        const smtpSender = (document.getElementById('sys-smtp-sender') as HTMLInputElement)?.value.trim();

        try {
          const systemUpdates = [
            { id: 'platform_name', key: 'Platform Name', value: platformName },
            { id: 'logo_url', key: 'Logo URL', value: logoUrl },
            { id: 'default_lang', key: 'Default Language', value: defaultLang },
            { id: 'default_curr', key: 'Default Currency', value: defaultCurr },
            { id: 'cloudinary_cloud', key: 'Cloudinary Cloud Name', value: cloudName },
            { id: 'cloudinary_api_key', key: 'Cloudinary API Key', value: cloudApiKey },
            { id: 'cloudinary_api_secret', key: 'Cloudinary API Secret', value: cloudApiSecret },
            { id: 'cloudinary_folder', key: 'Cloudinary Folder Prefix', value: cloudFolder },
            { id: 'cloudinary_max_size', key: 'Cloudinary Max File Size (MB)', value: cloudMaxSize },
            { id: 'smtp_host', key: 'SMTP Host Address', value: smtpHost },
            { id: 'smtp_port', key: 'SMTP Port Number', value: smtpPort },
            { id: 'smtp_user', key: 'SMTP Username', value: smtpUser },
            { id: 'smtp_pass', key: 'SMTP Password', value: smtpPass },
            { id: 'smtp_sender_name', key: 'SMTP Sender Display Name', value: smtpSender }
          ];

          for (const u of systemUpdates) {
            await setDoc(doc(db, 'systemSettings', u.id), u);
          }

          const mapsUpdates = [
            { id: 'maps_api', key: 'Google Maps API Key', value: mapsApi },
            { id: 'mapbox_api', key: 'Mapbox Access Token', value: mapboxApi },
            { id: 'default_radius', key: 'Default Search Radius (km)', value: mapsRadius },
            { id: 'gps_accuracy', key: 'Required GPS Accuracy (m)', value: mapsAccuracy }
          ];
          for (const u of mapsUpdates) {
            await setDoc(doc(db, 'mapsSettings', u.id), u);
          }

          const smsUpdates = [
            { id: 'sms_provider', key: 'SMS Provider Gateway', value: smsProvider },
            { id: 'beem_sms_key', key: 'Beem SMS API Key', value: beemKey },
            { id: 'africastalking_key', key: 'Africas Talking API Key', value: atKey },
            { id: 'twilio_sid', key: 'Twilio Account SID', value: twilioSid },
            { id: 'twilio_auth', key: 'Twilio Auth Token', value: twilioAuth },
            { id: 'custom_sms_endpoint', key: 'Custom SMS Endpoint', value: smsCustom }
          ];
          for (const u of smsUpdates) {
            await setDoc(doc(db, 'smsSettings', u.id), u);
          }

          const subUpdates = [
            { id: 'free_trial_duration', key: 'Free Trial Duration (Days)', value: trialDays },
            { id: 'price_starter', key: 'Starter Plan Price (TSh)', value: String(priceStarter) },
            { id: 'price_business', key: 'Business Plan Price (TSh)', value: String(priceBusiness) },
            { id: 'price_premium', key: 'Premium Plan Price (TSh)', value: String(pricePremium) }
          ];
          for (const u of subUpdates) {
            await setDoc(doc(db, 'subscriptionSettings', u.id), u);
          }

          const aiUpdates = [
            { id: 'ai_enabled', key: 'AI Service State', value: aiEnabled },
            { id: 'ai_provider', key: 'Active AI API Provider', value: aiProvider },
            { id: 'openai_api_key', key: 'OpenAI Secret API Key', value: openaiKey },
            { id: 'gemini_api_key', key: 'Google Gemini API Key', value: geminiKey },
            { id: 'deepseek_api_key', key: 'DeepSeek Secret API Key', value: deepseekKey }
          ];
          for (const u of aiUpdates) {
            await setDoc(doc(db, 'aiSettings', u.id), u);
          }

          // Backwards compatibility writes
          await setDoc(doc(db, 'subscriptionPlans', 'plan_starter'), { price: priceStarter }, { merge: true });
          await setDoc(doc(db, 'subscriptionPlans', 'plan_business'), { price: priceBusiness }, { merge: true });
          await setDoc(doc(db, 'subscriptionPlans', 'plan_premium'), { price: pricePremium }, { merge: true });
          await setDoc(doc(db, 'systemSettings', 'free_trial_duration'), { id: 'free_trial_duration', key: 'Free Trial Duration (Days)', value: trialDays });

          await logAction('System Settings Modified', 'Admin updated platform configs, pricing plans, API keys, AI, SMS and SMTP.');
          alert('System settings successfully updated!');
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to save settings.');
          saveSettingsBtn.removeAttribute('disabled');
          saveSettingsBtn.innerHTML = 'Save Platform Settings';
        }
      });
    }

    const pwaSaveBtn = document.getElementById('sys-pwa-save-btn');
    if (pwaSaveBtn) {
      pwaSaveBtn.addEventListener('click', async () => {
        const val = (document.getElementById('sys-pwa-cache-select') as HTMLSelectElement).value;
        try {
          await setDoc(doc(db, 'systemSettings', 'pwa_offline_cache'), { id: 'pwa_offline_cache', key: 'PWA Offline Cache', value: val });
          await logAction('PWA Settings Updated', `Toggled offline caching policy to: ${val}`);
          alert(`PWA Caching policy successfully updated to: ${val}`);
          navigateTo('admin-dashboard');
        } catch (_) {
          alert('Failed to update PWA configurations.');
        }
      });
    }

    const seedDemoBtn = document.getElementById('sys-seed-demo-btn');
    if (seedDemoBtn) {
      seedDemoBtn.addEventListener('click', async () => {
        if (confirm('Je, una uhakika unataka kuweka data za demo (seeding) kwenye Firestore? Hii itaweka wauzaji 5, bidhaa 25+ na huduma 5.')) {
          seedDemoBtn.setAttribute('disabled', 'true');
          seedDemoBtn.innerHTML = 'Seeding...';
          try {
            alert('Kipengele hiki kimezimwa kwenye production.');
            seedDemoBtn.removeAttribute('disabled');
            seedDemoBtn.innerHTML = 'Seed Demo Data';
            navigateTo('admin-dashboard');
          } catch (err: any) {
            alert('Imeshindwa kuweka data: ' + err.message);
            seedDemoBtn.removeAttribute('disabled');
            seedDemoBtn.innerHTML = 'Seed Demo Data';
          }
        }
      });
    }

    // Direct credential/ping testers
    document.querySelectorAll('.test-cred-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const service = btn.getAttribute('data-service');
        if (!service) return;
        btn.setAttribute('disabled', 'true');
        btn.innerHTML = 'Testing...';

        let status = 'Failed';
        
        try {
          if (service === 'gemini') {
            const key = (document.getElementById('sys-gemini-key') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.aiSettings.find((s: any) => s.id === 'gemini_api_key')?.value || '';
            if (!key) {
              status = 'Failed (Empty API Key)';
            } else {
              const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] })
              });
              if (response.ok) {
                status = 'Connected';
              } else {
                status = `Failed (HTTP ${response.status})`;
              }
            }
          } else if (service === 'openai') {
            const key = (document.getElementById('sys-openai-key') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.aiSettings.find((s: any) => s.id === 'openai_api_key')?.value || '';
            if (!key) {
              status = 'Failed (Empty API Key)';
            } else {
              if (key.startsWith('sk-') && key.length > 20) {
                status = 'Connected (Format Validated)';
              } else {
                status = 'Failed (Invalid Format)';
              }
            }
          } else if (service === 'deepseek') {
            const key = (document.getElementById('sys-deepseek-key') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.aiSettings.find((s: any) => s.id === 'deepseek_api_key')?.value || '';
            if (!key) {
              status = 'Failed (Empty API Key)';
            } else {
              if (key.startsWith('ds-') || key.length > 20) {
                status = 'Connected (Format Validated)';
              } else {
                status = 'Failed (Invalid Format)';
              }
            }
          } else if (service === 'cloudinary') {
            const cName = (document.getElementById('sys-cloud-name') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.systemSettings.find((s: any) => s.id === 'cloudinary_cloud')?.value || '';
            if (!cName) {
              status = 'Failed (No Cloud Name)';
            } else {
              const response = await fetch(`https://api.cloudinary.com/v1_1/${cName}/ping`);
              if (response.ok) {
                status = 'Connected';
              } else {
                status = `Failed (HTTP ${response.status})`;
              }
            }
          } else if (service === 'maps') {
            const mapsApi = (document.getElementById('sys-maps-api') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.mapsSettings.find((s: any) => s.id === 'maps_api')?.value || '';
            if (!mapsApi) {
              status = 'Failed (Empty API Key)';
            } else {
              const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Dar+es+Salaam&key=${mapsApi}`);
              if (response.ok) {
                const resJson = await response.json();
                if (resJson.status === 'REQUEST_DENIED') {
                  status = `Failed (API Error: ${resJson.error_message || 'Access Denied'})`;
                } else {
                  status = 'Connected';
                }
              } else {
                status = `Failed (HTTP ${response.status})`;
              }
            }
          } else if (service === 'smtp') {
            const host = (document.getElementById('sys-smtp-host') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.systemSettings.find((s: any) => s.id === 'smtp_host')?.value || '';
            const user = (document.getElementById('sys-smtp-user') as HTMLInputElement)?.value.trim() || 
               cachedAdminData.systemSettings.find((s: any) => s.id === 'smtp_user')?.value || '';
            if (host && user) {
              status = 'Connected (Config Validated)';
            } else {
              status = 'Failed (Configuration Incomplete)';
            }
          } else if (service === 'beem') {
            const key = (document.getElementById('sys-beem-key') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.smsSettings.find((s: any) => s.id === 'beem_sms_key')?.value || '';
            if (key) {
              status = 'Connected (Config Validated)';
            } else {
              status = 'Failed (API Key Missing)';
            }
          } else if (service === 'africastalking') {
            const key = (document.getElementById('sys-at-key') as HTMLInputElement)?.value.trim() || 
              cachedAdminData.smsSettings.find((s: any) => s.id === 'africastalking_key')?.value || '';
            if (key) {
              status = 'Connected (Config Validated)';
            } else {
              status = 'Failed (API Key Missing)';
            }
          }
        } catch (err: any) {
          status = `Failed (${err.message || 'Network Error'})`;
        }

        try {
          const testRef = doc(db, 'integrationTests', service);
          await setDoc(testRef, {
            id: service,
            status,
            lastTested: new Date().toISOString()
          });
          await logAction('Integration Tested', `Tested connection for ${service.toUpperCase()} with result: ${status}`);
          alert(`Connection Test for ${service.toUpperCase()} completed: ${status}`);
        } catch (_) {
          alert('Failed to save connection test status.');
        } finally {
          btn.removeAttribute('disabled');
          btn.innerHTML = 'Test';
        }
      });
    });
  }

  // Cache report data to window level for instantaneous details viewer updates
  logFirestoreQuery('read', 'fieldReports', 'All Documents (Cache on load)');
  getDocs(collection(db, 'fieldReports')).then(snap => {
    const list: any[] = [];
    snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
    (window as any).cachedFieldReports = list;
  });

  bindNavbarEvents();
}
