import { state, navigateTo } from '../appState';
import { db, auth } from '../firebase';
import { collection, setDoc, getDocs, doc, deleteDoc, query, where, getDoc } from 'firebase/firestore';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { logAction } from '../services/audit';
import { uploadFileToCloudinary } from '../services/cloudinaryService';

// Module-level persistent cache for selected files in SPA
const selectedFiles = new Map<string, File>();

// Module-level persistent state for the SPA
let activeTab: 'products' | 'services' | 'verification' | 'subscription' | 'settings' = 'verification';
let verifWizardStep = 1;

// Product Form state
let productFormMode: 'list' | 'add' | 'edit' = 'list';
let editingProduct: any = null;

// Service Form state
let serviceFormMode: 'list' | 'add' | 'edit' = 'list';
let editingService: any = null;

export async function renderProviderDashboardView(): Promise<string> {
  const user = state.currentUser;
  if (!user) return '<div class="stitch-flex stitch-justify-center stitch-align-center" style="padding: var(--spacing-lg); color: var(--color-outline);">Tafadhali ingia kwenye mfumo kwanza.</div>';

  const provRef = doc(db, 'providers', user.uid);
  let activeProvider: any = null;
  try {
    const provSnap = await getDoc(provRef);
    activeProvider = provSnap.exists() ? provSnap.data() : null;
  } catch (err) {
    console.error('Error fetching provider in guard:', err);
  }

  const role = state.userProfile?.role || 'customer';
  const isSystemStaff = role === 'admin' || role === 'superadmin' || role === 'staff';

  if (!isSystemStaff) {
    const status = activeProvider?.status || activeProvider?.providerStatus || 'not_registered';
    
    if (status !== 'approved') {
      return `
        <header class="stitch-header glass-card">
          <div class="stitch-header-content" style="justify-content: center;">
            <h1 class="stitch-title-medium" style="font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 15px; color: var(--color-error);">Portal Imefungwa / Locked</h1>
          </div>
        </header>
        
        <main class="stitch-main animate-fade-in" style="padding-top: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: var(--spacing-md); padding: 24px; font-family: var(--font-sans);">
          <div class="stitch-flex stitch-justify-center stitch-align-center animate-pulse" style="width: 64px; height: 64px; border-radius: var(--radius-full); background: rgba(239, 68, 68, 0.08); color: var(--color-error); border: 1px solid rgba(239, 68, 68, 0.15);">
            <span class="material-symbols-outlined" style="font-size: 32px;">lock</span>
          </div>
          
          <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface); margin: 4px 0 0 0;">
            Portal ya Muuzaji Imefungwa
          </h2>
          <span style="font-size: 9px; color: var(--color-outline); font-weight: 800; text-transform: uppercase; margin-top: -4px;">Provider Portal is Locked</span>

          <p style="font-size: 11.5px; line-height: 1.45; color: var(--color-on-surface-variant); max-width: 280px; margin: 6px auto 0 auto;">
            Huwezi kufungua Provider Dashboard kwa sababu akaunti yako haijathibitishwa na Msimamizi au imesimamishwa. Hali ya sasa ya biashara yako ni: <strong style="color: var(--color-error); text-transform: uppercase;">${status}</strong>.
          </p>

          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 260px; margin-top: 12px;">
            ${status === 'not_registered' ? `
              <button onclick="window.appState.navigateTo('onboarding')" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 40px; border-radius: var(--radius-full); font-weight: 800; font-size: 12px;">
                <span>Anza Usajili wa Duka</span>
              </button>
            ` : `
              <button onclick="window.appState.navigateTo('onboarding')" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 40px; border-radius: var(--radius-full); font-weight: 800; font-size: 12px;">
                <span>Fuatilia Hali ya Ombi / Track Status</span>
              </button>
            `}
            <button onclick="window.appState.navigateTo('home')" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 40px; border-radius: var(--radius-full); font-weight: 800; font-size: 12px; background: white; border: 1.5px solid rgba(226, 232, 240, 0.8);">
              <span>Fungua Customer Portal</span>
            </button>
          </div>
        </main>
        ${renderGlobalNavbar('profile')}
      `;
    }
  }

  try {
    // --- Fetch Data ---
    // Providers Document
    // (Already fetched above)

    // Categories (Dynamic Categories)
    const categoriesSnap = await getDocs(collection(db, 'categories'));
    const categories: any[] = [];
    categoriesSnap.forEach(docSnap => {
      categories.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Subscription Plans (Dynamic Subscription Plans)
    const plansSnap = await getDocs(collection(db, 'subscriptionPlans'));
    const subscriptionPlans: any[] = [];
    plansSnap.forEach(docSnap => {
      subscriptionPlans.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Onboarding State Machine Sync
    if (activeProvider && !activeProvider.providerStatus) {
      await setDoc(provRef, {
        providerStatus: 'registered',
        verificationStatus: 'unverified',
        reviewStage: 'none'
      }, { merge: true });
    }

    const verificationStatus = activeProvider?.verificationStatus || 'unverified';
    const isApproved = verificationStatus === 'approved' || activeProvider?.status === 'approved';

    // Access Control Guard: Force unverified providers to the verification tab
    if (!isApproved && (activeTab === 'products' || activeTab === 'services')) {
      activeTab = 'verification';
    }

    // Subscription
    const subQ = query(collection(db, 'subscriptions'), where('providerId', '==', user.uid));
    const subSnapshot = await getDocs(subQ);
    let activeSub: any = null;
    subSnapshot.forEach(docSnap => {
      activeSub = { id: docSnap.id, ...docSnap.data() };
    });

    // Trial Subscription Logic & Expiry Guard
    let isTrialExpired = false;
    if (activeProvider?.trialExpiresAt) {
      const expiry = new Date(activeProvider.trialExpiresAt);
      if (new Date() > expiry) {
        isTrialExpired = true;
      }
    }

    const isSubscriptionActive = activeSub && activeSub.status === 'active' && new Date() <= new Date(activeSub.expiresAt);
    const isExpired = isTrialExpired && !isSubscriptionActive;

    // Products
    const prodQ = query(collection(db, 'products'), where('providerId', '==', user.uid));
    const prodSnapshot = await getDocs(prodQ);
    const products: any[] = [];
    prodSnapshot.forEach(docSnap => {
      products.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Product Images
    const imagesSnapshot = await getDocs(collection(db, 'productImages'));
    const allImages: any[] = [];
    imagesSnapshot.forEach(docSnap => {
      allImages.push(docSnap.data());
    });

    // Services
    const servQ = query(collection(db, 'services'), where('providerId', '==', user.uid));
    const servSnapshot = await getDocs(servQ);
    const services: any[] = [];
    servSnapshot.forEach(docSnap => {
      services.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Verification Documents
    const docQ = query(collection(db, 'verificationDocuments'), where('providerId', '==', user.uid));
    const docsSnapshot = await getDocs(docQ);
    const verificationDocs: any[] = [];
    docsSnapshot.forEach(docSnap => {
      verificationDocs.push({ id: docSnap.id, ...docSnap.data() });
    });

    // Subscription already fetched above

    // Access Tokens (Unlocks count)
    const tokenQ = query(collection(db, 'accessTokens'), where('providerId', '==', user.uid));
    const tokenSnapshot = await getDocs(tokenQ);
    const unlocksCount = tokenSnapshot.size;

    // Payments
    const payQ = query(collection(db, 'payments'), where('userId', '==', user.uid));
    const paySnapshot = await getDocs(payQ);
    const payments: any[] = [];
    paySnapshot.forEach(docSnap => {
      payments.push({ id: docSnap.id, ...docSnap.data() });
    });

    // --- Sub-View Layout Gen ---
    const tabActiveStyle = 'border-bottom: 2px solid var(--color-primary); color: var(--color-primary); font-weight: var(--font-weight-bold);';
    const tabInactiveStyle = 'color: var(--color-on-surface-variant); border-bottom: 2px solid transparent;';

    let subViewContent = '';

    if (activeTab === 'products') {
      if (productFormMode === 'list') {
        // --- Dashboard Main Summary & Charts ---
        const popularProds = [...products]
          .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
          .slice(0, 3);

        const popularProdsHtml = popularProds.length > 0
          ? popularProds.map(p => `
              <div class="stitch-flex stitch-justify-between stitch-align-center" style="font-size: 11px; padding: 4px 0; border-bottom: 1px dashed rgba(226, 232, 240, 0.5);">
                <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">${p.name}</span>
                <span style="color: var(--color-primary); font-weight: bold;">👁️ ${p.qualityScore || 0} views</span>
              </div>
            `).join('')
          : `<p class="stitch-body-xs" style="color: var(--color-outline);">Hakuna bidhaa za kuonyesha.</p>`;

        const productsHtml = products.length > 0 
          ? products.map(p => {
              const pImages = allImages.filter(img => img.productId === p.id);
              const frontImgObj = pImages.find(img => img.angle === 'front');
              const frontImg = frontImgObj?.imageUrl || 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=120';
              const stockQty = p.stockQuantity !== undefined ? parseInt(p.stockQuantity) : 10;
              const stockBadgeText = stockQty === 0 ? 'Out of Stock' : stockQty <= 10 ? 'Low Stock' : 'Stock Available';
              const stockBadgeColor = stockQty === 0 ? 'rgba(239, 68, 68, 0.1)' : stockQty <= 10 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)';
              const stockTextColor = stockQty === 0 ? 'var(--color-error)' : stockQty <= 10 ? 'var(--color-secondary)' : 'var(--color-secondary)';

              return `
                <div class="stitch-card-sm" style="padding: var(--spacing-sm); gap: var(--spacing-sm);">
                  <div class="stitch-flex" style="gap: var(--spacing-sm); width: 100%;">
                    <img src="${frontImg}" style="width: 60px; height: 60px; border-radius: var(--radius-md); object-fit: cover; background: #f1f5f9;" />
                    <div style="flex: 1; min-width: 0;">
                      <span class="stitch-badge stitch-badge-primary" style="font-size: 8px; text-transform: uppercase;">${p.category || 'General'}</span>
                      <h4 class="stitch-title-small" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;">${p.name}</h4>
                      <p class="stitch-body-xs" style="color: var(--color-primary); font-weight: bold; margin-top: 1px;">TSh ${p.price.toLocaleString()}</p>
                      <p class="stitch-body-xs" style="font-size: 9px; color: var(--color-outline);">Kiasi cha Stock: ${stockQty}</p>
                    </div>
                    <div class="stitch-flex stitch-flex-col stitch-align-end" style="gap: 4px; flex-shrink: 0;">
                      <span class="stitch-badge ${p.status === 'approved' ? 'stitch-badge-primary' : 'stitch-badge-secondary'}" style="font-size: 9px;">
                        ${p.status === 'approved' ? 'Imethibitishwa' : 'Uhakiki'}
                      </span>
                      <span class="stitch-badge" style="font-size: 8px; background-color: ${stockBadgeColor}; color: ${stockTextColor};">
                        ${stockBadgeText}
                      </span>
                    </div>
                  </div>
                  
                  <!-- Analytics Stats -->
                  <div class="stitch-flex stitch-justify-between" style="background: rgba(226, 232, 240, 0.2); padding: 4px 8px; border-radius: var(--radius-sm); width: 100%; font-size: 10px; color: var(--color-on-surface-variant);">
                    <span>👁️ Views: ${p.qualityScore || 0}</span>
                    <span>🔑 Unlocks: ${Math.floor((p.qualityScore || 0) / 4)}</span>
                    <span>📞 Calls: ${Math.floor((p.qualityScore || 0) / 10)}</span>
                  </div>

                  <div class="stitch-flex stitch-gap-xs" style="width: 100%; border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm);">
                    ${isExpired ? `
                      <button class="stitch-btn stitch-btn-flat" disabled style="flex: 1; height: 32px; font-size: 11px; border: 1px solid var(--color-outline-variant); cursor: not-allowed; opacity: 0.5; display: flex; align-items: center; justify-content: center; gap: 4px;">
                        <span class="material-symbols-outlined" style="font-size: 14px;">lock</span> Imefungwa (Locked)
                      </button>
                    ` : `
                      <button class="stitch-btn stitch-btn-flat edit-prod-btn" data-id="${p.id}" style="flex: 1; height: 32px; font-size: 11px; border: 1px solid var(--color-outline-variant);">
                        <span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">edit</span> Hariri (Edit)
                      </button>
                      <button class="stitch-btn stitch-btn-flat delete-prod-btn" data-id="${p.id}" style="width: 32px; height: 32px; padding: 0; background-color: var(--color-error-container); color: var(--color-error); border: none;">
                        <span class="material-symbols-outlined" style="font-size: 14px;">delete</span>
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join('')
          : `
            <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-xl) 0; border: 1px dashed rgba(226, 232, 240, 0.5); border-radius: var(--radius-lg); text-align: center; gap: var(--spacing-sm);">
              <span class="material-symbols-outlined" style="font-size: 36px; color: var(--color-outline-variant);">inventory_2</span>
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hujapandisha Bidhaa</h4>
              <p class="stitch-body-small">Zindua biashara kwa kuongeza bidhaa mpya.</p>
            </div>
          `;

        const totalViews = products.reduce((acc, curr) => acc + (curr.qualityScore || 0), 0);
        const trustScore = activeProvider?.trustScore || 65;
        const verifStatusText = activeProvider?.status === 'approved' ? 'Imethibitishwa (Approved)' : activeProvider?.status === 'rejected' ? 'Imekataliwa (Rejected)' : 'Inasubiri Uhakiki (Pending)';

        // Scale heights to percentages for the top 7 products by views
        const top7Products = [...products]
          .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
          .slice(0, 7);
        const maxViews = Math.max(...top7Products.map(p => p.qualityScore || 0), 10);
        const chartData = top7Products.map(p => {
          const views = p.qualityScore || 0;
          const heightPct = Math.min(Math.max((views / maxViews) * 100, 15), 100);
          return { name: p.name, views, heightPct };
        });
        while (chartData.length < 7) {
          chartData.push({ name: 'Hakuna', views: 0, heightPct: 15 });
        }

        const expiryBanner = isExpired ? `
          <div class="stitch-card" style="border: 2px solid var(--color-error); background-color: rgba(239, 68, 68, 0.05); padding: var(--spacing-md); text-align: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); width: 100%;">
            <span class="material-symbols-outlined" style="color: var(--color-error); font-size: 48px;">warning</span>
            <h3 class="stitch-title-medium" style="color: var(--color-error); font-size: 16px;">KIFURUSHI CHAKO KIMEISHA / SUBSCRIPTION EXPIRED</h3>
            <p class="stitch-body-small" style="line-height: 1.4; max-width: 400px; margin: 0 auto;">
              Muda wako wa majaribio ya bure au kifurushi chako kimeisha. Ili uweze kuendelea kuongeza na kuhariri bidhaa au huduma zako, tafadhali nenda kwenye sehemu ya **Usajili** ili kuchagua na kulipia kifurushi kipya.
            </p>
            <button id="go-to-sub-btn" class="stitch-btn stitch-btn-primary" style="margin: var(--spacing-xs) auto 0 auto; height: 36px; font-size: 11px;">
              Nenda Kwenye Usajili (Go to Subscription)
            </button>
          </div>
        ` : '';

        subViewContent = `
          ${expiryBanner}
          <!-- Dashboard Summary Metrics Cards -->
          <section class="stitch-grid-2" style="gap: var(--spacing-sm); margin-bottom: var(--spacing-sm);">
            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 24px;">inventory</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Bidhaa Zangu</span>
              <h2 class="stitch-title-large" style="font-size: 18px; margin-top: 2px;">${products.length}</h2>
            </div>
            
            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 24px;">design_services</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Huduma Zangu</span>
              <h2 class="stitch-title-large" style="font-size: 18px; margin-top: 2px;">${services.length}</h2>
            </div>

            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-secondary); font-size: 24px;">contact_page</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Wateja Waliofungua</span>
              <h2 class="stitch-title-large" style="font-size: 18px; margin-top: 2px; color: var(--color-secondary);">${unlocksCount}</h2>
            </div>

            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 24px;">search</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Jumla Views</span>
              <h2 class="stitch-title-large" style="font-size: 18px; margin-top: 2px;">${totalViews}</h2>
            </div>

            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-tertiary); font-size: 24px;">verified_user</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Trust Score</span>
              <h2 class="stitch-title-large" style="font-size: 18px; margin-top: 2px; color: var(--color-tertiary);">${trustScore}%</h2>
            </div>

            <div class="stitch-card-sm" style="padding: var(--spacing-sm); align-items: center; text-align: center; gap: 2px;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 24px;">card_membership</span>
              <span class="stitch-body-xs" style="font-size: 9px; font-weight: bold; text-transform: uppercase; color: var(--color-outline);">Kifurushi (Sub)</span>
              <h2 class="stitch-title-large" style="font-size: 12px; margin-top: 6px; text-transform: uppercase;">${activeSub?.plan || 'Starter (Trial)'}</h2>
            </div>
          </section>

          <!-- Verification status banner -->
          <div class="stitch-card-sm" style="flex-direction: row; justify-content: space-between; align-items: center; padding: var(--spacing-sm); background-color: rgba(79, 70, 229, 0.05); border: 1px solid rgba(79, 70, 229, 0.1); margin-bottom: var(--spacing-sm);">
            <div class="stitch-flex stitch-align-center" style="gap: 6px;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px;">gpp_maybe</span>
              <span class="stitch-body-xs" style="font-weight: bold; color: var(--color-on-surface);">Hali ya Uhakiki wa Biashara:</span>
            </div>
            <span class="stitch-badge stitch-badge-primary" style="font-size: 9px;">${verifStatusText}</span>
          </div>

          <!-- Weekly Chart visualization (Tactile UI) -->
          <div class="stitch-card" style="margin-bottom: var(--spacing-sm);">
            <div class="stitch-flex stitch-justify-between stitch-align-center" style="margin-bottom: var(--spacing-xs);">
              <h3 class="stitch-title-small" style="text-transform: uppercase; font-size: 11px;">Mwenendo wa Views za Bidhaa</h3>
              <span class="stitch-body-xs" style="color: var(--color-primary); font-weight: bold;">Jumla views: ${totalViews}</span>
            </div>
            <!-- Weekly interactive chart columns -->
            <div class="stitch-flex stitch-justify-between" style="height: 80px; gap: 8px; align-items: flex-end; padding-top: var(--spacing-xs);">
              ${chartData.map((data, i) => {
                const isPlaceholder = data.name === 'Hakuna';
                const labelName = data.name.substring(0, 8) + (data.name.length > 8 ? '..' : '');
                const isActiveLocal = i === 0 && data.views > 0;
                return `
                  <div class="stitch-flex stitch-flex-col stitch-align-center" style="flex: 1; gap: 4px; height: 100%; justify-content: flex-end;" title="${data.name}: ${data.views} views">
                    <div style="width: 100%; border-radius: var(--radius-sm) var(--radius-sm) 0 0; height: ${data.heightPct}%; background-color: ${isActiveLocal ? 'var(--color-primary)' : 'var(--color-surface-container-high)'}; transition: all 0.3s;"></div>
                    <span class="stitch-body-xs" style="font-size: 7px; font-weight: bold; color: ${isActiveLocal ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${isPlaceholder ? '-' : labelName}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Popular Products list -->
          <div class="stitch-card" style="margin-bottom: var(--spacing-sm); gap: var(--spacing-xs);">
            <h3 class="stitch-title-small" style="text-transform: uppercase; font-size: 11px; margin-bottom: 4px;">Bidhaa Zinazopendwa Zaidi (Popular)</h3>
            ${popularProdsHtml}
          </div>

          <!-- Listed items list header -->
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="margin-top: var(--spacing-md); margin-bottom: var(--spacing-sm);">
            <h3 class="stitch-title-medium" style="font-size: 14px; text-transform: uppercase;">Bidhaa Zangu Zote</h3>
            ${isExpired ? `
              <button class="stitch-btn stitch-btn-sm" disabled style="font-size: 11px; opacity: 0.5; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 14px;">lock</span> Weka Bidhaa
              </button>
            ` : `
              <button id="add-product-trigger" class="stitch-btn stitch-btn-sm stitch-btn-primary" style="font-size: 11px;">
                <span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">add</span> Weka Bidhaa
              </button>
            `}
          </div>

          <div class="stitch-flex stitch-flex-col stitch-gap-md">
            ${productsHtml}
          </div>
        `;
      } else {
        // Add / Edit Form UI
        const isEdit = productFormMode === 'edit';
        const p = editingProduct || {};
        const pImages = isEdit ? allImages.filter(img => img.productId === p.id) : [];
        const prodCats = categories.filter(c => c.type === 'product');

        subViewContent = `
          <div class="stitch-card" style="gap: var(--spacing-md);">
            <h3 class="stitch-title-medium">${isEdit ? 'Hariri Bidhaa / Hariri Matangazo' : 'Pakia Bidhaa Mpya / Weka Bidhaa'}</h3>
            
            <p class="stitch-body-xs" style="background-color: rgba(79, 70, 229, 0.05); padding: 8px; border-radius: var(--radius-sm); border-left: 3px solid var(--color-primary); color: var(--color-on-surface-variant);">
              Picha lazima ziwe safi na zenye mwanga mzuri. Picha hafifu zinaweza kukataliwa wakati wa uhakiki.
            </p>

            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Jina la Bidhaa *</label>
                <input id="prod-name-input" class="stitch-input-raw" type="text" placeholder="e.g. iPhone 15 Pro Max 256GB" value="${p.name || ''}" required/>
              </div>

              <div class="stitch-grid-2">
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Aina ya Bidhaa (Category) *</label>
                  <select id="prod-category-select" class="stitch-input-raw">
                    ${prodCats.length > 0
                      ? prodCats.map(c => `<option value="${c.id}" ${p.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')
                      : '<option value="" disabled selected>Hakuna aina zilizopatikana (No categories found)</option>'
                    }
                  </select>
                </div>
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Chapa (Brand) *</label>
                  <input id="prod-brand-input" class="stitch-input-raw" type="text" placeholder="e.g. Apple" value="${p.brand || ''}"/>
                </div>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Maelezo ya Bidhaa *</label>
                <textarea id="prod-description-input" class="stitch-input-raw" style="height: 80px;" placeholder="Eleza bidhaa yako kwa undani...">${p.description || ''}</textarea>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Sifa Maalum za Bidhaa (Features) - Tenganisha kwa comma</label>
                <input id="prod-features-input" class="stitch-input-raw" type="text" placeholder="e.g. FaceID, Dual Sim, Ram 8GB" value="${p.features ? p.features.join(', ') : ''}"/>
              </div>

              <div class="stitch-grid-2">
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Bei ya Bidhaa (TSh) *</label>
                  <input id="prod-price-input" class="stitch-input-raw" type="number" placeholder="3200000" value="${p.price || ''}"/>
                </div>
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Idadi ya Bidhaa (Stock Quantity) *</label>
                  <input id="prod-stock-qty" class="stitch-input-raw" type="number" placeholder="10" value="${p.stockQuantity !== undefined ? p.stockQuantity : '10'}"/>
                </div>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Hali ya Bidhaa (Condition)</label>
                <select id="prod-condition-select" class="stitch-input-raw">
                  <option value="new" ${p.condition === 'new' ? 'selected' : ''}>Mpya (New)</option>
                  <option value="used" ${p.condition === 'used' ? 'selected' : ''}>Imetumika (Used)</option>
                  <option value="refurbished" ${p.condition === 'refurbished' ? 'selected' : ''}>Kukarabatiwa (Refurbished)</option>
                </select>
              </div>

              <!-- Direct 7 Images Upload -->
              <div style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm); margin-top: var(--spacing-xs);">
                <h4 class="stitch-title-small" style="font-size: 11px; margin-bottom: 8px;">Pakia Picha 7 (Required Angles - Max 5MB kila picha)</h4>
                <div class="stitch-grid-2" style="gap: var(--spacing-xs);">
                  ${['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'].map(angle => {
                    const imgObj = pImages.find(img => img.angle === angle);
                    const existingUrl = imgObj?.imageUrl || '';
                    const hasImg = !!existingUrl;
                    return `
                      <div class="stitch-flex stitch-flex-col stitch-gap-xs" style="background: rgba(226, 232, 240, 0.1); padding: var(--spacing-xs); border-radius: var(--radius-md); align-items: center; justify-content: center; min-height: 90px; position: relative; border: 1px dashed rgba(226, 232, 240, 0.5);">
                        <span class="stitch-body-xs" style="text-transform: capitalize; font-size: 9px; font-weight: bold; color: var(--color-on-surface); z-index: 10;">${angle} View *</span>
                        <div class="image-preview-container-${angle}" style="width: 44px; height: 44px; border-radius: var(--radius-sm); border: 1px solid rgba(226, 232, 240, 0.5); display: flex; align-items: center; justify-content: center; background: white; overflow: hidden; margin-top: 4px; z-index: 10;">
                          ${hasImg ? `<img src="${existingUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : '<span class="material-symbols-outlined" style="font-size: 18px; color: var(--color-outline);">add_a_photo</span>'}
                        </div>
                        <input type="file" id="file-angle" class="product-file-input" accept="image/*" data-angle="${angle}" data-url="${existingUrl}" style="opacity: 0; position: absolute; inset: 0; cursor: pointer; z-index: 20;" />
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            </div>

            <div class="stitch-flex stitch-gap-sm" style="margin-top: var(--spacing-sm);">
              <button id="prod-save-btn" class="stitch-btn stitch-btn-primary" style="flex: 1; height: var(--button-height-md);">Hifadhi</button>
              <button id="prod-cancel-btn" class="stitch-btn stitch-btn-flat" style="border: 1px solid var(--color-outline-variant); height: var(--button-height-md);">Ghairi</button>
            </div>
          </div>
        `;
      }
    } else if (activeTab === 'services') {
      if (serviceFormMode === 'list') {
        const servicesHtml = services.length > 0
          ? services.map(s => `
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); gap: var(--spacing-sm);">
                <div class="stitch-flex stitch-justify-between stitch-align-center" style="width: 100%;">
                  <div>
                    <span class="stitch-badge stitch-badge-primary" style="font-size: 8px; text-transform: uppercase;">${s.category || 'Service'}</span>
                    <h4 class="stitch-title-small" style="font-size: 13px; margin-top: 2px;">${s.name}</h4>
                    <p class="stitch-body-xs" style="color: var(--color-primary); font-weight: bold; margin-top: 1px;">Bei ya Huduma: TSh ${s.startingPrice.toLocaleString()}</p>
                    <p class="stitch-body-xs" style="font-size: 9px; margin-top: 2px;">📍 Maeneo ya Huduma: ${s.coverageAreas ? s.coverageAreas.join(', ') : 'All Areas'}</p>
                  </div>
                  <span class="stitch-badge ${s.isVerified ? 'stitch-badge-primary' : 'stitch-badge-secondary'}" style="font-size: 9px;">
                    ${s.isVerified ? 'Imethibitishwa' : 'Uhakiki'}
                  </span>
                </div>

                <p class="stitch-body-xs" style="font-style: italic;">"${s.description || 'Hakuna maelezo ya ziada.'}"</p>

                <div class="stitch-flex stitch-gap-xs" style="width: 100%; border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm);">
                  ${isExpired ? `
                    <button class="stitch-btn stitch-btn-flat" disabled style="flex: 1; height: 32px; font-size: 11px; border: 1px solid var(--color-outline-variant); cursor: not-allowed; opacity: 0.5; display: flex; align-items: center; justify-content: center; gap: 4px;">
                      <span class="material-symbols-outlined" style="font-size: 14px;">lock</span> Imefungwa (Locked)
                    </button>
                  ` : `
                    <button class="stitch-btn stitch-btn-flat edit-serv-btn" data-id="${s.id}" style="flex: 1; height: 32px; font-size: 11px; border: 1px solid var(--color-outline-variant);">
                      <span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">edit</span> Hariri (Edit)
                    </button>
                    <button class="stitch-btn stitch-btn-flat delete-serv-btn" data-id="${s.id}" style="width: 32px; height: 32px; padding: 0; background-color: var(--color-error-container); color: var(--color-error); border: none;">
                      <span class="material-symbols-outlined" style="font-size: 14px;">delete</span>
                    </button>
                  `}
                </div>
              </div>
            `).join('')
          : `
            <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-xl) 0; border: 1px dashed rgba(226, 232, 240, 0.5); border-radius: var(--radius-lg); text-align: center; gap: var(--spacing-sm);">
              <span class="material-symbols-outlined" style="font-size: 36px; color: var(--color-outline-variant);">design_services</span>
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hujapandisha Huduma</h4>
              <p class="stitch-body-small">Pakia huduma unazotoa kama Ufundi screen, Matengenezo n.k.</p>
            </div>
          `;

        const expiryBanner = isExpired ? `
          <div class="stitch-card" style="border: 2px solid var(--color-error); background-color: rgba(239, 68, 68, 0.05); padding: var(--spacing-md); text-align: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); width: 100%;">
            <span class="material-symbols-outlined" style="color: var(--color-error); font-size: 48px;">warning</span>
            <h3 class="stitch-title-medium" style="color: var(--color-error); font-size: 16px;">KIFURUSHI CHAKO KIMEISHA / SUBSCRIPTION EXPIRED</h3>
            <p class="stitch-body-small" style="line-height: 1.4; max-width: 400px; margin: 0 auto;">
              Muda wako wa majaribio ya bure au kifurushi chako kimeisha. Ili uweze kuendelea kuongeza na kuhariri bidhaa au huduma zako, tafadhali nenda kwenye sehemu ya **Usajili** ili kuchagua na kulipia kifurushi kipya.
            </p>
            <button id="go-to-sub-btn" class="stitch-btn stitch-btn-primary" style="margin: var(--spacing-xs) auto 0 auto; height: 36px; font-size: 11px;">
              Nenda Kwenye Usajili (Go to Subscription)
            </button>
          </div>
        ` : '';

        subViewContent = `
          ${expiryBanner}
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="margin-bottom: var(--spacing-sm);">
            <h3 class="stitch-title-medium" style="font-size: 14px; text-transform: uppercase;">Huduma Zangu</h3>
            ${isExpired ? `
              <button class="stitch-btn stitch-btn-sm" disabled style="font-size: 11px; opacity: 0.5; cursor: not-allowed; display: flex; align-items: center; justify-content: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 14px;">lock</span> Weka Huduma
              </button>
            ` : `
              <button id="add-service-trigger" class="stitch-btn stitch-btn-sm stitch-btn-primary" style="font-size: 11px;">
                <span class="material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">add</span> Weka Huduma
              </button>
            `}
          </div>
          <div class="stitch-flex stitch-flex-col stitch-gap-md">
            ${servicesHtml}
          </div>
        `;
      } else {
        // Add / Edit Service Form
        const isEdit = serviceFormMode === 'edit';
        const s = editingService || {};
        const servCats = categories.filter(c => c.type === 'service');

        subViewContent = `
          <div class="stitch-card" style="gap: var(--spacing-md);">
            <h3 class="stitch-title-medium">${isEdit ? 'Hariri Huduma' : 'Ongeza Huduma Mpya'}</h3>
            
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Jina la Huduma *</label>
                <input id="serv-name-input" class="stitch-input-raw" type="text" placeholder="e.g. Matengenezo ya Vioo vya Simu" value="${s.name || ''}" required/>
              </div>

              <div class="stitch-grid-2">
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Aina ya Huduma *</label>
                  <select id="serv-category-select" class="stitch-input-raw">
                    ${servCats.length > 0
                      ? servCats.map(c => `<option value="${c.id}" ${s.category === c.id ? 'selected' : ''}>${c.name}</option>`).join('')
                      : '<option value="" disabled selected>Hakuna aina zilizopatikana (No categories found)</option>'
                    }
                  </select>
                </div>
                <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                  <label class="stitch-form-label">Bei ya Huduma (TSh) *</label>
                  <input id="serv-starting-price" class="stitch-input-raw" type="number" placeholder="25000" value="${s.startingPrice || ''}"/>
                </div>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Maelezo ya Huduma *</label>
                <textarea id="serv-description-input" class="stitch-input-raw" style="height: 80px;" placeholder="Eleza namna unavyotoa huduma yako kwa wateja...">${s.description || ''}</textarea>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Maeneo Ninayohudumia (Coverage Areas) - Tenganisha kwa comma</label>
                <input id="serv-coverage-input" class="stitch-input-raw" type="text" placeholder="e.g. Kariakoo, Posta, Sinza" value="${s.coverageAreas ? s.coverageAreas.join(', ') : ''}"/>
              </div>
            </div>

            <div class="stitch-flex stitch-gap-sm" style="margin-top: var(--spacing-sm);">
              <button id="serv-save-btn" class="stitch-btn stitch-btn-primary" style="flex: 1; height: var(--button-height-md);">Hifadhi Huduma</button>
              <button id="serv-cancel-btn" class="stitch-btn stitch-btn-flat" style="border: 1px solid var(--color-outline-variant); height: var(--button-height-md);">Ghairi</button>
            </div>
          </div>
        `;
      }
    } else if (activeTab === 'verification') {
      const brelaDoc = verificationDocs.find(d => d.type === 'BRELA');
      const tinDoc = verificationDocs.find(d => d.type === 'TIN');
      const licenseDoc = verificationDocs.find(d => d.type === 'Business License');
      const officePhotos = verificationDocs.filter(d => d.type.startsWith('Office Photo'));

      const isSubmitted = activeProvider?.providerStatus === 'verification_submitted' || activeProvider?.providerStatus === 'under_review';
      const isApprovedStatus = activeProvider?.status === 'approved' || activeProvider?.providerStatus === 'approved' || activeProvider?.providerStatus === 'active_provider';

      if (isApprovedStatus) {
        subViewContent = `
          <div class="stitch-card" style="gap: var(--spacing-md); background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); text-align: center; padding: var(--spacing-xl) var(--spacing-md);">
            <div class="stitch-flex stitch-flex-col stitch-align-center" style="gap: var(--spacing-sm);">
              <span class="material-symbols-outlined" style="color: var(--color-secondary); font-size: 56px;">verified</span>
              <h3 class="stitch-title-large" style="font-size: 18px; color: var(--color-secondary);">Uhakiki Umekamilika / Verified ✓</h3>
              <p class="stitch-body-small" style="max-width: 320px; line-height: 1.4; margin: 0 auto;">
                Hongera! Wasifu na biashara yako imethibitishwa kikamilifu. Bidhaa na huduma zako sasa zinaonekana kwenye soko la wateja wa CHIMBO KARIAKOO.
              </p>
            </div>
            
            <div class="stitch-card-sm" style="padding: var(--spacing-sm); gap: var(--spacing-xs); font-size: 11px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.1); text-align: left; margin-top: var(--spacing-md);">
              <h4 class="stitch-title-small" style="font-size: 12px; color: var(--color-secondary); border-bottom: 1px solid rgba(16, 185, 129, 0.2); padding-bottom: 4px; margin-bottom: 4px;">Maelezo ya Uhakiki</h4>
              <div><strong>Hali ya Akaunti:</strong> Active / Approved</div>
              <div><strong>Jina la Biashara:</strong> ${activeProvider?.businessName || ''}</div>
              <div><strong>Coordinates za GPS:</strong> ${activeProvider?.latitude ? `${activeProvider.latitude.toFixed(4)}, ${activeProvider.longitude.toFixed(4)}` : 'N/A'}</div>
              <div><strong>Address ya Eneo:</strong> ${activeProvider?.address || 'N/A'}</div>
            </div>
          </div>
        `;
      } else if (isSubmitted) {
        subViewContent = `
          <div class="stitch-card" style="gap: var(--spacing-md); background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);">
            <div class="stitch-flex stitch-flex-col stitch-align-center" style="text-align: center; gap: var(--spacing-sm);">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 56px;">hourglass_empty</span>
              <h3 class="stitch-title-large" style="font-size: 18px; color: var(--color-primary);">Maombi Yako Yanahakikiwa</h3>
              <p class="stitch-body-small" style="max-width: 320px; line-height: 1.4; margin: 0 auto;">
                Asante kwa kuwasilisha maombi yako ya uhakiki. Timu yetu ya Admin na Maafisa wa Nyanjani (Field Officers) inakagua taarifa na nyaraka zako sasa.
              </p>
            </div>

            <div class="stitch-card-sm" style="padding: var(--spacing-sm); gap: var(--spacing-xs); font-size: 11px; background: rgba(0, 0, 0, 0.05);">
              <h4 class="stitch-title-small" style="font-size: 12px; border-bottom: 1px solid rgba(226, 232, 240, 0.3); padding-bottom: 4px; margin-bottom: 4px;">Hali ya Sasa (Current Status)</h4>
              <div><strong>Tarehe ya Kutuma:</strong> ${activeProvider?.verificationSubmittedAt ? new Date(activeProvider.verificationSubmittedAt).toLocaleDateString('sw-TZ', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A'}</div>
              <div><strong>Kipindi cha Uhakiki:</strong> Saa 24 hadi 48 za kazi</div>
              <div><strong>Hatua ya Uhakiki:</strong> 
                <span class="stitch-badge stitch-badge-primary" style="font-size: 9px; text-transform: uppercase;">
                  ${activeProvider?.reviewStage === 'document_check' ? 'Uhakiki wa Nyaraka (Document Check)' : 
                    activeProvider?.reviewStage === 'physical_visit' ? 'Kuhakiki Duka/Eneo (Physical Visit)' : 
                    activeProvider?.reviewStage || 'Inasubiri Uhakiki'}
                </span>
              </div>
            </div>

            <!-- Vertical Timeline stepper -->
            <div class="stitch-flex stitch-flex-col" style="gap: var(--spacing-sm); margin-top: var(--spacing-xs); padding-left: 8px;">
              <div class="stitch-flex" style="gap: var(--spacing-sm); align-items: flex-start; position: relative;">
                <div style="position: absolute; left: 9px; top: 20px; bottom: -20px; width: 2px; background-color: var(--color-secondary);"></div>
                <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 20px; height: 20px; border-radius: var(--radius-full); background: var(--color-secondary); color: white; shrink-0; z-index: 10;">
                  <span class="material-symbols-outlined" style="font-size: 12px;">check</span>
                </div>
                <div>
                  <h5 class="stitch-title-small" style="font-size: 11px; margin: 0;">Maombi Yamewasilishwa</h5>
                  <p class="stitch-body-xs" style="color: var(--color-outline); margin-top: 2px;">Nyaraka zote (BRELA, TIN, Leseni, GPS) zimepakiwa kikamilifu.</p>
                </div>
              </div>

              <div class="stitch-flex" style="gap: var(--spacing-sm); align-items: flex-start; position: relative;">
                <div style="position: absolute; left: 9px; top: 20px; bottom: -20px; width: 2px; background-color: ${activeProvider?.reviewStage === 'physical_visit' ? 'var(--color-secondary)' : 'rgba(226, 232, 240, 0.5)'};"></div>
                <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 20px; height: 20px; border-radius: var(--radius-full); background: ${activeProvider?.providerStatus === 'under_review' || activeProvider?.reviewStage === 'document_check' || activeProvider?.reviewStage === 'physical_visit' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.5)'}; color: white; shrink-0; z-index: 10;">
                  <span class="material-symbols-outlined" style="font-size: 12px;">visibility</span>
                </div>
                <div>
                  <h5 class="stitch-title-small" style="font-size: 11px; margin: 0; color: ${activeProvider?.providerStatus === 'under_review' ? 'var(--color-primary)' : 'inherit'};">Kukagua Nyaraka & Taarifa</h5>
                  <p class="stitch-body-xs" style="color: var(--color-outline); margin-top: 2px;">Tunaangalia usahihi wa leseni na vyeti ulivyotuma.</p>
                </div>
              </div>

              <div class="stitch-flex" style="gap: var(--spacing-sm); align-items: flex-start; position: relative;">
                <div style="position: absolute; left: 9px; top: 20px; bottom: -20px; width: 2px; background-color: rgba(226, 232, 240, 0.5);"></div>
                <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 20px; height: 20px; border-radius: var(--radius-full); background: ${activeProvider?.reviewStage === 'physical_visit' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.5)'}; color: white; shrink-0; z-index: 10;">
                  <span class="material-symbols-outlined" style="font-size: 12px;">location_on</span>
                </div>
                <div>
                  <h5 class="stitch-title-small" style="font-size: 11px; margin: 0; color: ${activeProvider?.reviewStage === 'physical_visit' ? 'var(--color-primary)' : 'inherit'};">Uhakiki wa Eneo (Physical Visit)</h5>
                  <p class="stitch-body-xs" style="color: var(--color-outline); margin-top: 2px;">Afisa wa nyanjani atatembelea duka lako lililopo Kariakoo.</p>
                </div>
              </div>

              <div class="stitch-flex" style="gap: var(--spacing-sm); align-items: flex-start;">
                <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 20px; height: 20px; border-radius: var(--radius-full); background: rgba(226, 232, 240, 0.5); color: white; shrink-0; z-index: 10;">
                  <span class="material-symbols-outlined" style="font-size: 12px;">workspace_premium</span>
                </div>
                <div>
                  <h5 class="stitch-title-small" style="font-size: 11px; margin: 0;">Uhakiki Umekamilika</h5>
                  <p class="stitch-body-xs" style="color: var(--color-outline); margin-top: 2px;">Akaunti yako inakuwa hai na unaanza kuonekana kwenye soko la wateja!</p>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        // Render 7-Step Wizard
        let stepContent = '';

        if (verifWizardStep === 1) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 1: Taarifa za Wasifu wa Biashara</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Jaza maelezo ya msingi kuhusu biashara yako. Taarifa hizi zitaonekana kwa wateja.</p>
              
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Jina la Biashara *</label>
                <input id="wiz-bizname" class="stitch-input-raw" type="text" placeholder="e.g. Kariakoo Electronics Hub" value="${activeProvider?.businessName || ''}" />
              </div>
              
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Namba ya WhatsApp ya Biashara *</label>
                <input id="wiz-whatsapp" class="stitch-input-raw" type="text" placeholder="e.g. +255712345678" value="${activeProvider?.whatsapp || ''}" />
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Maelezo ya Biashara</label>
                <textarea id="wiz-description" class="stitch-input-raw" style="height: 80px;" placeholder="Eleza biashara yako na huduma unazotoa...">${activeProvider?.description || ''}</textarea>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Saa za Kazi</label>
                <input id="wiz-hours" class="stitch-input-raw" type="text" placeholder="e.g. Jumatatu - Jumamosi: 8:00 AM - 6:00 PM" value="${activeProvider?.businessHours || ''}" />
              </div>
            </div>
          `;
        } else if (verifWizardStep === 2) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 2: Hati ya BRELA pekee</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Pakia cheti chako cha BRELA kwa ajili ya kuthibitisha usajili wa biashara ya kisheria.</p>
              
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); border-left: 4px solid ${brelaDoc ? 'var(--color-secondary)' : 'var(--color-outline-variant)'};">
                <div class="stitch-flex stitch-justify-between stitch-align-center" style="width: 100%;">
                  <div>
                    <h5 class="stitch-title-small" style="font-size: 12px;">Hati ya BRELA (PDF pekee, Max 10MB)</h5>
                    <p id="label-brela" class="stitch-body-xs" style="margin-top: 1px; color: var(--color-outline); font-family: var(--font-mono); font-size: 10px;">
                      ${brelaDoc ? 'Hati Imepakiwa (PDF)' : 'Faili halijachaguliwa'}
                    </p>
                  </div>
                  <span class="stitch-badge" style="font-size: 8px;">${brelaDoc ? brelaDoc.status : 'missing'}</span>
                </div>
                <div class="stitch-flex stitch-gap-xs" style="margin-top: 8px; align-items: center; width: 100%;">
                  <input type="file" id="file-brela" accept="application/pdf" class="verif-pdf-input" data-type="BRELA" data-url="${brelaDoc?.fileUrl || ''}" style="display: none;" />
                  <button class="stitch-btn stitch-btn-sm stitch-btn-secondary" onclick="document.getElementById('file-brela').click()" style="height: 32px; font-size: 10px; flex-grow: 1;">Chagua PDF</button>
                  <button class="stitch-btn stitch-btn-sm stitch-btn-primary verif-save-doc-btn" data-input-id="file-brela" style="height: 32px; font-size: 10px;">Hifadhi & Pakia</button>
                </div>
              </div>
            </div>
          `;
        } else if (verifWizardStep === 3) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 3: Cheti cha TIN pekee</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Pakia cheti cha namba ya mlipa kodi (TIN Certificate) kutoka TRA.</p>
              
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); border-left: 4px solid ${tinDoc ? 'var(--color-secondary)' : 'var(--color-outline-variant)'};">
                <div class="stitch-flex stitch-justify-between stitch-align-center" style="width: 100%;">
                  <div>
                    <h5 class="stitch-title-small" style="font-size: 12px;">Cheti cha TIN (PDF pekee, Max 10MB)</h5>
                    <p id="label-tin" class="stitch-body-xs" style="margin-top: 1px; color: var(--color-outline); font-family: var(--font-mono); font-size: 10px;">
                      ${tinDoc ? 'TIN Imepakiwa (PDF)' : 'Faili halijachaguliwa'}
                    </p>
                  </div>
                  <span class="stitch-badge" style="font-size: 8px;">${tinDoc ? tinDoc.status : 'missing'}</span>
                </div>
                <div class="stitch-flex stitch-gap-xs" style="margin-top: 8px; align-items: center; width: 100%;">
                  <input type="file" id="file-tin" accept="application/pdf" class="verif-pdf-input" data-type="TIN" data-url="${tinDoc?.fileUrl || ''}" style="display: none;" />
                  <button class="stitch-btn stitch-btn-sm stitch-btn-secondary" onclick="document.getElementById('file-tin').click()" style="height: 32px; font-size: 10px; flex-grow: 1;">Chagua PDF</button>
                  <button class="stitch-btn stitch-btn-sm stitch-btn-primary verif-save-doc-btn" data-input-id="file-tin" style="height: 32px; font-size: 10px;">Hifadhi & Pakia</button>
                </div>
              </div>
            </div>
          `;
        } else if (verifWizardStep === 4) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 4: Leseni ya Biashara pekee</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Pakia leseni yako halali ya biashara iliyotolewa na mamlaka ya serikali za mitaa.</p>
              
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); border-left: 4px solid ${licenseDoc ? 'var(--color-secondary)' : 'var(--color-outline-variant)'};">
                <div class="stitch-flex stitch-justify-between stitch-align-center" style="width: 100%;">
                  <div>
                    <h5 class="stitch-title-small" style="font-size: 12px;">Leseni ya Biashara (PDF pekee, Max 10MB)</h5>
                    <p id="label-license" class="stitch-body-xs" style="margin-top: 1px; color: var(--color-outline); font-family: var(--font-mono); font-size: 10px;">
                      ${licenseDoc ? 'Leseni Imepakiwa (PDF)' : 'Faili halijachaguliwa'}
                    </p>
                  </div>
                  <span class="stitch-badge" style="font-size: 8px;">${licenseDoc ? licenseDoc.status : 'missing'}</span>
                </div>
                <div class="stitch-flex stitch-gap-xs" style="margin-top: 8px; align-items: center; width: 100%;">
                  <input type="file" id="file-license" accept="application/pdf" class="verif-pdf-input" data-type="Business License" data-url="${licenseDoc?.fileUrl || ''}" style="display: none;" />
                  <button class="stitch-btn stitch-btn-sm stitch-btn-secondary" onclick="document.getElementById('file-license').click()" style="height: 32px; font-size: 10px; flex-grow: 1;">Chagua PDF</button>
                  <button class="stitch-btn stitch-btn-sm stitch-btn-primary verif-save-doc-btn" data-input-id="file-license" style="height: 32px; font-size: 10px;">Hifadhi & Pakia</button>
                </div>
              </div>
            </div>
          `;
        } else if (verifWizardStep === 5) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 5: Mahali Ulipo GPS (GPS Location)</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Gusa kitufe hapa chini ili kurekodi mahali sahihi pa duka lako. Hii inasaidia wateja kukupata kwenye soko.</p>
              
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); border-left: 4px solid var(--color-primary); gap: 6px;">
                ${activeProvider?.latitude && activeProvider?.longitude
                  ? `
                    <p class="stitch-body-xs" style="color: var(--color-error); font-weight: bold; margin-bottom: 4px;">
                      ⚠️ Mahali pako pamefungwa (Locked). Huwezi kubadilisha coordinates hadi uhakiki ukamilike au upate idhini ya Admin.
                    </p>
                  `
                  : `
                    <p class="stitch-body-xs" style="color: var(--color-secondary); margin-bottom: 4px;">
                      ⚠️ Kumbuka: Ukishasave mahali ulipo, coordinates zitafungwa (locked) hadi utakapopata idhini ya admin kubadilisha.
                    </p>
                  `
                }
                
                <div id="gps-status-badge" style="margin-bottom: 6px;">
                  ${activeProvider?.latitude && activeProvider?.longitude 
                    ? `<span class="stitch-badge stitch-badge-primary" style="font-size: 9px; background: rgba(16,185,129,0.1); color: var(--color-secondary);">Mahali Yamehifadhiwa ✓ (${activeProvider.latitude.toFixed(4)}, ${activeProvider.longitude.toFixed(4)})</span>` 
                    : '<span class="stitch-badge" style="font-size: 9px;">GPS Haijasajiliwa</span>'
                  }
                </div>

                ${activeProvider?.address ? `
                  <p class="stitch-body-xs" style="font-weight: bold; margin-bottom: 6px;">
                    📍 Address ya sasa: <span style="font-weight: normal; color: var(--color-on-surface-variant);">${activeProvider.address}</span>
                  </p>
                ` : ''}

                <button id="gps-locate-btn" class="stitch-btn stitch-btn-sm stitch-btn-primary" 
                  ${activeProvider?.latitude && activeProvider?.longitude ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : ''} 
                  style="width: 100%; height: 36px; font-size: 11px;">
                  <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px;">my_location</span> 
                  ${activeProvider?.latitude && activeProvider?.longitude ? 'GPS Locked' : 'Sajili GPS coordinates'}
                </button>
              </div>
            </div>
          `;
        } else if (verifWizardStep === 6) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 6: Picha za Duka/Ofisi</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Pakia picha tatu tofauti za duka au ofisi yako (nje na ndani) kuthibitisha uwepo wako.</p>
              
              <div class="stitch-grid-3" style="gap: var(--spacing-xs); margin-top: var(--spacing-xs);">
                ${[1, 2, 3].map(i => {
                  const photoDoc = officePhotos.find(d => d.type === `Office Photo ${i}`);
                  const photoUrl = photoDoc?.fileUrl || '';
                  const hasPhoto = !!photoUrl;
                  return `
                    <div class="stitch-flex stitch-flex-col stitch-gap-xs" style="background: rgba(226, 232, 240, 0.1); padding: var(--spacing-xs); border-radius: var(--radius-md); align-items: center; justify-content: center; min-height: 90px; position: relative; border: 1px dashed rgba(226, 232, 240, 0.5);">
                      <span class="stitch-body-xs" style="font-size: 8px; font-weight: bold; color: var(--color-outline);">Picha ${i}</span>
                      <div class="photo-preview-${i}" style="width: 40px; height: 40px; border-radius: var(--radius-sm); border: 1px solid rgba(226, 232, 240, 0.5); display: flex; align-items: center; justify-content: center; background: white; overflow: hidden; margin-top: 4px; z-index: 10;">
                        ${hasPhoto ? `<img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : '<span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">add_a_photo</span>'}
                      </div>
                      <input type="file" id="file-photo-${i}" class="office-file-input" accept="image/*" data-index="${i}" data-url="${photoUrl}" style="opacity: 0; position: absolute; inset: 0; cursor: pointer; z-index: 20;" />
                      <button class="stitch-btn stitch-btn-flat office-save-btn" data-index="${i}" style="font-size: 8px; height: 18px; margin-top: 4px; padding: 0 4px; z-index: 30;">Save</button>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        } else if (verifWizardStep === 7) {
          stepContent = `
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <h4 class="stitch-title-medium" style="font-size: 14px;">Hatua ya 7: Hakiki & Tuma Maombi</h4>
              <p class="stitch-body-xs" style="color: var(--color-outline);">Tafadhali hakiki taarifa zote ulizojaza na nyaraka ulizopakia kabla ya kutuma kwa ajili ya uhakiki wa mwisho.</p>
              
              <div class="stitch-card-sm" style="padding: var(--spacing-sm); gap: var(--spacing-xs); font-size: 11px; line-height: 1.4;">
                <h5 class="stitch-title-small" style="font-size: 12px; border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 2px;">Muhtasari wa Maombi</h5>
                <div><strong>Jina la Biashara:</strong> ${activeProvider?.businessName || 'Bado halijajazwa ❌'}</div>
                <div><strong>Namba ya WhatsApp:</strong> ${activeProvider?.whatsapp || 'Bado haijajazwa ❌'}</div>
                <div><strong>Coordinates za GPS:</strong> ${activeProvider?.latitude && activeProvider?.longitude ? `Mpo (${activeProvider.latitude.toFixed(4)}, ${activeProvider.longitude.toFixed(4)}) ✓` : 'Bado hazijasajiliwa ❌'}</div>
                <div><strong>Address ya Eneo:</strong> ${activeProvider?.address || 'Bado haijasajiliwa ❌'}</div>
                
                <div style="margin-top: 8px; border-top: 1px dashed rgba(226, 232, 240, 0.5); padding-top: 6px;">
                  <strong>Hali ya Nyaraka:</strong>
                  <ul style="padding-left: var(--spacing-md); margin-top: 2px;">
                    <li>BRELA: ${brelaDoc ? '<span style="color: var(--color-secondary); font-weight: bold;">Kamilifu ✓</span>' : '<span style="color: var(--color-error);">Haipo ❌</span>'}</li>
                    <li>TIN: ${tinDoc ? '<span style="color: var(--color-secondary); font-weight: bold;">Kamilifu ✓</span>' : '<span style="color: var(--color-error);">Haipo ❌</span>'}</li>
                    <li>Leseni: ${licenseDoc ? '<span style="color: var(--color-secondary); font-weight: bold;">Kamilifu ✓</span>' : '<span style="color: var(--color-error);">Haipo ❌</span>'}</li>
                    <li>Picha za Ofisi: ${officePhotos.length}/3</li>
                  </ul>
                </div>
              </div>

              ${(!activeProvider?.businessName || !activeProvider?.whatsapp || !activeProvider?.latitude || !brelaDoc || !tinDoc || !licenseDoc || officePhotos.length < 3)
                ? `
                  <div class="stitch-card-sm" style="background-color: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1); padding: var(--spacing-sm); color: var(--color-error); font-size: 11px;">
                    ⚠️ <strong>Haiwezi Kutumwa bado:</strong> Tafadhali kamilisha hatua zote zilizowekwa alama ya ❌ kabla ya kuwasilisha maombi yako kwa Admin.
                  </div>
                `
                : `
                  <button id="wiz-final-submit-btn" class="stitch-btn stitch-btn-primary" style="width: 100%; height: 44px; font-weight: bold;">
                    <span class="material-symbols-outlined" style="font-size: 20px; margin-right: 6px;">send</span> Tuma kwa Uhakiki (Submit Verification)
                  </button>
                `
              }
            </div>
          `;
        }

        subViewContent = `
          <div class="stitch-card" style="gap: var(--spacing-md);">
            <div class="stitch-flex stitch-align-center" style="gap: var(--spacing-xs);">
              <span class="material-symbols-outlined" style="color: var(--color-primary);">verified_user</span>
              <h3 class="stitch-title-medium">Uhakiki wa Biashara / Verification Wizard</h3>
            </div>

            <!-- Progress bar -->
            <div class="stitch-flex stitch-flex-col" style="gap: 6px; margin-bottom: var(--spacing-sm);">
              <div class="stitch-flex stitch-justify-between stitch-align-center">
                <span class="stitch-body-xs" style="font-weight: bold; text-transform: uppercase; color: var(--color-primary);">Hatua ya ${verifWizardStep} kati ya 7</span>
                <span class="stitch-body-xs" style="color: var(--color-outline);">${Math.round((verifWizardStep / 7) * 100)}% Imekamilika</span>
              </div>
              <div style="width: 100%; height: 6px; background-color: var(--color-surface-container-high); border-radius: var(--radius-full); overflow: hidden;">
                <div style="width: ${(verifWizardStep / 7) * 100}%; height: 100%; background-color: var(--color-primary); transition: width 0.3s ease;"></div>
              </div>
            </div>

            <!-- Warning/Instruction if changes requested -->
            ${activeProvider?.verificationStatus === 'changes_requested' 
              ? `
                <div class="stitch-card-sm" style="background-color: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.1); padding: var(--spacing-sm); color: var(--color-secondary); font-size: 11px; margin-bottom: var(--spacing-xs);">
                  ⚠️ <strong>Mabadiliko Yanahitajika (Changes Requested):</strong> Tafadhali kagua na kurekebisha taarifa au nyaraka kulingana na maoni ya Admin kabla ya kutuma upya.
                </div>
              `
              : ''
            }

            <!-- Step content -->
            ${stepContent}

            <!-- Navigation buttons -->
            <div class="stitch-flex stitch-gap-sm" style="margin-top: var(--spacing-md); border-top: 1px solid rgba(226,232,240,0.5); padding-top: var(--spacing-md);">
              <button id="wiz-prev-btn" class="stitch-btn stitch-btn-flat" 
                ${verifWizardStep === 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} 
                style="flex: 1; border: 1px solid var(--color-outline-variant); height: 36px; font-size: 11px;">
                Rudi Nyuma (Previous)
              </button>
              <button id="wiz-next-btn" class="stitch-btn stitch-btn-primary" 
                ${verifWizardStep === 7 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} 
                style="flex: 1; height: 36px; font-size: 11px;">
                Hatua Inayofuata (Next)
              </button>
            </div>
          </div>
        `;
      }
    } else if (activeTab === 'subscription') {
      const plan = activeSub?.plan || 'starter';
      const expiry = activeSub?.expiresAt ? new Date(activeSub.expiresAt).toLocaleDateString() : 'N/A';
      const status = activeSub?.status || 'expired';

      const paymentListHtml = payments.length > 0
        ? payments.map(p => `
            <tr style="border-bottom: 1px solid rgba(226, 232, 240, 0.3);">
              <td class="stitch-body-xs" style="padding: var(--spacing-xs) var(--spacing-sm); font-weight: bold;">${p.referenceCode || 'REF-SIM'}</td>
              <td class="stitch-body-xs" style="padding: var(--spacing-xs) var(--spacing-sm);">TSh ${p.amount.toLocaleString()}</td>
              <td class="stitch-body-xs" style="padding: var(--spacing-xs) var(--spacing-sm);"><span class="stitch-badge stitch-badge-primary" style="font-size: 8px;">Kamilifu</span></td>
              <td class="stitch-body-xs" style="padding: var(--spacing-xs) var(--spacing-sm); font-size: 9px;">${new Date(p.createdAt).toLocaleDateString()}</td>
            </tr>
          `).join('')
        : `<tr><td colspan="4" class="stitch-body-xs" style="padding: var(--spacing-md); text-align: center; color: var(--color-outline);">Hakuna miamala iliyofanyika.</td></tr>`;

      subViewContent = `
        <div class="stitch-card" style="gap: var(--spacing-md);">
          <div class="stitch-flex stitch-align-center" style="gap: var(--spacing-xs);">
            <span class="material-symbols-outlined" style="color: var(--color-primary);">card_membership</span>
            <h3 class="stitch-title-medium">Usajili wa Kifurushi / Subscription</h3>
          </div>

          <!-- Free Trial Banner Swahili -->
          <div style="background-color: rgba(16, 185, 129, 0.05); padding: var(--spacing-sm); border-radius: var(--radius-lg); border: 1px solid rgba(16, 185, 129, 0.2);">
            <h4 class="stitch-title-small" style="color: var(--color-secondary); font-size: 12px; text-transform: uppercase;">KIPINDI CHA MAJARIBIO BURE</h4>
            <p class="stitch-body-xs" style="margin-top: 2px; line-height: 1.4;">
              Kila muuzaji au mtoa huduma mpya anapata <strong>siku 30 za matumizi bure</strong>. Baada ya siku 30 kumalizika, utachagua mpango wa kulipia ili kuendelea kuonekana mtaani.
            </p>
          </div>

          <!-- Current plan card -->
          <div class="stitch-card-sm" style="background-color: var(--color-surface-container-low); padding: var(--spacing-sm); border: 1px solid rgba(79, 70, 229, 0.2);">
            <div class="stitch-flex stitch-justify-between stitch-align-center" style="width: 100%;">
              <div>
                <span class="stitch-body-xs" style="font-size: 9px; color: var(--color-outline); text-transform: uppercase;">Kifurushi Chako / Active Plan</span>
                <h4 class="stitch-title-medium" style="font-size: 16px; color: var(--color-primary); text-transform: capitalize; margin-top: 1px;">${plan} Plan</h4>
              </div>
              <span class="stitch-badge ${status === 'active' ? 'stitch-badge-primary' : 'stitch-badge-secondary'}">${status === 'active' ? 'Amilifu (Active)' : 'Imeisha'}</span>
            </div>
            
            <div style="border-top: 1px solid rgba(226, 232, 240, 0.5); margin-top: var(--spacing-xs); padding-top: var(--spacing-xs); display: flex; justify-content: space-between;">
              <span class="stitch-body-xs" style="font-size: 10px;">📅 Tarehe ya Mwisho: <strong>${expiry}</strong></span>
            </div>
          </div>

          <!-- Plans description Swahili -->
          <div style="margin-top: var(--spacing-xs); display: flex; flex-direction: column; gap: var(--spacing-xs);">
            <h4 class="stitch-title-small" style="font-size: 11px; text-transform: uppercase;">Vifurushi Vinavyopatikana (Plans):</h4>
            
            <div style="background: white; border: 1px solid rgba(226,232,240,0.8); border-radius: var(--radius-md); padding: 8px;">
              <h5 style="font-size: 11px; font-weight: bold; color: var(--color-primary);">Starter Plan</h5>
              <p style="font-size: 10px; margin-top: 1px;">Bei: TSh 50,000 / Muda: Siku 30</p>
              <p style="font-size: 9px; color: var(--color-outline); margin-top: 1px;">✓ Hadi bidhaa 10 • Uhakiki wa msingi nyanjani • Analytics za kawaida</p>
            </div>
            
            <div style="background: white; border: 1px solid rgba(79,70,229,0.2); border-radius: var(--radius-md); padding: 8px;">
              <h5 style="font-size: 11px; font-weight: bold; color: var(--color-primary);">Business Plan</h5>
              <p style="font-size: 10px; margin-top: 1px;">Bei: TSh 150,000 / Muda: Siku 30</p>
              <p style="font-size: 9px; color: var(--color-outline); margin-top: 1px;">✓ Bidhaa zisizo na kikomo • Vitu kuonekana mbele • Badge ya 'Best Deal'</p>
            </div>

            <div style="background: white; border: 1px solid rgba(226,232,240,0.8); border-radius: var(--radius-md); padding: 8px;">
              <h5 style="font-size: 11px; font-weight: bold; color: var(--color-primary);">Premium Plan</h5>
              <p style="font-size: 10px; margin-top: 1px;">Bei: TSh 300,000 / Muda: Siku 30</p>
              <p style="font-size: 9px; color: var(--color-outline); margin-top: 1px;">✓ VIP ads placement • Support ya haraka • Boosters za Trust rating</p>
            </div>
          </div>

          <!-- Plan Upgrade Simulator -->
          <div style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm); margin-top: var(--spacing-xs);">
            <h4 class="stitch-title-small" style="font-size: 12px; margin-bottom: 8px;">Lipia Kifurushi Upya (Renewal & Upgrade)</h4>
            
            <div class="stitch-flex stitch-flex-col stitch-gap-sm">
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Chagua Kifurushi</label>
                <select id="sub-plan-select" class="stitch-input-raw">
                  ${subscriptionPlans.length > 0
                    ? subscriptionPlans.map(plan => `<option value="${plan.id}" data-price="${plan.price}">${plan.name} Plan (TSh ${plan.price.toLocaleString()})</option>`).join('')
                    : '<option value="" disabled selected>Hakuna vifurushi vilivyopatikana (No plans found)</option>'
                  }
                </select>
              </div>

              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Njia ya Malipo</label>
                <select id="sub-paymethod-select" class="stitch-input-raw">
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="Tigo Pesa">Tigo Pesa</option>
                  <option value="Airtel Money">Airtel Money</option>
                  <option value="Card">Visa / Mastercard</option>
                </select>
              </div>

              <button id="sub-simulate-pay-btn" class="stitch-btn stitch-btn-primary" style="height: var(--button-height-md); width: 100%;">
                Lipia na Kuanzisha Kifurushi
              </button>
            </div>
          </div>

          <!-- Payment History -->
          <div style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm); margin-top: var(--spacing-xs);">
            <h4 class="stitch-title-small" style="font-size: 11px; text-transform: uppercase; margin-bottom: 6px;">Kumbukumbu ya Malipo / Billing</h4>
            <div style="overflow-x: auto; width: 100%;">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead>
                  <tr style="background-color: var(--color-surface-container-low); border-bottom: 1px solid rgba(226, 232, 240, 0.5);">
                    <th class="stitch-body-xs" style="padding: 6px var(--spacing-sm); font-weight: bold; font-size: 9px; color: var(--color-outline);">Kumbukumbu</th>
                    <th class="stitch-body-xs" style="padding: 6px var(--spacing-sm); font-weight: bold; font-size: 9px; color: var(--color-outline);">Kiasi</th>
                    <th class="stitch-body-xs" style="padding: 6px var(--spacing-sm); font-weight: bold; font-size: 9px; color: var(--color-outline);">Hali</th>
                    <th class="stitch-body-xs" style="padding: 6px var(--spacing-sm); font-weight: bold; font-size: 9px; color: var(--color-outline);">Tarehe</th>
                  </tr>
                </thead>
                <tbody>
                  ${paymentListHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    } else if (activeTab === 'settings') {
      subViewContent = `
        <div class="stitch-card" style="gap: var(--spacing-md);">
          <div class="stitch-flex stitch-align-center" style="gap: var(--spacing-xs);">
            <span class="material-symbols-outlined" style="color: var(--color-primary);">settings</span>
            <h3 class="stitch-title-medium">Mipangilio ya Wasifu / Settings</h3>
          </div>

          <div class="stitch-flex stitch-flex-col stitch-gap-sm">
            <!-- Taarifa za Biashara -->
            <h4 class="stitch-title-small" style="font-size: 11px; text-transform: uppercase; border-bottom: 1px solid rgba(226,232,240,0.8); padding-bottom: 2px;">Taarifa za Biashara</h4>
            <div class="stitch-flex stitch-flex-col stitch-gap-xs">
              <label class="stitch-form-label">Jina la Biashara / Business Name</label>
              <input id="settings-bizname" class="stitch-input-raw" type="text" value="${activeProvider?.businessName || state.userProfile?.name || ''}" />
            </div>
            <div class="stitch-flex stitch-flex-col stitch-gap-xs">
              <label class="stitch-form-label">Maelezo ya Biashara / Description</label>
              <textarea id="settings-bizdesc" class="stitch-input-raw" style="height: 60px;">${activeProvider?.description || ''}</textarea>
            </div>

            <!-- Mawasiliano -->
            <h4 class="stitch-title-small" style="font-size: 11px; text-transform: uppercase; border-bottom: 1px solid rgba(226,232,240,0.8); padding-bottom: 2px; margin-top: 6px;">Mawasiliano na Eneo</h4>
            <div class="stitch-grid-2">
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Namba ya Simu</label>
                <input id="settings-phone" class="stitch-input-raw" type="text" value="${state.userProfile?.phoneNumber || ''}" />
              </div>
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">WhatsApp Number</label>
                <input id="settings-whatsapp" class="stitch-input-raw" type="text" placeholder="e.g. 0712345678" value="${activeProvider?.whatsapp || ''}" />
              </div>
            </div>
            <div class="stitch-grid-2">
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Barua Pepe (Email)</label>
                <input id="settings-email" class="stitch-input-raw" type="email" value="${state.userProfile?.email || ''}" disabled />
              </div>
              <div class="stitch-flex stitch-flex-col stitch-gap-xs">
                <label class="stitch-form-label">Anwani (Address / Location)</label>
                <input id="settings-address" class="stitch-input-raw" type="text" value="${activeProvider?.address || ''}" />
              </div>
            </div>
            
            <div class="stitch-flex stitch-flex-col stitch-gap-xs">
              <label class="stitch-form-label">Saa za Kazi (Business Hours)</label>
              <input id="settings-hours" class="stitch-input-raw" type="text" placeholder="e.g. Jumatatu - Jumamosi: 2:00 Asubuhi - 12:00 Jioni" value="${activeProvider?.businessHours || 'Jumatatu - Jumamosi: 8:00 AM - 6:00 PM'}" />
            </div>

            <!-- Preferences -->
            <h4 class="stitch-title-small" style="font-size: 11px; text-transform: uppercase; border-bottom: 1px solid rgba(226,232,240,0.8); padding-bottom: 2px; margin-top: 6px;">Vipangilio vya Arifa</h4>
            <div class="stitch-flex stitch-flex-col" style="gap: 6px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                <input type="checkbox" id="settings-pref-sms" checked /> Tuma SMS kwa kila mteja mpya anayefungua mawasiliano.
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                <input type="checkbox" id="settings-pref-email" checked /> Tuma barua pepe za risiti na miamala.
              </label>
            </div>
          </div>

          <button id="settings-save-btn" class="stitch-btn stitch-btn-primary" style="width: 100%; height: var(--button-height-md); margin-top: var(--spacing-sm);">
            Hifadhi Mabadiliko (Save)
          </button>

          <button id="settings-logout-btn" class="stitch-btn" style="width: 100%; height: var(--button-height-md); margin-top: var(--spacing-xs); background-color: var(--color-error-container); color: var(--color-error); border: none; border-radius: var(--radius-lg); font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
            <span class="material-symbols-outlined" style="font-size: 18px;">logout</span> Ondoka Kwenye Akaunti (Logout)
          </button>
        </div>
      `;
    }

    return `
      <!-- Top App Bar -->
      <header class="stitch-header">
        <div class="stitch-header-content">
          <div class="stitch-flex stitch-align-center" style="gap: 10px;">
            <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 36px; height: 36px; border-radius: var(--radius-full); background: rgba(79, 70, 229, 0.1); color: var(--color-primary); shrink-0;">
              <span class="material-symbols-outlined" style="font-size: 20px;">storefront</span>
            </div>
            <h1 class="stitch-title-medium">CHIMBO Muuzaji</h1>
          </div>
          <button id="nav-btn-notif" class="stitch-btn stitch-btn-sm stitch-btn-flat" style="width: 36px; height: 36px; padding: 0; border-radius: var(--radius-full);">
            <span class="material-symbols-outlined" style="color: var(--color-on-surface); font-size: 20px;">notifications</span>
          </button>
        </div>
      </header>

      <main class="stitch-main" style="padding-top: 68px; display: flex; flex-direction: column; gap: var(--spacing-md);">
        
        <!-- Dashboard Navigation Tabs -->
        <div class="stitch-flex" style="border-bottom: 1px solid rgba(226, 232, 240, 0.5); width: 100%; margin-bottom: 4px; overflow-x: auto; -ms-overflow-style: none; scrollbar-width: none;">
          ${isApproved ? `
            <button id="tab-prods-btn" class="stitch-btn stitch-btn-flat" style="flex-shrink: 0; font-size: 11px; height: 40px; display: flex; align-items: center; justify-content: center; outline: none; ${activeTab === 'products' ? tabActiveStyle : tabInactiveStyle}">
              Bidhaa (Products)
            </button>
            <button id="tab-servs-btn" class="stitch-btn stitch-btn-flat" style="flex-shrink: 0; font-size: 11px; height: 40px; display: flex; align-items: center; justify-content: center; outline: none; ${activeTab === 'services' ? tabActiveStyle : tabInactiveStyle}">
              Huduma (Services)
            </button>
          ` : ''}
          <button id="tab-verif-btn" class="stitch-btn stitch-btn-flat" style="flex-shrink: 0; font-size: 11px; height: 40px; display: flex; align-items: center; justify-content: center; outline: none; ${activeTab === 'verification' ? tabActiveStyle : tabInactiveStyle}">
            Uhakiki (Verify)
          </button>
          <button id="tab-subs-btn" class="stitch-btn stitch-btn-flat" style="flex-shrink: 0; font-size: 11px; height: 40px; display: flex; align-items: center; justify-content: center; outline: none; ${activeTab === 'subscription' ? tabActiveStyle : tabInactiveStyle}">
            Usajili (Sub)
          </button>
          <button id="tab-settings-btn" class="stitch-btn stitch-btn-flat" style="flex-shrink: 0; font-size: 11px; height: 40px; display: flex; align-items: center; justify-content: center; outline: none; ${activeTab === 'settings' ? tabActiveStyle : tabInactiveStyle}">
            Mipangilio (Settings)
          </button>
        </div>

        <!-- Render the Active Tab Subview -->
        ${subViewContent}

      </main>

      ${renderGlobalNavbar('profile')}
    `;
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    return '<div class="stitch-flex stitch-justify-center stitch-align-center" style="padding: var(--spacing-lg); color: var(--color-error);">Hitilafu imetokea kwenye dashboard ya wauzaji.</div>';
  }
}

export function bindProviderDashboardEvents() {
  const user = auth.currentUser;
  if (!user) return;

  // Helper function to cache selected files and show instant local preview
  const bindFileInputToPreviewAndBase64 = (inputId: string, previewClass: string, isPdf: boolean = false, maxMb: number = 5) => {
    const input = document.getElementById(inputId) as HTMLInputElement;
    if (!input) return;

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) {
        if (isPdf) {
          const lowerName = file.name.toLowerCase();
          if (file.type !== 'application/pdf' || !lowerName.endsWith('.pdf')) {
            alert('Tafadhali pakia faili la PDF pekee (.pdf).');
            input.value = '';
            return;
          }
        }
        if (file.size > maxMb * 1024 * 1024) {
          alert(`Faili lisiwe kubwa kuliko MB ${maxMb}.`);
          input.value = '';
          return;
        }

        // Cache the file object in memory
        selectedFiles.set(inputId, file);

        // Show filename label if PDF
        if (isPdf) {
          const label = document.getElementById(inputId.replace('file-', 'label-'));
          if (label) label.innerText = file.name;
        }

        // Update image preview container using instant local object URL
        if (!isPdf) {
          const preview = input.parentElement?.querySelector(`.${previewClass}`);
          if (preview) {
            const objectUrl = URL.createObjectURL(file);
            preview.innerHTML = `<img src="${objectUrl}" style="width: 100%; height: 100%; object-fit: cover;" />`;
          }
        }
      }
    });
  };

  // Bind file inputs for product images (when form is active)
  if (productFormMode !== 'list') {
    ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'].forEach(angle => {
      bindFileInputToPreviewAndBase64(`file-${angle}`, `image-preview-container-${angle}`, false, 5);
    });
  }

  // Bind file inputs for verification documents (when active)
  if (activeTab === 'verification') {
    ['brela', 'tin', 'license'].forEach(docName => {
      bindFileInputToPreviewAndBase64(`file-${docName}`, '', true, 10);
    });
    [1, 2, 3].forEach(i => {
      bindFileInputToPreviewAndBase64(`file-photo-${i}`, `photo-preview-${i}`, false, 5);
    });
  }

  // --- Tab Swappers ---
  const tabProds = document.getElementById('tab-prods-btn');
  if (tabProds) {
    tabProds.addEventListener('click', () => {
      activeTab = 'products';
      productFormMode = 'list';
      editingProduct = null;
      navigateTo('provider-dashboard');
    });
  }

  const tabServs = document.getElementById('tab-servs-btn');
  if (tabServs) {
    tabServs.addEventListener('click', () => {
      activeTab = 'services';
      serviceFormMode = 'list';
      editingService = null;
      navigateTo('provider-dashboard');
    });
  }

  const tabVerif = document.getElementById('tab-verif-btn');
  if (tabVerif) {
    tabVerif.addEventListener('click', () => {
      activeTab = 'verification';
      navigateTo('provider-dashboard');
    });
  }

  const tabSubs = document.getElementById('tab-subs-btn');
  if (tabSubs) {
    tabSubs.addEventListener('click', () => {
      activeTab = 'subscription';
      navigateTo('provider-dashboard');
    });
  }

  const tabSettings = document.getElementById('tab-settings-btn');
  if (tabSettings) {
    tabSettings.addEventListener('click', () => {
      activeTab = 'settings';
      navigateTo('provider-dashboard');
    });
  }

  // --- Products Module Handlers ---
  const addProdTrig = document.getElementById('add-product-trigger');
  if (addProdTrig) {
    addProdTrig.addEventListener('click', () => {
      productFormMode = 'add';
      editingProduct = null;
      navigateTo('provider-dashboard');
    });
  }

  document.querySelectorAll('.edit-prod-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      try {
        const docRef = doc(db, 'products', id);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          editingProduct = { id: snap.id, ...snap.data() };
          productFormMode = 'edit';
          navigateTo('provider-dashboard');
        }
      } catch (err) {
        alert('Kushindwa kufungua fomu ya hariri.');
      }
    });
  });

  const prodCancelBtn = document.getElementById('prod-cancel-btn');
  if (prodCancelBtn) {
    prodCancelBtn.addEventListener('click', () => {
      productFormMode = 'list';
      editingProduct = null;
      navigateTo('provider-dashboard');
    });
  }

  const prodSaveBtn = document.getElementById('prod-save-btn');
  if (prodSaveBtn) {
    prodSaveBtn.addEventListener('click', async () => {
      const name = (document.getElementById('prod-name-input') as HTMLInputElement)?.value.trim();
      const category = (document.getElementById('prod-category-select') as HTMLSelectElement)?.value;
      const brand = (document.getElementById('prod-brand-input') as HTMLInputElement)?.value.trim();
      const description = (document.getElementById('prod-description-input') as HTMLTextAreaElement)?.value.trim();
      const featuresStr = (document.getElementById('prod-features-input') as HTMLInputElement)?.value.trim();
      const priceVal = parseFloat((document.getElementById('prod-price-input') as HTMLInputElement)?.value) || 0;
      const stockQtyVal = parseInt((document.getElementById('prod-stock-qty') as HTMLInputElement)?.value) || 0;
      const condition = (document.getElementById('prod-condition-select') as HTMLSelectElement)?.value;

      if (!name || priceVal <= 0 || !brand || !description) {
        alert('Tafadhali jaza nyuga zote zenye * kwa usahihi.');
        return;
      }

      prodSaveBtn.setAttribute('disabled', 'true');
      prodSaveBtn.innerHTML = 'Hifadhi...';

      try {
        const isEdit = productFormMode === 'edit';
        const productRef = isEdit ? doc(db, 'products', editingProduct.id) : doc(collection(db, 'products'));
        const productId = productRef.id;

        const features = featuresStr ? featuresStr.split(',').map(f => f.trim()) : [];

        const payload: any = {
          id: productId,
          providerId: user.uid,
          name,
          category,
          brand,
          description,
          features,
          price: priceVal,
          minPrice: priceVal,
          maxPrice: priceVal,
          condition,
          stockQuantity: stockQtyVal,
          stockStatus: stockQtyVal === 0 ? 'out_of_stock' : 'in_stock',
          qualityScore: editingProduct?.qualityScore || 90,
          trustScore: editingProduct?.trustScore || 85,
          isVerified: editingProduct?.isVerified || false,
          status: editingProduct?.status || 'pending',
          createdAt: editingProduct?.createdAt || new Date().toISOString()
        };

        console.log("[Product Save Diag] Writing product doc to Firestore...", productRef.path, "payload keys count:", Object.keys(payload).length);
        await setDoc(productRef, payload);

        // Save the 7 Images (signed Cloudinary uploads or preserve existing)
        const angles = ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'] as const;
        for (const angle of angles) {
          const inputId = `file-${angle}`;
          const file = selectedFiles.get(inputId);
          const imgDocId = `${productId}_${angle}`;
          const imgRef = doc(db, 'productImages', imgDocId);

          if (file) {
            console.log(`[Product Save Diag] Uploading new file to Cloudinary for ${angle} view...`);
            const uploadRes = await uploadFileToCloudinary(file, 'products');
            await setDoc(imgRef, {
              id: imgDocId,
              productId: productId,
              angle: angle,
              imageUrl: uploadRes.secureUrl,
              uploadedAt: uploadRes.uploadedAt || new Date().toISOString()
            });
          } else {
            // Check if we already have an existing image document in edit mode
            const input = document.getElementById(inputId) as HTMLInputElement;
            const existingUrl = input?.getAttribute('data-url') || '';
            
            if (isEdit && existingUrl) {
              const existingImgSnap = await getDoc(imgRef);
              if (!existingImgSnap.exists()) {
                await setDoc(imgRef, {
                  id: imgDocId,
                  productId: productId,
                  angle: angle,
                  imageUrl: existingUrl,
                  uploadedAt: new Date().toISOString()
                });
              }
            } else {
              // Write fallback metadata
              const fallbackUrl = `https://res.cloudinary.com/chimbo/image/upload/v1782046/${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${angle}.jpg`;
              await setDoc(imgRef, {
                id: imgDocId,
                productId: productId,
                angle: angle,
                imageUrl: fallbackUrl,
                uploadedAt: new Date().toISOString()
              });
            }
          }
        }
        selectedFiles.clear();
        await logAction(isEdit ? 'Product Updated' : 'Product Created', `User listed product: ${name} (ID: ${productId})`);
        alert('Bidhaa imehifadhiwa vizuri mtaani!');
        productFormMode = 'list';
        editingProduct = null;
        navigateTo('provider-dashboard');
      } catch (err: any) {
        console.error(err);
        alert('Imeshindwa kuhifadhi: ' + (err.message || String(err)));
        prodSaveBtn.removeAttribute('disabled');
        prodSaveBtn.innerHTML = 'Hifadhi';
      }
    });
  }

  document.querySelectorAll('.delete-prod-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      if (confirm('Je, una uhakika unataka kufuta bidhaa hii kabisa kwenye soko la CHIMBO?')) {
        try {
          await deleteDoc(doc(db, 'products', id));
          await logAction('Product Deleted', `Removed item ID ${id}`);
          
          const angles = ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'];
          for (const angle of angles) {
            try {
              await deleteDoc(doc(db, 'productImages', `${id}_${angle}`));
            } catch (_) {}
          }

          alert('Bidhaa imefutwa kwa ufanisi.');
          navigateTo('provider-dashboard');
        } catch (err) {
          alert('Imeshindwa kufuta bidhaa.');
        }
      }
    });
  });

  // --- Services Module Handlers ---
  const addServTrig = document.getElementById('add-service-trigger');
  if (addServTrig) {
    addServTrig.addEventListener('click', () => {
      serviceFormMode = 'add';
      editingService = null;
      navigateTo('provider-dashboard');
    });
  }

  document.querySelectorAll('.edit-serv-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      if (!id) return;
      try {
        const docRef = doc(db, 'services', id);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          editingService = { id: snap.id, ...snap.data() };
          serviceFormMode = 'edit';
          navigateTo('provider-dashboard');
        }
      } catch (err) {
        alert('Imeshindwa kufungua fomu ya huduma.');
      }
    });
  });

  const servCancelBtn = document.getElementById('serv-cancel-btn');
  if (servCancelBtn) {
    servCancelBtn.addEventListener('click', () => {
      serviceFormMode = 'list';
      editingService = null;
      navigateTo('provider-dashboard');
    });
  }

  const servSaveBtn = document.getElementById('serv-save-btn');
  if (servSaveBtn) {
    servSaveBtn.addEventListener('click', async () => {
      const name = (document.getElementById('serv-name-input') as HTMLInputElement)?.value.trim();
      const category = (document.getElementById('serv-category-select') as HTMLSelectElement)?.value;
      const coverageStr = (document.getElementById('serv-coverage-input') as HTMLInputElement)?.value.trim();
      const description = (document.getElementById('serv-description-input') as HTMLTextAreaElement)?.value.trim();
      const startingPrice = parseFloat((document.getElementById('serv-starting-price') as HTMLInputElement)?.value) || 0;

      if (!name || startingPrice <= 0 || !description) {
        alert('Tafadhali jaza nyuga zote zenye *');
        return;
      }

      servSaveBtn.setAttribute('disabled', 'true');
      servSaveBtn.innerHTML = 'Hifadhi...';

      try {
        const isEdit = serviceFormMode === 'edit';
        const serviceRef = isEdit ? doc(db, 'services', editingService.id) : doc(collection(db, 'services'));
        const serviceId = serviceRef.id;

        const coverageAreas = coverageStr ? coverageStr.split(',').map(a => a.trim()) : [];

        const payload = {
          id: serviceId,
          providerId: user.uid,
          name,
          category,
          description,
          startingPrice,
          minPrice: startingPrice,
          maxPrice: startingPrice,
          coverageAreas,
          isVerified: editingService?.isVerified || false,
          createdAt: editingService?.createdAt || new Date().toISOString()
        };

        await setDoc(serviceRef, payload);
        await logAction(isEdit ? 'Service Updated' : 'Service Created', `User listed service: ${name} (ID: ${serviceId})`);
        alert('Huduma imehifadhiwa vizuri!');
        serviceFormMode = 'list';
        editingService = null;
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la kuhifadhi: ' + (err.message || String(err)));
        servSaveBtn.removeAttribute('disabled');
        servSaveBtn.innerHTML = 'Hifadhi Huduma';
      }
    });
  }

  document.querySelectorAll('.delete-serv-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      if (confirm('Je, una uhakika unataka kufuta huduma hii kabisa?')) {
        try {
          await deleteDoc(doc(db, 'services', id));
          await logAction('Service Deleted', `Removed service ID ${id}`);
          alert('Huduma imefutwa kwa ufanisi.');
          navigateTo('provider-dashboard');
        } catch (err) {
          alert('Kufuta huduma imeshindikana.');
        }
      }
    });
  });

  // --- Verification PDF & Office Photo saving triggers ---
  document.querySelectorAll('.verif-save-doc-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const inputId = btn.getAttribute('data-input-id') || '';
      const input = document.getElementById(inputId) as HTMLInputElement;
      if (!input) return;

      const file = selectedFiles.get(inputId);
      const type = input.getAttribute('data-type') || '';
      const existingUrl = input.getAttribute('data-url') || '';

      if (!file && !existingUrl) {
        alert('Tafadhali chagua faili la PDF kwanza.');
        return;
      }

      btn.setAttribute('disabled', 'true');
      btn.innerHTML = 'Pakia...';

      try {
        const docId = `${user.uid}_${type.replace(/\s+/g, '_')}`;
        const docRef = doc(db, 'verificationDocuments', docId);

        if (file) {
          console.log(`[Verification] Uploading PDF for ${type}...`);
          const uploadRes = await uploadFileToCloudinary(file, 'verification');
          await setDoc(docRef, {
            id: docId,
            providerId: user.uid,
            type: type,
            fileUrl: uploadRes.secureUrl,
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          selectedFiles.delete(inputId);
        } else {
          alert('Faili halikubadilishwa.');
          btn.removeAttribute('disabled');
          btn.innerHTML = 'Hifadhi & Pakia';
          return;
        }

        await logAction('Verification Document Uploaded', `Uploaded PDF ${type} for provider ${user.uid}`);
        alert(`Faili la ${type} limehifadhiwa kikamilifu.`);
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la kuhifadhi: ' + err.message);
        btn.removeAttribute('disabled');
        btn.innerHTML = 'Hifadhi & Pakia';
      }
    });
  });

  document.querySelectorAll('.office-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = btn.getAttribute('data-index') || '';
      const inputId = `file-photo-${idx}`;
      const input = document.getElementById(inputId) as HTMLInputElement;
      if (!input) return;

      const file = selectedFiles.get(inputId);
      const existingUrl = input.getAttribute('data-url') || '';

      if (!file && !existingUrl) {
        alert('Tafadhali chagua picha kwanza.');
        return;
      }

      btn.setAttribute('disabled', 'true');
      btn.innerHTML = 'Pakia...';

      try {
        const docId = `${user.uid}_Office_Photo_${idx}`;
        const docRef = doc(db, 'verificationDocuments', docId);

        if (file) {
          console.log(`[Verification] Uploading Office Photo ${idx}...`);
          const uploadRes = await uploadFileToCloudinary(file, 'verification');
          await setDoc(docRef, {
            id: docId,
            providerId: user.uid,
            type: `Office Photo ${idx}`,
            fileUrl: uploadRes.secureUrl,
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          selectedFiles.delete(inputId);
        } else {
          alert('Picha haijabadilishwa.');
          btn.removeAttribute('disabled');
          btn.innerHTML = 'Save';
          return;
        }

        await logAction('Office Photo Uploaded', `Uploaded Office Photo ${idx} for provider ${user.uid}`);
        alert(`Picha ya Ofisi ${idx} imehifadhiwa.`);
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la kuhifadhi picha: ' + err.message);
        btn.removeAttribute('disabled');
        btn.innerHTML = 'Save';
      }
    });
  });

  // --- GPS Location Capture Trigger ---
  const gpsBtn = document.getElementById('gps-locate-btn');
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      gpsBtn.setAttribute('disabled', 'true');
      gpsBtn.innerHTML = 'Kutafuta GPS...';
      
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            const timestamp = new Date(position.timestamp).toISOString();

            try {
              let address = 'Kariakoo, Dar es Salaam';
              try {
                const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=sw,en`);
                if (res.ok) {
                  const data = await res.json();
                  address = data.display_name || data.address?.road || address;
                }
              } catch (e) {
                console.error('Failed to reverse geocode:', e);
              }

              const provRef = doc(db, 'providers', user.uid);
              await setDoc(provRef, {
                latitude: lat,
                longitude: lon,
                gpsAccuracy: accuracy,
                gpsTimestamp: timestamp,
                address: address
              }, { merge: true });

              await logAction('GPS Auto Captured', `Auto-captured provider coordinates: ${lat}, ${lon} (Accuracy: ${accuracy}m)`);
              alert('Mahali pa GPS pamethibitishwa na kuhifadhiwa kikamilifu!\nAnwani: ' + address);
              navigateTo('provider-dashboard');
            } catch (err: any) {
              alert('Imeshindwa kuhifadhi GPS: ' + err.message);
              gpsBtn.removeAttribute('disabled');
              gpsBtn.innerHTML = 'Sajili GPS coordinates';
            }
          },
          (error) => {
            alert('Hitilafu ya kupata GPS: ' + error.message);
            gpsBtn.removeAttribute('disabled');
            gpsBtn.innerHTML = 'Sajili GPS coordinates';
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      } else {
        alert('Browser yako haisupport geolocation.');
        gpsBtn.removeAttribute('disabled');
        gpsBtn.innerHTML = 'Sajili GPS coordinates';
      }
    });
  }

  // --- Wizard Navigation Listeners ---
  const wizPrevBtn = document.getElementById('wiz-prev-btn');
  if (wizPrevBtn) {
    wizPrevBtn.addEventListener('click', () => {
      if (verifWizardStep > 1) {
        verifWizardStep--;
        navigateTo('provider-dashboard');
      }
    });
  }

  const wizNextBtn = document.getElementById('wiz-next-btn');
  if (wizNextBtn) {
    wizNextBtn.addEventListener('click', async () => {
      if (verifWizardStep === 1) {
        const bizName = (document.getElementById('wiz-bizname') as HTMLInputElement)?.value.trim();
        const whatsapp = (document.getElementById('wiz-whatsapp') as HTMLInputElement)?.value.trim();
        const desc = (document.getElementById('wiz-description') as HTMLTextAreaElement)?.value.trim();
        const hours = (document.getElementById('wiz-hours') as HTMLInputElement)?.value.trim();

        if (!bizName || !whatsapp) {
          alert('Jina la Biashara na namba ya WhatsApp lazima zijazwe kwanza.');
          return;
        }

        try {
          wizNextBtn.setAttribute('disabled', 'true');
          wizNextBtn.innerHTML = 'Inahifadhi...';

          const provRef = doc(db, 'providers', user.uid);
          await setDoc(provRef, {
            businessName: bizName,
            whatsapp: whatsapp,
            description: desc,
            businessHours: hours,
            providerStatus: 'profile_incomplete'
          }, { merge: true });

          console.log('[Wizard Step 1] Profile details saved successfully.');
        } catch (err: any) {
          alert('Imeshindwa kuhifadhi taarifa: ' + err.message);
          wizNextBtn.removeAttribute('disabled');
          wizNextBtn.innerHTML = 'Hatua Inayofuata (Next)';
          return;
        }
      }

      if (verifWizardStep < 7) {
        verifWizardStep++;
        navigateTo('provider-dashboard');
      }
    });
  }

  const wizFinalSubmitBtn = document.getElementById('wiz-final-submit-btn');
  if (wizFinalSubmitBtn) {
    wizFinalSubmitBtn.addEventListener('click', async () => {
      wizFinalSubmitBtn.setAttribute('disabled', 'true');
      wizFinalSubmitBtn.innerHTML = 'Inawasilisha...';

      try {
        const provRef = doc(db, 'providers', user.uid);
        await setDoc(provRef, {
          providerStatus: 'verification_submitted',
          verificationStatus: 'pending',
          reviewStage: 'document_check',
          status: 'pending',
          verificationSubmittedAt: new Date().toISOString()
        }, { merge: true });

        await logAction('Verification Submitted', `Provider ${user.uid} submitted profile for verification.`);
        alert('Maombi yako ya uhakiki yamewasilishwa kikamilifu kwa Admin!');
        verifWizardStep = 1;
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la kuwasilisha maombi: ' + err.message);
        wizFinalSubmitBtn.removeAttribute('disabled');
        wizFinalSubmitBtn.innerHTML = 'Tuma kwa Uhakiki (Submit Verification)';
      }
    });
  }

  // --- Subscription Renewal Trigger ---
  const subSimPayBtn = document.getElementById('sub-simulate-pay-btn');
  if (subSimPayBtn) {
    subSimPayBtn.addEventListener('click', async () => {
      const planSel = document.getElementById('sub-plan-select') as HTMLSelectElement;
      const methodSel = document.getElementById('sub-paymethod-select') as HTMLSelectElement;

      const planVal = planSel.value;
      const priceVal = parseFloat(planSel.options[planSel.selectedIndex].getAttribute('data-price') || '0');
      const methodVal = methodSel.value;

      subSimPayBtn.setAttribute('disabled', 'true');
      subSimPayBtn.innerHTML = 'Inasubiri Malipo...';

      try {
        const payRef = doc(collection(db, 'payments'));
        const payId = payRef.id;
        const referenceCode = 'CHM-SUB-' + Math.floor(100000 + Math.random() * 900000);

        await setDoc(payRef, {
          id: payId,
          userId: user.uid,
          providerId: user.uid,
          amount: priceVal,
          paymentMethod: methodVal,
          status: 'success',
          referenceCode,
          createdAt: new Date().toISOString()
        });

        const subId = `${user.uid}_subscription`;
        const subRef = doc(db, 'subscriptions', subId);
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1);

        await setDoc(subRef, {
          id: subId,
          providerId: user.uid,
          plan: planVal,
          price: priceVal,
          status: 'active',
          expiresAt: expiryDate.toISOString(),
          createdAt: new Date().toISOString()
        });

        await logAction('Subscription Purchased', `Provider upgraded subscription to plan ${planVal} for TSh ${priceVal}`);
        alert(`Malipo yamekamilika! Kifurushi cha ${planVal.toUpperCase()} kimesajiliwa vyema.`);
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la malipo: ' + (err.message || String(err)));
        subSimPayBtn.removeAttribute('disabled');
        subSimPayBtn.innerHTML = 'Lipia na Kuanzisha Kifurushi';
      }
    });
  }

  // --- Settings Save Trigger ---
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', async () => {
      const bizName = (document.getElementById('settings-bizname') as HTMLInputElement)?.value.trim();
      const bizDesc = (document.getElementById('settings-bizdesc') as HTMLTextAreaElement)?.value.trim();
      const phone = (document.getElementById('settings-phone') as HTMLInputElement)?.value.trim();
      const whatsapp = (document.getElementById('settings-whatsapp') as HTMLInputElement)?.value.trim();
      const address = (document.getElementById('settings-address') as HTMLInputElement)?.value.trim();
      const hours = (document.getElementById('settings-hours') as HTMLInputElement)?.value.trim();

      if (!bizName || !phone) {
        alert('Jina la Biashara na namba ya simu lazima zijazwe.');
        return;
      }

      settingsSaveBtn.setAttribute('disabled', 'true');
      settingsSaveBtn.innerHTML = 'Inahifadhi...';

      try {
        const provRef = doc(db, 'providers', user.uid);
        await setDoc(provRef, {
          businessName: bizName,
          description: bizDesc,
          whatsapp: whatsapp,
          address: address,
          businessHours: hours
        }, { merge: true });

        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
          name: bizName,
          phoneNumber: phone
        }, { merge: true });

        if (state.userProfile) {
          state.userProfile.name = bizName;
          state.userProfile.phoneNumber = phone;
        }

        await logAction('Provider Settings Updated', `Provider updated business settings and contacts.`);
        alert('Mipangilio ya wasifu wako imesasishwa kwa ufanisi.');
        navigateTo('provider-dashboard');
      } catch (err: any) {
        alert('Kosa la kuhifadhi mipangilio: ' + err.message);
        settingsSaveBtn.removeAttribute('disabled');
        settingsSaveBtn.innerHTML = 'Hifadhi Mabadiliko (Save)';
      }
    });
  }

  // --- Settings Logout Flow ---
  const logoutBtn = document.getElementById('settings-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('Je, una uhakika unataka kuondoka kwenye akaunti yako?')) {
        try {
          await auth.signOut();
          alert('Umetoka kwenye akaunti kwa ufanisi.');
          navigateTo('home');
        } catch (err: any) {
          alert('Imeshindwa kuondoka: ' + err.message);
        }
      }
    });
  }

  // Warning Banner "Go to Subscription" redirect button
  const goToSubBtn = document.getElementById('go-to-sub-btn');
  if (goToSubBtn) {
    goToSubBtn.addEventListener('click', () => {
      activeTab = 'subscription';
      navigateTo('provider-dashboard');
    });
  }

  bindNavbarEvents();
}
