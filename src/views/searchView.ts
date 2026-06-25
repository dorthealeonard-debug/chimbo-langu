import { state, navigateTo, toggleSaveProduct, isProductSaved } from '../appState';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { searchCHIMBO, SearchFilters } from '../services/searchEngine';
import { RatedProduct, computeBestDeals } from '../services/bestDeal';
import { db, auth } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { checkPassActive } from '../services/passService';
import { maskProviderName, getGeneralArea } from '../utils/privacy';

let currentFilterCategory = 'Zote';

export function setSearchCategoryFilter(category: string) {
  currentFilterCategory = category === 'zote' ? 'Zote' : category;
}

export async function renderSearchView(): Promise<string> {
  const user = state.currentUser;

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
      console.error('Error fetching active unlocks on search:', e);
    }
  }

  const filters: SearchFilters = {};
  if (currentFilterCategory !== 'Zote') {
    filters.category = currentFilterCategory;
  }
  
  const results = await searchCHIMBO(state.activeSearchQuery, filters);
  const isPassActive = checkPassActive(state.userProfile);

  // Fetch providers to join metadata
  let providers: any[] = [];
  try {
    const providersSnap = await getDocs(collection(db, 'providers'));
    providersSnap.forEach(d => {
      providers.push({ id: d.id, ...d.data() });
    });
  } catch (err) {
    console.error('Error fetching providers in search view:', err);
  }

  // Fallback mock data has been removed per production directives.

  const providerMap = new Map<string, any>();
  providers.forEach(p => {
    providerMap.set(p.id, p);
  });

  // Fetch product images
  let productImagesList: any[] = [];
  try {
    const imagesSnap = await getDocs(collection(db, 'productImages'));
    imagesSnap.forEach(d => {
      productImagesList.push(d.data());
    });
  } catch (err) {
    console.error('Error fetching images in search view:', err);
  }

  // Fallback mock product images have been removed.

  const imageMap = new Map<string, string>(); // productId -> front image url
  productImagesList.forEach(data => {
    if (data.angle === 'front') {
      imageMap.set(data.productId, data.secureUrl || data.imageUrl);
    }
  });

  const getProductFrontImage = (productId: string, category: string) => {
    const cached = imageMap.get(productId);
    if (cached) return cached;

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

  // Helper to render a search result card
  const renderCard = (p: RatedProduct) => {
    const saved = isProductSaved(p.id);
    const prov = providerMap.get(p.providerId) || {};
    const isAddedToRoute = state.selectedRouteProductIds.includes(p.id);
    const imgUrl = getProductFrontImage(p.id, p.category);

    const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
    const isSelf = user && (user.uid === p.providerId);
    const isUnlocked = isStaffOrAdmin || isSelf || activeUnlockedIds.has(p.providerId);

    const displayProviderName = isUnlocked ? (prov.businessName || 'Duka Kuu') : maskProviderName(prov.businessName || 'Duka Kuu');
    const displayedPhone = isUnlocked ? (prov.whatsapp || prov.tinNumber || '0785000111') : '0785***111';
    const displayedStreet = isUnlocked ? (prov.address || 'Aggrey Street') : '****** St';
    const displayedArea = getGeneralArea(prov.address);

    const badgeMarkup = p.badge && p.badge !== 'none' 
      ? `<div class="stitch-badge stitch-badge-secondary" style="font-weight: 800; font-size: 9px; opacity: 0.95;">
           <span>🔥 ${p.badge.toUpperCase()}</span>
         </div>`
      : '';

    return `
      <div class="stitch-card hover-card animate-fade-in" style="padding: 0; overflow: hidden; gap: 0; background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-card-radius); position: relative;">
        
        <!-- Image Header with Hover Badge -->
        <div style="position: relative; height: 180px; overflow: hidden; background-color: var(--color-surface-container-low);">
          <img style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s;" src="${imgUrl}" alt="${p.name}"/>
          
          <!-- Favorite Button -->
          <button class="save-btn-toggle active-scale" data-id="${p.id}" style="position: absolute; top: var(--spacing-base); right: var(--spacing-base); width: 38px; height: 38px; border-radius: 50%; background: rgba(255, 255, 255, 0.95); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: var(--shadow-md); z-index: 10;">
            <span class="material-symbols-outlined" style="color: ${saved ? 'var(--color-error)' : 'var(--color-outline)'}; font-variation-settings: 'FILL' ${saved ? '1' : '0'}; font-size: 20px;">favorite</span>
          </button>

          <!-- Image Badges -->
          <div style="position: absolute; bottom: var(--spacing-base); left: var(--spacing-base); display: flex; flex-direction: column; gap: 6px; z-index: 10;">
            <div class="stitch-badge stitch-badge-primary" style="opacity: 0.95; font-weight: 800; font-size: 9px; display: flex; align-items: center; gap: 2px;">
              <span class="material-symbols-outlined" style="font-size: 11px; font-variation-settings: 'FILL' 1;">verified</span>
              <span>BEI ILIYOTHIBITISHWA</span>
            </div>
            ${badgeMarkup}
          </div>
        </div>

        <!-- Content details -->
        <div style="padding: 16px; display: flex; flex-direction: column; gap: var(--spacing-base);">
          
          <!-- Product Title & Condition -->
          <div>
            <div class="stitch-flex stitch-justify-between stitch-align-center">
              <h3 style="font-size: 16px; font-weight: 900; color: var(--color-on-surface); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; flex: 1; min-width: 0; padding-right: var(--spacing-sm); font-family: 'Space Grotesk', sans-serif;">${p.name}</h3>
              <span style="font-size: 9.5px; font-weight: 800; color: var(--color-primary); background: var(--color-primary-container); padding: 2px 8px; border-radius: var(--radius-full); text-transform: uppercase;">
                ${p.condition === 'new' ? 'Mpya' : 'Used'}
              </span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs stitch-mt-xs" style="font-size: 11.5px; color: var(--color-on-surface-variant);">
              <span>Muuzaji: <span class="font-semibold" style="color: var(--color-on-surface);">${displayProviderName}</span></span>
              <span>•</span>
              <span>Eneo: <span class="font-semibold" style="color: var(--color-on-surface);">${displayedArea}</span></span>
            </div>
          </div>

          <!-- Masked Provider details -->
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="padding: 10px 12px; background: var(--color-surface-container-low); border-radius: var(--radius-md); font-size: 11px; border: 1px solid rgba(226, 232, 240, 0.5);">
            <div class="stitch-flex stitch-align-center stitch-gap-2xs" style="color: var(--color-outline);">
              <span class="material-symbols-outlined" style="font-size: 14px;">phone</span>
              <span>Simu: <span class="font-mono font-semibold" style="color: var(--color-on-surface);">${displayedPhone}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-2xs" style="color: var(--color-outline);">
              <span class="material-symbols-outlined" style="font-size: 14px;">home</span>
              <span>Mtaa: <span class="font-mono font-semibold" style="color: var(--color-on-surface);">${displayedStreet}</span></span>
            </div>
          </div>

          <!-- Price, Distance, Trust Score Row -->
          <div class="stitch-grid-3" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-base); text-align: center; gap: 2px;">
            <div class="stitch-flex stitch-flex-col">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Bei Elekezi</span>
              <span style="font-size: 14px; font-weight: 900; color: var(--color-primary);">TSh ${p.price.toLocaleString()}</span>
            </div>
            <div class="stitch-flex stitch-flex-col" style="border-left: 1px solid rgba(226, 232, 240, 0.5);">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Mbali Naye</span>
              <span style="font-size: 14px; font-weight: 900; color: var(--color-on-surface);">${p.distance} km</span>
            </div>
            <div class="stitch-flex stitch-flex-col" style="border-left: 1px solid rgba(226, 232, 240, 0.5);">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Trust Score</span>
              <div class="stitch-flex stitch-align-center stitch-gap-2xs" style="justify-content: center; color: var(--color-secondary);">
                <span class="material-symbols-outlined" style="font-size: 14px; font-variation-settings: 'FILL' 1;">star</span>
                <span style="font-size: 14px; font-weight: 900;">${prov.trustScore || p.trustScore || 80}%</span>
              </div>
            </div>
          </div>

          <!-- Actions Drawer buttons -->
          <div class="stitch-flex stitch-gap-xs" style="margin-top: 2px;">
            <button class="stitch-btn stitch-btn-flat detail-btn active-scale" data-id="${p.id}" data-provider-id="${p.providerId}" style="flex: 1; height: 38px; border: 1px solid var(--color-outline-variant); font-size: 11.5px; font-weight: 700; border-radius: var(--radius-full);">
              View Details
            </button>
            <button class="stitch-btn ${isAddedToRoute ? 'stitch-btn-secondary' : 'stitch-btn-flat'} route-toggle-btn active-scale" data-id="${p.id}" style="flex: 1; height: 38px; font-size: 11.5px; font-weight: 700; border-radius: var(--radius-full); border: 1px solid ${isAddedToRoute ? 'var(--color-secondary)' : 'var(--color-outline-variant)'};">
              <span class="material-symbols-outlined" style="font-size: 15px; margin-right: 4px;">${isAddedToRoute ? 'remove_road' : 'add_road'}</span>
              <span>${isAddedToRoute ? 'Ondoa' : 'Add To Route'}</span>
            </button>
            <button class="stitch-btn stitch-btn-primary search-direct-nav-btn active-scale" data-id="${p.id}" data-provider-id="${p.providerId}" style="height: 38px; width: 38px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <span class="material-symbols-outlined" style="font-size: 18px;">explore</span>
            </button>
          </div>

        </div>
      </div>
    `;
  };

  // Build Results or Empty State
  let resultsContentHtml = '';

  if (results.length > 0) {
    resultsContentHtml = `
      <div class="stitch-flex stitch-justify-between stitch-align-center" style="margin-bottom: var(--spacing-2xs);">
        <p style="font-size: 11px; font-weight: 700; color: var(--color-outline);">${results.length} matokeo yamepatikana</p>
      </div>
      <div class="stitch-flex stitch-flex-col stitch-gap-md">
        ${results.map(p => renderCard(p)).join('')}
      </div>
    `;
  } else {
    // Empty state: show AI suggestions, similar products, nearby alternatives
    const { all } = await computeBestDeals(state.userLocation.lat, state.userLocation.lon);

    const queryWords = state.activeSearchQuery.toLowerCase().split(/\s+/);
    const similar = all.filter(p => {
      return queryWords.some(w => w.length > 2 && (p.category.toLowerCase().includes(w) || p.name.toLowerCase().includes(w) || (p.brand || '').toLowerCase().includes(w)));
    }).slice(0, 3);

    const nearby = [...all].sort((a, b) => (a.distance || 99) - (b.distance || 99)).slice(0, 3);

    const aiSuggestions = [
      'Samsung Galaxy A56',
      'iPhone 14 Pro Max',
      'HP EliteBook',
      'Fundi AC',
      'Brake Pads'
    ];

    resultsContentHtml = `
      <div class="stitch-flex stitch-flex-col stitch-gap-md animate-fade-in" style="padding-bottom: var(--spacing-xl);">
        <div class="stitch-card-sm text-center" style="padding: 24px; background: var(--color-surface-container-low); border: 1.5px dashed var(--color-outline-variant); border-radius: var(--radius-xl); gap: 8px; align-items: center;">
          <span class="material-symbols-outlined" style="font-size: 40px; color: var(--color-outline-variant);">search_off</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface);">Hakuna matokeo kwa "${state.activeSearchQuery}"</h3>
          <p style="font-size: 11.5px; color: var(--color-on-surface-variant); max-width: 260px; margin: 0 auto; line-height: 1.45;">Hatukupata mechi ya moja kwa moja. Kagua njia mbadala zilizopo karibu nawe hapa chini au gusa mapendekezo ya AI.</p>
        </div>

        <!-- AI Suggestions -->
        <div style="margin-top: 5px;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: var(--color-on-surface); margin-bottom: 8px;">🤖 AI Mapendekezo ya Utafutaji</h4>
          <div class="stitch-flex stitch-flex-wrap stitch-gap-xs">
            ${aiSuggestions.map(s => `
              <button class="search-ai-suggest-btn stitch-btn stitch-btn-sm stitch-btn-flat active-scale" data-query="${s}" style="border: 1px solid rgba(234, 179, 8, 0.25); background: rgba(234, 179, 8, 0.03); color: #854D0E; font-weight: 700; height: 32px; font-size: 11px; padding: 0 10px;">
                🔍 ${s}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Similar Products -->
        ${similar.length > 0 ? `
          <div style="margin-top: 10px;">
            <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: var(--color-on-surface); margin-bottom: 8px;">Bidhaa Zinazofanana (Similar Products)</h4>
            <div class="stitch-flex stitch-flex-col stitch-gap-xs">
              ${similar.map(p => renderCard(p)).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Nearby Alternatives -->
        <div style="margin-top: 10px;">
          <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 800; color: var(--color-on-surface); margin-bottom: 8px;">Bidhaa Mbadala za Karibu (Nearby Alternatives)</h4>
          <div class="stitch-flex stitch-flex-col stitch-gap-xs">
            ${nearby.map(p => renderCard(p)).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Floating selection drawer overlay
  const routeCount = state.selectedRouteProductIds.length;
  const floatingRouteBar = routeCount > 0 
    ? `
      <div style="position: fixed; bottom: 80px; left: 0; right: 0; z-index: 30; padding: 0 var(--screen-padding-x); max-width: var(--card-width-pwa); margin: 0 auto; box-sizing: border-box;">
        <div class="stitch-card-sm animate-slide-up" style="flex-direction: row; background: rgba(5, 150, 105, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); padding: 8px 16px; border-radius: var(--radius-full); box-shadow: var(--shadow-lg); border: 1px solid rgba(5, 150, 105, 0.3); justify-content: space-between; align-items: center; color: white;">
          <div class="stitch-flex stitch-align-center stitch-gap-xs">
            <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1; font-size: 18px;">directions</span>
            <span class="stitch-body-xs font-bold" style="color: white; font-size: 11.5px;">Wauzaji ${routeCount} Waliochaguliwa</span>
          </div>
          <button id="floating-route-gen-btn" class="stitch-btn stitch-btn-sm active-scale" style="background: white; color: var(--color-secondary); font-weight: 800; border-radius: var(--radius-full); height: 32px; padding: 0 16px; font-size: 11px;">
            Tengeneza Njia
          </button>
        </div>
      </div>
    `
    : '';

  const currentCat = currentCategoryFilter();

  return `
    <header class="stitch-header glass-card" style="height: auto; border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content" style="height: 52px; padding-bottom: 0;">
        <button id="search-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
        </button>
        <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Chagua na Ugundue</h1>
        <div style="width: 36px;"></div>
      </div>

      <!-- Live Search input -->
      <div style="padding: 0 var(--screen-padding-x) var(--spacing-sm) var(--screen-padding-x);">
        <div class="stitch-input-container" style="border-radius: var(--radius-full); overflow: hidden; border: 1.5px solid rgba(79, 70, 229, 0.15);">
          <span class="material-symbols-outlined stitch-input-icon">search</span>
          <input id="results-search-input" class="stitch-input" placeholder="Tafuta bidhaa..." type="text" value="${state.activeSearchQuery}" style="border: none; background: white; padding-left: 38px; height: 40px; font-size: 12.5px;"/>
        </div>
      </div>

      <!-- Horizontal category pill filters -->
      <div class="stitch-flex stitch-gap-xs stitch-hide-scrollbar" style="padding: var(--spacing-xs) var(--screen-padding-x) var(--spacing-sm) var(--screen-padding-x); background-color: transparent; overflow-x: auto;">
        ${[
          { id: 'Zote', label: 'Zote' },
          { id: 'smartphones', label: '📱 Simu' },
          { id: 'laptops', label: '💻 Kompyuta' },
          { id: 'electronics', label: '📺 Electronics' },
          { id: 'women fashion', label: '👗 Mavazi ya Kike' },
          { id: 'men fashion', label: '👔 Mavazi ya Kiume' },
          { id: 'auto parts', label: '⚙ Vipuri' }
        ].map(cat => {
          const isActive = cat.id.toLowerCase() === currentCat.toLowerCase();
          return `
            <button class="stitch-btn stitch-btn-sm ${isActive ? 'stitch-btn-primary' : 'stitch-btn-flat'} active-scale" data-category-filter="${cat.id.toLowerCase()}" style="border-radius: var(--radius-full); height: 30px; font-size: 11px; padding: 0 14px; font-weight: 700; border: 1.5px solid ${isActive ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; background: ${isActive ? 'var(--color-primary)' : 'white'}; color: ${isActive ? 'white' : 'var(--color-outline)'};">
              ${cat.label}
            </button>
          `;
        }).join('')}
      </div>
    </header>

    <main class="stitch-main" style="padding-top: 172px; padding-bottom: 140px;">
      ${resultsContentHtml}
    </main>

    ${floatingRouteBar}
    ${renderGlobalNavbar('search')}
  `;
}

function currentCategoryFilter(): string {
  return currentFilterCategory;
}

export function bindSearchEvents() {
  const backBtn = document.getElementById('search-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));

  const searchInput = document.getElementById('results-search-input') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        state.activeSearchQuery = searchInput.value.trim();
        navigateTo('search');
      }
    });
  }

  document.querySelectorAll('[data-category-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.getAttribute('data-category-filter') || 'Zote';
      currentFilterCategory = cat === 'zote' ? 'Zote' : cat;
      navigateTo('search');
    });
  });

  // AI search suggestion clicks
  document.querySelectorAll('.search-ai-suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-query') || '';
      state.activeSearchQuery = q;
      navigateTo('search');
    });
  });

  document.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const productId = btn.getAttribute('data-id');
      const providerId = btn.getAttribute('data-provider-id');
      navigateTo('detail', productId, providerId);
    });
  });

  document.querySelectorAll('.route-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pId = btn.getAttribute('data-id');
      if (pId) {
        const idx = state.selectedRouteProductIds.indexOf(pId);
        if (idx === -1) {
          state.selectedRouteProductIds.push(pId);
        } else {
          state.selectedRouteProductIds.splice(idx, 1);
        }
        navigateTo('search');
      }
    });
  });

  document.querySelectorAll('.search-direct-nav-btn').forEach(btn => {
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

  const floatRouteGenBtn = document.getElementById('floating-route-gen-btn');
  if (floatRouteGenBtn) {
    floatRouteGenBtn.addEventListener('click', () => {
      navigateTo('navigation');
    });
  }

  document.querySelectorAll('.save-btn-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pId = btn.getAttribute('data-id');
      if (pId) {
        toggleSaveProduct(pId);
        navigateTo('search');
      }
    });
  });

  bindNavbarEvents();
}
