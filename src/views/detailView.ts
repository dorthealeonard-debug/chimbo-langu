import { state, navigateTo, isProductSaved, toggleSaveProduct } from '../appState';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { db, auth } from '../firebase';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { checkPassActive, checkSelectionLimit } from '../services/passService';
import { maskProviderName, getGeneralArea } from '../utils/privacy';
import { checkAccessUnlocked, unlockNavigation, revokeUnlock, getActiveUnlocks } from '../services/navigation';

let activeImageIndex = 0;
let showUnlockLimitModal = false;
let providerIdToUnlock: string | null = null;
let itemIdToUnlock: string | null = null;
let itemTypeToUnlock: 'product' | 'service' = 'product';
let activeUnlocksList: Array<{ providerId: string; businessName: string }> = [];
let isUnlockedCurrent = false;

export async function renderDetailView(): Promise<string> {
  const pId = state.selectedProductId;
  if (!pId) {
    return '<div style="padding: var(--spacing-lg); text-align: center; font-family: var(--font-sans); color: var(--color-outline);">Hakuna bidhaa iliyochaguliwa.</div>';
  }

  let p: any = null;
  let prov: any = {};
  let images: any[] = [];
  let isService = false;

  // Try to fetch from Firestore first
  try {
    const productSnap = await getDoc(doc(db, 'products', pId));
    if (productSnap.exists()) {
      p = productSnap.data();
      const providerSnap = await getDoc(doc(db, 'providers', p.providerId));
      prov = providerSnap.exists() ? providerSnap.data() : {};
      const imagesSnap = await getDocs(query(collection(db, 'productImages'), where('productId', '==', pId)));
      imagesSnap.forEach(d => {
        images.push(d.data());
      });
    } else {
      const serviceSnap = await getDoc(doc(db, 'services', pId));
      if (serviceSnap.exists()) {
        p = serviceSnap.data();
        isService = true;
        const providerSnap = await getDoc(doc(db, 'providers', p.providerId));
        prov = providerSnap.exists() ? providerSnap.data() : {};
      }
    }
  } catch (err) {
    console.error('Error fetching details from Firestore:', err);
  }

  if (!p) {
    return `
      <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
        <div class="stitch-header-content">
          <button id="detail-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
            <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
          </button>
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Bidhaa Haikupatikana</h1>
          <div style="width: 36px;"></div>
        </div>
      </header>
      <main class="stitch-main animate-fade-in" style="padding-top: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: var(--spacing-sm); min-height: 400px; padding: 20px;">
        <span class="material-symbols-outlined" style="color: var(--color-outline); font-size: 48px;">info</span>
        <h2 class="stitch-title-large" style="font-size: 15px; color: var(--color-on-surface);">Chimbo Halijapatikana</h2>
        <p class="stitch-body-small" style="max-width: 260px; line-height: 1.4; color: var(--color-outline); margin-top: 4px;">
          Samahani, maelezo ya bidhaa hii au huduma hii hayakuweza kupatikana kwenye soko la CHIMBO kwa sasa.
        </p>
        <button id="error-back-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-size: 11px; height: 36px; padding: 0 16px; margin-top: 12px;">Rudi Nyuma</button>
      </main>
      ${renderGlobalNavbar('home')}
    `;
  }

  // Determine unlock status
  const user = auth.currentUser;
  const isStaffOrAdmin = state.userProfile?.role === 'admin' || state.userProfile?.role === 'superadmin' || state.userProfile?.role === 'staff';
  const isSelf = user && (user.uid === prov.userId || user.uid === prov.id);
  const isUnlocked = isStaffOrAdmin || isSelf || (user ? await checkAccessUnlocked(prov.id) : false);
  isUnlockedCurrent = isUnlocked;

  if (isService) {
    return await renderServiceDetailHtml(pId, p, prov, isUnlocked);
  }

  const saved = isProductSaved(pId);

  // Sort images by angle so they display in a consistent order
  const angleOrder = ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'];
  images.sort((a, b) => angleOrder.indexOf(a.angle) - angleOrder.indexOf(b.angle));

  if (images.length === 0) {
    const category = p.category || 'General';
    let defaultUrl = 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=800&q=80';
    if (category === 'electronics') {
      defaultUrl = 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=800&q=80';
    } else if (category === 'clothing' || category === 'women fashion' || category === 'men fashion') {
      defaultUrl = 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=80';
    } else if (category === 'parts' || category === 'auto parts') {
      defaultUrl = 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=800&q=80';
    }
    images.push({ angle: 'frontImage', imageUrl: defaultUrl });
  }

  if (activeImageIndex >= images.length) {
    activeImageIndex = 0;
  }

  const isAddedToRoute = state.selectedRouteProductIds.includes(pId);

  // Privacy Masking Logic
  const finalStoreName = isUnlocked ? (prov.businessName || 'Duka Kuu') : maskProviderName(prov.businessName || 'Duka Kuu');
  const finalPhone = isUnlocked ? (prov.whatsapp || prov.tinNumber || '0785000111') : '0785***111';
  const finalStreet = isUnlocked ? (prov.address || 'Aggrey Street') : '****** St';
  const finalArea = getGeneralArea(prov.address);

  // Distance representation
  const lat = prov.latitude || -6.8184;
  const lon = prov.longitude || 39.2826;
  const R = 6371;
  const dLat = (lat - state.userLocation.lat) * Math.PI / 180;
  const dLon = (lon - state.userLocation.lon) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(state.userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = parseFloat((R * c).toFixed(1));

  // Build Links
  const navLink = `https://www.google.com/maps/dir/?api=1&origin=${state.userLocation.lat},${state.userLocation.lon}&destination=${lat},${lon}`;
  const whatsappMsg = `Habari.\nNinaomba maelekezo ya kufika dukani.\n\nBidhaa:\n${p.name}\n\nDuka:\n${prov.businessName || 'Duka Kuu'}\n\nLocation:\n${navLink}`;
  const whatsappUrl = `https://wa.me/${isUnlocked ? finalPhone.replace(/[^0-9]/g, '') : ''}?text=${encodeURIComponent(whatsappMsg)}`;
  const emailSubject = 'Maelekezo Ya Kufika Dukani';
  const emailBody = `Bidhaa:\n${p.name}\n\nDuka:\n${prov.businessName || 'Duka Kuu'}\n\nLocation:\n${navLink}`;
  const emailUrl = `mailto:${isUnlocked ? (prov.email || 'info@samsungshop.co.tz') : ''}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const stockQty = p.stockQuantity !== undefined ? p.stockQuantity : 10;
  const isAvailable = p.stockStatus === 'in_stock' || stockQty > 0;
  const availabilityText = isAvailable ? `In Stock (${stockQty} units)` : 'Out of Stock';
  const availabilityColor = isAvailable ? '#10b981' : '#ef4444';

  // Render Replace/Upgrade Limit Modal if triggered
  let limitModalHtml = '';
  if (showUnlockLimitModal) {
    limitModalHtml = `
      <div class="stitch-flex stitch-justify-center stitch-align-center" style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 1000; padding: 20px;">
        <div class="stitch-card animate-scale-up" style="background: white; width: 100%; max-width: 320px; border-radius: var(--radius-xl); padding: 18px; gap: 14px; box-shadow: var(--shadow-lg);">
          <div class="stitch-flex stitch-align-center" style="gap: 8px; color: var(--color-error); border-bottom: 1px solid rgba(226,232,240,0.8); padding-bottom: 6px;">
            <span class="material-symbols-outlined" style="font-size: 22px; font-variation-settings: 'FILL' 1;">warning</span>
            <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; text-transform: uppercase;">Ukomo Umefikiwa</h3>
          </div>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.45; margin: 0;">
            Umeshajaza idadi ya wauzaji ulioruhusiwa kufungua. Unaweza kununua pass kubwa zaidi au **kubadilisha (replace)** duka lililopo sasa:
          </p>
          
          <div class="stitch-flex stitch-flex-col" style="gap: 6px; max-height: 150px; overflow-y: auto; margin: 4px 0; padding-right: 4px; width: 100%;">
            ${activeUnlocksList.map(u => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: var(--radius-md); gap: 8px; width: 100%; box-sizing: border-box;">
                <span style="font-size: 10.5px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left;">${u.businessName}</span>
                <button class="replace-unlock-trigger-btn stitch-btn stitch-btn-sm active-scale" data-old-id="${u.providerId}" style="height: 24px; font-size: 9.5px; padding: 0 8px; background-color: var(--color-error-container); color: var(--color-error); border: none; font-weight: 800; border-radius: var(--radius-sm); cursor: pointer;">
                  Replace
                </button>
              </div>
            `).join('')}
            ${activeUnlocksList.length === 0 ? '<p style="font-size: 10px; color: var(--color-outline); text-align: center; padding: 10px 0;">Hakuna maduka yaliyofunguliwa kwa sasa.</p>' : ''}
          </div>
          
          <div class="stitch-flex stitch-flex-col" style="gap: 6px; margin-top: 4px; width: 100%;">
            <button id="modal-upgrade-pass-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 36px; font-weight: 800; font-size: 11px; border-radius: var(--radius-full);">
              Nunua Pass Sasa (Upgrade)
            </button>
            <button id="modal-close-limit-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 36px; font-weight: 700; font-size: 11px; border: 1px solid var(--color-outline-variant); border-radius: var(--radius-full);">
              Ghairi (Cancel)
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    ${limitModalHtml}
    <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content">
        <button id="detail-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
        </button>
        <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Pitia Chimbo</h1>
        <div style="width: 36px;"></div>
      </div>
    </header>

    <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 150px; overflow-x: hidden;">
      <!-- Image Gallery -->
      <section class="stitch-card" style="padding: 0; overflow: hidden; background-color: var(--color-surface-container-low); border: none; border-radius: var(--radius-xl); position: relative;">
        <div class="stitch-flex stitch-justify-center stitch-align-center" id="gallery-container" style="position: relative; aspect-ratio: 16 / 10; height: 250px; width: 100%;">
          <img style="max-width: 100%; max-height: 100%; object-fit: contain; padding: var(--spacing-sm);" src="${images[activeImageIndex].secureUrl || images[activeImageIndex].imageUrl}" alt="${p.name} - ${images[activeImageIndex].angle}"/>
          
          ${images.length > 1 ? `
            <button id="gallery-prev" class="active-scale" style="position: absolute; left: var(--spacing-md); top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; background: rgba(255, 255, 255, 0.95); border: none; display: flex; align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; box-shadow: var(--shadow-md); z-index: 10;">
              <span class="material-symbols-outlined" style="font-size: 20px;">chevron_left</span>
            </button>
            <button id="gallery-next" class="active-scale" style="position: absolute; right: var(--spacing-md); top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; background: rgba(255, 255, 255, 0.95); border: none; display: flex; align-items: center; justify-content: center; color: var(--color-primary); cursor: pointer; box-shadow: var(--shadow-md); z-index: 10;">
              <span class="material-symbols-outlined" style="font-size: 20px;">chevron_right</span>
            </button>
            <div style="position: absolute; bottom: var(--spacing-md); left: var(--spacing-md); background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(4px); color: white; padding: 4px 10px; border-radius: var(--radius-full); font-size: var(--font-size-2xs); font-weight: 700;">
              Picha ${activeImageIndex + 1}/${images.length} • Angle: ${images[activeImageIndex].angle.toUpperCase()}
            </div>
          ` : ''}
        </div>
      </section>

      <!-- Thumbnail Row -->
      ${images.length > 1 ? `
        <div class="stitch-flex stitch-gap-xs stitch-hide-scrollbar" style="overflow-x: auto; padding: var(--spacing-xs) 0; margin-top: 6px; justify-content: center; width: 100%; gap: 6px;">
          ${images.map((img, idx) => `
            <button class="gallery-thumb-btn active-scale" data-index="${idx}" style="width: 44px; height: 44px; border-radius: var(--radius-md); overflow: hidden; border: 2px solid ${idx === activeImageIndex ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; cursor: pointer; flex-shrink: 0; background-color: var(--color-surface-container-low); padding: 0;">
              <img src="${img.secureUrl || img.imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" alt="${img.angle}">
            </button>
          `).join('')}
        </div>
      ` : ''}

      <div class="stitch-flex stitch-flex-col stitch-gap-md" style="margin-top: 12px;">
        <!-- Product Main details -->
        <section class="stitch-flex stitch-flex-col stitch-gap-xs">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 900; color: var(--color-on-surface); line-height: 1.2; flex: 1;">${p.name}</h2>
          </div>
          
          <div class="stitch-flex stitch-align-center stitch-gap-xs stitch-mt-xs">
            <span style="font-size: 9.5px; font-weight: 800; color: var(--color-primary); background: var(--color-primary-container); padding: 2px 8px; border-radius: var(--radius-full); text-transform: uppercase;">
              ${p.condition === 'new' ? 'Mpya kabisa' : 'Used'}
            </span>
            <div class="stitch-badge stitch-badge-primary" style="font-weight: 800; font-size: 9px; display: flex; align-items: center; gap: 2px;">
              <span class="material-symbols-outlined" style="font-size: 11px; font-variation-settings: 'FILL' 1;">verified</span>
              <span>BEI YA MWISHO SOKONI (NO BARGAINING)</span>
            </div>
          </div>
          
          <div style="margin-top: 8px;">
            <span style="font-size: 26px; font-weight: 900; color: var(--color-primary);">TSh ${p.price.toLocaleString()}</span>
            <span style="font-size: 11.5px; color: var(--color-outline); font-weight: 500;"> (Bei ya Marejeo Duka)</span>
          </div>

          <div style="margin-top: 4px; font-size: 12.5px; font-weight: 700; color: ${availabilityColor}; display: flex; align-items: center; gap: 4px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${availabilityColor}; display: inline-block;"></span>
            <span>Availability: ${availabilityText}</span>
          </div>
        </section>

        <!-- Provider Section details -->
        <section class="stitch-card" style="background-color: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: 18px; gap: 12px;">
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px;">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="color: var(--color-primary);">storefront</span>
              <h3 style="font-size: 15px; font-weight: 900; color: var(--color-on-surface); font-family: 'Space Grotesk', sans-serif;">${finalStoreName}</h3>
            </div>
            <span class="stitch-badge stitch-badge-primary" style="font-size: 9px; font-weight: 800;">✓ VERIFIED PROVIDER</span>
          </div>

          <!-- Phone, street, area, distance -->
          <div class="stitch-grid-2" style="font-size: 12px; gap: 10px; font-weight: 500; color: var(--color-on-surface-variant);">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">phone</span>
              <span>Simu: <span class="font-mono font-semibold" style="color: var(--color-on-surface);">${finalPhone}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">home</span>
              <span>Mtaa: <span class="font-semibold" style="color: var(--color-on-surface);">${finalStreet}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">map</span>
              <span>Eneo: <span class="font-semibold" style="color: var(--color-on-surface);">${finalArea}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">explore</span>
              <span>Umbali: <span class="font-semibold" style="color: var(--color-secondary);">${distance} km mbali</span></span>
            </div>
          </div>

          <!-- Trust Score breakdown meter -->
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: 10px; margin-top: 4px;">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="color: var(--color-secondary); font-size: 18px; font-variation-settings: 'FILL' 1;">star</span>
              <span style="font-size: 12px; font-weight: 700; color: var(--color-on-surface);">Trust Score</span>
            </div>
            <span style="font-size: 14px; font-weight: 900; color: var(--color-secondary);">${prov.trustScore || p.trustScore || 85}%</span>
          </div>
        </section>

        <!-- Unlock Flow Card (rendered when provider is locked) -->
        ${!isUnlocked ? `
          <section class="stitch-card" style="background: rgba(79, 70, 229, 0.04); border: 1.5px dashed var(--color-primary); border-radius: var(--radius-xl); padding: 18px; align-items: center; text-align: center; gap: 8px;">
            <span class="material-symbols-outlined" style="font-size: 40px; color: var(--color-primary);">lock</span>
            <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900;">Mawasiliano & Ramani Vimefungwa</h4>
            <p style="font-size: 11px; color: var(--color-outline); max-width: 260px; line-height: 1.4; margin: 0 auto 6px auto;">
              Fungua duka hili ili uweze kuona namba ya simu, WhatsApp, barua pepe, anwani sahihi, na kuanza navigation ya safari.
            </p>
            <button id="unlock-provider-details-btn" class="stitch-btn stitch-btn-primary active-scale" style="height: 38px; border-radius: var(--radius-full); font-weight: 800; font-size: 11px; padding: 0 16px; display: flex; align-items: center; justify-content: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 16px;">key</span> Fungua Mawasiliano ya Duka
            </button>
          </section>
        ` : `
          <!-- Lock/Revoke Store details button (returns slot) -->
          <section class="stitch-flex stitch-justify-center" style="margin-top: -6px;">
            <button id="lock-provider-details-btn" class="stitch-btn active-scale" style="height: 32px; border-radius: var(--radius-full); font-size: 10px; font-weight: 800; background-color: var(--color-error-container); color: var(--color-error); border: none; padding: 0 14px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <span class="material-symbols-outlined" style="font-size: 14px;">lock_open</span> Funga Duka (Lock Store & Return Slot)
            </button>
          </section>
        `}

        <!-- Call and Whatsapp buttons -->
        <section class="stitch-grid-2" style="gap: var(--spacing-sm);">
          <a href="${isUnlocked ? `tel:${finalPhone}` : '#'}" class="stitch-btn stitch-btn-flat active-scale" id="call-provider-btn" style="height: 44px; border: 1.5px solid var(--color-outline-variant); border-radius: var(--radius-full); text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; gap: 6px; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--color-primary);">call</span>
            <span>CALL PROVIDER</span>
          </a>
          <a href="${isUnlocked ? whatsappUrl : '#'}" target="${isUnlocked ? '_blank' : '_self'}" class="stitch-btn stitch-btn-flat active-scale" id="whatsapp-provider-btn" style="height: 44px; border: 1.5px solid #25D366; border-radius: var(--radius-full); text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; background: rgba(37, 211, 102, 0.04); color: #128C7E; gap: 6px; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: #25D366;">chat</span>
            <span>WHATSAPP</span>
          </a>
        </section>

        <!-- View Provider, Email and Save buttons -->
        <section class="stitch-flex stitch-gap-xs">
          <button id="view-provider-products-btn" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1.2; height: 40px; font-size: 11.5px; border-radius: var(--radius-full); border: 1.5px solid var(--color-outline-variant); font-weight: 700;">
            VIEW PROVIDER
          </button>
          <a href="${isUnlocked ? emailUrl : '#'}" class="stitch-btn stitch-btn-flat active-scale" id="email-provider-btn" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1.5px solid var(--color-outline-variant); display: flex; align-items: center; justify-content: center; text-decoration: none; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--color-primary);">mail</span>
          </a>
          <button id="save-detail-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1.5px solid var(--color-outline-variant); display: flex; align-items: center; justify-content: center;">
            <span class="material-symbols-outlined" style="color: ${saved ? 'var(--color-error)' : 'var(--color-outline)'}; font-variation-settings: 'FILL' ${saved ? '1' : '0'}; font-size: 18px;">favorite</span>
          </button>
        </section>

        <!-- Price Protection Dispute trigger button -->
        <section class="stitch-card" style="background: linear-gradient(135deg, rgba(220, 38, 38, 0.04) 0%, rgba(220, 38, 38, 0.01) 100%); border: 1.5px solid rgba(220, 38, 38, 0.18); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-xs);">
          <div class="stitch-flex align-center stitch-gap-xs" style="color: var(--color-error);">
            <span class="material-symbols-outlined" style="font-size: 18px; font-variation-settings: 'FILL' 1;">gavel</span>
            <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 12.5px; font-weight: 900; text-transform: uppercase;">Ulinzi wa Bei (Price shield)</h4>
          </div>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.4;">
            Mtoa huduma akidai bei  kubwa kuliko iliyotangazwa, ripoti hapa mara moja ili Trust Score yake ishushwe.
          </p>
          <button id="detail-report-price-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 38px; border: 1.5px solid rgba(220, 38, 38, 0.25); background: rgba(220, 38, 38, 0.03); color: var(--color-error); font-weight: 800; font-size: 11px; border-radius: var(--radius-full); margin-top: 4px;">
            Ripoti Bei Kubwa (Report Wrong Price)
          </button>
        </section>

        <!-- Specifications / Description -->
        <section class="stitch-flex stitch-flex-col stitch-gap-xs">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14.5px; font-weight: 800;">Sifa na Maelezo</h3>
          <p style="font-size: 12.5px; color: var(--color-on-surface-variant); line-height: 1.55;">
            ${p.description || 'Bidhaa hii imesajiliwa kuwa ya leads. Unaweza kuongeza kwenye safari yako kisha kutembelea duka la muuzaji.'}
          </p>
        </section>
      </div>
    </main>

    <!-- Bottom Sticky CTA Actions -->
    <div style="position: fixed; bottom: 80px; left: 0; right: 0; z-index: 30; padding: 0 var(--screen-padding-x); max-width: var(--card-width-pwa); margin: 0 auto; box-sizing: border-box;">
      <div class="stitch-card-sm glass-card" style="flex-direction: row; padding: 8px; border-radius: var(--radius-full); gap: var(--spacing-xs);">
        <button id="detail-route-add-btn" class="stitch-btn ${isAddedToRoute ? 'stitch-btn-secondary' : 'stitch-btn-flat'} active-scale" style="flex: 1; height: 44px; border: 1.5px solid var(--color-outline-variant); font-size: 11px; font-weight: 800; border-radius: var(--radius-full);">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px;">${isAddedToRoute ? 'remove_road' : 'add_road'}</span>
          <span>${isAddedToRoute ? 'ONDOA SAFARINI' : 'WEKA SAFARINI'}</span>
        </button>
        <button id="detail-navigate-btn" class="stitch-btn stitch-btn-primary active-scale" style="flex: 1.2; height: 44px; border-radius: var(--radius-full); font-weight: 900; font-size: 12px; letter-spacing: 0.3px; ${!isUnlocked ? 'opacity: 0.7;' : ''}">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px;">explore</span>
          <span>TUKUPELEKE ALIPO</span>
        </button>
      </div>
    </div>

    ${renderGlobalNavbar('search')}
  `;
}

async function renderServiceDetailHtml(id: string, s: any, prov: any, isUnlocked: boolean): Promise<string> {
  isUnlockedCurrent = isUnlocked;
  const saved = isProductSaved(id);
  const isAddedToRoute = state.selectedRouteProductIds.includes(id);

  // Privacy Masking Logic
  const finalStoreName = isUnlocked ? (prov.businessName || 'Mtoa Huduma Kuu') : maskProviderName(prov.businessName || 'Mtoa Huduma Kuu');
  const finalPhone = isUnlocked ? (prov.whatsapp || prov.tinNumber || '0785000111') : '0785***111';
  const finalStreet = isUnlocked ? (prov.address || 'Aggrey Street') : '****** St';
  const finalArea = getGeneralArea(prov.address);

  // Distance formula
  const lat = prov.latitude || -6.8184;
  const lon = prov.longitude || 39.2826;
  const R = 6371;
  const dLat = (lat - state.userLocation.lat) * Math.PI / 180;
  const dLon = (lon - state.userLocation.lon) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(state.userLocation.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = parseFloat((R * c).toFixed(1));

  const navLink = `https://www.google.com/maps/dir/?api=1&origin=${state.userLocation.lat},${state.userLocation.lon}&destination=${lat},${lon}`;
  const whatsappMsg = `Habari.\nNinaomba maelekezo ya kufika dukani.\n\nHuduma:\n${s.name}\n\nMtoa Huduma:\n${prov.businessName || 'Fundi Kuu'}\n\nLocation:\n${navLink}`;
  const whatsappUrl = `https://wa.me/${isUnlocked ? finalPhone.replace(/[^0-9]/g, '') : ''}?text=${encodeURIComponent(whatsappMsg)}`;
  const emailSubject = 'Maelekezo Ya Kufika Dukani';
  const emailBody = `Huduma:\n${s.name}\n\nMtoa Huduma:\n${prov.businessName || 'Fundi Kuu'}\n\nLocation:\n${navLink}`;
  const emailUrl = `mailto:${isUnlocked ? (prov.email || 'info@chimbo.com') : ''}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const imageUrl = s.imageUrl || 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&w=800&q=80';

  // Render Replace/Upgrade Limit Modal if triggered
  let limitModalHtml = '';
  if (showUnlockLimitModal) {
    limitModalHtml = `
      <div class="stitch-flex stitch-justify-center stitch-align-center" style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 1000; padding: 20px;">
        <div class="stitch-card animate-scale-up" style="background: white; width: 100%; max-width: 320px; border-radius: var(--radius-xl); padding: 18px; gap: 14px; box-shadow: var(--shadow-lg);">
          <div class="stitch-flex stitch-align-center" style="gap: 8px; color: var(--color-error); border-bottom: 1px solid rgba(226,232,240,0.8); padding-bottom: 6px;">
            <span class="material-symbols-outlined" style="font-size: 22px; font-variation-settings: 'FILL' 1;">warning</span>
            <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900; text-transform: uppercase;">Ukomo Umefikiwa</h3>
          </div>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.45; margin: 0;">
            Umeshajaza idadi ya wauzaji ulioruhusiwa kufungua. Unaweza kununua pass kubwa zaidi au **kubadilisha (replace)** duka lililopo sasa:
          </p>
          
          <div class="stitch-flex stitch-flex-col" style="gap: 6px; max-height: 150px; overflow-y: auto; margin: 4px 0; padding-right: 4px; width: 100%;">
            ${activeUnlocksList.map(u => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: var(--radius-md); gap: 8px; width: 100%; box-sizing: border-box;">
                <span style="font-size: 10.5px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left;">${u.businessName}</span>
                <button class="replace-unlock-trigger-btn stitch-btn stitch-btn-sm active-scale" data-old-id="${u.providerId}" style="height: 24px; font-size: 9.5px; padding: 0 8px; background-color: var(--color-error-container); color: var(--color-error); border: none; font-weight: 800; border-radius: var(--radius-sm); cursor: pointer;">
                  Replace
                </button>
              </div>
            `).join('')}
            ${activeUnlocksList.length === 0 ? '<p style="font-size: 10px; color: var(--color-outline); text-align: center; padding: 10px 0;">Hakuna maduka yaliyofunguliwa kwa sasa.</p>' : ''}
          </div>
          
          <div class="stitch-flex stitch-flex-col" style="gap: 6px; margin-top: 4px; width: 100%;">
            <button id="modal-upgrade-pass-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 36px; font-weight: 800; font-size: 11px; border-radius: var(--radius-full);">
              Nunua Pass Sasa (Upgrade)
            </button>
            <button id="modal-close-limit-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 36px; font-weight: 700; font-size: 11px; border: 1px solid var(--color-outline-variant); border-radius: var(--radius-full);">
              Ghairi (Cancel)
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return `
    ${limitModalHtml}
    <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content">
        <button id="detail-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
        </button>
        <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Pitia Huduma</h1>
        <div style="width: 36px;"></div>
      </div>
    </header>

    <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 150px; overflow-x: hidden;">
      <!-- Service Image -->
      <section class="stitch-card" style="padding: 0; overflow: hidden; background-color: var(--color-surface-container-low); border: none; border-radius: var(--radius-xl); position: relative; aspect-ratio: 16 / 10; height: 250px; width: 100%;">
        <img style="width: 100%; height: 100%; object-fit: cover;" src="${imageUrl}" alt="${s.name}"/>
      </section>

      <div class="stitch-flex stitch-flex-col stitch-gap-md" style="margin-top: 12px;">
        <!-- Service Main details -->
        <section class="stitch-flex stitch-flex-col stitch-gap-xs">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 900; color: var(--color-on-surface); line-height: 1.2; flex: 1;">${s.name}</h2>
          </div>
          
          <div class="stitch-flex stitch-align-center stitch-gap-xs stitch-mt-xs">
            <span style="font-size: 9.5px; font-weight: 800; color: var(--color-tertiary); background: var(--color-tertiary-container); padding: 2px 8px; border-radius: var(--radius-full); text-transform: uppercase;">
              HUDUMA / FUNDI
            </span>
            <div class="stitch-badge stitch-badge-primary" style="font-weight: 800; font-size: 9px; display: flex; align-items: center; gap: 2px;">
              <span class="material-symbols-outlined" style="font-size: 11px; font-variation-settings: 'FILL' 1;">verified</span>
              <span>BEI YA MWISHO (NO BARGAINING)</span>
            </div>
          </div>
          
          <div style="margin-top: 8px;">
            <span style="font-size: 24px; font-weight: 900; color: var(--color-secondary);">Anzia TSh ${s.startingPrice.toLocaleString()}</span>
            <span style="font-size: 11.5px; color: var(--color-outline); font-weight: 500;"> (Range: TSh ${s.minPrice?.toLocaleString() || s.startingPrice.toLocaleString()} - ${s.maxPrice?.toLocaleString() || 'Safi'})</span>
          </div>
        </section>

        <!-- Provider Section details -->
        <section class="stitch-card" style="background-color: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: 18px; gap: 12px;">
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="border-bottom: 1px solid rgba(226, 232, 240, 0.5); padding-bottom: 8px;">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="color: var(--color-primary);">storefront</span>
              <h3 style="font-size: 15px; font-weight: 900; color: var(--color-on-surface); font-family: 'Space Grotesk', sans-serif;">${finalStoreName}</h3>
            </div>
            <span class="stitch-badge stitch-badge-primary" style="font-size: 9px; font-weight: 800;">✓ VERIFIED FUNDI</span>
          </div>

          <!-- Phone, street, area, distance -->
          <div class="stitch-grid-2" style="font-size: 12px; gap: 10px; font-weight: 500; color: var(--color-on-surface-variant);">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">phone</span>
              <span>Simu: <span class="font-mono font-semibold" style="color: var(--color-on-surface);">${finalPhone}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">home</span>
              <span>Mtaa: <span class="font-semibold" style="color: var(--color-on-surface);">${finalStreet}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">map</span>
              <span>Eneo: <span class="font-semibold" style="color: var(--color-on-surface);">${finalArea}</span></span>
            </div>
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-outline);">explore</span>
              <span>Umbali: <span class="font-semibold" style="color: var(--color-secondary);">${distance} km mbali</span></span>
            </div>
          </div>

          <!-- Trust Score breakdown meter -->
          <div class="stitch-flex stitch-justify-between stitch-align-center" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: 10px; margin-top: 4px;">
            <div class="stitch-flex stitch-align-center stitch-gap-xs">
              <span class="material-symbols-outlined" style="color: var(--color-secondary); font-size: 18px; font-variation-settings: 'FILL' 1;">star</span>
              <span style="font-size: 12px; font-weight: 700; color: var(--color-on-surface);">Trust Score</span>
            </div>
            <span style="font-size: 14px; font-weight: 900; color: var(--color-secondary);">${prov.trustScore || s.trustScore || 80}%</span>
          </div>
        </section>

        <!-- Unlock Flow Card -->
        ${!isUnlocked ? `
          <section class="stitch-card" style="background: rgba(79, 70, 229, 0.04); border: 1.5px dashed var(--color-primary); border-radius: var(--radius-xl); padding: 18px; align-items: center; text-align: center; gap: 8px;">
            <span class="material-symbols-outlined" style="font-size: 40px; color: var(--color-primary);">lock</span>
            <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 900;">Mawasiliano & Ramani Vimefungwa</h4>
            <p style="font-size: 11px; color: var(--color-outline); max-width: 260px; line-height: 1.4; margin: 0 auto 6px auto;">
              Fungua mtoa huduma huyu ili uweze kuona namba ya simu, WhatsApp, barua pepe, anwani sahihi, na kuanza navigation ya safari.
            </p>
            <button id="unlock-provider-details-btn" class="stitch-btn stitch-btn-primary active-scale" style="height: 38px; border-radius: var(--radius-full); font-weight: 800; font-size: 11px; padding: 0 16px; display: flex; align-items: center; justify-content: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 16px;">key</span> Fungua Mawasiliano ya Duka
            </button>
          </section>
        ` : `
          <!-- Lock/Revoke Store details button (returns slot) -->
          <section class="stitch-flex stitch-justify-center" style="margin-top: -6px;">
            <button id="lock-provider-details-btn" class="stitch-btn active-scale" style="height: 32px; border-radius: var(--radius-full); font-size: 10px; font-weight: 800; background-color: var(--color-error-container); color: var(--color-error); border: none; padding: 0 14px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
              <span class="material-symbols-outlined" style="font-size: 14px;">lock_open</span> Funga Duka (Lock Store & Return Slot)
            </button>
          </section>
        `}

        <!-- Call and Whatsapp buttons -->
        <section class="stitch-grid-2" style="gap: var(--spacing-sm);">
          <a href="${isUnlocked ? `tel:${finalPhone}` : '#'}" class="stitch-btn stitch-btn-flat active-scale" id="call-provider-btn" style="height: 44px; border: 1.5px solid var(--color-outline-variant); border-radius: var(--radius-full); text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; gap: 6px; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--color-primary);">call</span>
            <span>CALL PROVIDER</span>
          </a>
          <a href="${isUnlocked ? whatsappUrl : '#'}" target="${isUnlocked ? '_blank' : '_self'}" class="stitch-btn stitch-btn-flat active-scale" id="whatsapp-provider-btn" style="height: 44px; border: 1.5px solid #25D366; border-radius: var(--radius-full); text-decoration: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; background: rgba(37, 211, 102, 0.04); color: #128C7E; gap: 6px; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: #25D366;">chat</span>
            <span>WHATSAPP</span>
          </a>
        </section>

        <!-- View Provider, Email and Save buttons -->
        <section class="stitch-flex stitch-gap-xs">
          <button id="view-provider-products-btn" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1.2; height: 40px; font-size: 11.5px; border-radius: var(--radius-full); border: 1.5px solid var(--color-outline-variant); font-weight: 700;">
            VIEW PROVIDER
          </button>
          <a href="${isUnlocked ? emailUrl : '#'}" class="stitch-btn stitch-btn-flat active-scale" id="email-provider-btn" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1.5px solid var(--color-outline-variant); display: flex; align-items: center; justify-content: center; text-decoration: none; ${!isUnlocked ? 'opacity: 0.5;' : ''}">
            <span class="material-symbols-outlined" style="font-size: 18px; color: var(--color-primary);">mail</span>
          </a>
          <button id="save-detail-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1.5px solid var(--color-outline-variant); display: flex; align-items: center; justify-content: center;">
            <span class="material-symbols-outlined" style="color: ${saved ? 'var(--color-error)' : 'var(--color-outline)'}; font-variation-settings: 'FILL' ${saved ? '1' : '0'}; font-size: 18px;">favorite</span>
          </button>
        </section>

        <!-- Price Protection Dispute trigger button -->
        <section class="stitch-card" style="background: linear-gradient(135deg, rgba(220, 38, 38, 0.04) 0%, rgba(220, 38, 38, 0.01) 100%); border: 1.5px solid rgba(220, 38, 38, 0.18); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-xs);">
          <div class="stitch-flex align-center stitch-gap-xs" style="color: var(--color-error);">
            <span class="material-symbols-outlined" style="font-size: 18px; font-variation-settings: 'FILL' 1;">gavel</span>
            <h4 style="font-family: 'Space Grotesk', sans-serif; font-size: 12.5px; font-weight: 900; text-transform: uppercase;">Ulinzi wa Bei (Price shield)</h4>
          </div>
          <p style="font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.45;">
            Mtoa huduma akidai bei kubwa kuliko iliyotangazwa, ripoti mara moja ili Trust Score yake ishushwe.
          </p>
          <button id="detail-report-price-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 38px; border: 1.5px solid rgba(220, 38, 38, 0.25); background: rgba(220, 38, 38, 0.03); color: var(--color-error); font-weight: 800; font-size: 11px; border-radius: var(--radius-full); margin-top: 4px;">
            Ripoti Bei Kubwa (Report Wrong Price)
          </button>
        </section>

        <!-- Service Description / Coverage Areas -->
        <section class="stitch-flex stitch-flex-col stitch-gap-xs">
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 14.5px; font-weight: 800;">Maelezo ya Huduma & Maeneo ya Upatikanaji</h3>
          <p style="font-size: 12.5px; color: var(--color-on-surface-variant); line-height: 1.55;">
            ${s.description || 'Huduma hii inatolewa na fundi mtaalamu aliyethibitishwa na CHIMBO.'}
          </p>
          <div class="stitch-flex stitch-flex-wrap stitch-gap-2xs stitch-mt-xs">
            <span style="font-size: 11px; font-weight: bold; color: var(--color-outline);">Maeneo ya Huduma:</span>
            ${(s.coverageAreas || []).map((area: string) => `
              <span style="font-size: 10px; font-weight: 700; color: var(--color-primary); background: var(--color-primary-container); padding: 1px 6px; border-radius: var(--radius-sm);">${area}</span>
            `).join('')}
          </div>
        </section>
      </div>
    </main>

    <!-- Bottom Sticky CTA Actions -->
    <div style="position: fixed; bottom: 80px; left: 0; right: 0; z-index: 30; padding: 0 var(--screen-padding-x); max-width: var(--card-width-pwa); margin: 0 auto; box-sizing: border-box;">
      <div class="stitch-card-sm glass-card" style="flex-direction: row; padding: 8px; border-radius: var(--radius-full); gap: var(--spacing-xs);">
        <button id="detail-route-add-btn" class="stitch-btn ${isAddedToRoute ? 'stitch-btn-secondary' : 'stitch-btn-flat'} active-scale" style="flex: 1; height: 44px; border: 1.5px solid var(--color-outline-variant); font-size: 11px; font-weight: 800; border-radius: var(--radius-full);">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px;">${isAddedToRoute ? 'remove_road' : 'add_road'}</span>
          <span>${isAddedToRoute ? 'ONDOA SAFARINI' : 'WEKA SAFARINI'}</span>
        </button>
        <button id="detail-navigate-btn" class="stitch-btn stitch-btn-primary active-scale" style="flex: 1.2; height: 44px; border-radius: var(--radius-full); font-weight: 900; font-size: 12px; letter-spacing: 0.3px; ${!isUnlocked ? 'opacity: 0.7;' : ''}">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 4px;">explore</span>
          <span>TUKUPELEKE ALIPO</span>
        </button>
      </div>
    </div>

    ${renderGlobalNavbar('search')}
  `;
}

export function bindDetailViewEvents() {
  const backBtn = document.getElementById('detail-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));

  const errBack = document.getElementById('error-back-btn');
  if (errBack) errBack.addEventListener('click', () => navigateTo('home'));

  const saveBtn = document.getElementById('save-detail-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const pId = state.selectedProductId;
      if (pId) {
        toggleSaveProduct(pId);
        navigateTo('detail');
      }
    });
  }

  const prevBtn = document.getElementById('gallery-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      // Toggle index
      activeImageIndex = activeImageIndex === 0 ? 0 : activeImageIndex - 1;
      navigateTo('detail');
    });
  }
  const nextBtn = document.getElementById('gallery-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      activeImageIndex = (activeImageIndex + 1) % 7;
      navigateTo('detail');
    });
  }

  // Bind thumbnail click events
  document.querySelectorAll('.gallery-thumb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.getAttribute('data-index') || '0', 10);
      activeImageIndex = index;
      navigateTo('detail');
    });
  });

  const viewProvBtn = document.getElementById('view-provider-products-btn');
  if (viewProvBtn) {
    viewProvBtn.addEventListener('click', () => {
      const providerId = state.selectedProviderId;
      if (providerId) {
        state.activeSearchQuery = '';
        navigateTo('search', null, providerId);
      }
    });
  }

  const routeAddBtn = document.getElementById('detail-route-add-btn');
  if (routeAddBtn) {
    routeAddBtn.addEventListener('click', () => {
      const pId = state.selectedProductId;
      if (pId) {
        const idx = state.selectedRouteProductIds.indexOf(pId);
        if (idx === -1) {
          state.selectedRouteProductIds.push(pId);
        } else {
          state.selectedRouteProductIds.splice(idx, 1);
        }
        navigateTo('detail');
      }
    });
  }

  // --- Dynamic Unlock Trigger Button ---
  const unlockBtn = document.getElementById('unlock-provider-details-btn');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      if (!state.currentUser) {
        alert("Tafadhali ingia au jisajili ili uweze kufungua mawasiliano ya muuzaji.");
        navigateTo('auth');
        return;
      }

      const isPassActive = checkPassActive(state.userProfile);
      if (!isPassActive) {
        alert("Ufikiaji Umefungwa! Huna Pass thabiti inayotumika sasa. Tafadhali nunua Pass ya Daily au Weekly kwanza.");
        navigateTo('access');
        return;
      }

      // Check unlock limit
      const limitCheck = await checkSelectionLimit(state.userProfile);
      if (limitCheck.allowed) {
        try {
          unlockBtn.setAttribute('disabled', 'true');
          unlockBtn.innerHTML = 'Fungua...';
          const type = state.selectedProductId?.startsWith('SER') ? 'service' : 'product';
          await unlockNavigation(state.selectedProviderId!, state.selectedProductId!, type);
          alert("Duka limefunguliwa kikamilifu! Sasa unaweza kuona mawasiliano sahihi na ramani.");
          navigateTo('detail');
        } catch (e: any) {
          alert("Imeshindwa kufungua: " + e.message);
          navigateTo('detail');
        }
      } else {
        // Limit reached: trigger the dynamic Upgrade or Replace dialog
        console.log("[Unlock Protection] Limit reached, loading active unlocks for replacement...");
        try {
          activeUnlocksList = await getActiveUnlocks();
          providerIdToUnlock = state.selectedProviderId;
          itemIdToUnlock = state.selectedProductId;
          itemTypeToUnlock = state.selectedProductId?.startsWith('SER') ? 'service' : 'product';
          showUnlockLimitModal = true;
          navigateTo('detail');
        } catch (err: any) {
          alert("Kosa: " + err.message);
        }
      }
    });
  }

  // --- Lock/Revoke Store Trigger Button ---
  const lockBtn = document.getElementById('lock-provider-details-btn');
  if (lockBtn) {
    lockBtn.addEventListener('click', async () => {
      const providerId = state.selectedProviderId;
      if (!providerId) return;

      if (confirm("Je, una uhakika unataka kufunga mawasiliano ya duka hili? Utaweza kutumia slot hii kufungua duka lingine.")) {
        try {
          lockBtn.setAttribute('disabled', 'true');
          lockBtn.innerHTML = 'Kufunga...';
          await revokeUnlock(providerId);
          alert("Duka limefungwa tena. Slot yako 1 ya uhakiki imerejeshwa kwa ufanisi!");
          navigateTo('detail');
        } catch (e: any) {
          alert("Kosa: " + e.message);
          navigateTo('detail');
        }
      }
    });
  }

  // --- Modal Event Listeners ---
  if (showUnlockLimitModal) {
    // Close button
    const closeBtn = document.getElementById('modal-close-limit-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        showUnlockLimitModal = false;
        navigateTo('detail');
      });
    }

    // Upgrade Pass button
    const upgradeBtn = document.getElementById('modal-upgrade-pass-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        showUnlockLimitModal = false;
        navigateTo('access');
      });
    }

    // Replace buttons
    document.querySelectorAll('.replace-unlock-trigger-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const oldProvId = btn.getAttribute('data-old-id');
        if (!oldProvId || !providerIdToUnlock || !itemIdToUnlock) return;

        btn.setAttribute('disabled', 'true');
        btn.innerHTML = 'Replacing...';

        try {
          // 1. Revoke old unlock
          await revokeUnlock(oldProvId);
          // 2. Unlock new provider in its place
          await unlockNavigation(providerIdToUnlock, itemIdToUnlock, itemTypeToUnlock);
          
          alert("Duka jipya limefunguliwa na la zamani limefungwa kikamilifu!");
          showUnlockLimitModal = false;
          providerIdToUnlock = null;
          itemIdToUnlock = null;
          navigateTo('detail');
        } catch (e: any) {
          alert("Kosa wakati wa kubadilisha duka: " + e.message);
          showUnlockLimitModal = false;
          navigateTo('detail');
        }
      });
    });
  }

  // Explore / Tukupeleke Alipo Protection
  const navigateBtn = document.getElementById('detail-navigate-btn');
  if (navigateBtn) {
    navigateBtn.addEventListener('click', () => {
      const pId = state.selectedProductId;
      const providerId = state.selectedProviderId;
      if (!pId || !providerId) return;

      if (!state.currentUser) {
        alert('Tafadhali ingia ili uweze kutengeneza njia ya safari.');
        navigateTo('auth');
        return;
      }

      const isPassActive = checkPassActive(state.userProfile);
      if (!isPassActive) {
        alert('Ufikiaji Umefungwa! Huna Pass thabiti inayotumika. Tafadhali nunua Pass ya Daily au Weekly kwanza.');
        navigateTo('access');
        return;
      }

      // Check if unlocked
      if (!isUnlockedCurrent) {
        alert("Tafadhali fungua mawasiliano ya duka hili kwanza (click 'Fungua Mawasiliano ya Duka') kabla ya kuanza navigation.");
        return;
      }

      if (!state.selectedRouteProductIds.includes(pId)) {
        state.selectedRouteProductIds.push(pId);
      }
      navigateTo('navigation', pId, providerId);
    });
  }

  const reportBtn = document.getElementById('detail-report-price-btn');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        alert('Tafadhali ingia kwanza.');
        navigateTo('auth');
        return;
      }
      const isPassActive = checkPassActive(state.userProfile);
      if (!isPassActive) {
        alert('Ufikiaji Umefungwa! Huna Pass thabiti inayotumika. Tafadhali nunua Pass ya Daily au Weekly kwanza ili kuona na kuripoti.');
        navigateTo('access');
        return;
      }

      // Check if unlocked
      if (!isUnlockedCurrent) {
        alert("Tafadhali fungua mawasiliano ya duka hili kwanza kabla ya kuripoti bei.");
        return;
      }

      navigateTo('navigation', state.selectedProductId, state.selectedProviderId);
      setTimeout(() => {
        const openReport = document.getElementById('nav-screen-report-btn');
        if (openReport) openReport.click();
      }, 300);
    });
  }

  // Bind call/whatsapp/email clicks protection
  const protectContactAction = (btnId: string, alertMsg: string) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', (e) => {
        if (!isUnlockedCurrent) {
          e.preventDefault();
          alert(alertMsg);
        }
      });
    }
  };

  protectContactAction('call-provider-btn', 'Tafadhali fungua mawasiliano ya duka hili kwanza ili uweze kupiga simu.');
  protectContactAction('whatsapp-provider-btn', 'Tafadhali fungua mawasiliano ya duka hili kwanza ili uweze kuwasiliana kwa WhatsApp.');
  protectContactAction('email-provider-btn', 'Tafadhali fungua mawasiliano ya duka hili kwanza ili uweze kutuma barua pepe.');

  bindNavbarEvents();
}
