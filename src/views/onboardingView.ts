import { state, navigateTo } from '../appState';
import { db, auth } from '../firebase';
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';
import { logAction } from '../services/audit';
import { uploadFileToCloudinary } from '../services/cloudinaryService';
import { renderGlobalNavbar, bindNavbarEvents } from './homeView';

// Onboarding wizard step index:
// Step 0: Welcome / Overview
// Step 1: Business Profile (Name, Type, Description with dynamic wording)
// Step 2: Business Location (GPS Capture & Mapbox non-interactive confirmation)
// Step 3: Address Details (Region, District, Ward, Street, Landmark, directions, autofilled)
// Step 4: Verification Documents (BRELA, TIN, License, Office, Storefront file upload to Cloudinary)
// Step 5: Review & Confirmation (Summary & Locked GPS details, strict checkbox)
// Step 6: Success page
let onboardingStep: number = 0;

// Local caching of Firestore loading state
let isLoaded = false;
let dbProvider: any = null;
let editMode = false; // Set to true if provider is rejected and clicks "Edit Information"
let isCapturingGps = false;
let gpsStatusText = 'Not Captured';

// Local file selection cache (cleared after upload)
const selectedFiles: {
  brela: File | null;
  tin: File | null;
  license: File | null;
  office: File | null;
  storefront: File | null;
} = {
  brela: null,
  tin: null,
  license: null,
  office: null,
  storefront: null
};

// Form data structure matching the business requirements
const formData = {
  businessName: '',
  businessType: 'Product Seller' as 'Product Seller' | 'Service Provider' | 'Products and Services',
  description: '',
  primaryCategory: '',
  latitude: null as number | null,
  longitude: null as number | null,
  gpsAccuracy: null as number | null,
  gpsTimestamp: null as string | null,
  reverseGeocodedAddress: '',
  region: '',
  district: '',
  ward: '',
  street: '',
  buildingName: '',
  landmark: '',
  floor: '',
  shopNumber: '',
  additionalDirections: '',
  brelaUrl: '',
  tinUrl: '',
  licenseUrl: '',
  officePhotos: '',
  storeFrontPhoto: ''
};

// Mapbox loader helper
async function ensureMapboxLoaded(): Promise<void> {
  if ((window as any).mapboxgl) return;

  return new Promise((resolve, reject) => {
    // Inject Mapbox CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css';
    document.head.appendChild(link);

    // Inject Mapbox JS
    const script = document.createElement('script');
    script.src = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Mapbox GL JS'));
    document.head.appendChild(script);
  });
}

// Mapbox Token resolver
async function getMapboxToken(): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'mapsSettings', 'mapbox_token'));
    if (snap.exists()) {
      return snap.data().value || import.meta.env.VITE_MAPBOX_TOKEN || '';
    }
  } catch (err) {
    console.warn('Failed to fetch mapsSettings mapbox_token, using fallback:', err);
  }
  return import.meta.env.VITE_MAPBOX_TOKEN || '';
}

/**
 * Main rendering router for onboarding.
 * If user has a submitted profile in Firestore, automatically intercepts and renders the status tracker.
 */
export async function renderOnboardingView(): Promise<string> {
  const user = state.currentUser;
  if (!user) {
    return `
      <header class="stitch-header">
        <div class="stitch-header-content" style="justify-content: center;">
          <h1 class="stitch-title-medium">Usajili wa Biashara / Onboarding</h1>
        </div>
      </header>
      <main class="stitch-main" style="padding-top: 68px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: var(--spacing-md); padding: 24px; font-family: var(--font-sans);">
        <div class="stitch-flex stitch-justify-center stitch-align-center animate-pulse" style="width: 64px; height: 64px; border-radius: var(--radius-full); background: rgba(79, 70, 229, 0.08); color: var(--color-primary); margin-bottom: 8px;">
          <span class="material-symbols-outlined" style="font-size: 32px;">vpn_key</span>
        </div>
        <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 17px; font-weight: 900; color: var(--color-on-surface);">Ingia Kwenye Mfumo</h2>
        <p style="font-size: 11.5px; color: var(--color-outline); max-width: 260px; line-height: 1.45; margin: 0;">
          Tafadhali ingia kwenye akaunti yako kwanza ili kuanza mchakato salama wa kusajili biashara yako Kariakoo.
        </p>
        <button onclick="window.appState.navigateTo('auth')" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; max-width: 240px; border-radius: var(--radius-full); height: 42px; font-weight: 800; margin-top: 12px; font-size: 12px;">Ingia Sasa / Login</button>
      </main>
      ${renderGlobalNavbar('profile')}
    `;
  }

  // Fetch Firestore registration details if not already loaded
  if (!isLoaded) {
    try {
      const provRef = doc(db, 'providers', user.uid);
      const provSnap = await getDoc(provRef);
      if (provSnap.exists()) {
        dbProvider = provSnap.data();
        if (dbProvider) {
          // Pre-populate fields for edit/review/status purposes
          formData.businessName = dbProvider.businessName || '';
          formData.businessType = dbProvider.businessType || 'Product Seller';
          formData.description = dbProvider.description || '';
          formData.primaryCategory = dbProvider.category || '';
          formData.latitude = dbProvider.latitude || null;
          formData.longitude = dbProvider.longitude || null;
          formData.gpsAccuracy = dbProvider.accuracy || null;
          formData.gpsTimestamp = dbProvider.gpsTimestamp || null;
          formData.reverseGeocodedAddress = dbProvider.reverseGeocodedAddress || '';
          formData.region = dbProvider.region || '';
          formData.district = dbProvider.district || '';
          formData.ward = dbProvider.ward || '';
          formData.street = dbProvider.street || '';
          formData.buildingName = dbProvider.buildingName || '';
          formData.landmark = dbProvider.landmark || '';
          formData.floor = dbProvider.floor || '';
          formData.shopNumber = dbProvider.shopNumber || '';
          formData.additionalDirections = dbProvider.additionalDirections || '';
          formData.brelaUrl = dbProvider.brelaUrl || '';
          formData.tinUrl = dbProvider.tinUrl || '';
          formData.licenseUrl = dbProvider.licenseUrl || '';
          formData.officePhotos = dbProvider.officePhotos || '';
          formData.storeFrontPhoto = dbProvider.storeFrontPhoto || '';
        }
      } else {
        dbProvider = null;
      }
      isLoaded = true;
    } catch (err) {
      console.error('Error fetching provider profile inside onboarding view:', err);
    }
  }

  // GATEKEEPER: If provider exists and status is NOT draft, immediately bypass wizard to show status tracker
  if (dbProvider && dbProvider.status !== 'draft' && !editMode) {
    return renderStatusTracker(dbProvider);
  }

  return renderOnboardingWizard();
}

/**
 * Renders the 6-step onboarding wizard layout
 */
function renderOnboardingWizard(): string {
  let stepMarkup = '';
  const totalSteps = 5; // Steps 1 to 5

  switch (onboardingStep) {
    case 0:
      stepMarkup = renderStepWelcome();
      break;
    case 1:
      stepMarkup = renderStepProfile();
      break;
    case 2:
      stepMarkup = renderStepLocation();
      break;
    case 3:
      stepMarkup = renderStepAddress();
      break;
    case 4:
      stepMarkup = renderStepDocuments();
      break;
    case 5:
      stepMarkup = renderStepReview();
      break;
    case 6:
      stepMarkup = renderStepSuccess();
      break;
  }

  const stepHeader = onboardingStep > 0 && onboardingStep <= totalSteps ? `
    <div style="padding: 10px var(--screen-padding-x) 0 var(--screen-padding-x); background: var(--color-surface); z-index: 10;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--color-primary); letter-spacing: 0.5px;">Usajili wa Biashara</span>
        <span style="font-size: 10px; font-weight: 900; color: var(--color-outline);">Hatua ${onboardingStep} ya ${totalSteps}</span>
      </div>
      <div style="height: 4px; width: 100%; background: rgba(226, 232, 240, 0.6); border-radius: var(--radius-full); overflow: hidden;">
        <div style="height: 100%; width: ${(onboardingStep / totalSteps) * 100}%; background: linear-gradient(90deg, var(--color-primary) 0%, #818cf8 100%); transition: width 0.30s ease; border-radius: var(--radius-full);"></div>
      </div>
    </div>
  ` : '';

  return `
    <header class="stitch-header glass-card">
      <div class="stitch-header-content">
        <button id="onboard-back-btn" class="stitch-btn stitch-btn-sm stitch-btn-flat active-scale" style="width: 36px; height: 36px; padding: 0; border-radius: var(--radius-full); border: 1.5px solid rgba(226, 232, 240, 0.5);">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px;">arrow_back</span>
        </button>
        <h1 class="stitch-title-medium" style="font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 14.5px;">Sajili Chimbo Lako</h1>
        <div style="width: 36px;"></div> <!-- spacer -->
      </div>
    </header>

    <main class="stitch-main" style="padding-top: 68px; padding-bottom: 80px; font-family: var(--font-sans);">
      ${stepHeader}
      <div style="padding: var(--spacing-sm) var(--screen-padding-x);">
        ${stepMarkup}
      </div>
    </main>

    <!-- Upload Overlay with Glassmorphism -->
    <div id="upload-overlay" class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center animate-fade-in" style="display: none; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(12px); z-index: 9999; color: white; gap: 16px; text-align: center; font-family: var(--font-sans);">
      <div class="relative w-16 h-16">
        <div class="absolute inset-0 border-4 border-white/20 rounded-full"></div>
        <div class="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
      <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 800; margin: 0; color: white;">Nyaraka Zinasafirishwa...</h3>
      <p id="upload-progress-msg" style="font-size: 11.5px; color: rgba(255, 255, 255, 0.7); max-width: 260px; line-height: 1.45; margin: 0;">Inapandisha BRELA kwenye Cloudinary ya CHIMBO...</p>
    </div>

    ${renderGlobalNavbar('profile')}
  `;
}

/**
 * Step 0: Welcome Screen
 */
