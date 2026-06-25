import { state, navigateTo } from '../appState';
import { db, auth } from '../firebase';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, query, where } from 'firebase/firestore';
import { checkPassActive, recordRouteInHistory, checkSelectionLimit } from '../services/passService';
import { checkAccessUnlocked, unlockNavigation } from '../services/navigation';

// Module-level persistent navigation state
let isNavigatingGps = false;
let hasStartedNavigation = false;
let mapInstance: any = null;
let mapboxInitRetries = 0;
let voiceSynthEnabled = true;
let voiceLanguage: 'sw' | 'en' = 'sw';

// Real GPS tracking variables
let gpsWatchId: number | null = null;
let userLatitude: number | null = null;
let userLongitude: number | null = null;
let userHeading: number | null = null;
let userSpeed: number | null = null;
let autoCenter = true;

let globalSortedProviders: any[] = [];
let globalRealDistance = 0;
let globalRealDuration = 0;
let userMarker: any = null;
let globalRouteCoordinates: [number, number][] = [];
let mapboxSteps: any[] = [];
let currentStepIndex = 0;
let lastUserGpsPos: { lat: number; lon: number } | null = null;
let lastDirectionsFetchTime = 0;
let lastSpokenInstruction = '';
let arrived = false;

// Price Report Modal State
let isReportModalOpen = false;
let selectedReportProviderId = '';
let selectedReportProductId = '';

