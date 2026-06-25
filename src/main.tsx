import { state, initAppState, subscribeToState } from './appState';
import { renderHomeView, bindHomeEvents } from './views/homeView';
import { renderSearchView, bindSearchEvents } from './views/searchView';
import { renderDetailView, bindDetailViewEvents } from './views/detailView';
import { renderAccessView, bindAccessEvents } from './views/accessView';
import { renderSavedView, bindSavedEvents } from './views/savedView';
import { renderNavigationView, bindNavigationEvents } from './views/navigationView';
import { renderOnboardingView, bindOnboardingEvents } from './views/onboardingView';
import { renderProviderDashboardView, bindProviderDashboardEvents } from './views/providerDashboardView';
import { renderAdminDashboardView, bindAdminDashboardEvents } from './views/adminDashboardView';
import { renderAuthView, bindAuthEvents } from './views/authView';
import './index.css';

// Active rendering driver for the Vanilla CHIMBO Single Page PWA app
function renderFirestoreErrorUI(root: HTMLElement) {
  if (!state.firestoreError) return;
  root.innerHTML = `
    <div class="p-lg text-center max-w-[480px] mx-auto pt-16 space-y-md animate-fade-in" style="font-family: 'Space Grotesk', sans-serif;">
      <span class="material-symbols-outlined text-error" style="font-size: 60px; color: var(--color-error);">gpp_maybe</span>
      <h3 class="font-headline-lg-mobile text-error font-black" style="font-size: 18px; margin-top: 12px; margin-bottom: 8px;">Itifaki ya Ulinzi Imekataa (Permission Error)</h3>
      <div class="stitch-card text-left" style="background: var(--color-surface-container-low); padding: 16px; border-radius: var(--radius-lg); font-size: 12px; font-family: 'JetBrains Mono', monospace; line-height: 1.5; color: var(--color-on-surface-variant); border: 1.5px solid rgba(239, 68, 68, 0.2); text-align: left; display: flex; flex-direction: column; gap: 4px;">
        <div><strong>Collection Name:</strong> ${state.firestoreError.collectionName}</div>
        <div><strong>Document Path:</strong> ${state.firestoreError.documentPath}</div>
        <div><strong>Operation Type:</strong> ${state.firestoreError.operationType}</div>
        <div><strong>Current User UID:</strong> ${state.firestoreError.uid || 'N/A'}</div>
        <div><strong>Current Role:</strong> ${state.firestoreError.role}</div>
        <div class="text-error" style="margin-top: 8px; border-top: 1px solid rgba(239, 68, 68, 0.2); padding-top: 8px; color: var(--color-error);"><strong>Error:</strong> ${state.firestoreError.error}</div>
      </div>
      <p class="text-xs text-on-surface-variant leading-relaxed" style="margin-top: 12px; font-size: 11px;">CHIMBO imezuia upakiaji ili kuzuia kufeli kwa mfumo. Tafadhali wasiliana na msimamizi wa mfumo au jaribu kuingia upya.</p>
      <div class="stitch-flex stitch-gap-sm" style="display: flex; gap: 12px; margin-top: 16px;">
        <button onclick="window.location.reload()" class="stitch-btn stitch-btn-primary active-scale" style="flex: 1; border-radius: var(--radius-full); height: 42px; font-weight: 700; font-size: 12.5px;">Rudia Upya</button>
        <button id="error-logout-btn" class="stitch-btn stitch-btn-secondary active-scale" style="flex: 1; border-radius: var(--radius-full); height: 42px; font-weight: 700; font-size: 12.5px;">Ondoka (Logout)</button>
      </div>
    </div>
  `;
  const logoutBtn = document.getElementById('error-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        const { logoutUser } = await import('./firebase');
        await logoutUser();
        window.location.reload();
      } catch (e) {
        alert('Failed to logout');
      }
    });
  }
}

async function updateDOM() {
  const root = document.getElementById('root');
  if (!root) return;

  if (state.firestoreError) {
    renderFirestoreErrorUI(root);
    return;
  }

  if (state.currentView === 'admin-dashboard' || state.currentView === 'provider-dashboard') {
    root.classList.remove('stitch-app');
  } else {
    root.classList.add('stitch-app');
  }

  // Let the user see loading indication while async Firestore actions resolve
  if (state.currentView !== 'home' && state.currentView !== 'onboarding') {
    root.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-screen bg-surface gap-md text-primary">
        <div class="relative w-16 h-16">
          <div class="absolute inset-0 border-4 border-primary/20 rounded-full"></div>
          <div class="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
        <p class="font-headline-md text-xs font-bold tracking-widest animate-pulse uppercase">CHIMBO Intel Network...</p>
      </div>
    `;
  }

  try {
    let markup = '';
    
    switch (state.currentView) {
      case 'home':
        markup = await renderHomeView();
        root.innerHTML = markup;
        bindHomeEvents();
        break;
      case 'search':
        markup = await renderSearchView();
        root.innerHTML = markup;
        bindSearchEvents();
        break;
      case 'detail':
        markup = await renderDetailView();
        root.innerHTML = markup;
        bindDetailViewEvents();
        break;
      case 'access':
        markup = await renderAccessView();
        root.innerHTML = markup;
        bindAccessEvents();
        break;
      case 'saved':
        markup = await renderSavedView();
        root.innerHTML = markup;
        bindSavedEvents();
        break;
      case 'navigation':
        markup = await renderNavigationView();
        root.innerHTML = markup;
        bindNavigationEvents();
        break;
      case 'onboarding':
        markup = await renderOnboardingView();
        root.innerHTML = markup;
        bindOnboardingEvents();
        break;
      case 'provider-dashboard':
        markup = await renderProviderDashboardView();
        root.innerHTML = markup;
        bindProviderDashboardEvents();
        break;
      case 'admin-dashboard':
        markup = await renderAdminDashboardView();
        root.innerHTML = markup;
        bindAdminDashboardEvents();
        break;
      case 'auth':
        markup = await renderAuthView();
        root.innerHTML = markup;
        bindAuthEvents();
        break;
      default:
        markup = await renderHomeView();
        root.innerHTML = markup;
        bindHomeEvents();
        break;
    }
  } catch (err) {
    console.error('Error rendering current view route:', err);
    if (state.firestoreError) {
      renderFirestoreErrorUI(root);
    } else {
      root.innerHTML = `
        <div class="p-lg text-center max-w-[400px] mx-auto pt-24 space-y-md">
          <span class="material-symbols-outlined text-error text-6xl">cloud_off</span>
          <h3 class="font-headline-lg-mobile text-error font-black">Munganisho Umefeli</h3>
          <p class="text-xs text-on-surface-variant leading-relaxed">Hakikisha mtandao wako wa simu upo sawa au umeruhusu ufikiaji wa Firebase.</p>
          <button onclick="window.location.reload()" class="w-full h-11 bg-primary text-white rounded-full font-label-md">Rudia Sasa</button>
        </div>
      `;
    }
  }
}

// Subscribe and boot
subscribeToState(updateDOM);
initAppState();

// Register generic service worker for local PWA capabilities offline ready
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('CHIMBO PWA ServiceWorker successfully registered:', reg.scope);
    }).catch(err => {
      console.log('CHIMBO ServiceWorker registration failed: ', err);
    });
  });
}