function renderStepWelcome(): string {
  return `
    <div class="animate-fade-in" style="text-align: center; margin-bottom: var(--spacing-md);">
      <div class="stitch-flex stitch-justify-center stitch-align-center" style="width: 56px; height: 56px; border-radius: var(--radius-full); background: rgba(79, 70, 229, 0.08); color: var(--color-primary); margin: 0 auto var(--spacing-xs) auto; border: 1px solid rgba(79, 70, 229, 0.15);">
        <span class="material-symbols-outlined" style="font-size: 28px;">storefront</span>
      </div>
      <h2 class="stitch-title-large" style="font-size: 18px; font-weight: 900; color: var(--color-primary); font-family: 'Space Grotesk', sans-serif; margin-bottom: 4px;">Usajili Rasmi wa Biashara</h2>
      <p class="stitch-body-small" style="font-size: 11px; max-width: 300px; margin: 0 auto; line-height: 1.45; color: var(--color-outline);">
        Unganisha duka lako na maelfu ya wateja wa Kariakoo wanaotafuta bidhaa na huduma zako kila siku kwenye mfumo wa CHIMBO.
      </p>
    </div>

    <div class="stitch-card glass-card animate-fade-in" style="background-color: var(--color-surface-container-low); border: 1.5px solid rgba(79, 70, 229, 0.1); padding: var(--spacing-sm); margin-bottom: var(--spacing-md); gap: 14px;">
      <h3 style="font-size: 10px; border-bottom: 1.5px solid rgba(226, 232, 240, 0.8); padding-bottom: 6px; margin: 0; text-transform: uppercase; color: var(--color-outline); font-family: 'Space Grotesk', sans-serif; font-weight: 900; letter-spacing: 0.5px;">Mlolongo wa Usajili / Checklist</h3>
      
      <div class="stitch-flex stitch-flex-col" style="gap: var(--spacing-sm); text-align: left;">
        
        <div class="stitch-flex" style="gap: 12px; align-items: flex-start;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px; margin-top: 1px; font-variation-settings: 'FILL' 1;">badge</span>
          <div>
            <h4 style="font-size: 11.5px; font-weight: 800; margin: 0; color: var(--color-on-surface);">1. Wasifu wa Biashara (Profile)</h4>
            <p class="stitch-body-xs" style="font-size: 10px; margin-top: 1px; color: var(--color-outline); line-height: 1.35;">Kusanya Jina la Biashara, maelezo sahihi ya shughuli zako, na kategoria kuu ya bidhaa/huduma.</p>
          </div>
        </div>

        <div class="stitch-flex" style="gap: 12px; align-items: flex-start;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px; margin-top: 1px; font-variation-settings: 'FILL' 1;">my_location</span>
          <div>
            <h4 style="font-size: 11.5px; font-weight: 800; margin: 0; color: var(--color-on-surface);">2. Nasa GPS Halisi (Live GPS Capture)</h4>
            <p class="stitch-body-xs" style="font-size: 10px; margin-top: 1px; color: var(--color-outline); line-height: 1.35;">Tunasajili eneo halisi la duka lako kwa kutumia GPS ya kifaa chako. Lazima uwe umesimama dukani kwako kabla ya kuendelea.</p>
          </div>
        </div>

        <div class="stitch-flex" style="gap: 12px; align-items: flex-start;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px; margin-top: 1px; font-variation-settings: 'FILL' 1;">home_pin</span>
          <div>
            <h4 style="font-size: 11.5px; font-weight: 800; margin: 0; color: var(--color-on-surface);">3. Anuani na Mtaa (Address Details)</h4>
            <p class="stitch-body-xs" style="font-size: 10px; margin-top: 1px; color: var(--color-outline); line-height: 1.35;">Kusanya Mkoa, Wilaya, Kata, Mtaa, Jengo, na alama za karibu za duka lako. Inasaidiwa na Mapbox autofill.</p>
          </div>
        </div>

        <div class="stitch-flex" style="gap: 12px; align-items: flex-start;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px; margin-top: 1px; font-variation-settings: 'FILL' 1;">upload_file</span>
          <div>
            <h4 style="font-size: 11.5px; font-weight: 800; margin: 0; color: var(--color-on-surface);">4. Uhakiki wa Nyaraka (Verification Documents)</h4>
            <p class="stitch-body-xs" style="font-size: 10px; margin-top: 1px; color: var(--color-outline); line-height: 1.35;">Pakia vyeti rasmi vya BRELA, TIN, picha za nje ya duka, na ndani ya ofisi. Faili zote zinalindwa kwa ulinzi wa Cloudinary HTTPS.</p>
          </div>
        </div>

        <div class="stitch-flex" style="gap: 12px; align-items: flex-start;">
          <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 18px; margin-top: 1px; font-variation-settings: 'FILL' 1;">fact_check</span>
          <div>
            <h4 style="font-size: 11.5px; font-weight: 800; margin: 0; color: var(--color-on-surface);">5. Mapitio & Ukaguzi (Review & Submit)</h4>
            <p class="stitch-body-xs" style="font-size: 10px; margin-top: 1px; color: var(--color-outline); line-height: 1.35;">Pitia kwa kina maelezo yote kabla ya kuwasilisha maombi kwenye foleni ya ukaguzi ya wasimamizi (Admin Review Queue).</p>
          </div>
        </div>

      </div>
    </div>

    <button id="step-welcome-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 44px; font-weight: 800; font-size: 12.5px; border-radius: var(--radius-full); box-shadow: var(--shadow-md);">
      <span>Anza Usajili wa Duka</span>
      <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 6px;">arrow_forward</span>
    </button>
  `;
}

/**
 * Step 1: Business Profile View
 */
function renderStepProfile(): string {
  // Description instructions dynamically change based on selection
  let descInstructions = 'Describe both your products and services.';
  let descPlaceholder = 'e.g. Tunauza simu za Samsung na kutoa huduma ya matengenezo...';
  if (formData.businessType === 'Product Seller') {
    descInstructions = 'Describe the products you sell.';
    descPlaceholder = 'e.g. Duka letu linajihusisha na uuzaji wa simu mpya na used za Apple na Samsung, chaja orijinal na laptop za HP...';
  } else if (formData.businessType === 'Service Provider') {
    descInstructions = 'Describe the services you provide.';
    descPlaceholder = 'e.g. Sisi ni wataalamu wa kutengeneza na kufanya marekebisho ya AC za majumbani na maofisini, na kufanya wiring...';
  }

  // Define dynamic categories dropdown depending on the type (hide product categories for service providers!)
  let categoryOptions = '';
  if (formData.businessType === 'Product Seller') {
    categoryOptions = `
      <option value="electronics" ${formData.primaryCategory === 'electronics' ? 'selected' : ''}>Simu & Kielektroniki (Electronics)</option>
      <option value="fashion" ${formData.primaryCategory === 'fashion' ? 'selected' : ''}>Nguo & Mavazi (Clothing & Fashion)</option>
      <option value="spares" ${formData.primaryCategory === 'spares' ? 'selected' : ''}>Vipuri vya Magari (Auto Spare Parts)</option>
      <option value="home" ${formData.primaryCategory === 'home' ? 'selected' : ''}>Vifaa vya Nyumbani (Home & Kitchen)</option>
      <option value="cosmetics" ${formData.primaryCategory === 'cosmetics' ? 'selected' : ''}>Vipodozi na Urembo (Cosmetics & Beauty)</option>
    `;
  } else if (formData.businessType === 'Service Provider') {
    categoryOptions = `
      <option value="repairs" ${formData.primaryCategory === 'repairs' ? 'selected' : ''}>Matengenezo ya AC & Ufundi (Technical Repairs)</option>
      <option value="salon" ${formData.primaryCategory === 'salon' ? 'selected' : ''}>Saluni na Urembo (Salon & Spa)</option>
      <option value="delivery" ${formData.primaryCategory === 'delivery' ? 'selected' : ''}>Usafirishaji (Delivery & Logistics)</option>
      <option value="cleaning" ${formData.primaryCategory === 'cleaning' ? 'selected' : ''}>Usafi wa Nyumba/Ofisi (Cleaning Services)</option>
      <option value="consulting" ${formData.primaryCategory === 'consulting' ? 'selected' : ''}>Ushauri & Taaluma (Professional Services)</option>
    `;
  } else {
    // Both
    categoryOptions = `
      <option value="electronics_services" ${formData.primaryCategory === 'electronics_services' ? 'selected' : ''}>Kielektroniki & Matengenezo (Electronics & Repairs)</option>
      <option value="fashion_tailoring" ${formData.primaryCategory === 'fashion_tailoring' ? 'selected' : ''}>Nguo & Ushonaji (Fashion & Tailoring)</option>
      <option value="spares_mechanic" ${formData.primaryCategory === 'spares_mechanic' ? 'selected' : ''}>Vipuri & Ufundi Magari (Spares & Mechanics)</option>
      <option value="general_mixed" ${formData.primaryCategory === 'general_mixed' ? 'selected' : ''}>Bidhaa na Huduma Mchanganyiko (General mixed)</option>
    `;
  }

  return `
    <div class="animate-fade-in" style="margin-bottom: var(--spacing-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; margin: 0; color: var(--color-primary);">1. Wasifu wa Biashara</h2>
      <p style="font-size: 11px; color: var(--color-outline); margin-top: 2px; line-height: 1.4;">Weka jina rasmi, aina ya biashara yako, na maelezo mafupi yatakayowavutia wateja.</p>
    </div>

    <div class="stitch-card glass-card animate-fade-in" style="gap: var(--spacing-md); margin-top: var(--spacing-sm);">
      
      <!-- Business Name -->
      <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
        <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="biz-name">Jina la Biashara / Business Name <span style="color: var(--color-error);">*</span></label>
        <input id="biz-name" class="stitch-input-raw" type="text" value="${formData.businessName}" placeholder="e.g. Kariakoo Electronics Hub" style="font-size: 12px; height: 38px;"/>
      </div>

      <!-- Business Type Card Selectors -->
      <div class="stitch-flex stitch-flex-col" style="gap: 6px;">
        <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;">Aina ya Biashara / Business Type <span style="color: var(--color-error);">*</span></label>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          
          <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1.5px solid ${formData.businessType === 'Product Seller' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; border-radius: var(--radius-md); background: ${formData.businessType === 'Product Seller' ? 'rgba(79, 70, 229, 0.03)' : 'white'}; cursor: pointer; transition: all 0.2s;" class="active-scale">
            <input type="radio" name="biz-type-radio" value="Product Seller" ${formData.businessType === 'Product Seller' ? 'checked' : ''} style="accent-color: var(--color-primary);" onchange="window.selectBusinessType('Product Seller')"/>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 12px; font-weight: 800; color: var(--color-on-surface);">Muuzaji wa Bidhaa pekee (Product Seller)</span>
              <span style="font-size: 9.5px; color: var(--color-outline);">e.g. Uuzaji wa Simu, Viatu, Vipuri, Laptops n.k.</span>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1.5px solid ${formData.businessType === 'Service Provider' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; border-radius: var(--radius-md); background: ${formData.businessType === 'Service Provider' ? 'rgba(79, 70, 229, 0.03)' : 'white'}; cursor: pointer; transition: all 0.2s;" class="active-scale">
            <input type="radio" name="biz-type-radio" value="Service Provider" ${formData.businessType === 'Service Provider' ? 'checked' : ''} style="accent-color: var(--color-primary);" onchange="window.selectBusinessType('Service Provider')"/>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 12px; font-weight: 800; color: var(--color-on-surface);">Mtoa Huduma pekee (Service Provider)</span>
              <span style="font-size: 9.5px; color: var(--color-outline);">e.g. Mafundi AC, Saluni, Walimu wa Nyumbani n.k.</span>
            </div>
          </label>

          <label style="display: flex; align-items: center; gap: 10px; padding: 10px; border: 1.5px solid ${formData.businessType === 'Products and Services' ? 'var(--color-primary)' : 'rgba(226, 232, 240, 0.8)'}; border-radius: var(--radius-md); background: ${formData.businessType === 'Products and Services' ? 'rgba(79, 70, 229, 0.03)' : 'white'}; cursor: pointer; transition: all 0.2s;" class="active-scale">
            <input type="radio" name="biz-type-radio" value="Products and Services" ${formData.businessType === 'Products and Services' ? 'checked' : ''} style="accent-color: var(--color-primary);" onchange="window.selectBusinessType('Products and Services')"/>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 12px; font-weight: 800; color: var(--color-on-surface);">Zote mbili: Bidhaa & Huduma (Products & Services)</span>
              <span style="font-size: 9.5px; color: var(--color-outline);">e.g. Uuzaji wa Simu pamoja na Matengenezo yake</span>
            </div>
          </label>

        </div>
      </div>

      <!-- Business Category -->
      <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
        <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="biz-cat">Kategoria Kuu / Main Category <span style="color: var(--color-error);">*</span></label>
        <select id="biz-cat" class="stitch-input-raw" style="font-size: 12px; height: 38px; padding-left: 8px;">
          ${categoryOptions}
        </select>
      </div>

      <!-- Dynamic Description -->
      <div class="stitch-flex stitch-flex-col" style="gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 11px;" for="biz-desc">Maelezo ya Biashara (Description) <span style="color: var(--color-error);">*</span></label>
          <span style="font-size: 9px; color: var(--color-primary); font-weight: bold; text-transform: uppercase;">${descInstructions}</span>
        </div>
        <textarea id="biz-desc" class="stitch-input-raw" style="height: 90px; padding: 8px; font-size: 11.5px; line-height: 1.4; resize: none;" placeholder="${descPlaceholder}">${formData.description}</textarea>
      </div>

    </div>

    <div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
      <button id="step-prev" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">Rudi nyuma</button>
      <button id="step-next-1" class="stitch-btn stitch-btn-primary active-scale" style="flex: 2; border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">
        <span>Endelea mbele</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 6px;">arrow_forward</span>
      </button>
    </div>
  `;
}