// Geodetic distance helper (in meters)
function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Radius of the Earth in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function ensureMapboxLoaded(): Promise<void> {
  if ((window as any).mapboxgl) return;

  return new Promise((resolve, reject) => {
    // 1. Inject Mapbox CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
    document.head.appendChild(link);

    // 2. Inject Mapbox JS
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

export async function renderNavigationView(): Promise<string> {
  const user = state.currentUser;
  if (!user) return '<div style="padding: var(--spacing-lg); text-align: center; font-family: var(--font-sans); color: var(--color-outline);">Tafadhali ingia kwanza ili ufikie ramani.</div>';

  const isPassActive = checkPassActive(state.userProfile);
  if (!isPassActive) {
    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content">
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Ramani Imefungwa</h1>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px;">
        <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-xl) var(--screen-padding-x); text-align: center; gap: var(--spacing-md);">
          <span class="material-symbols-outlined" style="font-size: 52px; color: var(--color-error);">lock</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800;">Ufikiaji Umefungwa</h3>
          <p class="stitch-body-small" style="max-width: 280px; margin: 0 auto; font-size: 11.5px; line-height: 1.45;">Huna Pass ya Safari inayotumika sasa. Tafadhali nunua Pass ya Daily au Weekly au tumia free trial ili kufungua ramani zote nchini na kuona maelezo ya wauzaji.</p>
          <button id="nav-buy-pass-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-weight: 800; height: 42px; padding: 0 20px;">Nunua Pass Sasa</button>
        </div>
      </main>
    `;
  }

  // Check selection limits for subscription plans
  const limitCheck = await checkSelectionLimit(state.userProfile);
  if (!limitCheck.allowed && state.selectedRouteProductIds.length > 0) {
    const productsSnap = await getDocs(collection(db, 'products'));
    const productMap = new Map<string, any>();
    productsSnap.forEach(d => productMap.set(d.id, d.data()));

    let hasLockedProvider = false;
    for (const pId of state.selectedRouteProductIds) {
      const prod = productMap.get(pId);
      if (prod) {
        const isUnlocked = await checkAccessUnlocked(prod.providerId);
        if (!isUnlocked) {
          hasLockedProvider = true;
          break;
        }
      }
    }

    if (hasLockedProvider) {
      return `
        <header class="stitch-header glass-card">
          <div class="stitch-header-content">
            <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Kikomo Kimefikiwa</h1>
          </div>
        </header>
        <main class="stitch-main" style="padding-top: 68px;">
          <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-xl) var(--screen-padding-x); text-align: center; gap: var(--spacing-md);">
            <span class="material-symbols-outlined" style="font-size: 52px; color: var(--color-error);">lock_clock</span>
            <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800;">Umevuka Kikomo cha Uteuzi</h3>
            <p class="stitch-body-small" style="max-width: 300px; margin: 0 auto; font-size: 12px; line-height: 1.45;">
              Pass yako ya ${state.userProfile?.passType === 'daily' ? 'Siku 1 (Daily)' : 'Siku 7 (Weekly)'} inaruhusu upeo wa wauzaji ${limitCheck.limit} pekee.<br>
              Tayari umetengeneza njia na kufungua mawasiliano ya wauzaji ${limitCheck.count}. Tafadhali subiri pass hii iishe au nunua nyingine.
            </p>
            <button id="nav-screen-explore-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); height: 42px; padding: 0 20px; font-weight: 700;">Gundua Bidhaa</button>
          </div>
        </main>
      `;
    }
  }

  // 1. Resolve selected items and providers
  let selectedProducts: any[] = [];
  let providersList: any[] = [];
  try {
    const providersSnap = await getDocs(collection(db, 'providers'));
    providersSnap.forEach(d => {
      const data = d.data();
      if (data.status === 'approved') {
        providersList.push({ id: d.id, ...data });
      }
    });
  } catch (err) {
    console.error('Error loading providers in navigation:', err);
  }

  const providerMap = new Map<string, any>();
  providersList.forEach(p => providerMap.set(p.id, p));

  let productsList: any[] = [];
  try {
    const productsSnap = await getDocs(collection(db, 'products'));
    productsSnap.forEach(d => productsList.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error loading products in navigation:', err);
  }

  const productMap = new Map<string, any>();
  productsList.forEach(p => productMap.set(p.id, p));

  if (state.selectedRouteProductIds.length > 0) {
    state.selectedRouteProductIds.forEach(pId => {
      const prod = productMap.get(pId);
      if (prod) selectedProducts.push(prod);
    });
  } else if (state.selectedProductId) {
    const prod = productMap.get(state.selectedProductId);
    if (prod) selectedProducts.push(prod);
  }

  // Find unique providers
  const uniqueProviderIds = Array.from(new Set(selectedProducts.map(p => p.providerId)));
  let pathProviders: any[] = [];
  
  if (uniqueProviderIds.length > 0) {
    uniqueProviderIds.forEach(pId => {
      const prov = providerMap.get(pId);
      if (prov) pathProviders.push(prov);
    });
  } else if (state.selectedProviderId) {
    const prov = providerMap.get(state.selectedProviderId);
    if (prov) pathProviders.push(prov);
  }

  if (pathProviders.length === 0) {
    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content">
          <button id="nav-screen-empty-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
            <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
          </button>
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Uelekeo wa Safari</h1>
          <div style="width: 36px;"></div>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px;">
        <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-xl) var(--screen-padding-x); text-align: center; gap: var(--spacing-md);">
          <span class="material-symbols-outlined" style="font-size: 52px; color: var(--color-outline-variant);">explore</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800;">Hujachagua Duka la Kwenda</h3>
          <p class="stitch-body-small" style="max-width: 280px; margin: 0 auto; font-size: 11.5px;">Tafadhali chagua bidhaa na ubonyeze 'Weka Safarini' kisha ufungue ramani hii tena.</p>
          <button id="nav-screen-explore-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); height: 42px; padding: 0 20px; font-weight: 700;">Gundua Bidhaa</button>
        </div>
      </main>
    `;
  }

  // --- BUSINESS RULE GATING: Check if all providers are unlocked ---
  const lockedProviders: any[] = [];
  for (const prov of pathProviders) {
    const isUnlocked = await checkAccessUnlocked(prov.id);
    if (!isUnlocked) {
      lockedProviders.push(prov);
    }
  }

  if (lockedProviders.length > 0) {
    const lockedCardsHtml = lockedProviders.map(prov => {
      const prodForProv = selectedProducts.find(p => p.providerId === prov.id);
      const itemId = prodForProv?.id || 'route-gen';
      const itemType = prodForProv?.type || 'product';

      return `
        <div class="stitch-card shadow-premium" style="border: 1.5px solid rgba(239, 68, 68, 0.2); background: white; padding: var(--spacing-base); border-radius: var(--radius-xl); gap: 10px; width: 100%; display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: var(--spacing-sm);">
          <span class="material-symbols-outlined" style="font-size: 36px; color: var(--color-error); background: rgba(239, 68, 68, 0.05); padding: 8px; border-radius: 50%;">lock</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; color: var(--color-on-surface); margin: 0;">Duka Limefungwa (Locked)</h3>
          <p style="font-size: 11px; line-height: 1.4; color: var(--color-outline); max-width: 240px; margin: 0;">Huwezi kuona njia au kuanza navigation mpaka umefungua mawasiliano ya duka hili.</p>
          <div style="font-weight: 900; font-size: 13.5px; color: var(--color-primary); margin: 4px 0;">${prov.businessName}</div>
          <button class="stitch-btn stitch-btn-primary unlock-nav-prov-btn active-scale" data-provider-id="${prov.id}" data-item-id="${itemId}" data-item-type="${itemType}" style="width: 100%; height: 38px; border-radius: var(--radius-full); font-weight: 700; font-size: 12px; margin: 0;">Fungua Mawasiliano ya Duka</button>
        </div>
      `;
    }).join('');

    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content">
          <button id="nav-screen-empty-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
            <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
          </button>
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Duka Limefungwa</h1>
          <div style="width: 36px;"></div>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px;">
        <div class="stitch-flex stitch-flex-col stitch-align-center" style="padding: var(--spacing-md) var(--screen-padding-x); gap: var(--spacing-sm);">
          ${lockedCardsHtml}
        </div>
      </main>
    `;
  }

  // 2. Greedy TSP route sorting (using provider real coordinates)
  let currentLat = state.userLocation.lat;
  let currentLon = state.userLocation.lon;
  let sortedProviders: any[] = [];
  let remaining = [...pathProviders];

  while (remaining.length > 0) {
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const pLat = remaining[i].latitude || -6.8184;
      const pLon = remaining[i].longitude || 39.2826;
      const dist = getDistanceInMeters(currentLat, currentLon, pLat, pLon) / 1000;
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    const nextProv = remaining[closestIdx];
    sortedProviders.push({ ...nextProv, segmentDistance: closestDist });
    currentLat = nextProv.latitude || -6.8184;
    currentLon = nextProv.longitude || 39.2826;
    remaining.splice(closestIdx, 1);
  }

  globalSortedProviders = sortedProviders;

  let totalDistance = 0;
  sortedProviders.forEach(p => totalDistance += p.segmentDistance);
  totalDistance = parseFloat(totalDistance.toFixed(2));
  
  const totalDurationMin = Math.ceil((totalDistance / 25) * 60) || 5;

  // Custom CSS styles injector
  const stylesHtml = `
    <style>
      .map-control-btn {
        width: 40px;
        height: 40px;
        background: white;
        border: 1px solid rgba(226, 232, 240, 0.8);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        color: var(--color-on-surface);
        cursor: pointer;
        outline: none;
        pointer-events: auto;
      }
      .map-control-btn:active {
        transform: scale(0.95);
      }
      .gps-pulsing-marker {
        width: 18px;
        height: 18px;
        background: #4f46e5;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(79, 70, 229, 0.6);
        animation: gpsPulse 2s infinite;
      }
      @keyframes gpsPulse {
        0% {
          box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.7);
        }
        70% {
          box-shadow: 0 0 0 10px rgba(79, 70, 229, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(79, 70, 229, 0);
        }
      }
      .speedometer-badge {
        position: absolute;
        bottom: 110px;
        left: var(--spacing-md);
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(8px);
        color: white;
        padding: 8px 12px;
        border-radius: var(--radius-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
        font-family: 'Space Grotesk', sans-serif;
        z-index: 20;
        pointer-events: auto;
      }
      .arrival-overlay {
        position: fixed;
        inset: 0;
        z-index: 150;
        background: rgba(15, 23, 42, 0.7);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
    </style>
  `;

  // Start route registration inside database on navigation boot
  if (!isNavigatingGps && hasStartedNavigation) {
    const providerIds = sortedProviders.map(p => p.id);
    setTimeout(async () => {
      await recordRouteInHistory(providerIds, totalDistance, totalDurationMin);
    }, 100);
  }

  // Pre-formatted share messages
  const primaryProvider = sortedProviders[0];
  const mapsLink = `https://www.google.com/maps/dir/?api=1&origin=${state.userLocation.lat},${state.userLocation.lon}&destination=${primaryProvider.latitude},${primaryProvider.longitude}&waypoints=${sortedProviders.slice(1).map(p => `${p.latitude},${p.longitude}`).join('|')}`;
  const shareMessage = `Habari.\n\nNinaelekea kwa mtoa huduma huyu.\n\nLocation:\n${mapsLink}\n\nProvider:\n${primaryProvider.businessName}\n\nArea:\n${primaryProvider.address || 'Kariakoo'}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent('Maelekezo Ya Kufika Dukani')}&body=${encodeURIComponent(shareMessage)}`;

  if (!selectedReportProviderId && sortedProviders.length > 0) {
    selectedReportProviderId = sortedProviders[0].id;
  }
  if (!selectedReportProductId && selectedProducts.length > 0) {
    selectedReportProductId = selectedProducts[0].id;
  }

  // Load Mapbox
  if (hasStartedNavigation) {
    setTimeout(() => {
      initMapboxMap();
    }, 100);
  }

  const mapHtml = `
    <!-- Mapbox container -->
    <div style="position: absolute; inset: 0; z-index: 0; overflow: hidden; background-color: var(--color-surface-container-high);">
      <div id="mapbox-map" style="width: 100%; height: 100%;"></div>
    </div>
  `;

  const initOverlayHtml = !hasStartedNavigation ? `
    <!-- Initialization Overlay -->
    <div id="nav-init-overlay" style="position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; background-color: rgba(15, 23, 42, 0.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); padding: 20px; pointer-events: auto;">
      <div class="stitch-card animate-fade-in" style="align-items: center; text-align: center; gap: var(--spacing-sm); max-width: 300px; padding: 24px; border-radius: var(--radius-xl); border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(255, 255, 255, 0.85); box-shadow: var(--shadow-lg);">
        <span class="material-symbols-outlined" style="font-size: 48px; color: var(--color-primary);">explore</span>
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800; color: var(--color-on-surface); margin: 0;">Njia ya Safari Iko Tayari</h3>
        <p style="font-size: 11.5px; line-height: 1.45; color: var(--color-outline); margin-top: 4px;">Gusa kitufe cha Anza Safari ili kuwasha GPS, kupata maelekezo ya sauti, na kuonyesha ramani.</p>
        <button id="nav-screen-start-btn-init" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; border-radius: var(--radius-full); height: 42px; font-weight: bold; margin-top: var(--spacing-xs);">Anza Safari / Start GPS</button>
      </div>
    </div>
  ` : '';

  let startBtnText = 'ANZA SAFARI / START GPS';
  if (hasStartedNavigation) {
    startBtnText = isNavigatingGps ? 'SIMAMISHA GPS / PAUSE' : 'ENDELEA SAFARI / RESUME';
  }

  return `
    ${stylesHtml}
    
    <!-- Floating Back Button -->
    <div style="position: fixed; top: var(--spacing-md); left: var(--spacing-md); z-index: 50; display: flex; gap: var(--spacing-xs);">
      <button id="nav-screen-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale shadow-premium" style="width: 44px; height: 44px; padding: 0; background: white; border-radius: 50%;">
        <span class="material-symbols-outlined" style="color: var(--color-on-surface); font-size: 22px;">arrow_back</span>
      </button>
    </div>

    ${mapHtml}
    ${initOverlayHtml}

    <!-- Speedometer circular badge -->
    ${hasStartedNavigation ? `
      <div class="speedometer-badge">
        <span style="font-size: 9px; color: rgba(255, 255, 255, 0.6); font-weight: bold; text-transform: uppercase;">Kasi (Speed)</span>
        <div style="display: flex; align-items: baseline; gap: 2px; margin-top: 2px;">
          <span id="speed-val-badge" style="font-size: 24px; font-weight: 900; color: white;">0</span>
          <span style="font-size: 10px; font-weight: bold; color: rgba(255, 255, 255, 0.8);">km/h</span>
        </div>
      </div>
    ` : ''}

    <!-- Floating Map Controls -->
    ${hasStartedNavigation ? `
      <div style="position: absolute; top: 76px; right: var(--spacing-md); z-index: 30; display: flex; flex-direction: column; gap: 10px;">
        <button id="recenter-btn" class="map-control-btn" title="Re-center GPS">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">my_location</span>
        </button>
        <button id="zoomin-btn" class="map-control-btn" title="Zoom In">
          <span class="material-symbols-outlined" style="font-size: 20px;">add</span>
        </button>
        <button id="zoomout-btn" class="map-control-btn" title="Zoom Out">
          <span class="material-symbols-outlined" style="font-size: 20px;">remove</span>
        </button>
        <button id="compass-btn" class="map-control-btn" title="Compass Orientation">
          <span id="compass-arrow" class="material-symbols-outlined" style="font-size: 20px; transition: transform 0.2s;">explore</span>
        </button>
      </div>
    ` : ''}

    <!-- Main Navigation Interface Overlay -->
    <main class="stitch-main animate-fade-in" style="padding-top: var(--spacing-xl); padding-bottom: var(--spacing-lg); height: 100vh; display: flex; flex-direction: column; justify-content: space-between; position: relative; z-index: 20; pointer-events: none; box-sizing: border-box;">
      
      <!-- Top Guidance Widget -->
      <div style="pointer-events: auto; width: 100%;">
        <div class="stitch-card glass-card shadow-premium" style="gap: var(--spacing-xs); border-radius: var(--radius-xl);">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 13.5px; font-weight: 900; color: var(--color-primary); display: flex; align-items: center; gap: 4px; margin: 0;">
              <span class="material-symbols-outlined" style="font-size: 16px;">route</span>
              <span>Safari ya Live GPS</span>
            </h2>
            
            <div class="stitch-flex" style="gap: 6px;">
              <!-- Voice guidance toggle -->
              <button id="voice-toggle-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="height: 24px; padding: 0 8px; font-size: 9px; border-radius: var(--radius-sm); border: 1.5px solid rgba(79, 70, 229, 0.15); margin: 0;">
                <span class="material-symbols-outlined" style="font-size: 11px; margin-right: 3px; font-variation-settings: 'FILL' ${voiceSynthEnabled ? '1' : '0'};">${voiceSynthEnabled ? 'volume_up' : 'volume_off'}</span>
                <span>Voice: ${voiceSynthEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <!-- Voice language toggle -->
              <button id="lang-toggle-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="height: 24px; padding: 0 8px; font-size: 9px; border-radius: var(--radius-sm); border: 1.5px solid rgba(79, 70, 229, 0.15); margin: 0;">
                <span>Lang: ${voiceLanguage.toUpperCase()}</span>
              </button>
            </div>
          </div>

          <!-- Turn-by-Turn Guidance Panel -->
          <div class="stitch-card-sm" style="background-color: var(--color-surface); border: 1px solid rgba(226, 232, 240, 0.8); padding: 10px; border-left: 4px solid var(--color-secondary); flex-direction: row; align-items: center; gap: 8px; border-radius: var(--radius-md);">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--color-secondary-container); color: var(--color-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <span class="material-symbols-outlined" style="font-size: 16px;">navigation</span>
            </div>
            <div style="flex: 1; min-width: 0;">
              <p id="next-turn-text" class="stitch-body-xs font-semibold" style="font-size: 11px; color: var(--color-on-surface); line-height: 1.35; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${hasStartedNavigation ? 'Waiting for GPS updates...' : 'Gusa Anza Safari ili kupata maelekezo ya kwanza.'}
              </p>
              <span id="current-road-name" style="font-size: 9px; color: var(--color-outline); font-weight: bold; text-transform: uppercase;">Chimbo Maps Route</span>
            </div>
          </div>

          <!-- Cumulative Route Stats -->
          <div class="stitch-grid-3" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: var(--spacing-sm); margin-top: 2px; text-align: center;">
            <div class="stitch-flex stitch-flex-col">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Distance</span>
              <span id="route-stat-distance" style="font-size: 14px; font-weight: 900; color: var(--color-on-surface);">${hasStartedNavigation ? '-- km' : `${totalDistance} km`}</span>
            </div>
            <div class="stitch-flex stitch-flex-col" style="border-left: 1px solid rgba(226, 232, 240, 0.5);">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">ETA</span>
              <span id="route-stat-duration" style="font-size: 14px; font-weight: 900; color: var(--color-on-surface);">${hasStartedNavigation ? '-- min' : `${totalDurationMin} min`}</span>
            </div>
            <div class="stitch-flex stitch-flex-col" style="border-left: 1px solid rgba(226, 232, 240, 0.5);">
              <span style="font-size: 8px; font-weight: bold; color: var(--color-outline); text-transform: uppercase;">Waypoints</span>
              <span style="font-size: 13px; font-weight: 900; color: var(--color-secondary); align-self: center;">
                ${state.userProfile?.passType === 'free_trial' ? 'Unlimited' : `${limitCheck.count}/${limitCheck.limit}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Actions Drawer -->
      <div style="pointer-events: auto; width: 100%; display: flex; flex-direction: column; gap: var(--spacing-sm);">
        
        <!-- Price Discrepancy Dispute trigger button -->
        <button id="nav-screen-report-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 38px; background: rgba(220, 38, 38, 0.08); border: 1.5px solid rgba(220, 38, 38, 0.25); color: var(--color-error); font-weight: 800; font-size: 10.5px; border-radius: var(--radius-full); box-shadow: var(--shadow-sm); margin: 0;">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 6px;">gavel</span>
          <span>MUUZAJI KABADILISHA BEI? RIPOTI RIPOTI HAPA</span>
        </button>

        <div class="stitch-card glass-card shadow-premium" style="gap: var(--spacing-sm); border-radius: var(--radius-xl); padding: var(--spacing-sm);">
          <button id="nav-screen-start-btn" class="stitch-btn ${isNavigatingGps ? 'stitch-btn-secondary' : 'stitch-btn-primary'} active-scale" style="width: 100%; border-radius: var(--radius-full); font-weight: 800; font-size: 12.5px; height: 44px; letter-spacing: 0.3px; margin: 0;">
            <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px; font-variation-settings: 'FILL' 1;">navigation</span>
            <span>${startBtnText}</span>
          </button>
          
          <div class="stitch-grid-2">
            <a href="${whatsappUrl}" target="_blank" class="stitch-btn stitch-btn-flat active-scale" style="height: 36px; border-radius: var(--radius-full); border: 1.5px solid #25D366; font-size: 10.5px; font-weight: 800; background: rgba(37, 211, 102, 0.04); color: #128C7E; display: flex; align-items: center; justify-content: center; text-decoration: none;">
              <span class="material-symbols-outlined" style="color: #25D366; font-size: 16px; margin-right: 4px;">chat</span>
              <span>WHATSAPP SHARE</span>
            </a>
            <a href="${emailUrl}" class="stitch-btn stitch-btn-flat active-scale" style="height: 36px; border-radius: var(--radius-full); border: 1.5px solid var(--color-outline-variant); font-size: 10.5px; font-weight: 800; display: flex; align-items: center; justify-content: center; text-decoration: none;">
              <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 16px; margin-right: 4px;">mail</span>
              <span>EMAIL SHARE</span>
            </a>
          </div>
        </div>
      </div>
    </main>

    <!-- Price discrepancy form modal -->
    ${isReportModalOpen ? `
      <div style="position: fixed; inset: 0; z-index: 100; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px;">
        <div class="stitch-card animate-slide-up" style="width: 100%; max-width: 380px; background: white; border-radius: var(--radius-xl); padding: 20px; gap: 12px; pointer-events: auto; border: 1.5px solid rgba(220, 38, 38, 0.25); box-shadow: var(--shadow-lg); display: flex; flex-direction: column;">
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px;">
            <h3 style="color: var(--color-error); font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; display: flex; align-items: center; gap: 4px; margin: 0;">
              <span class="material-symbols-outlined" style="font-size: 18px;">gavel</span>
              <span>Ripoti Tofauti ya Bei</span>
            </h3>
            <button id="close-report-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 32px; height: 32px; padding: 0; border-radius: 50%;">
              <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
            </button>
          </div>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.4; margin-bottom: 4px;">
            Muuzaji ameomba bei kubwa wakati ulivyofika kwake? Tuma ripoti ili kupunguza Trust Score yake kwa -15% papo hapo.
          </p>

          <form id="price-discrepancy-form" class="stitch-flex stitch-flex-col stitch-gap-sm" style="display: flex; flex-direction: column; gap: 10px;">
            <div class="stitch-flex stitch-flex-col stitch-gap-2xs" style="display: flex; flex-direction: column; gap: 2px;">
              <label class="stitch-form-label" style="font-size: 11px; font-weight: 700;">Mtoa Huduma:</label>
              <select id="report-provider-id" class="stitch-input-raw" style="font-size: 12px; height: 36px; border-radius: var(--radius-sm); border: 1px solid var(--color-outline-variant);">
                ${sortedProviders.map(p => `<option value="${p.id}" ${p.id === selectedReportProviderId ? 'selected' : ''}>${p.businessName}</option>`).join('')}
              </select>
            </div>

            <div class="stitch-flex stitch-flex-col stitch-gap-2xs" style="display: flex; flex-direction: column; gap: 2px;">
              <label class="stitch-form-label" style="font-size: 11px; font-weight: 700;">Bidhaa husika:</label>
              <select id="report-product-id" class="stitch-input-raw" style="font-size: 12px; height: 36px; border-radius: var(--radius-sm); border: 1px solid var(--color-outline-variant);">
                ${selectedProducts.map(p => `<option value="${p.id}" ${p.id === selectedReportProductId ? 'selected' : ''}>${p.name}</option>`).join('')}
              </select>
            </div>

            <div class="stitch-grid-2" style="gap: var(--spacing-xs);">
              <div class="stitch-flex stitch-flex-col stitch-gap-2xs" style="display: flex; flex-direction: column; gap: 2px;">
                <label class="stitch-form-label" style="font-size: 11px; font-weight: 700;">Bei ya CHIMBO (TSh):</label>
                <input id="report-displayed-price" class="stitch-input" type="number" readonly style="font-size: 12px; background: var(--color-surface-container-low); border-radius: var(--radius-sm); height: 36px; padding: 0 10px; border: 1px solid var(--color-outline-variant);" />
              </div>
              <div class="stitch-flex stitch-flex-col stitch-gap-2xs" style="display: flex; flex-direction: column; gap: 2px;">
                <label class="stitch-form-label" style="font-size: 11px; font-weight: 700;">Bei Aliyoomba (TSh):</label>
                <input id="report-requested-price" class="stitch-input" type="number" required placeholder="Mf. 1,100,000" style="font-size: 12px; border-radius: var(--radius-sm); height: 36px; padding: 0 10px; border: 1px solid var(--color-outline-variant);" />
              </div>
            </div>

            <div class="stitch-flex stitch-flex-col stitch-gap-2xs" style="display: flex; flex-direction: column; gap: 2px;">
              <label class="stitch-form-label" style="font-size: 11px; font-weight: 700;">Comment:</label>
              <textarea id="report-comment" class="stitch-input" placeholder="Eleza kwa kifupi kilichotokea..." required style="height: 60px; font-size: 12px; font-family: sans-serif; padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-outline-variant); resize: none;"></textarea>
            </div>

            <button type="submit" id="submit-report-btn" class="stitch-btn stitch-btn-secondary active-scale" style="width: 100%; height: 40px; font-size: 12px; font-weight: bold; border-radius: var(--radius-full); margin-top: 6px; letter-spacing: 0.3px;">TUMA RIPOTI SASA</button>
          </form>
        </div>
      </div>
    ` : ''}
  `;
}

// 3. Dynamic Mapbox loading & initialization
async function initMapboxMap() {
  const mapElement = document.getElementById('mapbox-map');
  if (!mapElement) return;

  if (mapboxInitRetries >= 3) {
    console.warn('[Navigation] Mapbox initialization aborted: retry limit reached.');
    return;
  }

  // Verify that GPS coordinates are available before booting Mapbox
  if (userLatitude === null || userLongitude === null) {
    mapElement.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; background: var(--color-surface-container-high); color: var(--color-on-surface-variant); gap: 12px; font-family: 'Space Grotesk', sans-serif;">
        <div class="relative w-10 h-10">
          <div class="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
          <div class="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p class="font-bold text-[11px] tracking-wider animate-pulse uppercase" style="color: var(--color-outline);">Kupokea mawimbi ya GPS / Waiting for GPS...</p>
      </div>
    `;
    return;
  }

  if (mapInstance) {
    // Smoothly update existing Mapbox elements without re-rendering the view
    if (userMarker) {
      userMarker.setLngLat([userLongitude, userLatitude]);
    }
    if (autoCenter) {
      mapInstance.easeTo({ center: [userLongitude, userLatitude] });
    }
    return;
  }

  try {
    await ensureMapboxLoaded();

    const mapsSettingsSnap = await getDocs(collection(db, 'mapsSettings'));
    let mapboxToken = '';
    mapsSettingsSnap.forEach(d => {
      if (d.id === 'mapbox_api') {
        mapboxToken = d.data().value || '';
      }
    });

    if (!mapboxToken || mapboxToken.includes('demo')) {
      mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
    }

    const mapboxgl = (window as any).mapboxgl;
    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: 'mapbox-map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [userLongitude, userLatitude],
      zoom: 17,
      pitch: 45
    });
    
    mapInstance = map;

    map.on('dragstart', () => {
      autoCenter = false;
      console.log('[Navigation] Auto-center disabled due to manual map drag.');
    });

    // Custom pulsing blue user position marker
    const el = document.createElement('div');
    el.className = 'gps-pulsing-marker';
    userMarker = new mapboxgl.Marker(el)
      .setLngLat([userLongitude, userLatitude])
      .addTo(map);

    // Destination Marker (Royal Green)
    if (globalSortedProviders.length > 0) {
      const coordinates: [number, number][] = [[userLongitude, userLatitude]];

      globalSortedProviders.forEach((prov, idx) => {
        const provLon = prov.longitude || 39.2826;
        const provLat = prov.latitude || -6.8184;
        coordinates.push([provLon, provLat]);

        new mapboxgl.Marker({ color: '#10b981' })
          .setLngLat([provLon, provLat])
          .setPopup(new mapboxgl.Popup().setHTML(`<h5>Kituo ${idx + 1}: ${prov.businessName}</h5><p>${prov.address}</p>`))
          .addTo(map);
      });

      const bounds = new mapboxgl.LngLatBounds();
      coordinates.forEach(coord => bounds.extend(coord));
      map.fitBounds(bounds, { padding: 60 });

      // First Fetch Directions immediately
      await fetchDirectionsAndDrawRoute(mapboxToken);
    }
  } catch (err) {
    mapboxInitRetries++;
    console.error(`[Navigation] Failed to initialize Mapbox map (Attempt ${mapboxInitRetries}/3):`, err);
  }
}

// 4. Throttled Directions Routing & Drawing
async function fetchDirectionsAndDrawRoute(mapboxToken: string) {
  if (userLatitude === null || userLongitude === null || !mapInstance) return;
  
  const destLat = globalSortedProviders[0].latitude || -6.8184;
  const destLon = globalSortedProviders[0].longitude || 39.2826;
  
  const now = Date.now();
  const timeElapsed = now - lastDirectionsFetchTime;
  
  let distanceMoved = 0;
  if (lastUserGpsPos) {
    distanceMoved = getDistanceInMeters(userLatitude, userLongitude, lastUserGpsPos.lat, lastUserGpsPos.lon);
  }
  
  // Throttle check: at least 8s and 15m moved, except for first time or off-route
  if (timeElapsed < 8000 && distanceMoved < 15 && globalRouteCoordinates.length > 0) {
    console.log('[Navigation] Throttling Directions request (too soon & small movement).');
    return;
  }

  console.log(`[Navigation] Fetching route from [${userLongitude}, ${userLatitude}] to [${destLon}, ${destLat}]`);
  lastDirectionsFetchTime = now;
  lastUserGpsPos = { lat: userLatitude, lon: userLongitude };

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${userLongitude},${userLatitude};${destLon},${destLat}?geometries=geojson&steps=true&language=${voiceLanguage}&access_token=${mapboxToken}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const routeGeojson = data.routes[0].geometry;
      globalRouteCoordinates = routeGeojson.coordinates;
      mapboxSteps = data.routes[0].legs[0].steps || [];
      currentStepIndex = 0;
      
      const realDistance = parseFloat((data.routes[0].distance / 1000).toFixed(2));
      const realDuration = Math.ceil(data.routes[0].duration / 60);
      
      // Update route stats in DOM directly (Prevents flickering view redraws)
      updateRouteStats(realDistance, realDuration);
      
      // Draw/Update the route layer on the map
      if (mapInstance.getSource('route')) {
        mapInstance.getSource('route').setData({
          type: 'Feature',
          properties: {},
          geometry: routeGeojson
        });
      } else {
        mapInstance.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: routeGeojson
          }
        });
        mapInstance.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#4f46e5', // Royal Blue route line
            'line-width': 6,
            'line-opacity': 0.85
          }
        });
      }
      
      // Announce first step voice instruction if navigation is starting
      if (mapboxSteps.length > 0) {
        const initialText = voiceLanguage === 'sw' 
          ? `Safari imeanzishwa. ${mapboxSteps[0].maneuver.instruction}`
          : `Navigation started. ${mapboxSteps[0].maneuver.instruction}`;
        speakInstruction(initialText, voiceLanguage);
        updateNextTurnUI(mapboxSteps[0].maneuver.instruction);
      }
    } else {
      throw new Error('No routes found in Mapbox response');
    }
  } catch (err: any) {
    console.error('[Navigation] Failed to fetch Mapbox route:', err);
    // Show proper error on UI without breaking it
    const nextTurnEl = document.getElementById('next-turn-text');
    if (nextTurnEl) {
      nextTurnEl.innerHTML = `<span style="color: var(--color-error);">Imeshindwa kupakia uelekeo sahihi.</span>`;
    }
  }
}

