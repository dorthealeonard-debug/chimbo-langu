import { state, navigateTo } from '../appState';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { checkPassActive, purchasePass } from '../services/passService';

let isPurchasingPassType: 'daily' | 'weekly' | null = null;
let selectedCarrier: 'M-Pesa' | 'Tigo Pesa' | 'Airtel Money' | 'Card' = 'M-Pesa';
let isProcessingPayment = false;

export async function renderAccessView(): Promise<string> {
  const user = state.currentUser;
  if (!user) {
    return `
      <header class="stitch-header glass-card">
        <div class="stitch-header-content">
          <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Pass za Safari</h1>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px;">
        <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center animate-fade-in" style="padding: var(--spacing-xl) var(--screen-padding-x); text-align: center; gap: var(--spacing-md);">
          <span class="material-symbols-outlined" style="font-size: 48px; color: var(--color-outline-variant);">vpn_key</span>
          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800;">Ingia Kuona Pass Zako</h3>
          <p class="stitch-body-small" style="max-width: 300px; margin: 0 auto; font-size: 11.5px; line-height: 1.45;">Tafadhali ingia na Google au namba ya simu ili kuona hali ya pass yako na kufungua njia za ramani.</p>
          <button id="login-access-btn" class="stitch-btn stitch-btn-primary active-scale" style="border-radius: var(--radius-full); font-weight: 700; height: 38px; padding: 0 16px;">Ingia Sasa</button>
        </div>
      </main>
      ${renderGlobalNavbar('access')}
    `;
  }

  const profile = state.userProfile || { passType: 'none', passExpiresAt: '', routeHistory: [] };
  const isPassActive = checkPassActive(state.userProfile);

  // Fetch unlocked providers
  const unlockedProviders: any[] = [];
  try {
    const tokensSnapshot = await getDocs(query(collection(db, 'accessTokens'), where('userId', '==', user.uid)));
    const providersSnap = await getDocs(collection(db, 'providers'));
    const providerMap = new Map<string, any>();
    providersSnap.forEach(d => providerMap.set(d.id, d.data()));

    tokensSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.userId === user.uid && data.status === 'active') {
        const prov = providerMap.get(data.providerId);
        if (prov) {
          unlockedProviders.push({
            id: data.providerId,
            businessName: prov.businessName,
            phone: prov.tinNumber ? '+255 712 345 678' : '+255 700 000 000',
            address: prov.address || 'Kariakoo',
            expiryDate: data.expiryDate
          });
        }
      }
    });
  } catch (err) {
    console.error('Error fetching unlocked providers:', err);
  }

  let expiryText = 'Hauna Pass Active';
  if (isPassActive && profile.passExpiresAt) {
    const expDate = new Date(profile.passExpiresAt);
    expiryText = `Muda wa kuisha: ${expDate.toLocaleDateString()} saa ${expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Unlocked list
  const listHtml = unlockedProviders.length > 0 
    ? unlockedProviders.map(item => `
        <div class="stitch-card hover-card animate-fade-in" style="padding: 12px; background: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl);">
          <div class="stitch-flex stitch-justify-between stitch-align-center">
            <div>
              <div class="stitch-flex stitch-align-center stitch-gap-2xs" style="color: var(--color-secondary);">
                <span class="material-symbols-outlined" style="font-size: 14px; font-variation-settings: 'FILL' 1;">vpn_key</span>
                <span style="font-size: 8.5px; font-weight: 900; text-transform: uppercase;">UFUNGUO HALISI</span>
              </div>
              <h4 style="font-size: 14px; font-weight: 900; color: var(--color-on-surface); margin-top: 4px; font-family: 'Space Grotesk', sans-serif;">${item.businessName}</h4>
              <p style="font-size: 11px; color: var(--color-on-surface-variant); font-weight: 500;">Mtaa: ${item.address}</p>
            </div>
            <div style="width: 8px; height: 8px; border-radius: 50%; background-color: var(--color-secondary); box-shadow: 0 0 8px var(--color-secondary);"></div>
          </div>
          <div class="stitch-flex stitch-align-center stitch-gap-2xs stitch-mt-xs" style="font-size: 11px; color: var(--color-outline);">
            <span class="material-symbols-outlined" style="font-size: 14px;">phone</span>
            <span>Simu: <span class="font-mono font-semibold" style="color: var(--color-on-surface);">${item.phone}</span></span>
          </div>
          <div class="stitch-flex stitch-gap-xs stitch-mt-sm">
            <button class="stitch-btn stitch-btn-sm stitch-btn-primary nav-access-btn active-scale" data-provider-id="${item.id}" style="flex: 1; height: 32px; font-size: 11px; font-weight: 700; border-radius: var(--radius-full);">
              Anza Safari
            </button>
            <a href="tel:${item.phone}" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 32px; height: 32px; padding: 0; border: 1.5px solid var(--color-outline-variant); display: flex; align-items: center; justify-content: center; border-radius: 50%;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: var(--color-primary);">call</span>
            </a>
            <a href="https://wa.me/${item.phone.replace(/[^0-9]/g, '')}" target="_blank" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 32px; height: 32px; padding: 0; border: 1.5px solid #25D366; display: flex; align-items: center; justify-content: center; border-radius: 50%;">
              <span class="material-symbols-outlined" style="font-size: 16px; color: #25D366;">chat</span>
            </a>
          </div>
        </div>
      `).join('')
    : `
      <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center" style="padding: var(--spacing-lg) var(--screen-padding-x); text-align: center; gap: var(--spacing-sm);">
        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--color-outline-variant);">vpn_key</span>
        <p style="font-size: 11px; color: var(--color-outline); max-width: 240px; margin: 0 auto; line-height: 1.4;">Hujafungua duka lolote bado. Ukianza safari ya kwanza, ramani na namba ya muuzaji zitaonyeshwa hapa.</p>
      </div>
    `;

  return `
    <header class="stitch-header glass-card" style="border-bottom: 1px solid rgba(226, 232, 240, 0.4);">
      <div class="stitch-header-content">
        <button id="access-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: 50%;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px;">arrow_back</span>
        </button>
        <h1 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900;">Pass na Ufikiaji</h1>
        <div style="width: 36px;"></div>
      </div>
    </header>

    <main class="stitch-main animate-fade-in" style="padding-top: 68px; padding-bottom: 100px;">
      <!-- Pass status header -->
      <section class="stitch-card shadow-premium" style="background: linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(99, 102, 241, 0.02) 100%); border: 1px solid rgba(79, 70, 229, 0.15); border-radius: var(--radius-xl); gap: var(--spacing-xs); padding: 20px;">
        <div class="stitch-flex stitch-justify-between stitch-align-center">
          <span style="font-size: 9px; font-weight: 900; color: var(--color-primary); text-transform: uppercase; letter-spacing: 0.5px;">Hali ya Pass Yako</span>
          <span class="stitch-badge ${isPassActive ? 'stitch-badge-primary' : 'stitch-badge-secondary'}" style="font-size: 9px; font-weight: 800; padding: 2px 8px;">
            ${profile.passType ? profile.passType.toUpperCase().replace('_', ' ') : 'NONE'}
          </span>
        </div>
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 900; color: var(--color-on-surface); margin-top: 4px;">
          ${isPassActive ? 'Ufikiaji Uko Wazi ✓' : 'Ufikiaji Umefungwa ✗'}
        </h3>
        <p style="font-size: 12px; color: var(--color-on-surface-variant); font-weight: 500; margin-top: 1px;">${expiryText}</p>
      </section>

      <!-- Buy Passes cards -->
      <section class="stitch-card" style="background-color: var(--color-surface); border: 1.5px solid rgba(226, 232, 240, 0.7); border-radius: var(--radius-xl); padding: var(--spacing-base); gap: var(--spacing-sm);">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface);">Chagua Pass Mpya</h3>
        <p class="stitch-body-xs" style="color: var(--color-outline); line-height: 1.45;">Fungua ramani zote na mawasiliano ya biashara zilizothibitishwa Kariakoo na nchi nzima.</p>
        
        <div class="stitch-grid-2" style="gap: var(--spacing-sm);">
          <!-- Daily Pass Card -->
          <div class="stitch-card-sm select-pass-option hover-card active-scale ${isPurchasingPassType === 'daily' ? 'border-primary' : ''}" data-type="daily" style="cursor: pointer; padding: 16px; align-items: center; text-align: center; background-color: var(--color-surface-container-low); border: 1.5px solid ${isPurchasingPassType === 'daily' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.6)'}; border-radius: var(--radius-lg);">
            <span class="stitch-badge stitch-badge-secondary" style="font-size: 8px; font-weight: 800; padding: 2px 6px;">DAILY PASS</span>
            <span style="font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 900; color: var(--color-primary); margin-top: 6px;">TSh 1,000</span>
            <span style="font-size: 9.5px; color: var(--color-outline); margin-top: 2px; font-weight: 500;">Ufikiaji wa Siku 1</span>
          </div>

          <!-- Weekly Pass Card -->
          <div class="stitch-card-sm select-pass-option hover-card active-scale ${isPurchasingPassType === 'weekly' ? 'border-primary' : ''}" data-type="weekly" style="cursor: pointer; padding: 16px; align-items: center; text-align: center; background-color: var(--color-surface-container-low); border: 1.5px solid ${isPurchasingPassType === 'weekly' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.6)'}; border-radius: var(--radius-lg);">
            <span class="stitch-badge stitch-badge-primary" style="font-size: 8px; font-weight: 800; padding: 2px 6px;">WEEKLY PASS</span>
            <span style="font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 900; color: var(--color-primary); margin-top: 6px;">TSh 5,000</span>
            <span style="font-size: 9.5px; color: var(--color-outline); margin-top: 2px; font-weight: 500;">Ufikiaji wa Siku 7</span>
          </div>
        </div>

        ${isPurchasingPassType ? `
          <!-- Payment carrier selection drawer -->
          <div class="stitch-flex stitch-flex-col stitch-gap-xs stitch-mt-sm animate-slide-up" style="border-top: 1px solid rgba(226, 232, 240, 0.5); padding-top: 14px;">
            <p style="font-size: 11px; font-weight: 800; color: var(--color-on-surface-variant); margin-bottom: 4px;">Chagua Mtandao wa Lipa (Carrier Billing):</p>
            <div class="stitch-grid-4" style="gap: var(--spacing-xs);">
              ${['M-Pesa', 'Tigo Pesa', 'Airtel Money', 'Card'].map(c => `
                <button class="pay-carrier-btn-acc stitch-btn stitch-btn-sm active-scale" data-carrier="${c}" style="height: 36px; padding: 0; font-size: 10px; font-weight: 700; border-radius: var(--radius-md); border: 1.5px solid ${selectedCarrier === c ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; background: ${selectedCarrier === c ? 'rgba(79, 70, 229, 0.05)' : 'white'}; color: ${selectedCarrier === c ? 'var(--color-primary)' : 'var(--color-outline)'};">
                  ${c}
                </button>
              `).join('')}
            </div>
            <button id="final-buy-pass-btn" class="stitch-btn stitch-btn-secondary stitch-mt-sm active-scale" style="width: 100%; height: 42px; font-size: 12.5px; font-weight: bold; border-radius: var(--radius-full); letter-spacing: 0.3px;">
              ${isProcessingPayment ? 'Tafadhali subiri...' : `LIPIA TSh ${isPurchasingPassType === 'daily' ? '1,000' : '5,000'} SASA`}
            </button>
          </div>
        ` : ''}
      </section>

      <!-- Unlocked items list -->
      <section style="margin-top: var(--spacing-lg);">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 900; color: var(--color-on-surface); border-bottom: 1.5px solid rgba(226, 232, 240, 0.6); padding-bottom: 8px; margin-bottom: 12px;">
          Mawasiliano Niliyoyafungua (Unlocked Contacts)
        </h3>
        <div class="stitch-flex stitch-flex-col stitch-gap-sm">
          ${listHtml}
        </div>
      </section>
    </main>

    ${renderGlobalNavbar('access')}
  `;
}

export function bindAccessEvents() {
  const backBtn = document.getElementById('access-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => navigateTo('home'));

  const loginBtn = document.getElementById('login-access-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      navigateTo('auth');
    });
  }

  document.querySelectorAll('.select-pass-option').forEach(card => {
    card.addEventListener('click', () => {
      const type = card.getAttribute('data-type') as 'daily' | 'weekly';
      isPurchasingPassType = type;
      navigateTo('access');
    });
  });

  document.querySelectorAll('.pay-carrier-btn-acc').forEach(btn => {
    btn.addEventListener('click', () => {
      const carrier = btn.getAttribute('data-carrier') as any;
      selectedCarrier = carrier;
      navigateTo('access');
    });
  });

  const finalBtn = document.getElementById('final-buy-pass-btn');
  if (finalBtn && isPurchasingPassType) {
    finalBtn.addEventListener('click', async () => {
      if (isProcessingPayment) return;
      isProcessingPayment = true;
      navigateTo('access');

      try {
        await purchasePass(isPurchasingPassType, selectedCarrier);
        alert(`Malipo ya Shule kupitia ${selectedCarrier} yamekamilika kwa ufanisi! Pass ya ${isPurchasingPassType.toUpperCase()} imeamilishwa.`);
        isPurchasingPassType = null;
        isProcessingPayment = false;
        navigateTo('home');
      } catch (err) {
        alert('Kuna hitilafu iliyotokea kwenye miamala yako.');
        isProcessingPayment = false;
        navigateTo('access');
      }
    });
  }

  document.querySelectorAll('.nav-access-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerId = btn.getAttribute('data-provider-id');
      if (providerId) {
        navigateTo('navigation', null, providerId);
      }
    });
  });

  bindNavbarEvents();
}