/**
 * Step 2: Business Location View (GPS Capture only, no map dragging!)
 */
function renderStepLocation(): string {
  const hasGps = formData.latitude !== null && formData.longitude !== null;
  const isLocked = dbProvider && dbProvider.locationLocked === true && !editMode;

  let gpsBadgeMarkup = `
    <div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: var(--radius-sm); background: rgba(239, 68, 68, 0.08); color: var(--color-error); font-size: 9px; font-weight: bold; text-transform: uppercase; border: 1px solid rgba(239, 68, 68, 0.15);">
      <span class="material-symbols-outlined" style="font-size: 12px;">location_off</span>
      <span>${gpsStatusText}</span>
    </div>
  `;

  if (hasGps) {
    gpsBadgeMarkup = `
      <div style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: var(--radius-sm); background: rgba(16, 185, 129, 0.08); color: var(--color-secondary); font-size: 9px; font-weight: bold; text-transform: uppercase; border: 1px solid rgba(16, 185, 129, 0.15);">
        <span class="material-symbols-outlined" style="font-size: 12px;">gps_fixed</span>
        <span>CAPTURED (LIVE GPS)</span>
      </div>
    `;
  }

  return `
    <div class="animate-fade-in" style="margin-bottom: var(--spacing-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; margin: 0; color: var(--color-primary);">2. Nasa Eneo la Biashara (GPS)</h2>
      <p style="font-size: 11px; color: var(--color-outline); margin-top: 2px; line-height: 1.4;">Mfumo unahitaji GPS halisi ya browser yako ili kuwaongoza wateja kwa usahihi wa Uber/Google Maps.</p>
    </div>

    <!-- Location Locking Alert -->
    ${isLocked ? `
      <div class="stitch-card animate-fade-in" style="border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.02); padding: 10px; border-radius: var(--radius-md); flex-direction: row; gap: 8px; align-items: center; margin-bottom: 12px;">
        <span class="material-symbols-outlined" style="color: var(--color-error); font-size: 20px;">lock</span>
        <span style="font-size: 10.5px; color: var(--color-error); font-weight: bold; line-height: 1.35;">Eneo lako limeshafungwa na Msimamizi (Locked by Admin). Recapture haijaruhusiwa isipokuwa uombe msaada.</span>
      </div>
    ` : ''}

    <div class="stitch-card glass-card animate-fade-in" style="padding: var(--spacing-sm); gap: 12px;">
      
      <div style="background: rgba(79, 70, 229, 0.03); border: 1.5px dashed rgba(79, 70, 229, 0.2); padding: 12px; border-radius: var(--radius-md); text-align: center; display: flex; flex-direction: column; gap: 6px; align-items: center;">
        <span class="material-symbols-outlined animate-bounce" style="color: var(--color-primary); font-size: 26px;">person_pin_circle</span>
        <h4 style="font-size: 12px; font-weight: 800; margin: 0; color: var(--color-on-surface);">Maagizo ya GPS ya Kibiashara</h4>
        <p style="font-size: 10px; color: var(--color-outline); max-width: 260px; line-height: 1.45; margin: 0;">
          <strong>Tafadhali simama mlangoni pa duka au ofisi yako halisi Kariakoo kabla ya kubonyeza kitufe hapa chini.</strong> Hii inahakikisha wateja hawapotei wanapokufuata.
        </p>
      </div>

      <!-- Capture Button -->
      ${isLocked ? `
        <button class="stitch-btn stitch-btn-secondary" style="width: 100%; height: 42px; font-weight: 800; border-radius: var(--radius-md); opacity: 0.6; cursor: not-allowed;" disabled>
          <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">lock</span>
          <span>Eneo Limefungwa (Locked)</span>
        </button>
      ` : `
        <button id="gps-capture-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 42px; font-weight: 800; border-radius: var(--radius-md); border: none; background: linear-gradient(135deg, var(--color-primary) 0%, #6366f1 100%); display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: var(--shadow-sm);" onclick="window.captureLiveLocation()">
          <span class="material-symbols-outlined ${isCapturingGps ? 'animate-spin' : ''}" style="font-size: 18px;">my_location</span>
          <span>${isCapturingGps ? 'Nasa Eneo... (Accessing GPS)' : 'Nasa Eneo Langu (Capture Location)'}</span>
        </button>
      `}

      <!-- Status Dashboard Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 8.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">GPS Status</span>
          ${gpsBadgeMarkup}
        </div>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 8.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Muda / Timestamp</span>
          <span style="font-size: 9.5px; font-weight: 800; color: var(--color-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${formData.gpsTimestamp ? new Date(formData.gpsTimestamp).toLocaleTimeString() : 'Bado haijanaswa'}
          </span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 8px;">
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 8.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Vipimo / Coordinates</span>
          <span style="font-size: 10px; font-family: monospace; font-weight: bold; color: var(--color-primary);">
            ${hasGps ? `${formData.latitude!.toFixed(6)}, ${formData.longitude!.toFixed(6)}` : '0.000000, 0.000000'}
          </span>
        </div>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px;">
          <span style="font-size: 8.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Usahihi / Accuracy</span>
          <span style="font-size: 10px; font-weight: 800; color: ${formData.gpsAccuracy !== null && formData.gpsAccuracy < 10 ? 'var(--color-secondary)' : 'var(--color-on-surface)'};">
            ${formData.gpsAccuracy !== null ? `+/- ${formData.gpsAccuracy.toFixed(1)}m` : 'Bado'}
          </span>
        </div>
      </div>

      <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 2px;">
        <span style="font-size: 8.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Anuani ya Geocode / Geocoded Address</span>
        <span style="font-size: 10px; font-weight: 800; color: var(--color-on-surface); line-height: 1.3;">
          ${formData.reverseGeocodedAddress || 'Nasa eneo ili kupata anwani ya ramani kutoka Mapbox.'}
        </span>
      </div>

      <!-- Read-Only Map for visual confirmation -->
      <div style="position: relative; height: 140px; background-color: rgba(226, 232, 240, 0.5); border-radius: var(--radius-md); overflow: hidden; border: 1.5px solid rgba(226, 232, 240, 0.8);">
        <div id="confirm-map" style="width: 100%; height: 100%;"></div>
        ${!hasGps ? `
          <div style="position: absolute; inset: 0; background: rgba(15, 23, 42, 0.03); backdrop-filter: blur(1.5px); display: flex; align-items: center; justify-content: center; color: var(--color-outline); font-size: 10px; font-weight: bold;">
            [ Ramani ya Uhakiki itapakia hapa baada ya kunasa GPS ]
          </div>
        ` : ''}
      </div>

    </div>

    <div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
      <button id="step-prev" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">Rudi nyuma</button>
      <button id="step-next-2" class="stitch-btn stitch-btn-primary active-scale" style="flex: 2; border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">
        <span>Endelea mbele</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 6px;">arrow_forward</span>
      </button>
    </div>
  `;
}

