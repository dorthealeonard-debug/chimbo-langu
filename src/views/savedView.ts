import { state, navigateTo, toggleSaveProduct } from '../appState';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { RatedProduct } from '../services/bestDeal';
import { UserProfile } from '../types';
import { checkPassActive } from '../services/passService';

export async function renderSavedView(): Promise<string> {
  const user = state.currentUser;
  
  if (!user) {
    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content">
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Wasifu Wangu</h1>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px;">
        <div class="stitch-card animate-fade-in" style="align-items: center; text-align: center; gap: var(--spacing-md); padding: 24px;">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--color-outline-variant);">account_circle</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800;">Fungua Wasifu Wako</h3>
          <p class="stitch-body-small">Ingia na Barua Pepe au Google ila uweze kuona dashibodi yako na kuhifadhi bidhaa zako za favorites.</p>
          <button id="saved-login-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-weight: 700; height: 38px; padding: 0 20px;">Sajili au Ingia Sasa</button>
        </div>
      </main>
      ${renderGlobalNavbar('saved')}
    `;
  }

  const profile: UserProfile = state.userProfile || { id: '', name: 'Mteja', role: 'customer', passType: 'none', routeHistory: [], createdAt: '' };
  const isPassActive = checkPassActive(state.userProfile);

  // 1. Fetch saved products
  const savedProducts: RatedProduct[] = [];
  try {
    for (const pId of state.savedProductIds) {
      const docSnap = await getDoc(doc(db, 'products', pId));
      if (docSnap.exists()) {
        const data = docSnap.data();
        savedProducts.push({
          id: docSnap.id,
          providerId: data.providerId,
          name: data.name,
          price: data.price,
          category: data.category || 'electronics',
          condition: data.condition || 'used',
          qualityScore: data.qualityScore || 90,
          trustScore: data.trustScore || 85,
          badge: data.badge || 'none'
        });
      }
    }
  } catch (err) {
    console.error('Error loading saved products:', err);
  }

  // 2. Fetch images from productImages collection
  const imagesSnap = await getDocs(collection(db, 'productImages'));
  const imageMap = new Map<string, string>(); // productId -> front image url
  imagesSnap.forEach(d => {
    const data = d.data();
    if (data.angle === 'front') {
      imageMap.set(data.productId, data.secureUrl || data.imageUrl);
    }
  });

  const getProductFrontImage = (productId: string, category: string) => {
    const cached = imageMap.get(productId);
    if (cached) return cached;

    // Fallbacks
    if (category === 'electronics') {
      return 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=200&q=80';
    } else if (category === 'clothing' || category === 'women fashion' || category === 'men fashion') {
      return 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=200&q=80';
    } else if (category === 'parts' || category === 'auto parts') {
      return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=200&q=80';
    }
    return 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=200&q=80';
  };

  // 3. Fetch Price Protection reports history
  const priceReports: any[] = [];
  try {
    const q = query(collection(db, 'reports'), where('reporterId', '==', user.uid));
    const snap = await getDocs(q);
    snap.forEach(d => priceReports.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error loading reports history:', err);
  }

  // 4. Fetch user notifications
  const notifications: any[] = [];
  try {
    const q = query(collection(db, 'notifications'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    snap.forEach(d => notifications.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error loading notifications:', err);
  }

  // 5. Subscription pass variables
  const isTrial = profile.passType === 'free_trial';
  let passText = 'Hauna Pass Active';
  if (isPassActive && profile.passExpiresAt) {
    const expiry = new Date(profile.passExpiresAt);
    passText = `${profile.passType === 'free_trial' ? 'Trial ya Siku 7' : profile.passType === 'daily' ? 'Daily Pass' : 'Weekly Pass'} (Inaisha ${expiry.toLocaleDateString()})`;
  }

  // Dashboard sections
  const savedListHtml = savedProducts.length > 0 
    ? savedProducts.map(p => `
        <div class="stitch-card-sm hover-card active-scale" style="flex-direction: row; align-items: center; gap: var(--spacing-base); padding: var(--spacing-sm); background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-lg);">
          <div style="width: 52px; height: 52px; border-radius: var(--radius-md); overflow: hidden; background-color: var(--color-surface-container-low); flex-shrink: 0;">
            <img style="width: 100%; height: 100%; object-fit: cover;" src="${getProductFrontImage(p.id, p.category)}" alt="${p.name}"/>
          </div>
          <div style="flex: 1; min-width: 0;">
            <h4 style="font-size: 13px; font-weight: 800; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;">${p.name}</h4>
            <p style="font-size: 11px; font-weight: 900; color: var(--color-primary);">TSh ${p.price.toLocaleString()}</p>
          </div>
          <div class="stitch-flex stitch-gap-xs" style="flex-shrink: 0;">
            <button class="stitch-btn stitch-btn-sm stitch-btn-flat open-saved-btn active-scale" data-id="${p.id}" data-provider-id="${p.providerId}" style="width: 32px; height: 32px; padding: 0; border-radius: 50%;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-primary);">visibility</span>
            </button>
            <button class="stitch-btn stitch-btn-sm stitch-btn-flat delete-saved-btn active-scale" data-id="${p.id}" style="width: 32px; height: 32px; padding: 0; border-radius: 50%; background-color: var(--color-error-container); color: var(--color-error);">
              <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
            </button>
          </div>
        </div>
      `).join('')
    : `
      <div class="stitch-card-sm" style="padding: var(--spacing-lg); text-align: center; align-items: center; justify-content: center; background: var(--color-surface); border: 1.5px dashed var(--color-outline-variant); border-radius: var(--radius-xl); gap: var(--spacing-sm);">
        <span class="material-symbols-outlined" style="font-size: 40px; color: var(--color-primary); opacity: 0.8;">bookmark_heart</span>
        <div style="gap: var(--spacing-2xs); display: flex; flex-direction: column;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 800; color: var(--color-on-surface);">Huna Bidhaa Zilizohifadhiwa Bado</h4>
          <p style="font-size: 11.5px; color: var(--color-outline); line-height: 1.4; max-width: 240px; margin: 0 auto;">You have no saved products yet. Browse and save your favorite products to find them easily later.</p>
        </div>
        <button id="saved-browse-btn" class="stitch-btn stitch-btn-primary active-scale" style="height: 36px; font-size: 12px; font-weight: 700; border-radius: var(--radius-full); padding: 0 16px; margin-top: 4px;">
          Tafuta Bidhaa / Browse Products
        </button>
      </div>
    `;

  const routeHistoryHtml = (profile.routeHistory && profile.routeHistory.length > 0)
    ? profile.routeHistory.map((route: any) => `
        <div class="stitch-card-sm" style="padding: 12px; background: var(--color-surface-container-low); border: none; border-radius: var(--radius-lg); gap: 4px;">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <span class="stitch-badge stitch-badge-secondary" style="font-size: 8px; font-weight: 800;">SAFARI</span>
            <span style="font-size: 10px; color: var(--color-outline); font-weight: 500;">${new Date(route.timestamp).toLocaleDateString()}</span>
          </div>
          <h4 style="font-size: 12.5px; font-weight: 800; color: var(--color-on-surface); margin-top: 4px;">Njia ya Safari: Vituo ${route.providerIds ? route.providerIds.length : 1}</h4>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); font-weight: 500;">Umbali wa: ${route.totalDistance || 0} km • Muda: ${route.totalDuration || 0} min</p>
        </div>
      `).join('')
    : `
      <div class="stitch-card-sm" style="padding: var(--spacing-lg); text-align: center; align-items: center; justify-content: center; background: var(--color-surface); border: 1.5px dashed var(--color-outline-variant); border-radius: var(--radius-xl); gap: var(--spacing-sm);">
        <span class="material-symbols-outlined" style="font-size: 40px; color: var(--color-secondary); opacity: 0.8;">map</span>
        <div style="gap: var(--spacing-2xs); display: flex; flex-direction: column;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 800; color: var(--color-on-surface);">Hujasafiri kwa Njia Yoyote Bado</h4>
          <p style="font-size: 11.5px; color: var(--color-outline); line-height: 1.4; max-width: 240px; margin: 0 auto;">No routes planned yet. Use CHIMBO's smart navigation to plan optimized routes to Kariakoo markets.</p>
        </div>
        <button id="saved-plan-route-btn" class="stitch-btn stitch-btn-secondary active-scale" style="height: 36px; font-size: 12px; font-weight: 700; border-radius: var(--radius-full); padding: 0 16px; margin-top: 4px;">
          Gundua Njia / Explore Maps
        </button>
      </div>
    `;

  const priceReportsHtml = priceReports.length > 0
    ? priceReports.map(rep => `
        <div class="stitch-card-sm" style="padding: 10px 12px; background: var(--color-surface-container-low); border: none; border-radius: var(--radius-lg); gap: var(--spacing-2xs);">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <span style="font-size: 12px; font-weight: 800; color: var(--color-error);">${rep.reason}</span>
            <span class="stitch-badge ${rep.status === 'resolved' ? 'stitch-badge-primary' : 'stitch-badge-secondary'}" style="font-size: 8px; font-weight: 800;">${rep.status.toUpperCase()}</span>
          </div>
          <p style="font-size: 11.5px; color: var(--color-on-surface); font-weight: 600; margin-top: 2px;">Aliomba: TSh ${rep.requestedPrice?.toLocaleString()} (CHIMBO: TSh ${rep.displayedPrice?.toLocaleString()})</p>
          <p style="font-size: 10.5px; color: var(--color-outline); font-style: italic;">Maoni: ${rep.description}</p>
        </div>
      `).join('')
    : `
      <div class="stitch-card-sm" style="padding: var(--spacing-md); text-align: center; align-items: center; justify-content: center; background: var(--color-surface); border: 1.5px dashed var(--color-outline-variant); border-radius: var(--radius-xl); gap: var(--spacing-xs);">
        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-error); opacity: 0.7;">gavel</span>
        <div style="gap: 2px; display: flex; flex-direction: column;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: var(--color-on-surface);">Huna Ripoti Zilizotuma Bado</h4>
          <p style="font-size: 11px; color: var(--color-outline); line-height: 1.4;">No price protection reports filed. Help keep Kariakoo prices transparent!</p>
        </div>
      </div>
    `;

  const notificationsHtml = notifications.length > 0
    ? notifications.map(notif => `
        <div class="stitch-card-sm" style="padding: 10px 12px; background: ${notif.read ? 'var(--color-surface-container-low)' : 'rgba(79, 70, 229, 0.05)'}; border: 1px solid ${notif.read ? 'transparent' : 'rgba(79, 70, 229, 0.15)'}; border-radius: var(--radius-lg);">
          <h4 style="font-size: 12.5px; font-weight: 800; color: var(--color-on-surface);">${notif.title}</h4>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); margin-top: 2px;">${notif.body}</p>
        </div>
      `).join('')
    : `
      <div class="stitch-card-sm" style="padding: var(--spacing-md); text-align: center; align-items: center; justify-content: center; background: var(--color-surface); border: 1.5px dashed var(--color-outline-variant); border-radius: var(--radius-xl); gap: var(--spacing-xs);">
        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-outline); opacity: 0.7;">mail</span>
        <div style="gap: 2px; display: flex; flex-direction: column;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: var(--color-on-surface);">Inbox Yako Iko Wazi</h4>
          <p style="font-size: 11px; color: var(--color-outline); line-height: 1.4;">No new alerts. We will notify you when a seller updates products or verifies status.</p>
        </div>
      </div>
    `;

  return `
    <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content">
        <button id="saved-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
        </button>
        <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Customer Dashboard</h1>
        <div style="width: 36px;"></div>
      </div>
    </header>

    <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 100px;">
      
      <!-- Profile Widget -->
      <section class="stitch-card" style="background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-md);">
        <div class="stitch-flex stitch-align-center stitch-gap-base">
          <div style="width: 50px; height: 50px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary), #818cf8); color: white; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 16px; text-transform: uppercase;">
            ${(profile.name || 'U').substring(0, 2)}
          </div>
          <div>
            <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface);">${profile.name || 'Mteja'}</h3>
            <p style="font-size: 11.5px; color: var(--color-on-surface-variant); font-weight: 500;">${user.email || user.phoneNumber || 'Mtumiaji wa CHIMBO'}</p>
          </div>
        </div>

        <div class="stitch-grid-2" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm); margin-top: 2px;">
          <div>
            <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Pass Yako</span>
            <p style="font-size: 12px; font-weight: 900; color: var(--color-primary); margin-top: 1px;">${passText}</p>
          </div>
          <div>
            <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Aina ya Jukumu</span>
            <span class="stitch-badge stitch-badge-primary" style="font-size: 8.5px; font-weight: 800; padding: 2px 6px; align-self: flex-start; margin-top: 1px; display: inline-block;">${profile.role}</span>
          </div>
        </div>


      </section>

      <!-- Trust Information widget -->
      <section class="stitch-card shadow-premium" style="background: linear-gradient(135deg, rgba(5, 150, 105, 0.06) 0%, rgba(5, 150, 105, 0.02) 100%); border: 1.5px solid rgba(5, 150, 105, 0.2); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-xs);">
        <div class="stitch-flex stitch-align-center stitch-gap-xs" style="color: var(--color-secondary);">
          <span class="material-symbols-outlined" style="font-size: 18px; font-variation-settings: 'FILL' 1;">shield</span>
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 12.5px; font-weight: 900; text-transform: uppercase;">Ulinzi & Uaminifu wa CHIMBO</h4>
        </div>
        <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.45;">
          CHIMBO inakuhakikishia usalama wa safari yako ya manunuzi. Wauzaji wote wanapitia uhakiki wa leseni na TIN, na bei zote zinakaguliwa nyanjani kuzuia madalali.
        </p>
      </section>

      <!-- Saved Products & Favorites -->
      <section style="margin-top: 10px;">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); border-bottom: 1.5px solid rgba(226, 232, 240, 0.6); padding-bottom: 6px; margin-bottom: 12px;">Bidhaa Nilizozihifadhi (Favorites)</h3>
        <div class="stitch-flex stitch-flex-col stitch-gap-xs">
          ${savedListHtml}
        </div>
      </section>

      <!-- Recent Routes & history -->
      <section style="margin-top: 10px;">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); border-bottom: 1.5px solid rgba(226, 232, 240, 0.6); padding-bottom: 6px; margin-bottom: 12px;">Njia zangu za Safari (Route History)</h3>
        <div class="stitch-flex stitch-flex-col stitch-gap-sm">
          ${routeHistoryHtml}
        </div>
      </section>

      <!-- Price Reports history -->
      <section style="margin-top: 10px;">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); border-bottom: 1.5px solid rgba(226, 232, 240, 0.6); padding-bottom: 6px; margin-bottom: 12px;">Ripoti Zangu za Bei (Price Reports)</h3>
        <div class="stitch-flex stitch-flex-col stitch-gap-sm">
          ${priceReportsHtml}
        </div>
      </section>

      <!-- Notifications inbox -->
      <section style="margin-top: 10px;">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); border-bottom: 1.5px solid rgba(226, 232, 240, 0.6); padding-bottom: 6px; margin-bottom: 12px;">Arifa za Mfumo (Notifications)</h3>
        <div class="stitch-flex stitch-flex-col stitch-gap-xs">
          ${notificationsHtml}
        </div>
      </section>

    </main>

    ${renderGlobalNavbar('saved')}
  `;
}

export function bindSavedEvents() {
  const backBtn = document.getElementById('saved-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));

  const loginBtn = document.getElementById('saved-login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      navigateTo('auth');
    });
  }

  const browseBtn = document.getElementById('saved-browse-btn');
  if (browseBtn) {
    browseBtn.addEventListener('click', () => {
      navigateTo('home');
    });
  }

  const planRouteBtn = document.getElementById('saved-plan-route-btn');
  if (planRouteBtn) {
    planRouteBtn.addEventListener('click', () => {
      navigateTo('home');
    });
  }



  document.querySelectorAll('.open-saved-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pId = btn.getAttribute('data-id');
      const prId = btn.getAttribute('data-provider-id');
      navigateTo('detail', pId, prId);
    });
  });

  document.querySelectorAll('.delete-saved-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pId = btn.getAttribute('data-id');
      if (pId) {
        toggleSaveProduct(pId);
        navigateTo('saved');
      }
    });
  });

  bindNavbarEvents();
}