// 5. GPS watchPosition update callback
async function handleGpsUpdate(position: GeolocationPosition, mapboxToken: string) {
  const lat = position.coords.latitude;
  const lon = position.coords.longitude;
  const speed = position.coords.speed; // speed in m/s
  const heading = position.coords.heading;

  userLatitude = lat;
  userLongitude = lon;
  userHeading = heading;
  
  // Convert speed from m/s to km/h, fallback to 0 if null
  userSpeed = speed ? Math.round(speed * 3.6) : 0;

  // Update Speedometer UI directly
  const speedValEl = document.getElementById('speed-val-badge');
  if (speedValEl) {
    speedValEl.innerText = `${userSpeed}`;
  }

  // Update compass arrow rotation directly
  const compassArrow = document.getElementById('compass-arrow');
  if (compassArrow) {
    const bearing = heading !== null ? heading : 0;
    compassArrow.style.transform = `rotate(${360 - bearing}deg)`;
  }

  // 1. If Mapbox is not initialized, initialize it now!
  if (!mapInstance) {
    await initMapboxMap();
    return;
  }

  // 2. Update User Marker position on map
  if (userMarker) {
    userMarker.setLngLat([lon, lat]);
  }

  // 3. Auto-center map if active
  if (autoCenter) {
    mapInstance.easeTo({
      center: [lon, lat],
      bearing: heading || 0,
      zoom: 17,
      duration: 1000
    });
  }

  // 4. Calculate distance to destination and check arrival (15m radius)
  const destLat = globalSortedProviders[0].latitude || -6.8184;
  const destLon = globalSortedProviders[0].longitude || 39.2826;
  const distToDest = getDistanceInMeters(lat, lon, destLat, destLon);

  if (distToDest <= 15 && !arrived) {
    arrived = true;
    triggerArrival();
    return;
  }

  // 5. Off-route detection (Auto-Rerouting)
  if (globalRouteCoordinates.length > 0) {
    let minDistance = Infinity;
    for (const coord of globalRouteCoordinates) {
      const dist = getDistanceInMeters(lat, lon, coord[1], coord[0]);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }

    if (minDistance > 40) {
      console.log(`[Navigation] Off-route detected (minDistance: ${minDistance}m > 40m). Recalculating...`);
      const rerouteText = voiceLanguage === 'sw' 
        ? 'Umetoka kwenye njia. Njia mpya inatafutwa.'
        : 'Off route. Recalculating route.';
      speakInstruction(rerouteText, voiceLanguage);
      await fetchDirectionsAndDrawRoute(mapboxToken);
      return;
    }
  }

  // 6. Fetch route if not yet loaded or user moved > 15m
  if (globalRouteCoordinates.length === 0) {
    await fetchDirectionsAndDrawRoute(mapboxToken);
  }

  // 7. Voice turn-by-turn guidance based on step tracking
  if (mapboxSteps.length > 0) {
    // Find the step maneuver closest to the user's position
    let closestStepIdx = currentStepIndex;
    let minStepDist = Infinity;
    
    for (let i = 0; i < mapboxSteps.length; i++) {
      const stepCoord = mapboxSteps[i].maneuver.location;
      const dist = getDistanceInMeters(lat, lon, stepCoord[1], stepCoord[0]);
      if (dist < minStepDist) {
        minStepDist = dist;
        closestStepIdx = i;
      }
    }
    
    currentStepIndex = closestStepIdx;
    const currentStep = mapboxSteps[closestStepIdx];
    const nextStep = mapboxSteps[closestStepIdx + 1];

    if (nextStep) {
      const nextManeuverCoord = nextStep.maneuver.location;
      const distToNextManeuver = getDistanceInMeters(lat, lon, nextManeuverCoord[1], nextManeuverCoord[0]);

      if (distToNextManeuver < 30) {
        // Approaching turn! Speak it!
        const approachText = voiceLanguage === 'sw'
          ? `Baada ya mita ${Math.round(distToNextManeuver)}, ${nextStep.maneuver.instruction}`
          : `In ${Math.round(distToNextManeuver)} meters, ${nextStep.maneuver.instruction}`;
        
        speakInstruction(approachText, voiceLanguage);
        updateNextTurnUI(nextStep.maneuver.instruction);
      } else {
        // Normal step guidance
        speakInstruction(currentStep.maneuver.instruction, voiceLanguage);
        updateNextTurnUI(currentStep.maneuver.instruction);
      }
    } else {
      // Last step
      speakInstruction(currentStep.maneuver.instruction, voiceLanguage);
      updateNextTurnUI(currentStep.maneuver.instruction);
    }
  }
}