/**
 * Step 3: Business Address Details View
 */
function renderStepAddress(): string {
  return `
    <div class="animate-fade-in" style="margin-bottom: var(--spacing-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; margin: 0; color: var(--color-primary);">3. Maelezo ya Anuani na Mtaa</h2>
      <p style="font-size: 11px; color: var(--color-outline); margin-top: 2px; line-height: 1.4;">Jaza maelezo ya kina ya anwani yako. Mfumo umejaza kiotomatiki baadhi ya nyuga kutokana na geocoding ya Mapbox.</p>
    </div>

    <div class="stitch-card glass-card animate-fade-in" style="gap: 10px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
      
      <div class="stitch-grid-2" style="gap: 8px;">
        <!-- Region -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Mkoa / Region <span style="color: var(--color-error);">*</span></label>
          <input id="biz-region" class="stitch-input-raw" type="text" value="${formData.region}" placeholder="e.g. Dar es Salaam" style="font-size: 11.5px; height: 36px;"/>
        </div>
        <!-- District -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Wilaya / District <span style="color: var(--color-error);">*</span></label>
          <input id="biz-district" class="stitch-input-raw" type="text" value="${formData.district}" placeholder="e.g. Ilala" style="font-size: 11.5px; height: 36px;"/>
        </div>
      </div>

      <div class="stitch-grid-2" style="gap: 8px;">
        <!-- Ward -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Kata / Ward <span style="color: var(--color-error);">*</span></label>
          <input id="biz-ward" class="stitch-input-raw" type="text" value="${formData.ward}" placeholder="e.g. Kariakoo" style="font-size: 11.5px; height: 36px;"/>
        </div>
        <!-- Street -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Mtaa / Street <span style="color: var(--color-error);">*</span></label>
          <input id="biz-street" class="stitch-input-raw" type="text" value="${formData.street}" placeholder="e.g. Congo Street" style="font-size: 11.5px; height: 36px;"/>
        </div>
      </div>

      <div class="stitch-grid-2" style="gap: 8px;">
        <!-- Building Name -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Jina la Jengo (Building) <span style="color: var(--color-outline); font-weight: normal;">(Optional)</span></label>
          <input id="biz-building" class="stitch-input-raw" type="text" value="${formData.buildingName}" placeholder="e.g. Machinga Complex" style="font-size: 11.5px; height: 36px;"/>
        </div>
        <!-- Landmark -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Alama ya Karibu (Landmark) <span style="color: var(--color-error);">*</span></label>
          <input id="biz-landmark" class="stitch-input-raw" type="text" value="${formData.landmark}" placeholder="e.g. Mkabili na msikiti wa Manyema" style="font-size: 11.5px; height: 36px;"/>
        </div>
      </div>

      <div class="stitch-grid-2" style="gap: 8px;">
        <!-- Floor -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Ghorofa / Floor <span style="color: var(--color-outline); font-weight: normal;">(Optional)</span></label>
          <input id="biz-floor" class="stitch-input-raw" type="text" value="${formData.floor}" placeholder="e.g. Ground Floor / Floor 1" style="font-size: 11.5px; height: 36px;"/>
        </div>
        <!-- Shop Number -->
        <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
          <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;">Namba ya Fremu (Shop #) <span style="color: var(--color-outline); font-weight: normal;">(Optional)</span></label>
          <input id="biz-shopnum" class="stitch-input-raw" type="text" value="${formData.shopNumber}" placeholder="e.g. Shop No. 4B" style="font-size: 11.5px; height: 36px;"/>
        </div>
      </div>

      <!-- Additional Directions -->
      <div class="stitch-flex stitch-flex-col" style="gap: 2px;">
        <label class="stitch-form-label" style="font-weight: 800; font-size: 10px;" for="biz-directions">Maelekezo Zaidi ya Njia (Directions) <span style="color: var(--color-error);">*</span></label>
        <textarea id="biz-directions" class="stitch-input-raw" style="height: 60px; padding: 6px; font-size: 11px; line-height: 1.4; resize: none;" placeholder="e.g. Ukifika makutano ya barabara ya Congo na Msimbazi, geuka kulia kwenye fremu ya pili...">${formData.additionalDirections}</textarea>
      </div>

    </div>

    <div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
      <button id="step-prev" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">Rudi nyuma</button>
      <button id="step-next-3" class="stitch-btn stitch-btn-primary active-scale" style="flex: 2; border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">
        <span>Endelea mbele</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 6px;">arrow_forward</span>
      </button>
    </div>
  `;
}

/**
 * Step 4: Verification Documents View
 */
function renderStepDocuments(): string {
  return `
    <div class="animate-fade-in" style="margin-bottom: var(--spacing-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; margin: 0; color: var(--color-primary);">4. Pakia Nyaraka za Uhakiki</h2>
      <p style="font-size: 11px; color: var(--color-outline); margin-top: 2px; line-height: 1.4;">Pakia nyaraka rasmi na picha halisi za duka ili kujenga imani kwa wateja na kupata verified badge.</p>
    </div>

    <div class="stitch-card glass-card animate-fade-in" style="gap: 12px; max-height: 385px; overflow-y: auto; padding-right: 4px;">
      
      <!-- BRELA Certificate -->
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-md); background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface);">Cheti cha BRELA (BRELA Certificate) <span style="color: var(--color-error);">*</span></span>
          ${formData.brelaUrl ? '<span style="font-size: 9px; color: var(--color-secondary); font-weight: bold; display: flex; align-items: center; gap: 2px;"><span class="material-symbols-outlined" style="font-size: 12px;">check_circle</span>Uploaded</span>' : ''}
        </div>
        <input type="file" id="file-brela" accept="image/*,application/pdf" style="font-size: 10.5px; width: 100%; border: none; background: rgba(226, 232, 240, 0.4); padding: 4px; border-radius: var(--radius-xs);" onchange="window.cacheSelectedFile('brela', this)"/>
        <p style="font-size: 8.5px; color: var(--color-outline); margin: 0;">Pakia cheti cha usajili wa jina la biashara au kampuni (PDF/Image).</p>
      </div>

      <!-- TIN Certificate -->
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-md); background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface);">Cheti cha TIN ya TRA (TIN Certificate) <span style="color: var(--color-error);">*</span></span>
          ${formData.tinUrl ? '<span style="font-size: 9px; color: var(--color-secondary); font-weight: bold; display: flex; align-items: center; gap: 2px;"><span class="material-symbols-outlined" style="font-size: 12px;">check_circle</span>Uploaded</span>' : ''}
        </div>
        <input type="file" id="file-tin" accept="image/*,application/pdf" style="font-size: 10.5px; width: 100%; border: none; background: rgba(226, 232, 240, 0.4); padding: 4px; border-radius: var(--radius-xs);" onchange="window.cacheSelectedFile('tin', this)"/>
        <p style="font-size: 8.5px; color: var(--color-outline); margin: 0;">Pakia cheti chako cha namba ya walipakodi TRA (PDF/Image).</p>
      </div>

      <!-- Business License -->
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-md); background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface);">Leseni ya Biashara (Business License) <span style="color: var(--color-outline); font-weight: normal;">(If applicable)</span></span>
          ${formData.licenseUrl ? '<span style="font-size: 9px; color: var(--color-secondary); font-weight: bold; display: flex; align-items: center; gap: 2px;"><span class="material-symbols-outlined" style="font-size: 12px;">check_circle</span>Uploaded</span>' : ''}
        </div>
        <input type="file" id="file-license" accept="image/*,application/pdf" style="font-size: 10.5px; width: 100%; border: none; background: rgba(226, 232, 240, 0.4); padding: 4px; border-radius: var(--radius-xs);" onchange="window.cacheSelectedFile('license', this)"/>
        <p style="font-size: 8.5px; color: var(--color-outline); margin: 0;">Leseni halisi ya biashara iliyotolewa na Halmashauri (Optional).</p>
      </div>

      <!-- Office Photos -->
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-md); background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface);">Picha za Ndani ya Ofisi / Duka (Office Photos) <span style="color: var(--color-outline); font-weight: normal;">(Optional)</span></span>
          ${formData.officePhotos ? '<span style="font-size: 9px; color: var(--color-secondary); font-weight: bold; display: flex; align-items: center; gap: 2px;"><span class="material-symbols-outlined" style="font-size: 12px;">check_circle</span>Uploaded</span>' : ''}
        </div>
        <input type="file" id="file-office" accept="image/*" style="font-size: 10.5px; width: 100%; border: none; background: rgba(226, 232, 240, 0.4); padding: 4px; border-radius: var(--radius-xs);" onchange="window.cacheSelectedFile('office', this)"/>
        <p style="font-size: 8.5px; color: var(--color-outline); margin: 0;">Picha inayoonyesha ndani ya duka au ofisi yako ikiwa na bidhaa au meza.</p>
      </div>

      <!-- Store Front Photo -->
      <div style="display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-md); background: white;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface);">Picha ya Nje / Store Front Photo <span style="color: var(--color-error);">*</span></span>
          ${formData.storeFrontPhoto ? '<span style="font-size: 9px; color: var(--color-secondary); font-weight: bold; display: flex; align-items: center; gap: 2px;"><span class="material-symbols-outlined" style="font-size: 12px;">check_circle</span>Uploaded</span>' : ''}
        </div>
        <input type="file" id="file-storefront" accept="image/*" style="font-size: 10.5px; width: 100%; border: none; background: rgba(226, 232, 240, 0.4); padding: 4px; border-radius: var(--radius-xs);" onchange="window.cacheSelectedFile('storefront', this)"/>
        <p style="font-size: 8.5px; color: var(--color-outline); margin: 0;">Picha ya nje inayoonyesha bango na mlango wa duka lako ili wateja wakutambue.</p>
      </div>

    </div>

    <div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
      <button id="step-prev" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">Rudi nyuma</button>
      <button id="step-next-4" class="stitch-btn stitch-btn-primary active-scale" style="flex: 2; border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">
        <span>Safirisha & Endelea</span>
        <span class="material-symbols-outlined" style="font-size: 16px; margin-left: 6px;">cloud_upload</span>
      </button>
    </div>
  `;
}

