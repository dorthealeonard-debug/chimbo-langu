import { state, navigateTo, toggleSaveProduct, isProductSaved } from '../appState';
import { loginWithGoogle, logoutUser, db, auth } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where, limit } from 'firebase/firestore';
import { checkPassActive } from '../services/passService';
import { setSearchCategoryFilter } from './searchView';
import { maskProviderName, getGeneralArea } from '../utils/privacy';

export async function renderHomeView(): Promise<string> {
  const user = state.currentUser;
  const isPassActive = checkPassActive(state.userProfile);
  
  const activeUnlockedIds = new Set<string>();
  if (user) {
    try {
      const q = query(
        collection(db, 'accessTokens'),
        where('userId', '==', user.uid),
        where('status', '==', 'active')
      );
      const tokensSnap = await getDocs(q);
      tokensSnap.forEach(docSnap => {
        const d = docSnap.data();
        if (d.providerId) activeUnlockedIds.add(d.providerId);
      });
    } catch (e) {
      console.error('Error fetching active unlocks on home:', e);
    }
  }

  // 1. Fetch data from Firestore
  let providers: any[] = [];
  let products: any[] = [];
  let services: any[] = [];
  let productImages: any[] = [];

  try {
    const providersSnap = await getDocs(collection(db, 'providers'));
    providersSnap.forEach(d => {
      const data = d.data();
      if (data.status === 'approved') {
        const lat = data.latitude || -6.8184;
        const lon = data.longitude || 39.2826;
        const R = 6371; // Earth radius in km
        const dLat = (lat - state.userLocation.lat) * Math.PI / 180;
        const dLon = (lon - state.userLocation.lon) * Math.PI / 180;
        const a = 
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(state.userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
          Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const dist = parseFloat((R * c).toFixed(1));

        providers.push({ id: d.id, ...data, distance: dist });
      }
    });

    const productsSnap = await getDocs(collection(db, 'products'));
    productsSnap.forEach(d => {
      const data = d.data();
      const prov = providers.find(p => p.id === data.providerId);
      if (prov && data.status === 'approved') {
        products.push({
          id: d.id,
          ...data,
          providerName: prov.businessName,
          area: prov.address || 'Kariakoo',
          distance: prov.distance,
          trustScore: prov.trustScore || data.trustScore || 85
        });
      }
    });

    const servicesSnap = await getDocs(collection(db, 'services'));
    servicesSnap.forEach(d => {
      const data = d.data();
      const prov = providers.find(p => p.id === data.providerId);
      if (prov && data.isVerified) {
        services.push({
          id: d.id,
          ...data,
          providerName: prov.businessName,
          area: prov.address || 'Kariakoo',
          distance: prov.distance,
          trustScore: prov.trustScore || 80
        });
      }
    });

    const imagesSnap = await getDocs(collection(db, 'productImages'));
    imagesSnap.forEach(d => {
      productImages.push(d.data());
    });
  } catch (err) {
    console.error('Error loading home view data from Firestore:', err);
  }

  // Fallback mock data has been removed per production directives.
  // The soko operates exclusively on live Firestore collections.

  // Get front image for products
  const getProductFrontImage = (productId: string, category: string) => {
    const imgObj = productImages.find(img => img.productId === productId && img.angle === 'front');
    if (imgObj && (imgObj.secureUrl || imgObj.imageUrl)) return imgObj.secureUrl || imgObj.imageUrl;

    // Fallbacks
    if (category === 'electronics') {
      return 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=400&q=80';
    } else if (category === 'clothing' || category === 'women fashion' || category === 'men fashion') {
      return 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=400&q=80';
    } else if (category === 'parts' || category === 'auto parts') {
      return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=400&q=80';
    }
    return 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=400&q=80';
  };

  // Sort lists for carousels and sections
  // Carousel 1: Nearby Products (distance ASC)
  const nearbyProducts = [...products].sort((a, b) => (a.distance || 99) - (b.distance || 99));

  // Carousel 2: Trending Products (viewCount DESC)
  const trendingProducts = [...products].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));

  // Carousel 3: New Products (createdAt DESC)
  const newProducts = [...products].sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());

  // Nearby Providers (distance ASC)
  const nearbyProviders = [...providers].sort((a, b) => a.distance - b.distance).slice(0, 5);

  // Recommendations: high quality and high trust
  const recommendedProducts = [...products]
    .sort((a, b) => ((b.qualityScore || 85) + (b.trustScore || 85)) - ((a.qualityScore || 85) + (a.trustScore || 85)))
    .slice(0, 4);

  // Render Header
  const headerHtml = `
    <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content">
        <div class="stitch-flex stitch-align-center stitch-gap-xs active-scale" id="brand-logo" style="cursor: pointer;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 26px; font-variation-settings: 'FILL' 1;">explore</span>
          <span class="stitch-title-display" style="font-size: 22px; font-family: 'Space Grotesk', sans-serif; font-weight: 900; letter-spacing: -1px; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">CHIMBO</span>
        </div>
        <div class="stitch-flex stitch-align-center stitch-gap-xs">
          ${user ? `
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <div id="profile-avatar" style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary), #818cf8); color: white; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 11px; text-transform: uppercase; cursor: pointer;">
                ${(state.userProfile?.name || user.displayName || 'U').substring(0, 1)}
              </div>
              <button id="logout-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="font-size: 11px; padding: 4px 8px; color: var(--color-outline);">Ondoka</button>
            </div>
          ` : `
            <button id="login-btn" class="stitch-btn stitch-btn-sm stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-size: 11px; height: 32px; padding: 0 14px;">Ingia</button>
          `}
        </div>
      </div>
    </header>
  `;

  // Animated Hero Section
  const heroHtml = `
    <section class="animate-fade-in" style="margin-top: 10px;">
      <div class="stitch-card shadow-premium" style="background: linear-gradient(135deg, rgba(79, 70, 229, 0.09) 0%, rgba(99, 102, 241, 0.03) 100%); border: 1px solid rgba(79, 70, 229, 0.15); border-radius: var(--radius-card-radius); padding: 24px; position: relative; overflow: hidden;">
        <!-- Glowing background blobs -->
        <div style="position: absolute; top: -20px; right: -20px; width: 100px; height: 100px; background: rgba(79, 70, 229, 0.2); filter: blur(40px); border-radius: 50%;"></div>
        <div style="position: absolute; bottom: -30px; left: -10px; width: 80px; height: 80px; background: rgba(236, 72, 153, 0.15); filter: blur(35px); border-radius: 50%;"></div>

        <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 900; line-height: 1.2; color: var(--color-on-surface); letter-spacing: -0.5px; margin-bottom: 8px;">
          Gundua Wauzaji Halisi wa <span style="background: linear-gradient(90deg, var(--color-primary), var(--color-secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Tanzania</span>
        </h2>
        <p class="stitch-body-small" style="font-size: 12.5px; color: var(--color-on-surface-variant); margin-bottom: var(--spacing-md); line-height: 1.45;">
          Hatuna cart, hatuna bargaining. Pata wauzaji wa kweli wenye bei elekezi zilizothibitishwa Kariakoo, na uongozwe na GPS hadi mlangoni mwa duka.
        </p>

        <!-- Large Search Box -->
        <div class="stitch-input-container" style="position: relative; width: 100%; border-radius: var(--radius-full); overflow: hidden; box-shadow: var(--shadow-md); border: 1.5px solid rgba(79, 70, 229, 0.22); transition: border-color 0.2s;">
          <span class="material-symbols-outlined stitch-input-icon" style="color: var(--color-primary); left: 16px;">search</span>
          <input id="main-search-input" class="stitch-input" placeholder="Tafuta Samsung A56, Fundi AC..." type="text" style="padding-left: 46px; padding-right: 90px; height: 50px; font-size: 13.5px; border-radius: var(--radius-full); border: none; background: white;">
          <button id="main-search-btn" class="stitch-btn stitch-btn-primary active-scale" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); height: 38px; border-radius: var(--radius-full); padding: 0 18px; font-weight: 700; font-size: 11.5px; letter-spacing: 0.5px;">TAFUTA</button>
        </div>
      </div>
    </section>
  `;

  // Categories Shortcuts
  const categoriesHtml = `
    <section class="animate-fade-in" style="margin-top: 5px;">
      <div class="stitch-mb-xs">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 800; color: var(--color-on-surface);">Kundi la Bidhaa</h3>
      </div>
      
      <div class="stitch-grid-3" style="gap: var(--spacing-xs);">
        <div class="category-emoji-card" data-category="smartphones">
          <span style="font-size: 26px;">📱</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Simu / Tech</span>
        </div>
        <div class="category-emoji-card" data-category="laptops">
          <span style="font-size: 26px;">💻</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Kompyuta</span>
        </div>
        <div class="category-emoji-card" data-category="electronics">
          <span style="font-size: 26px;">📺</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Electronics</span>
        </div>
        <div class="category-emoji-card" data-category="women fashion">
          <span style="font-size: 26px;">👗</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Kike Fashion</span>
        </div>
        <div class="category-emoji-card" data-category="men fashion">
          <span style="font-size: 26px;">👔</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Kiume Fashion</span>
        </div>
        <div class="category-emoji-card" data-category="auto parts">
          <span style="font-size: 26px;">⚙</span>
          <span style="font-size: 11px; font-weight: 700; color: var(--color-on-surface-variant);">Auto Parts</span>
        </div>
      </div>
    </section>
  `;

  // Trust Explanation Section
  const trustExplanationHtml = `
    <section class="animate-fade-in" style="margin-top: 5px;">
      <div class="stitch-card" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.06) 0%, rgba(16, 185, 129, 0.01) 100%); border: 1.5px solid rgba(16, 185, 129, 0.18); border-radius: var(--radius-xl); padding: var(--spacing-base); display: flex; flex-direction: row; gap: var(--spacing-base); align-items: flex-start;">
        <span class="material-symbols-outlined" style="color: var(--color-secondary); font-size: 32px; margin-top: 2px;">gavel</span>
        <div>
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; color: var(--color-on-surface); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px;">Mfumo wa Uaminifu (Trust Shield)</h4>
          <p style="font-size: 11.5px; color: var(--color-on-surface-variant); line-height: 1.45;">
            CHIMBO siyo soko la mtandaoni la kununua vitu kwa kadi na kupelekewa nyumbani. Wauzaji wote wamethibitishwa maeneo yao ya biashara, na bei zote zimeidhinishwa kuwa za kweli. Ukikutana na mabadiliko ya bei dukani, ripoti nasi tutamshusha trust score yake!
          </p>
        </div>
      </div>
    </section>
  `;

  // Carousel Helper: Returns continuous infinite-scrolling tracks
  // Carousel 1: Nearby Products -> LEFT to RIGHT (carousel-track-right)
  // Carousel 2: Trending Products -> RIGHT to LEFT (carousel-track-left)
  // Carousel 3: New Products -> LEFT to RIGHT (carousel-track-right)
  const renderProductCarousel = (title: string, subtitle: string, items: any[], trackClass: 'carousel-track-left' | 'carousel-track-right', type: 'nearby' | 'trending' | 'new') => {
    if (items.length === 0) return '';
 
    // Duplicate list items to create the infinite scrolling loop effect
    const loopItems = [...items, ...items];
 
    const cardsMarkup = loopItems.map((item, idx) => {
      const saved = isProductSaved(item.id);
      const imgUrl = getProductFrontImage(item.id, item.category);
      const cleanDistance = item.distance !== undefined ? `${item.distance} km` : '0.0 km';
      
      const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
      const isSelf = user && (user.uid === item.providerId);
      const isUnlocked = isStaffOrAdmin || isSelf || activeUnlockedIds.has(item.providerId);

      const displayProviderName = isUnlocked ? item.providerName : maskProviderName(item.providerName);
      const cleanArea = getGeneralArea(item.area);
 
      let badgeContent = '';
      if (type === 'nearby') {
        badgeContent = `<span style="font-size: 8.5px; font-weight: 800; color: var(--color-secondary); background: rgba(5, 150, 105, 0.08); padding: 2px 6px; border-radius: var(--radius-sm);">${cleanDistance}</span>`;
      } else if (type === 'trending') {
        badgeContent = `<span style="font-size: 8.5px; font-weight: 800; color: var(--color-primary); background: rgba(79, 70, 229, 0.08); padding: 2px 6px; border-radius: var(--radius-sm);">🔥 ${item.viewCount || 0} views</span>`;
      } else {
        badgeContent = `<span style="font-size: 8.5px; font-weight: 800; color: #d97706; background: rgba(217, 119, 6, 0.08); padding: 2px 6px; border-radius: var(--radius-sm);">New</span>`;
      }
 
      return `
        <div class="stitch-card hover-card active-scale product-card-click" data-id="${item.id}" data-provider-id="${item.providerId}" style="width: 220px; padding: 0; overflow: hidden; background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); cursor: pointer; display: flex; flex-direction: column; flex-shrink: 0; text-align: left;">
          <!-- Large Product Image -->
          <div style="height: 135px; width: 100%; overflow: hidden; background-color: var(--color-surface-container-low); position: relative;">
            <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="${item.name}">
            <div style="position: absolute; top: 8px; left: 8px; display: flex; gap: 4px; z-index: 5;">
              ${badgeContent}
            </div>
            <!-- Trust badge -->
            <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(2px); color: white; padding: 2px 6px; border-radius: var(--radius-sm); font-size: 8.5px; font-weight: 900;">
              ${item.trustScore || 80}% Trust
            </div>
          </div>
          <!-- Card Info -->
          <div style="padding: var(--spacing-sm); display: flex; flex-direction: column; gap: 6px; flex-grow: 1; justify-content: space-between;">
            <div style="display: flex; flex-direction: column; gap: 3px;">
              <h4 style="font-size: 13px; font-weight: 900; color: var(--color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</h4>
              
              <!-- Provider Name -->
              <p style="font-size: 10px; color: var(--color-on-surface-variant); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px;">
                <span class="material-symbols-outlined" style="font-size: 13px; color: var(--color-primary);">storefront</span>
                <span>${displayProviderName}</span>
              </p>
 
              <!-- Area & Distance -->
              <div class="stitch-flex stitch-justify-between stitch-align-center" style="font-size: 9.5px; color: var(--color-outline); font-weight: 500; margin-top: 1px;">
                <span style="display: flex; align-items: center; gap: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;">
                  <span class="material-symbols-outlined" style="font-size: 12px;">location_on</span>
                  <span>${cleanArea}</span>
                </span>
                <span style="display: flex; align-items: center; gap: 2px; flex-shrink: 0; color: var(--color-secondary); font-weight: 700;">
                  <span class="material-symbols-outlined" style="font-size: 12px; font-variation-settings: 'FILL' 1;">explore</span>
                  <span>${cleanDistance}</span>
                </span>
              </div>
            </div>
 
            <div class="stitch-flex stitch-flex-col stitch-gap-xs" style="margin-top: 4px; border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: 6px;">
              <!-- Price -->
              <span style="font-size: 14px; font-weight: 900; color: var(--color-primary);">TSh ${item.price.toLocaleString()}</span>
              
              <!-- View Details Button -->
              <button class="stitch-btn stitch-btn-sm stitch-btn-primary active-scale" style="width: 100%; border-radius: var(--radius-md); font-weight: 800; font-size: 10px; height: 32px;">
                View Details
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
 
    return `
      <section class="animate-fade-in" style="margin-top: var(--spacing-sm); width: 100%;">
        <div class="stitch-mb-xs" style="padding-left: 2px;">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface); line-height: 1.1;">${title}</h3>
          <p style="font-size: 11px; color: var(--color-outline); margin-top: 1px;">${subtitle}</p>
        </div>
        <div class="carousel-container">
          <div class="${trackClass}">
            ${cardsMarkup}
          </div>
        </div>
      </section>
    `;
  };

  // Popular Services section
  const renderServicesSection = () => {
    if (services.length === 0) return '';
    return `
      <section class="animate-fade-in" style="margin-top: var(--spacing-base);">
        <div class="stitch-mb-xs">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface);">Popular Services / Mafundi</h3>
          <p style="font-size: 11px; color: var(--color-outline); margin-top: 1px;">Mafundi na wataalamu waliothibitishwa kwa ukarabati na huduma nyanjani</p>
        </div>
        <div class="stitch-flex stitch-flex-col stitch-gap-xs">
          ${services.map(item => {
            const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
            const isSelf = user && (user.uid === item.providerId);
            const isUnlocked = isStaffOrAdmin || isSelf || activeUnlockedIds.has(item.providerId);
            const displayProviderName = isUnlocked ? item.providerName : maskProviderName(item.providerName);
            const displayArea = getGeneralArea(item.area);
            return `
              <div class="stitch-card-sm hover-card active-scale service-card-click" data-id="${item.id}" data-provider-id="${item.providerId}" style="background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-lg); padding: 12px; cursor: pointer; display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px;">
                <div class="stitch-flex stitch-align-center stitch-gap-base" style="flex: 1; min-width: 0;">
                  <div style="width: 40px; height: 40px; border-radius: var(--radius-md); background: var(--color-tertiary-container); color: var(--color-tertiary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <span class="material-symbols-outlined" style="font-size: 20px;">construction</span>
                  </div>
                  <div style="flex: 1; min-width: 0;">
                    <h4 style="font-size: 13.5px; font-weight: 800; color: var(--color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${item.name}</h4>
                    <p style="font-size: 10px; color: var(--color-outline); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Fundi: ${displayProviderName} • Eneo: ${displayArea}</p>
                  </div>
                </div>
                <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                  <span style="font-size: 13.5px; font-weight: 900; color: var(--color-secondary);">TSh ${item.startingPrice.toLocaleString()}</span>
                  <span style="font-size: 8.5px; font-weight: 800; color: var(--color-secondary); background: rgba(5, 150, 105, 0.05); padding: 2px 6px; border-radius: var(--radius-sm);">${item.trustScore || 80}% Trust</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  };

  // Nearby Providers section
  const renderProvidersSection = () => {
    if (nearbyProviders.length === 0) return '';
    return `
      <section class="animate-fade-in" style="margin-top: var(--spacing-base);">
        <div class="stitch-mb-xs">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface);">Wauzaji Waliopo Karibu Nawe</h3>
          <p style="font-size: 11px; color: var(--color-outline); margin-top: 1px;">Kagua maduka na biashara zilizothibitishwa ofisi zao za mtaani</p>
        </div>
        <div class="stitch-grid-2" style="gap: var(--spacing-sm);">
          ${nearbyProviders.map(item => {
            const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
            const isSelf = user && (user.uid === item.id);
            const isUnlocked = isStaffOrAdmin || isSelf || activeUnlockedIds.has(item.id);
            const displayProviderName = isUnlocked ? item.businessName : maskProviderName(item.businessName);
            const displayArea = getGeneralArea(item.address);
            const displayStreet = isUnlocked ? (item.street || 'Aggrey Street') : '****** St';
            return `
              <div class="stitch-card hover-card active-scale provider-card-click" data-id="${item.id}" style="padding: var(--spacing-base); background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); cursor: pointer; display: flex; flex-direction: column; gap: 8px;">
                <div class="stitch-flex stitch-justify-between stitch-align-center">
                  <div class="stitch-flex stitch-align-center stitch-gap-2xs" style="color: var(--color-primary);">
                    <span class="material-symbols-outlined" style="font-size: 14px; font-variation-settings: 'FILL' 1;">verified</span>
                    <span style="font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.3px;">Verified</span>
                  </div>
                  <div style="font-size: 9px; font-weight: 800; color: var(--color-secondary); background: rgba(5, 150, 105, 0.06); padding: 1px 5px; border-radius: var(--radius-sm);">
                    ${item.trustScore || 85}% Trust
                  </div>
                </div>
                <div>
                  <h4 style="font-size: 13px; font-weight: 900; color: var(--color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${displayProviderName}</h4>
                  <p style="font-size: 10px; color: var(--color-outline); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Eneo: ${displayArea}</p>
                </div>
                <div class="stitch-flex stitch-justify-between" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: 6px; margin-top: 4px; font-size: 10px; color: var(--color-on-surface-variant); font-weight: bold;">
                  <span>📍 ${displayStreet}</span>
                  <span>${item.distance}km mbali</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  };

  // Recommendations section
  const renderRecommendationsSection = () => {
    if (recommendedProducts.length === 0) return '';
    return `
      <section class="animate-fade-in" style="margin-top: var(--spacing-base);">
        <div class="stitch-mb-xs">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: var(--color-on-surface);">Recommended For You</h3>
          <p style="font-size: 11px; color: var(--color-outline); margin-top: 1px;">Bidhaa bora zaidi zenye daraja la juu la ubora na uaminifu</p>
        </div>
        <div class="stitch-grid-2" style="gap: var(--spacing-sm);">
          ${recommendedProducts.map(item => {
            const imgUrl = getProductFrontImage(item.id, item.category);
            
            const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
            const isSelf = user && (user.uid === item.providerId);
            const isUnlocked = isStaffOrAdmin || isSelf || activeUnlockedIds.has(item.providerId);
            const displayProviderName = isUnlocked ? item.providerName : maskProviderName(item.providerName);
            
            return `
              <div class="stitch-card hover-card active-scale product-card-click" data-id="${item.id}" data-provider-id="${item.providerId}" style="padding: 0; overflow: hidden; background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); cursor: pointer; display: flex; flex-direction: column;">
                <div style="height: 100px; width: 100%; overflow: hidden; background-color: var(--color-surface-container-low); position: relative;">
                  <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="${item.name}">
                  <div style="position: absolute; bottom: 6px; left: 6px; background: rgba(5, 150, 105, 0.9); color: white; padding: 2px 6px; border-radius: var(--radius-full); font-size: 8px; font-weight: 800;">
                    ${item.trustScore || 85}% TRUST
                  </div>
                </div>
                <div style="padding: 10px; display: flex; flex-direction: column; gap: 2px;">
                  <h4 style="font-size: 12.5px; font-weight: 800; color: var(--color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</h4>
                  <p style="font-size: 9.5px; color: var(--color-outline); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Duka: ${displayProviderName}</p>
                  <p style="font-size: 13px; font-weight: 900; color: var(--color-primary); margin-top: 4px;">TSh ${item.price.toLocaleString()}</p>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  };

  // Subscription Widget
  let subscriptionWidgetHtml = '';
  if (user && state.userProfile) {
    const profile = state.userProfile;
    const expiry = profile.passExpiresAt ? new Date(profile.passExpiresAt) : null;
    const now = new Date();
    const isTrial = profile.passType === 'free_trial';
    
    let timeText = 'Pass Imeisha Muda';
    let percentText = '0%';
    let strokeDashOffset = 100;
    
    if (isPassActive && expiry) {
      const diffMs = expiry.getTime() - now.getTime();
      const totalMs = isTrial ? 7 * 24 * 60 * 60 * 1000 : (profile.passType === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000);
      const percent = Math.min(100, Math.max(0, Math.round((diffMs / totalMs) * 100)));
      percentText = `${percent}%`;
      strokeDashOffset = 100 - percent;

      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours >= 24) {
        timeText = `${Math.ceil(diffHours / 24)} Siku zimesalia`;
      } else {
        timeText = `${diffHours} Masaa yamesalia`;
      }
    }

    // Active routing summary card
    const routeCount = state.selectedRouteProductIds.length;
    let routingWidget = '';
    if (routeCount > 0) {
      routingWidget = `
        <div class="stitch-card animate-slide-up shadow-premium" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.02) 100%); border: 1.5px solid rgba(16, 185, 129, 0.2); border-radius: var(--radius-xl); padding: var(--spacing-base); flex-direction: row; justify-content: space-between; align-items: center; margin-top: 8px;">
          <div class="stitch-flex stitch-align-center stitch-gap-base">
            <div style="width: 42px; height: 42px; border-radius: 50%; background: var(--color-secondary-container); color: var(--color-secondary); display: flex; align-items: center; justify-content: center;">
              <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">directions</span>
            </div>
            <div>
              <h4 style="font-size: 13.5px; font-weight: 900; color: var(--color-on-surface);">Njia ya Safari Tayari</h4>
              <p style="font-size: 11px; color: var(--color-on-surface-variant); font-weight: 500;">Vituo ${routeCount} vimechaguliwa kwenye uteuzi wako.</p>
            </div>
          </div>
          <button id="dashboard-gen-route-btn" class="stitch-btn stitch-btn-secondary active-scale" style="height: 38px; border-radius: var(--radius-full); font-size: 11px; font-weight: 700; padding: 0 16px;">Tengeneza Njia</button>
        </div>
      `;
    }

    subscriptionWidgetHtml = `
      <section class="animate-fade-in" style="margin-top: 5px;">
        <div class="stitch-card" style="background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: var(--spacing-base); flex-direction: row; gap: var(--spacing-base); align-items: center;">
          <div style="position: relative; width: 60px; height: 60px; flex-shrink: 0;">
            <svg style="transform: rotate(-90deg); width: 100%; height: 100%;" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(79, 70, 229, 0.08)" stroke-width="3"></circle>
              <circle cx="18" cy="18" r="16" fill="none" stroke="var(--color-primary)" stroke-width="3" stroke-dasharray="100" stroke-dashoffset="${strokeDashOffset}" stroke-linecap="round" style="transition: stroke-dashoffset 0.5s ease;"></circle>
            </svg>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 900; color: var(--color-primary);">
              ${percentText}
            </div>
          </div>
          <div style="flex: 1; min-width: 0;">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span style="font-size: 13.5px; font-weight: 900; color: var(--color-on-surface);">${isTrial ? 'Trial ya Siku 7' : profile.passType === 'daily' ? 'Daily Access Pass' : 'Weekly Access Pass'}</span>
              <span class="stitch-badge ${isPassActive ? 'stitch-badge-primary' : 'stitch-badge-secondary'}" style="font-size: 9px; padding: 2px 6px;">${isPassActive ? 'ACTIVE' : 'EXPIRED'}</span>
            </div>
            <p style="font-size: 11.5px; color: var(--color-on-surface-variant); font-weight: 500; margin-top: 1px;">
              ${isPassActive ? `${timeText} • Ufikiaji upo wazi` : 'Ufikiaji wako umefungwa. Nunua pass mpya.'}
            </p>
          </div>
          ${!isPassActive ? `
            <button id="dashboard-buy-pass-btn" class="stitch-btn stitch-btn-sm stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-size: 10.5px; padding: 6px 12px;">Nunua Pass</button>
          ` : ''}
        </div>
      </section>
      ${routingWidget}
    `;
  }

  // AI suggestions
  const aiWidgetHtml = `
    <section class="animate-fade-in" style="margin-top: 5px;">
      <div class="stitch-card" style="background: linear-gradient(135deg, rgba(234, 179, 8, 0.07) 0%, rgba(234, 179, 8, 0.02) 100%); border: 1.5px solid rgba(234, 179, 8, 0.18); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-xs);">
        <div class="stitch-flex stitch-align-center stitch-gap-xs" style="color: #854D0E;">
          <span class="material-symbols-outlined" style="font-size: 20px; font-variation-settings: 'FILL' 1;">smart_toy</span>
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13.5px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.3px;">🤖 AI Chagua Haraka (Smart Assistant)</h4>
        </div>
        <p style="font-size: 11.5px; color: var(--color-on-surface-variant); line-height: 1.45;">
          Gusa maoni hapa chini kufanya utafutaji thabiti wa haraka papo hapo:
        </p>
        <div class="stitch-flex stitch-flex-col stitch-gap-xs stitch-mt-xs">
          <button class="ai-suggestion-btn stitch-btn stitch-btn-flat active-scale" data-query="Samsung Galaxy A56" style="justify-content: flex-start; text-align: left; background: white; border: 1px solid rgba(234, 179, 8, 0.15); border-radius: var(--radius-md); padding: 8px 12px; font-size: 11.5px; font-weight: 600; color: #854D0E; height: auto;">
            🔍 Nitafutie Samsung Galaxy A56 Kariakoo
          </button>
          <button class="ai-suggestion-btn stitch-btn stitch-btn-flat active-scale" data-query="Fundi AC" style="justify-content: flex-start; text-align: left; background: white; border: 1px solid rgba(234, 179, 8, 0.15); border-radius: var(--radius-md); padding: 8px 12px; font-size: 11.5px; font-weight: 600; color: #854D0E; height: auto;">
            🔌 Nitafutie Fundi AC mwenye Trust Score kubwa
          </button>
          <button class="ai-suggestion-btn stitch-btn stitch-btn-flat active-scale" data-query="used" style="justify-content: flex-start; text-align: left; background: white; border: 1px solid rgba(234, 179, 8, 0.15); border-radius: var(--radius-md); padding: 8px 12px; font-size: 11.5px; font-weight: 600; color: #854D0E; height: auto;">
            🏷 Nitafutie simu za used (iPhone/Samsung)
          </button>
        </div>
      </div>
    </section>
  `;

  // Render Dynamic Empty State if market collections are empty
  let marketContentHtml = '';
  if (products.length === 0 && providers.length === 0) {
    marketContentHtml = `
      <section class="animate-fade-in" style="margin-top: var(--spacing-sm); width: 100%;">
        <div class="stitch-card" style="background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: 32px 16px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--spacing-sm);">
          <span class="material-symbols-outlined" style="font-size: 44px; color: var(--color-outline);">storefront</span>
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); margin-bottom: 2px;">Soko Lipo Wazi Kwa Sasa</h4>
          <p style="font-size: 11.5px; color: var(--color-outline); line-height: 1.45; max-width: 260px; margin: 0 auto;">
            Bado hakuna wauzaji au bidhaa zilizosajiliwa Kariakoo. Kama wewe ni muuzaji, nenda kwenye wasifu wako kujiunga na kuweka bidhaa zako za kwanza!
          </p>
          ${state.userProfile?.role !== 'provider' && state.userProfile?.role !== 'admin' ? `
            <button id="empty-state-join-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-size: 10.5px; height: 34px; padding: 0 16px; margin-top: 8px;">Jiunge Kama Muuzaji</button>
          ` : ''}
        </div>
      </section>
    `;
  } else {
    marketContentHtml = `
      <!-- Continuously Moving Carousels -->
      ${renderProductCarousel('Wauzaji wa Karibu Nawe', 'Bidhaa zilizo karibu zaidi na eneo lako (distance ASC)', nearbyProducts, 'carousel-track-right', 'nearby')}
      ${renderProductCarousel('Bidhaa Zinazovuma (Trending)', 'Bidhaa zenye umaarufu mkubwa kwenye soko (viewCount DESC)', trendingProducts, 'carousel-track-left', 'trending')}
      ${renderProductCarousel('New Arrivals', 'Bidhaa mpya zilizosajiliwa hivi karibuni (createdAt DESC)', newProducts, 'carousel-track-right', 'new')}

      <!-- Popular Services -->
      ${renderServicesSection()}

      <!-- Recommendations -->
      ${renderRecommendationsSection()}
    `;
  }

  // Main compilation
  const mainContentHtml = `
    <main class="stitch-main" style="padding-top: 68px; padding-bottom: 84px; overflow-x: hidden;">
      <!-- Hero Header -->
      ${heroHtml}

      <!-- Categories -->
      ${categoriesHtml}

      <!-- Trust Model explanation -->
      ${trustExplanationHtml}

      <!-- AI Widget -->
      ${aiWidgetHtml}

      <!-- Subscriptions -->
      ${subscriptionWidgetHtml}

      <!-- Soko Content / Empty State -->
      ${marketContentHtml}

      <!-- Nearby Providers -->
      ${renderProvidersSection()}
    </main>
  `;

  return `
    ${headerHtml}
    ${mainContentHtml}
    ${renderGlobalNavbar('home')}
  `;
}

export function bindHomeEvents() {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => navigateTo('auth'));
  }

  const logoBtn = document.getElementById('brand-logo');
  if (logoBtn) {
    logoBtn.addEventListener('click', () => navigateTo('home'));
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await logoutUser();
    });
  }

  const profileAvatar = document.getElementById('profile-avatar');
  if (profileAvatar) {
    profileAvatar.addEventListener('click', () => navigateTo('auth'));
  }

  const searchInput = document.getElementById('main-search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('main-search-btn');
  if (searchBtn && searchInput) {
    const handleSearch = () => {
      const q = searchInput.value.trim();
      state.activeSearchQuery = q || 'Samsung Galaxy A56';
      navigateTo('search');
    };
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }

  // Categories Pill clicks
  document.querySelectorAll('.category-emoji-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.getAttribute('data-category') || 'smartphones';
      state.activeSearchQuery = ''; 
      setSearchCategoryFilter(cat);
      navigateTo('search');
    });
  });

  // AI suggestions click
  document.querySelectorAll('.ai-suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-query') || '';
      state.activeSearchQuery = q;
      navigateTo('search');
    });
  });

  // Touch-to-pause for moving carousels on mobile PWA devices
  document.querySelectorAll('.carousel-track-left, .carousel-track-right').forEach(track => {
    track.addEventListener('touchstart', () => {
      (track as HTMLElement).style.animationPlayState = 'paused';
    }, { passive: true });
    track.addEventListener('touchend', () => {
      (track as HTMLElement).style.animationPlayState = 'running';
    }, { passive: true });
  });

  // Carousel card clicks
  document.querySelectorAll('.product-card-click').forEach(card => {
    card.addEventListener('click', (e) => {
      // Check if clicked the navigation sub-button
      const target = e.target as HTMLElement;
      if (target.closest('.carousel-nav-trigger-btn')) {
        return; // Handled separately
      }
      
      const productId = card.getAttribute('data-id');
      const providerId = card.getAttribute('data-provider-id');
      navigateTo('detail', productId, providerId);
    });
  });

  // Carousel direct navigation triggers
  document.querySelectorAll('.carousel-nav-trigger-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const productId = btn.getAttribute('data-id');
      const providerId = btn.getAttribute('data-provider-id');
      if (!productId || !providerId) return;

      const isPassActive = checkPassActive(state.userProfile);
      if (!isPassActive) {
        alert('Ufikiaji Umefungwa! Huna Pass thabiti inayotumika. Tafadhali nunua Pass ya Daily au Weekly kwanza.');
        navigateTo('access');
        return;
      }

      if (!state.selectedRouteProductIds.includes(productId)) {
        state.selectedRouteProductIds.push(productId);
      }
      navigateTo('navigation', productId, providerId);
    });
  });

  document.querySelectorAll('.service-card-click').forEach(card => {
    card.addEventListener('click', () => {
      const serviceId = card.getAttribute('data-id');
      const providerId = card.getAttribute('data-provider-id');
      // For simplicity, services navigate to provider search page or a simulated detail page
      navigateTo('detail', serviceId, providerId);
    });
  });

  document.querySelectorAll('.provider-card-click').forEach(card => {
    card.addEventListener('click', () => {
      const providerId = card.getAttribute('data-id');
      // Navigate to search filtered by this provider
      state.activeSearchQuery = '';
      navigateTo('search', null, providerId);
    });
  });

  const buyPassBtn = document.getElementById('dashboard-buy-pass-btn');
  if (buyPassBtn) {
    buyPassBtn.addEventListener('click', () => navigateTo('access'));
  }

  const genRouteBtn = document.getElementById('dashboard-gen-route-btn');
  if (genRouteBtn) {
    genRouteBtn.addEventListener('click', () => navigateTo('navigation'));
  }

  const emptyStateJoinBtn = document.getElementById('empty-state-join-btn');
  if (emptyStateJoinBtn) {
    emptyStateJoinBtn.addEventListener('click', () => navigateTo('auth'));
  }

  bindNavbarEvents();
}

export function renderGlobalNavbar(activeTab: 'home' | 'search' | 'saved' | 'access' | 'profile'): string {
  return `
    <nav class="stitch-footer">
      <div class="stitch-footer-content">
        <button id="nav-home" class="stitch-nav-btn ${activeTab === 'home' ? 'stitch-nav-btn-active' : ''}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${activeTab === 'home' ? '1' : '0'};">home</span>
          <span class="stitch-mono" style="margin-top: 2px;">Nyumbani</span>
        </button>
        <button id="nav-search" class="stitch-nav-btn ${activeTab === 'search' ? 'stitch-nav-btn-active' : ''}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${activeTab === 'search' ? '1' : '0'};">search</span>
          <span class="stitch-mono" style="margin-top: 2px;">Tafuta</span>
        </button>
        <button id="nav-saved" class="stitch-nav-btn ${activeTab === 'saved' ? 'stitch-nav-btn-active' : ''}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${activeTab === 'saved' ? '1' : '0'};">favorite</span>
          <span class="stitch-mono" style="margin-top: 2px;">Saved</span>
        </button>
        <button id="nav-access" class="stitch-nav-btn ${activeTab === 'access' ? 'stitch-nav-btn-active' : ''}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${activeTab === 'access' ? '1' : '0'};">vpn_key</span>
          <span class="stitch-mono" style="margin-top: 2px;">Pass</span>
        </button>
        <button id="nav-profile" class="stitch-nav-btn ${activeTab === 'profile' ? 'stitch-nav-btn-active' : ''}">
          <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' ${activeTab === 'profile' ? '1' : '0'};">person</span>
          <span class="stitch-mono" style="margin-top: 2px;">Wasifu</span>
        </button>
      </div>
    </nav>
  `;
}

export function bindNavbarEvents() {
  const nh = document.getElementById('nav-home');
  if (nh) nh.addEventListener('click', () => navigateTo('home'));

  const ns = document.getElementById('nav-search');
  if (ns) ns.addEventListener('click', () => navigateTo('search'));

  const nsv = document.getElementById('nav-saved');
  if (nsv) nsv.addEventListener('click', () => navigateTo('saved'));

  const na = document.getElementById('nav-access');
  if (na) na.addEventListener('click', () => navigateTo('access'));

  const np = document.getElementById('nav-profile');
  if (np) np.addEventListener('click', () => navigateTo('auth'));
}