// Helper to update route stats directly in the DOM
function updateRouteStats(distance: number, duration: number) {
  globalRealDistance = distance;
  globalRealDuration = duration;
  
  const distEl = document.getElementById('route-stat-distance');
  const durEl = document.getElementById('route-stat-duration');
  if (distEl) distEl.innerText = `${distance} km`;
  if (durEl) durEl.innerText = `${duration} min`;
}

// Helper to update maneuver instruction in the DOM
function updateNextTurnUI(instruction: string) {
  const nextTurnEl = document.getElementById('next-turn-text');
  if (nextTurnEl) nextTurnEl.innerText = instruction;
}

// Voice speech synthesizer handler
function speakInstruction(text: string, lang: 'sw' | 'en') {
  if (!voiceSynthEnabled || !('speechSynthesis' in window)) return;
  if (text === lastSpokenInstruction) return;
  
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'sw' ? 'sw-TZ' : 'en-US';
  utterance.rate = 0.95;

  if (window.speechSynthesis.getVoices) {
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang.startsWith(lang));
    if (match) {
      utterance.voice = match;
    }
  }
  
  window.speechSynthesis.speak(utterance);
  lastSpokenInstruction = text;
}

// Trigger arrival overlay and stop GPS tracking
function triggerArrival() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  isNavigatingGps = false;
  
  const arrivalText = voiceLanguage === 'sw'
    ? `Umekamilisha safari yako ya CHIMBO. Umewasili kwenye duka la ${globalSortedProviders[0].businessName}.`
    : `You have arrived at your destination, ${globalSortedProviders[0].businessName}.`;
  
  speakInstruction(arrivalText, voiceLanguage);
  
  const root = document.getElementById('root');
  if (root) {
    const overlay = document.createElement('div');
    overlay.id = 'arrival-modal';
    overlay.className = 'arrival-overlay';
    overlay.innerHTML = `
      <div class="stitch-card animate-scale-in" style="align-items: center; text-align: center; gap: 16px; max-width: 320px; padding: 24px; border-radius: var(--radius-xl); border: 2px solid #10b981; background: white; box-shadow: var(--shadow-lg); pointer-events: auto;">
        <span class="material-symbols-outlined" style="font-size: 64px; color: #10b981; background: rgba(16, 185, 129, 0.05); padding: 12px; border-radius: 50%;">check_circle</span>
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 900; color: #10b981; margin: 0;">Hongera! Umewasili</h3>
        <p style="font-size: 12px; line-height: 1.5; color: var(--color-on-surface-variant); font-weight: 500;">
          Umekamilisha safari yako ya CHIMBO.<br>
          Umewasili salama kwenye duka la:<br>
          <strong>${globalSortedProviders[0].businessName}</strong>
        </p>
        <button id="nav-finish-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; border-radius: var(--radius-full); height: 40px; font-weight: bold; background-color: #10b981; border-color: #10b981; margin: 0;">Kamilisha Safari</button>
      </div>
    `;
    root.appendChild(overlay);
    
    const finishBtn = document.getElementById('nav-finish-btn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => {
        isNavigatingGps = false;
        hasStartedNavigation = false;
        mapInstance = null;
        mapboxInitRetries = 0;
        arrived = false;
        overlay.remove();
        navigateTo('home');
      });
    }
  }
}