/**
 * Step 5: Review & Confirmation View
 */
function renderStepReview(): string {
  const isProduct = formData.businessType !== 'Service Provider';
  const isService = formData.businessType !== 'Product Seller';

  return `
    <div class="animate-fade-in" style="margin-bottom: var(--spacing-sm);">
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; margin: 0; color: var(--color-primary);">5. Mapilio & Uhakiki wa Mwisho</h2>
      <p style="font-size: 11px; color: var(--color-outline); margin-top: 2px; line-height: 1.4;">Tafadhali pitia kwa ufasaha taarifa zako zote kabla ya kuziwasilisha. Hakuna gharama za bei zinazokusanywa hapa.</p>
    </div>

    <div class="stitch-card glass-card animate-fade-in" style="gap: 12px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
      
      <!-- Profile Section -->
      <div>
        <h4 style="font-size: 10.5px; font-weight: 900; color: var(--color-primary); text-transform: uppercase; margin: 0 0 6px 0; font-family: 'Space Grotesk', sans-serif;">A. Wasifu wa Biashara</h4>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
          <div><strong>Jina la Duka:</strong> ${formData.businessName}</div>
          <div><strong>Aina ya Biashara:</strong> ${formData.businessType}</div>
          <div><strong>Kategoria Kuu:</strong> ${formData.primaryCategory}</div>
          <div style="line-height: 1.35; margin-top: 2px;"><strong>Maelezo ya ${isProduct ? 'Bidhaa' : ''}${isProduct && isService ? ' na ' : ''}${isService ? 'Huduma' : ''}:</strong> ${formData.description}</div>
        </div>
      </div>

      <!-- Location Section -->
      <div>
        <h4 style="font-size: 10.5px; font-weight: 900; color: var(--color-primary); text-transform: uppercase; margin: 0 0 6px 0; font-family: 'Space Grotesk', sans-serif;">B. Eneo la Ki-GPS (LOCKED)</h4>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
          <div><strong>Vipimo (Lat, Lon):</strong> ${formData.latitude!.toFixed(6)}, ${formData.longitude!.toFixed(6)}</div>
          <div><strong>Usahihi wa Kupima:</strong> +/- ${formData.gpsAccuracy!.toFixed(1)}m</div>
          <div><strong>Muda wa Kunasa:</strong> ${new Date(formData.gpsTimestamp!).toLocaleString()}</div>
          <div style="line-height: 1.35;"><strong>Anwani ya Geocode:</strong> ${formData.reverseGeocodedAddress}</div>
        </div>
      </div>

      <!-- Address Section -->
      <div>
        <h4 style="font-size: 10.5px; font-weight: 900; color: var(--color-primary); text-transform: uppercase; margin: 0 0 6px 0; font-family: 'Space Grotesk', sans-serif;">C. Anuani ya Duka</h4>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
          <div><strong>Mtaa / Kata:</strong> Mtaa wa ${formData.street}, Kata ya ${formData.ward}</div>
          <div><strong>Wilaya / Mkoa:</strong> Wilaya ya ${formData.district}, ${formData.region}</div>
          <div><strong>Jengo & Namba ya fremu:</strong> Jengo la ${formData.buildingName || 'N/A'}, Fremu No. ${formData.shopNumber || 'N/A'} (Floor: ${formData.floor || 'N/A'})</div>
          <div><strong>Alama ya Karibu (Landmark):</strong> ${formData.landmark}</div>
          <div style="line-height: 1.35; margin-top: 2px;"><strong>Maelekezo ya Ziada:</strong> ${formData.additionalDirections}</div>
        </div>
      </div>

      <!-- Documents Section -->
      <div>
        <h4 style="font-size: 10.5px; font-weight: 900; color: var(--color-primary); text-transform: uppercase; margin: 0 0 6px 0; font-family: 'Space Grotesk', sans-serif;">D. Nyaraka zilizopakiwa</h4>
        <div style="background: rgba(226, 232, 240, 0.4); padding: 8px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 6px; font-size: 10.5px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span>Cheti cha BRELA:</span>
            <a href="${formData.brelaUrl}" target="_blank" style="color: var(--color-primary); font-weight: bold; text-decoration: underline;">View BRELA</a>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span>Cheti cha TIN:</span>
            <a href="${formData.tinUrl}" target="_blank" style="color: var(--color-primary); font-weight: bold; text-decoration: underline;">View TIN</a>
          </div>
          ${formData.licenseUrl ? `
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span>Leseni ya Biashara:</span>
              <a href="${formData.licenseUrl}" target="_blank" style="color: var(--color-primary); font-weight: bold; text-decoration: underline;">View License</a>
            </div>
          ` : ''}
          ${formData.officePhotos ? `
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span>Picha ya Ndani:</span>
              <a href="${formData.officePhotos}" target="_blank" style="color: var(--color-primary); font-weight: bold; text-decoration: underline;">View Office Photo</a>
            </div>
          ` : ''}
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span>Picha ya Nje ya Duka:</span>
            <a href="${formData.storeFrontPhoto}" target="_blank" style="color: var(--color-primary); font-weight: bold; text-decoration: underline;">View Store Front</a>
          </div>
        </div>
      </div>

      <!-- Confirmation statement -->
      <div style="margin-top: 4px; padding: 4px 0;">
        <label style="display: flex; align-items: flex-start; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="confirm-chk" style="margin-top: 2px; accent-color: var(--color-primary);"/>
          <span style="font-size: 10px; color: var(--color-on-surface); line-height: 1.4; font-weight: 800;">
            Nathibitisha kuwa nimesimama katika eneo halisi la biashara yangu, na taarifa zote pamoja na nyaraka nilizowasilisha ni za kweli na sahihi. Ninaelewa kuwa kutoa taarifa za uongo kunaweza kusababisha akaunti yangu kusimamishwa.
          </span>
        </label>
      </div>

    </div>

    <div style="margin-top: var(--spacing-md); display: flex; gap: var(--spacing-sm);">
      <button id="step-prev" class="stitch-btn stitch-btn-flat active-scale" style="flex: 1; border: 1.5px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800;">Rudi nyuma</button>
      <button id="step-submit" class="stitch-btn stitch-btn-primary active-scale" style="flex: 2; border-radius: var(--radius-full); height: 42px; font-size: 12px; font-weight: 800; background: linear-gradient(135deg, var(--color-secondary) 0%, #10b981 100%); border: none; box-shadow: var(--shadow-md);">
        <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 4px; font-variation-settings: 'FILL' 1;">verified</span>
        <span>Wasilisha Maombi yangu</span>
      </button>
    </div>
  `;
}

/**
 * Step 6: Success Page View
 */
function renderStepSuccess(): string {
  return `
    <div class="stitch-flex stitch-flex-col stitch-align-center stitch-justify-center animate-fade-in" style="padding: var(--spacing-xl) 0; text-align: center; gap: 14px; font-family: var(--font-sans);">
      <div class="stitch-flex stitch-justify-center stitch-align-center animate-pulse" style="width: 72px; height: 72px; border-radius: var(--radius-full); background: rgba(16, 185, 129, 0.08); color: var(--color-secondary); border: 1.5px solid rgba(16, 185, 129, 0.25);">
        <span class="material-symbols-outlined animate-bounce" style="font-size: 38px; font-variation-settings: 'FILL' 1;">check_circle</span>
      </div>
      
      <h2 style="font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 900; color: var(--color-secondary); margin: 0;">Maombi Yamepokelewa Kikamilifu!</h2>
      
      <div class="stitch-card-sm glass-card" style="border: 1.5px solid rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.02); padding: 16px; border-radius: var(--radius-lg); max-width: 310px; text-align: left; gap: 4px;">
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 12px; font-weight: 800; color: var(--color-on-surface); text-transform: uppercase;">Registration Submitted Successfully</h3>
        <p style="font-size: 11px; color: var(--color-outline); margin: 0; line-height: 1.4;">
          Wasifu wako wa biashara na nyaraka rasmi vimesajiliwa salama kwenye database ya CHIMBO Intel Network. Maombi yako yataingia kwenye foleni ya ukaguzi ya wasimamizi (Admin Review Queue).
        </p>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 280px; margin-top: 10px;">
        <button id="success-track-btn" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 42px; border-radius: var(--radius-full); font-weight: 800; font-size: 12px;">
          <span class="material-symbols-outlined" style="font-size: 16px; margin-right: 6px;">analytics</span>
          <span>Fuatilia Hali ya Ombi (Track Status)</span>
        </button>
        <button id="success-profile-btn" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 40px; border-radius: var(--radius-full); border: 1.5px solid rgba(226, 232, 240, 0.8); font-weight: 800; font-size: 11.5px;">
          <span>Rudi Kwenye Wasifu Wangu</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Step 7: Dedicated Status Tracker Page View
 * Renders a premium, glassmorphic timeline of the application stages
 */
function renderStatusTracker(provider: any): string {
  const currentStatus = provider.status || 'pending';
  const adminNotes = provider.adminNotes || '';

  // Determine stage index
  // 1: Pending Review
  // 2: Documents Under Review
  // 3: Field Verification
  // 4: Approved / Active
  let activeStage = 1;
  let statusColor = 'var(--color-primary)';
  let statusTextEn = 'Pending Review';
  let statusTextSw = 'Inasubiri Ukaguzi wa Awali';
  let statusDescEn = 'We have received your application. Our team is performing an initial review.';
  let statusDescSw = 'Tumepokea maombi yako ya usajili wa biashara. Timu yetu inafanya ukaguzi wa awali wa maelezo yako.';
  let nextStepEn = 'Verification of uploaded documents (BRELA, TIN, and Photos).';
  let nextStepSw = 'Kukaguliwa kwa nyaraka zilizowasilishwa (BRELA, TIN na Picha).';
  let waitingTimeEn = '24 Hours';
  let waitingTimeSw = 'Masaa 24';

  if (currentStatus === 'documents_under_review' || provider.reviewStage === 'documents_under_review') {
    activeStage = 2;
    statusColor = 'var(--color-primary)';
    statusTextEn = 'Documents Under Review';
    statusTextSw = 'Nyaraka Zinakaguliwa';
    statusDescEn = 'Our team is verifying the authenticity and accuracy of your business certificates and photos.';
    statusDescSw = 'Timu yetu ya wataalamu inahakiki ukweli na usahihi wa nyaraka zako za kibiashara na picha za ofisi uliyotuma.';
    nextStepEn = 'Document approval and field assignment scheduling.';
    nextStepSw = 'Uidhinishaji wa nyaraka na kupangiwa ziara ya eneo la biashara ya Kariakoo.';
    waitingTimeEn = '12–24 Hours';
    waitingTimeSw = 'Masaa 12-24';
  } else if (currentStatus === 'field_verification' || provider.reviewStage === 'field_verification') {
    activeStage = 3;
    statusColor = '#f59e0b'; // amber
    statusTextEn = 'Field Verification';
    statusTextSw = 'Uhakiki wa Nyanjani';
    statusDescEn = 'A CHIMBO field officer is scheduled to visit your shop or office in Kariakoo to verify physical existence.';
    statusDescSw = 'Afisa wa nyanjani wa CHIMBO amepangiwa kutembelea duka au ofisi yako Kariakoo kuona uhakiki wa macho.';
    nextStepEn = 'Field officer physical visit and final sign-off.';
    nextStepSw = 'Ziara ya afisa na kupitishwa kwa ukaguzi wa mwisho.';
    waitingTimeEn = '1–2 Days';
    waitingTimeSw = 'Siku 1-2';
  } else if (currentStatus === 'approved') {
    activeStage = 4;
    statusColor = 'var(--color-secondary)'; // emerald
    statusTextEn = 'Approved & Active';
    statusTextSw = 'Imethibitishwa na Ipo Hai';
    statusDescEn = 'Congratulations. Your Provider Portal is now active.';
    statusDescSw = 'Hongera sana! Wasifu wako wa biashara umeidhinishwa kikamilifu na sasa upo hai kwenye mfumo wa CHIMBO.';
    nextStepEn = 'Start listing your products or services!';
    nextStepSw = 'Weka bidhaa au huduma zako wateja waanze kukupigia na kukufuata!';
    waitingTimeEn = 'Completed';
    waitingTimeSw = 'Kazi Imekamilika';
  } else if (currentStatus === 'rejected') {
    activeStage = 0;
    statusColor = 'var(--color-error)';
    statusTextEn = 'Rejected / Profile Incomplete';
    statusTextSw = 'Yamekataliwa / Marekebisho Yanahitajika';
    statusDescEn = `Your application was not approved. Reason: ${adminNotes || 'Nyaraka au maelezo hayajakamilika.'}`;
    statusDescSw = `Maombi yako hayakuidhinishwa kwa sababu ifuatayo: "${adminNotes || 'Nyaraka au maelezo hayajakamilika.'}"`;
    nextStepEn = 'Please click Edit Information below to correct highlighted errors and resubmit.';
    nextStepSw = 'Tafadhali bonyeza kurekebisha taarifa hapa chini ili kurekebisha na kutuma upya.';
    waitingTimeEn = 'Immediate (Self-service)';
    waitingTimeSw = 'Papo hapo (Marekebisho)';
  } else if (currentStatus === 'suspended') {
    activeStage = -1;
    statusColor = 'var(--color-error)';
    statusTextEn = 'Suspended';
    statusTextSw = 'Imesimamishwa (Suspended)';
    statusDescEn = 'Your provider portal has been temporarily suspended due to policy violations or unresolved disputes.';
    statusDescSw = 'Akaunti yako ya kibiashara imesimamishwa kwa muda kutokana na kukiuka vigezo na masharti au migogoro ya wateja.';
    nextStepEn = 'Please contact the CHIMBO support desk for dispute resolution.';
    nextStepSw = 'Wasiliana na dawati la huduma kwa wateja kwa utatuzi wa mgogoro wako.';
    waitingTimeEn = 'Pending dispute resolution';
    waitingTimeSw = 'Kutegemea na utatuzi wa mgogoro';
  }

  // Generate timeline nodes
  const stages = [
    { num: 1, titleSw: 'Usajili wa Awali', titleEn: 'Pending Review' },
    { num: 2, titleSw: 'Ukaguzi wa Nyaraka', titleEn: 'Documents Review' },
    { num: 3, titleSw: 'Uhakiki wa Nyanjani', titleEn: 'Field Verification' },
    { num: 4, titleSw: 'Akaunti Imekubaliwa', titleEn: 'Approved & Active' }
  ];

  const timelineHtml = stages.map(s => {
    let nodeBg = 'rgba(226, 232, 240, 0.8)';
    let nodeBorder = '2px solid rgba(226, 232, 240, 1)';
    let nodeColor = 'var(--color-outline)';
    let lineBg = 'rgba(226, 232, 240, 0.8)';
    let titleStyle = 'color: var(--color-outline); font-weight: normal;';

    if (activeStage >= s.num && activeStage > 0) {
      nodeBg = s.num === 4 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(79, 70, 229, 0.1)';
      nodeBorder = s.num === 4 ? '2.5px solid var(--color-secondary)' : '2.5px solid var(--color-primary)';
      nodeColor = s.num === 4 ? 'var(--color-secondary)' : 'var(--color-primary)';
      titleStyle = `color: ${s.num === 4 ? 'var(--color-secondary)' : 'var(--color-on-surface)'}; font-weight: 800;`;
    }

    if (activeStage > s.num && activeStage > 0) {
      lineBg = 'var(--color-primary)';
    }

    const isLast = s.num === 4;

    return `
      <div style="display: flex; gap: 14px; position: relative;">
        <!-- Left line & bubble -->
        <div style="display: flex; flex-direction: column; align-items: center; width: 24px; flex-shrink: 0;">
          <div style="width: 24px; height: 24px; border-radius: 50%; background: ${nodeBg}; border: ${nodeBorder}; color: ${nodeColor}; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; z-index: 2;">
            ${activeStage > s.num && s.num < 4 ? '<span class="material-symbols-outlined" style="font-size: 13px; font-weight: 900;">check</span>' : s.num}
          </div>
          ${!isLast ? `<div style="width: 3px; height: 35px; background: ${lineBg}; z-index: 1; margin-top: 2px;"></div>` : ''}
        </div>
        <!-- Right texts -->
        <div style="display: flex; flex-direction: column; padding-top: 2px;">
          <span style="font-size: 11.5px; ${titleStyle}">${s.titleSw}</span>
          <span style="font-size: 9px; color: var(--color-outline); text-transform: uppercase; font-weight: bold;">${s.titleEn}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <header class="stitch-header glass-card">
      <div class="stitch-header-content" style="justify-content: center;">
        <h1 class="stitch-title-medium" style="font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 15px; color: var(--color-primary);">Hali ya Usajili / Tracker</h1>
      </div>
    </header>

    <main class="stitch-main" style="padding-top: 68px; padding-bottom: 80px; font-family: var(--font-sans);">
      <div style="padding: var(--spacing-sm) var(--screen-padding-x); display: flex; flex-direction: column; gap: 14px;">
        
        <!-- Premium Status Card Header -->
        <div class="stitch-card glass-card animate-fade-in" style="border: 1.5px solid ${statusColor}; background: rgba(255, 255, 255, 0.75); padding: var(--spacing-sm); gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(226, 232, 240, 0.7); padding-bottom: 6px;">
            <span style="font-size: 9.5px; font-weight: 900; color: var(--color-outline); text-transform: uppercase; letter-spacing: 0.5px;">Current Registration Status</span>
            <span style="font-size: 10px; font-weight: 900; color: ${statusColor}; text-transform: uppercase; display: inline-flex; align-items: center; gap: 2px;">
              <span class="material-symbols-outlined" style="font-size: 12px;">trip_origin</span>
              ${currentStatus}
            </span>
          </div>

          <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 900; color: ${statusColor}; margin: 2px 0 0 0;">
            ${statusTextSw}
          </h3>
          <span style="font-size: 9px; color: var(--color-outline); font-weight: 800; text-transform: uppercase; margin-top: -4px;">${statusTextEn}</span>

          <p style="font-size: 11.5px; line-height: 1.45; color: var(--color-on-surface-variant); margin: 4px 0 0 0;">
            ${statusDescSw}
          </p>
          <p style="font-size: 10px; line-height: 1.4; color: var(--color-outline); font-style: italic; margin: 2px 0 0 0;">
            "${statusDescEn}"
          </p>
        </div>

        <!-- Expected Next Steps & Waiting Time widgets -->
        <div style="display: grid; grid-template-columns: 1fr; gap: 10px;" class="animate-fade-in">
          
          <div style="background: white; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-lg); padding: 10px; display: flex; gap: 10px; align-items: flex-start;">
            <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px; font-variation-settings: 'FILL' 1;">next_plan</span>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 9px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Hatua Inayofuata / Next Step</span>
              <span style="font-size: 11px; font-weight: 800; color: var(--color-on-surface); line-height: 1.4;">${nextStepSw}</span>
              <span style="font-size: 9.5px; color: var(--color-outline); line-height: 1.3;">"${nextStepEn}"</span>
            </div>
          </div>

          <div style="background: white; border: 1px solid rgba(226, 232, 240, 0.8); border-radius: var(--radius-lg); padding: 10px; display: flex; gap: 10px; align-items: flex-start;">
            <span class="material-symbols-outlined" style="color: var(--color-primary); font-size: 20px; font-variation-settings: 'FILL' 1;">hourglass_empty</span>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 9px; font-weight: 900; color: var(--color-outline); text-transform: uppercase;">Muda wa Ukaguzi / Estimated Waiting Time</span>
              <span style="font-size: 11px; font-weight: 900; color: var(--color-primary);">${waitingTimeSw} / ${waitingTimeEn}</span>
            </div>
          </div>

        </div>

        <!-- Vertical Progress Timeline -->
        <div class="stitch-card glass-card animate-fade-in" style="padding: 16px var(--spacing-md); gap: var(--spacing-md);">
          <h4 style="font-size: 10px; border-bottom: 1px solid rgba(226, 232, 240, 0.8); padding-bottom: 6px; margin: 0; text-transform: uppercase; color: var(--color-outline); font-family: 'Space Grotesk', sans-serif; font-weight: 900; letter-spacing: 0.5px;">Mchakato wa Uhakiki / Verification Steps</h4>
          
          <div style="display: flex; flex-direction: column; gap: 12px; padding-left: 8px;">
            ${timelineHtml}
          </div>
        </div>

        <!-- Bottom Actions Panel -->
        <div style="margin-top: var(--spacing-sm); display: flex; flex-direction: column; gap: 8px;" class="animate-fade-in">
          ${currentStatus === 'approved' ? `
            <button onclick="window.appState.navigateTo('provider-dashboard')" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 44px; border-radius: var(--radius-full); font-weight: 800; font-size: 12.5px; background: linear-gradient(135deg, var(--color-secondary) 0%, #10b981 100%); border: none; box-shadow: var(--shadow-md);">
              <span>Fungua Moduli ya Muuzaji (Open Portal)</span>
              <span class="material-symbols-outlined" style="font-size: 18px; margin-left: 6px;">dashboard</span>
            </button>
          ` : ''}

          ${currentStatus === 'rejected' ? `
            <button onclick="window.startOnboardingEdit()" class="stitch-btn stitch-btn-primary active-scale" style="width: 100%; height: 44px; border-radius: var(--radius-full); font-weight: 800; font-size: 12.5px; background: linear-gradient(135deg, var(--color-primary) 0%, #6366f1 100%); border: none; box-shadow: var(--shadow-md);">
              <span class="material-symbols-outlined" style="font-size: 18px; margin-right: 6px;">edit_note</span>
              <span>Rekebisha Taarifa / Edit Information</span>
            </button>
          ` : ''}

          <button onclick="window.appState.navigateTo('home')" class="stitch-btn stitch-btn-flat active-scale" style="width: 100%; height: 40px; border-radius: var(--radius-full); border: 1.5px solid rgba(226, 232, 240, 0.8); font-weight: 800; font-size: 11.5px; background: white;">
            <span>Rudi Kwenye Wasifu / Kundufu</span>
          </button>
        </div>

      </div>
    </main>
    ${renderGlobalNavbar('profile')}
  `;
}

/**
 * Event bindings for the onboarding views
 */
export function bindOnboardingEvents() {
  bindNavbarEvents();

  // 1. Welcome Step triggers
  const welcomeBtn = document.getElementById('step-welcome-btn');
  if (welcomeBtn) {
    welcomeBtn.addEventListener('click', () => {
      onboardingStep = 1;
      navigateTo('onboarding');
    });
  }

  // 2. Generic Back button in Header
  const backBtn = document.getElementById('onboard-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (onboardingStep === 0) {
        navigateTo('home');
      } else if (onboardingStep === 6) {
        onboardingStep = 0;
        isLoaded = false; // Reset to reload from DB next time
        navigateTo('onboarding');
      } else {
        onboardingStep = onboardingStep - 1;
        navigateTo('onboarding');
      }
    });
  }

  // 3. Step 1 -> Step 2
  const stepNext1 = document.getElementById('step-next-1');
  if (stepNext1) {
    stepNext1.addEventListener('click', () => {
      formData.businessName = (document.getElementById('biz-name') as HTMLInputElement).value.trim();
      formData.primaryCategory = (document.getElementById('biz-cat') as HTMLSelectElement).value;
      formData.description = (document.getElementById('biz-desc') as HTMLTextAreaElement).value.trim();

      if (!formData.businessName) {
        alert('Tafadhali jaza Jina la Biashara yako halisi!');
        return;
      }
      if (!formData.description) {
        alert('Tafadhali jaza maelezo ya kina ya biashara yako!');
        return;
      }

      onboardingStep = 2;
      navigateTo('onboarding');
    });
  }

  // 4. Step 2 -> Step 3
  const stepNext2 = document.getElementById('step-next-2');
  if (stepNext2) {
    stepNext2.addEventListener('click', () => {
      if (formData.latitude === null || formData.longitude === null) {
        alert('Tafadhali nasa eneo lako la biashara kwa kutumia GPS kwanza!');
        return;
      }
      onboardingStep = 3;
      navigateTo('onboarding');
    });
  }

  // 5. Step 3 -> Step 4
  const stepNext3 = document.getElementById('step-next-3');
  if (stepNext3) {
    stepNext3.addEventListener('click', () => {
      formData.region = (document.getElementById('biz-region') as HTMLInputElement).value.trim();
      formData.district = (document.getElementById('biz-district') as HTMLInputElement).value.trim();
      formData.ward = (document.getElementById('biz-ward') as HTMLInputElement).value.trim();
      formData.street = (document.getElementById('biz-street') as HTMLInputElement).value.trim();
      formData.buildingName = (document.getElementById('biz-building') as HTMLInputElement).value.trim();
      formData.landmark = (document.getElementById('biz-landmark') as HTMLInputElement).value.trim();
      formData.floor = (document.getElementById('biz-floor') as HTMLInputElement).value.trim();
      formData.shopNumber = (document.getElementById('biz-shopnum') as HTMLInputElement).value.trim();
      formData.additionalDirections = (document.getElementById('biz-directions') as HTMLTextAreaElement).value.trim();

      if (!formData.region || !formData.district || !formData.ward || !formData.street) {
        alert('Tafadhali jaza nyuga zote zenye nyota nyekundu (Mkoa, Wilaya, Kata, Mtaa)!');
        return;
      }
      if (!formData.landmark) {
        alert('Tafadhali jaza alama ya karibu (Landmark) ili kurahisisha kufikiwa!');
        return;
      }
      if (!formData.additionalDirections) {
        alert('Tafadhali jaza maelekezo zaidi ya njia!');
        return;
      }

      onboardingStep = 4;
      navigateTo('onboarding');
    });
  }

  // 6. Step 4 -> Step 5 (Document Uploads to Cloudinary)
  const stepNext4 = document.getElementById('step-next-4');
  if (stepNext4) {
    stepNext4.addEventListener('click', async () => {
      // Validations: TIN, BRELA, storefront photos are mandatory!
      if (!formData.brelaUrl && !selectedFiles.brela) {
        alert('Tafadhali pakia cheti cha BRELA kuendelea!');
        return;
      }
      if (!formData.tinUrl && !selectedFiles.tin) {
        alert('Tafadhali pakia cheti chako cha TIN ya TRA kuendelea!');
        return;
      }
      if (!formData.storeFrontPhoto && !selectedFiles.storefront) {
        alert('Tafadhali pakia Picha ya Nje ya duka (Storefront Photo) kuendelea!');
        return;
      }

      const overlay = document.getElementById('upload-overlay');
      const progressMsg = document.getElementById('upload-progress-msg');
      if (overlay) overlay.style.display = 'flex';

      try {
        if (selectedFiles.brela) {
          if (progressMsg) progressMsg.innerText = 'Inapandisha Cheti cha BRELA kwenye Cloudinary ya CHIMBO...';
          const res = await uploadFileToCloudinary(selectedFiles.brela, 'onboarding_documents');
          formData.brelaUrl = res.secureUrl;
        }
        if (selectedFiles.tin) {
          if (progressMsg) progressMsg.innerText = 'Inapandisha Cheti cha TIN ya TRA kwenye Cloudinary ya CHIMBO...';
          const res = await uploadFileToCloudinary(selectedFiles.tin, 'onboarding_documents');
          formData.tinUrl = res.secureUrl;
        }
        if (selectedFiles.license) {
          if (progressMsg) progressMsg.innerText = 'Inapandisha Leseni ya Biashara kwenye Cloudinary ya CHIMBO...';
          const res = await uploadFileToCloudinary(selectedFiles.license, 'onboarding_documents');
          formData.licenseUrl = res.secureUrl;
        }
        if (selectedFiles.office) {
          if (progressMsg) progressMsg.innerText = 'Inapandisha Picha ya Ndani ya Ofisi kwenye Cloudinary ya CHIMBO...';
          const res = await uploadFileToCloudinary(selectedFiles.office, 'onboarding_documents');
          formData.officePhotos = res.secureUrl;
        }
        if (selectedFiles.storefront) {
          if (progressMsg) progressMsg.innerText = 'Inapandisha Picha ya Nje ya Duka kwenye Cloudinary ya CHIMBO...';
          const res = await uploadFileToCloudinary(selectedFiles.storefront, 'onboarding_documents');
          formData.storeFrontPhoto = res.secureUrl;
        }

        // Clear file caches after successful upload
        selectedFiles.brela = null;
        selectedFiles.tin = null;
        selectedFiles.license = null;
        selectedFiles.office = null;
        selectedFiles.storefront = null;

        onboardingStep = 5;
        navigateTo('onboarding');
      } catch (err) {
        console.error('[Document Upload Error]:', err);
        alert('Imefeli kupakia nyaraka kwenye Cloudinary. Tafadhali hakikisha mtandao upo sawa na ujaribu tena.');
      } finally {
        if (overlay) overlay.style.display = 'none';
      }
    });
  }

  // 7. Step 5 Submit (Create provider, notifications, queues in Firestore)
  const submitBtn = document.getElementById('step-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const confirmChk = document.getElementById('confirm-chk') as HTMLInputElement;
      if (!confirmChk || !confirmChk.checked) {
        alert('Tafadhali kubali kauli ya uthibitisho kwa kuweka tiki kabla ya kuwasilisha!');
        return;
      }

      const user = state.currentUser;
      if (!user) return;

      submitBtn.innerHTML = '<span class="animate-spin material-symbols-outlined" style="font-size: 16px; margin-right: 6px;">refresh</span> Inatuma Maombi...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        const providerData: any = {
          id: user.uid,
          userId: user.uid,
          businessName: formData.businessName,
          businessType: formData.businessType,
          category: formData.primaryCategory,
          description: formData.description,
          latitude: formData.latitude,
          longitude: formData.longitude,
          accuracy: formData.gpsAccuracy,
          gpsTimestamp: formData.gpsTimestamp,
          reverseGeocodedAddress: formData.reverseGeocodedAddress,
          region: formData.region,
          district: formData.district,
          ward: formData.ward,
          street: formData.street,
          buildingName: formData.buildingName || '',
          landmark: formData.landmark,
          floor: formData.floor || '',
          shopNumber: formData.shopNumber || '',
          additionalDirections: formData.additionalDirections || '',
          brelaUrl: formData.brelaUrl,
          tinUrl: formData.tinUrl,
          licenseUrl: formData.licenseUrl || '',
          officePhotos: formData.officePhotos || '',
          storeFrontPhoto: formData.storeFrontPhoto,
          status: 'pending', // Pending Review
          verificationStatus: 'pending',
          providerStatus: 'pending',
          reviewStage: 'pending_review',
          trustScore: 40,
          isVerified: false,
          locationLocked: true, // Lock location automatically on submission
          createdAt: new Date().toISOString()
        };

        // 1. Write provider profile doc
        await setDoc(doc(db, 'providers', user.uid), providerData);

        // 2. Write Admin Notifications
        // Push-alert in standard notifications collection
        const adminNotifRef = doc(collection(db, 'notifications'));
        await setDoc(adminNotifRef, {
          userId: 'admin',
          title: 'Maombi Mapya ya Mtoa Huduma',
          body: `Duka jipya "${formData.businessName}" limejiandikisha kama ${formData.businessType} na linasubiri uhakiki na ziara ya uwanjani.`,
          read: false,
          createdAt: new Date().toISOString(),
          type: 'provider_registration',
          providerId: user.uid
        });

        // Safe record in explicit adminNotifications collection
        const adminNotifHistoryRef = doc(collection(db, 'adminNotifications'));
        await setDoc(adminNotifHistoryRef, {
          title: 'New Provider Registration',
          body: `Duka jipya "${formData.businessName}" limejiandikisha na linasubiri uhakiki.`,
          providerId: user.uid,
          businessName: formData.businessName,
          createdAt: new Date().toISOString(),
          read: false
        });

        // 3. Write Verification Queue entry
        await setDoc(doc(db, 'verificationQueue', user.uid), {
          providerId: user.uid,
          businessName: formData.businessName,
          status: 'pending',
          createdAt: new Date().toISOString(),
          submittedDocuments: ['BRELA', 'TIN', 'Store Front Photo']
        });

        // 4. Create individual Verification Documents for the admin portal Document Verification Center
        const docsToCreate = [
          { type: 'BRELA', url: formData.brelaUrl },
          { type: 'TIN', url: formData.tinUrl },
          { type: 'Store Front Photo', url: formData.storeFrontPhoto }
        ];
        if (formData.licenseUrl) docsToCreate.push({ type: 'Business License', url: formData.licenseUrl });
        if (formData.officePhotos) docsToCreate.push({ type: 'Office Photo', url: formData.officePhotos });

        for (const item of docsToCreate) {
          const docId = `${user.uid}_${item.type.toLowerCase().replace(/\s+/g, '_')}`;
          await setDoc(doc(db, 'verificationDocuments', docId), {
            id: docId,
            providerId: user.uid,
            type: item.type,
            status: 'pending',
            secureUrl: item.url,
            fileUrl: item.url,
            format: 'image',
            createdAt: new Date().toISOString()
          });
        }

        await logAction('Provider Submitted Onboarding', `Provider ${formData.businessName} submitted verification request and locked coordinates.`);

        // Clear states
        editMode = false;
        isLoaded = false; // Trigger reload of provider document next time
        onboardingStep = 6;
        navigateTo('onboarding');
      } catch (err) {
        console.error('[Submission Error]:', err);
        alert('Imeshindwa kuwasilisha ombi lako. Tafadhali jaribu tena baada ya muda kidogo.');
        submitBtn.innerHTML = 'Wasilisha Maombi yangu';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  // 8. Step prev button
  const prevBtn = document.getElementById('step-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (onboardingStep > 0) {
        onboardingStep = onboardingStep - 1;
        navigateTo('onboarding');
      }
    });
  }

  // 9. Success buttons
  const trackBtn = document.getElementById('success-track-btn');
  if (trackBtn) {
    trackBtn.addEventListener('click', () => {
      onboardingStep = 0;
      isLoaded = false; // Reset to reload updated provider doc from DB
      navigateTo('onboarding');
    });
  }

  const profileBtn = document.getElementById('success-profile-btn');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      navigateTo('auth'); // Navigate back to user profile dashboard
    });
  }

  // 10. Load Mapbox GL Map asynchronously if in Step 2 Location view
  if (onboardingStep === 2 && formData.latitude !== null && formData.longitude !== null) {
    (async () => {
      try {
        await ensureMapboxLoaded();
        const token = await getMapboxToken();
        const mapboxgl = (window as any).mapboxgl;
        if (mapboxgl) {
          mapboxgl.accessToken = token;
          const map = new mapboxgl.Map({
            container: 'confirm-map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [formData.longitude, formData.latitude],
            zoom: 16,
            interactive: false // Strictly read-only: Never allow provider to drag map
          });
          new mapboxgl.Marker({ color: 'var(--color-primary)' })
            .setLngLat([formData.longitude, formData.latitude])
            .addTo(map);
        }
      } catch (err) {
        console.error('[Mapbox Loader Error]:', err);
      }
    })();
  }
}

// ==========================================
// EXPOSED GLOBAL HELPER FUNCTIONS (SPA)
// ==========================================

/**
 * Caches the selected business type on card change in Step 1
 */
(window as any).selectBusinessType = (type: 'Product Seller' | 'Service Provider' | 'Products and Services') => {
  formData.businessType = type;
  // Auto reset category selection to avoid mixing mismatching categories
  formData.primaryCategory = '';
  navigateTo('onboarding');
};

/**
 * Caches a locally selected file in the File Input elements
 */
(window as any).cacheSelectedFile = (key: 'brela' | 'tin' | 'license' | 'office' | 'storefront', input: HTMLInputElement) => {
  if (input.files && input.files[0]) {
    selectedFiles[key] = input.files[0];
    console.log(`[File Caching] Cached selected file for ${key}:`, input.files[0].name);
  }
};

/**
 * GPS capturing method using browser geolocation API.
 * Captures: latitude, longitude, accuracy, timestamp and reverse geocodes via Mapbox.
 */
(window as any).captureLiveLocation = () => {
  if (isCapturingGps) return;
  isCapturingGps = true;
  gpsStatusText = 'Accessing GPS...';
  navigateTo('onboarding');

  if (!navigator.geolocation) {
    alert('Browser yako haisupport huduma ya GPS. Tafadhali tumia simu ya mkononi au kivinjari cha kisasa.');
    isCapturingGps = false;
    gpsStatusText = 'Unsupported';
    navigateTo('onboarding');
    return;
  }

  const options = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const timestamp = new Date(position.timestamp).toISOString();

        console.log(`[GPS Captured] Lat: ${lat}, Lon: ${lon}, Acc: ${accuracy}m`);

        formData.latitude = lat;
        formData.longitude = lon;
        formData.gpsAccuracy = accuracy;
        formData.gpsTimestamp = timestamp;

        gpsStatusText = 'Reverse Geocoding...';
        navigateTo('onboarding');

        // Mapbox Reverse Geocoding
        const token = await getMapboxToken();
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Mapbox reverse geocoding request failed');
        const geocodeData = await res.json();

        if (geocodeData && geocodeData.features && geocodeData.features.length > 0) {
          const mainFeature = geocodeData.features[0];
          formData.reverseGeocodedAddress = mainFeature.place_name || '';

          // Parse context to autofill Step 3 fields
          let region = '';
          let district = '';
          let ward = '';
          let street = '';

          if (mainFeature.place_type && (mainFeature.place_type.includes('address') || mainFeature.place_type.includes('street'))) {
            street = mainFeature.text || '';
          }

          if (mainFeature.context) {
            for (const ctx of mainFeature.context) {
              if (ctx.id.startsWith('neighborhood') || ctx.id.startsWith('locality')) {
                ward = ctx.text;
              } else if (ctx.id.startsWith('district')) {
                district = ctx.text;
              } else if (ctx.id.startsWith('region')) {
                region = ctx.text;
              } else if (ctx.id.startsWith('place') && !ward) {
                ward = ctx.text;
              }
            }
          }

          formData.region = region || 'Dar es Salaam';
          formData.district = district || 'Ilala';
          formData.ward = ward || 'Kariakoo';
          formData.street = street || mainFeature.text || '';
        } else {
          formData.reverseGeocodedAddress = `Dar es Salaam, Tanzania (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        }

        gpsStatusText = 'Captured Successfully';
      } catch (err) {
        console.error('[Geocoding Error]:', err);
        formData.reverseGeocodedAddress = `Captured coordinates (${formData.latitude!.toFixed(5)}, ${formData.longitude!.toFixed(5)})`;
        gpsStatusText = 'Captured (Geocode Fail)';
      } finally {
        isCapturingGps = false;
        navigateTo('onboarding');
      }
    },
    (error) => {
      console.error('[GPS Capture Error]:', error);
      let errorMsg = 'Imeshindwa kupata GPS halisi ya kifaa chako.';
      if (error.code === error.PERMISSION_DENIED) {
        errorMsg = 'Tafadhali ruhusu ufikiaji wa GPS (Location Permission) kwenye browser yako ili uendelee.';
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        errorMsg = 'Eneo la GPS halipatikani sasa hivi. Hakikisha upo nje au karibu na dirisha.';
      } else if (error.code === error.TIMEOUT) {
        errorMsg = 'GPS imechukua muda mrefu mno. Tafadhali jaribu kunasa eneo tena.';
      }
      alert(errorMsg);
      isCapturingGps = false;
      gpsStatusText = 'Failed';
      navigateTo('onboarding');
    },
    options
  );
};

/**
 * Triggered by the Rejected status screen button to edit details.
 * Changes the status in Firestore back to draft, sets editMode = true,
 * and launches Step 1 of the wizard.
 */
(window as any).startOnboardingEdit = async () => {
  const user = state.currentUser;
  if (!user) return;

  const confirmEdit = confirm('Je, una uhakika unataka kufanya marekebisho kwenye maelezo yako na kutuma upya maombi ya usajili?');
  if (!confirmEdit) return;

  try {
    const provRef = doc(db, 'providers', user.uid);
    // Reset status to draft so the user remains in the wizard session
    await setDoc(provRef, { status: 'draft' }, { merge: true });
    
    editMode = true;
    isLoaded = false; // Forces reload of details from Firestore
    onboardingStep = 1;
    navigateTo('onboarding');
  } catch (err) {
    console.error('Error resetting status to draft for editing:', err);
    alert('Hitilafu ilitokea wakati wa kuanzisha marekebisho.');
  }
};