export function bindNavigationEvents() {
  const backBtn = document.getElementById('nav-screen-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // Clean up watch position listener and state on exit
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
      }
      isNavigatingGps = false;
      hasStartedNavigation = false;
      mapInstance = null;
      mapboxInitRetries = 0;
      arrived = false;
      currentStepIndex = 0;
      navigateTo('home');
    });
  }

  const buyBtn = document.getElementById('nav-buy-pass-btn');
  if (buyBtn) {
    buyBtn.addEventListener('click', () => navigateTo('access'));
  }

  const exploreBtn = document.getElementById('nav-screen-explore-btn');
  if (exploreBtn) exploreBtn.addEventListener('click', () => navigateTo('search'));

  const emptyBackBtn = document.getElementById('nav-screen-empty-back-btn');
  if (emptyBackBtn) {
    emptyBackBtn.addEventListener('click', () => {
      if (gpsWatchId !== null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
      }
      isNavigatingGps = false;
      hasStartedNavigation = false;
      mapInstance = null;
      mapboxInitRetries = 0;
      arrived = false;
      currentStepIndex = 0;
      navigateTo('home');
    });
  }

  // --- Unlock locked providers directly from navigation page ---
  document.querySelectorAll('.unlock-nav-prov-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provId = btn.getAttribute('data-provider-id');
      const itemId = btn.getAttribute('data-item-id') || 'route-gen';
      const itemType = btn.getAttribute('data-item-type') || 'product';
      if (!provId) return;

      const limitCheck = await checkSelectionLimit(state.userProfile);
      if (!limitCheck.allowed) {
        alert("Huna slots za kutosha za kufungua duka hili. Tafadhali nenda kwenye ukurasa wa duka ubadilishe au ununue Pass mpya.");
        return;
      }

      btn.innerHTML = '<span class="animate-spin material-symbols-outlined" style="font-size: 14px; margin-right: 4px;">refresh</span> Kufungua...';
      try {
        await unlockNavigation(provId, itemId, itemType as any);
        alert(`Umekamilisha kufungua duka! Sasa njia ipo tayari kuanza.`);
        navigateTo('navigation');
      } catch (e: any) {
        alert('Imeshindwa kufungua duka: ' + e.message);
        btn.innerHTML = 'Fungua Mawasiliano ya Duka';
      }
    });
  });

  // Zoom Controls
  const zoomInBtn = document.getElementById('zoomin-btn');
  if (zoomInBtn && mapInstance) {
    zoomInBtn.addEventListener('click', () => {
      mapInstance.zoomIn();
    });
  }

  const zoomOutBtn = document.getElementById('zoomout-btn');
  if (zoomOutBtn && mapInstance) {
    zoomOutBtn.addEventListener('click', () => {
      mapInstance.zoomOut();
    });
  }

  // Re-center GPS Camera on click
  const recenterBtn = document.getElementById('recenter-btn');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      autoCenter = true;
      if (userLatitude !== null && userLongitude !== null && mapInstance) {
        mapInstance.easeTo({
          center: [userLongitude, userLatitude],
          bearing: userHeading || 0,
          zoom: 17,
          duration: 1000
        });
      }
    });
  }

  // Start GPS Geolocation Tracking
  const startBtn = document.getElementById('nav-screen-start-btn');
  const startBtnInit = document.getElementById('nav-screen-start-btn-init');
  
  const toggleGpsNavigation = async () => {
    if (isNavigatingGps) {
      // Pause tracking (simply stop processing, but we keep the watch running to avoid flashing GPS popups)
      isNavigatingGps = false;
      const pauseText = voiceLanguage === 'sw' ? 'Safari imesimama.' : 'Navigation paused.';
      speakInstruction(pauseText, voiceLanguage);
      navigateTo('navigation');
    } else {
      hasStartedNavigation = true;
      isNavigatingGps = true;
      arrived = false;
      currentStepIndex = 0;
      
      const welcomeText = voiceLanguage === 'sw' 
        ? 'Safari imeanzishwa kupitia CHIMBO. Fuata uelekeo kwenye ramani.' 
        : 'Navigation started. Follow the route on the map.';
      speakInstruction(welcomeText, voiceLanguage);

      if (!navigator.geolocation) {
        alert('Kifaa chako hakiauni Geolocation API. Imeshindwa kuanza.');
        isNavigatingGps = false;
        navigateTo('navigation');
        return;
      }

      // Start watching real position
      if (gpsWatchId === null) {
        const mapsSettingsSnap = await getDocs(collection(db, 'mapsSettings'));
        let mapboxToken = '';
        mapsSettingsSnap.forEach(d => {
          if (d.id === 'mapbox_api') {
            mapboxToken = d.data().value || '';
          }
        });

        if (!mapboxToken || mapboxToken.includes('demo')) {
          mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
        }

        gpsWatchId = navigator.geolocation.watchPosition(
          (pos) => handleGpsUpdate(pos, mapboxToken),
          (err) => {
            console.error('[GPS Error] Geolocation watch position failed:', err);
            const nextTurnEl = document.getElementById('next-turn-text');
            if (nextTurnEl) {
              nextTurnEl.innerHTML = `<span style="color: var(--color-error);">Waiting for GPS signal / Kupokea GPS...</span>`;
            }
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
          }
        );
      }

      navigateTo('navigation');
    }
  };

  if (startBtn) {
    startBtn.addEventListener('click', toggleGpsNavigation);
  }
  if (startBtnInit) {
    startBtnInit.addEventListener('click', toggleGpsNavigation);
  }

  // Voice Speech Synthesis toggle
  const voiceToggle = document.getElementById('voice-toggle-btn');
  if (voiceToggle) {
    voiceToggle.addEventListener('click', () => {
      voiceSynthEnabled = !voiceSynthEnabled;
      if (!voiceSynthEnabled) {
        window.speechSynthesis.cancel();
      }
      navigateTo('navigation');
    });
  }

  // Language toggle Swahili <-> English
  const langToggle = document.getElementById('lang-toggle-btn');
  if (langToggle) {
    langToggle.addEventListener('click', async () => {
      voiceLanguage = voiceLanguage === 'sw' ? 'en' : 'sw';
      lastSpokenInstruction = ''; // Reset voice cache to allow immediate announcement in new language
      
      const changeText = voiceLanguage === 'sw' ? 'Mabadiliko ya lugha: Kiswahili.' : 'Language changed to English.';
      speakInstruction(changeText, voiceLanguage);
      
      // Re-trigger Directions fetch to get Mapbox turn steps in new language
      if (userLatitude !== null && userLongitude !== null) {
        const mapsSettingsSnap = await getDocs(collection(db, 'mapsSettings'));
        let mapboxToken = '';
        mapsSettingsSnap.forEach(d => {
          if (d.id === 'mapbox_api') {
            mapboxToken = d.data().value || '';
          }
        });

        if (!mapboxToken || mapboxToken.includes('demo')) {
          mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
        }
        // Force refresh directions
        lastDirectionsFetchTime = 0;
        await fetchDirectionsAndDrawRoute(mapboxToken);
      }

      navigateTo('navigation');
    });
  }

  // Price report discrepancy modal handlers
  const reportBtn = document.getElementById('nav-screen-report-btn');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      isReportModalOpen = true;
      navigateTo('navigation');
    });
  }

  const closeReport = document.getElementById('close-report-btn');
  if (closeReport) {
    closeReport.addEventListener('click', () => {
      isReportModalOpen = false;
      navigateTo('navigation');
    });
  }

  const form = document.getElementById('price-discrepancy-form') as HTMLFormElement;
  const repProviderSelect = document.getElementById('report-provider-id') as HTMLSelectElement;
  const repProductSelect = document.getElementById('report-product-id') as HTMLSelectElement;
  const displayedPriceInput = document.getElementById('report-displayed-price') as HTMLInputElement;

  if (repProductSelect && displayedPriceInput) {
    const updatePrefillPrice = async () => {
      const pId = repProductSelect.value;
      if (pId) {
        const prodSnap = await getDoc(doc(db, 'products', pId));
        if (prodSnap.exists()) {
          displayedPriceInput.value = prodSnap.data().price.toString();
          selectedReportProductId = pId;
        }
      }
    };
    repProductSelect.addEventListener('change', updatePrefillPrice);
    updatePrefillPrice();
  }

  if (repProviderSelect) {
    repProviderSelect.addEventListener('change', () => {
      selectedReportProviderId = repProviderSelect.value;
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const requestedPriceInput = document.getElementById('report-requested-price') as HTMLInputElement;
      const commentInput = document.getElementById('report-comment') as HTMLTextAreaElement;

      const reporterId = auth.currentUser?.uid || 'guest';
      const providerId = selectedReportProviderId;
      const productId = selectedReportProductId;
      const displayedPrice = parseFloat(displayedPriceInput.value) || 0;
      const requestedPrice = parseFloat(requestedPriceInput.value) || 0;
      const comment = commentInput.value;
      
      const photoUrl = 'https://cloudinary.com/chimbo/evidence/default_receipt.jpg';
      const reportId = `rep-${Math.floor(100000 + Math.random() * 900000)}`;

      const submitBtn = document.getElementById('submit-report-btn');
      if (submitBtn) submitBtn.innerHTML = 'Tuma ripoti...';

      try {
        await setDoc(doc(db, 'reports', reportId), {
          id: reportId,
          reporterId,
          providerId,
          productId,
          reason: 'Fake Price',
          displayedPrice,
          requestedPrice,
          photoUrl,
          description: comment,
          urgency: 'high',
          status: 'open',
          isDemo: true,
          createdAt: new Date().toISOString()
        });

        // Decrement provider trust score by 15 points in Firestore
        const providerRef = doc(db, 'providers', providerId);
        const provSnap = await getDoc(providerRef);
        if (provSnap.exists()) {
          const provData = provSnap.data();
          const currentScore = provData.trustScore || 85;
          const newScore = Math.max(0, currentScore - 15);
          await updateDoc(providerRef, { trustScore: newScore });
        }

        alert('Usimamizi wa bei: Ripoti imepokelewa na kuhifadhiwa na timu yetu ya Admin. Muuzaji huyu Trust Score yake imeshuka kwa -15% kutokana na discrepancy hii.');
        isReportModalOpen = false;
        navigateTo('navigation');
      } catch (err) {
        alert('Kuna hitilafu iliyotokea wakati wa kutuma ripoti: ' + err);
        if (submitBtn) submitBtn.innerHTML = 'TUMA RIPOTI SASA';
      }
    });
  }
}
