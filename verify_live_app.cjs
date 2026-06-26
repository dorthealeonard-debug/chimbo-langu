const { spawn } = require('child_process');
const http = require('http');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.callbacks = new Map();
    this.consoleErrors = [];
    this.uncaughtExceptions = [];
    this.logMessages = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => this.handleMessage(event.data);
    });
  }

  handleMessage(dataStr) {
    const data = JSON.parse(dataStr);
    if (data.id && this.callbacks.has(data.id)) {
      const { resolve, reject } = this.callbacks.get(data.id);
      this.callbacks.delete(data.id);
      if (data.error) {
        reject(data.error);
      } else {
        resolve(data.result);
      }
    }

    // Capture console API calls
    if (data.method === 'Runtime.consoleAPICalled') {
      const type = data.params.type;
      const args = data.params.args.map(a => a.value || a.description || JSON.stringify(a));
      const text = args.join(' ');
      this.logMessages.push(`[Console ${type}]: ${text}`);
      console.log(`[Browser Console ${type}]:`, text);
      if (type === 'error') {
        this.consoleErrors.push(text);
      }
    }

    // Capture uncaught exceptions
    if (data.method === 'Runtime.exceptionThrown') {
      const desc = data.params.exceptionDetails.exception.description || JSON.stringify(data.params.exceptionDetails.exception);
      this.uncaughtExceptions.push(desc);
      console.error('[Browser Exception]:', desc);
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval Exception: ${res.exceptionDetails.exception.description}`);
    }
    return res.result.value;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function run() {
  console.log("=== CHIMBO LIVE VERIFICATION ===");
  console.log("Starting Chrome...");
  const chromeProcess = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless",
    "--remote-debugging-port=9222",
    "--disable-gpu",
    "--no-sandbox"
  ]);

  chromeProcess.on('error', (err) => {
    console.error("Failed to start Chrome:", err);
  });

  await delay(3000);

  let client;
  try {
    const list = await getJson("http://127.0.0.1:9222/json/list");
    const page = list.find(p => p.type === 'page');
    if (!page) {
      throw new Error("No page target found in Chrome!");
    }
    
    client = new CDPClient(page.webSocketDebuggerUrl);
    await client.connect();
    console.log("Connected to Chrome DevTools Protocol.");

    // Enable console and page events
    await client.send('Runtime.enable');
    await client.send('Page.enable');

    const appUrl = 'http://localhost:3001/';
    console.log(`Navigating to: ${appUrl}`);
    await client.send('Page.navigate', { url: appUrl });
    await delay(6000);

    // Inject alert/confirm/prompt mock
    console.log("Injecting mocks...");
    await client.evaluate(`
      window.alert = function(msg) { console.log('ALERT_MOCK: ' + msg); };
      window.confirm = function(msg) { console.log('CONFIRM_MOCK: ' + msg); return true; };
      window.promptMocks = {
        'Jina la Simu': 'iPhone 15 Pro Max',
        'Gharama ya kuuza': '3200000',
        'Category': 'electronics'
      };
      window.prompt = function(msg, def) {
        console.log('PROMPT_MOCK: ' + msg);
        for (const [k, v] of Object.entries(window.promptMocks)) {
          if (msg.includes(k)) return v;
        }
        return def;
      };
    `);

    // Verify Title
    const title = await client.evaluate('document.title');
    console.log(`Page Title: ${title}`);

    const runLoginFlow = async (email, password, expectedRole) => {
      console.log(`\n--- Testing Auth & Dashboard for ${email} ---`);
      
      // Ensure clean state by reloading the page and checking login
      console.log("Navigating to clean page...");
      await client.send('Page.navigate', { url: appUrl });
      await delay(4000);

      // Log out if currently logged in
      console.log("Checking if logged in...");
      const loggedIn = await client.evaluate(`!!document.getElementById('auth-logout-btn') || !!document.getElementById('logout-btn')`);
      if (loggedIn) {
        console.log("User is currently logged in. Logging out...");
        await client.evaluate(`(() => {
          const btn = document.getElementById('auth-logout-btn') || document.getElementById('logout-btn');
          if (btn) btn.click();
        })()`);
        await delay(3000);
      }

      // Navigate directly to auth view via appState
      console.log("Routing directly to auth view...");
      await client.evaluate(`(() => {
        window.appState.navigateTo('auth');
      })()`);
      await delay(2000);

      // 1. Click Email Tab if it exists (for compatibility with new simplified auth view)
      console.log("Checking for Email tab...");
      await client.evaluate(`(() => {
        const btn = document.getElementById('tab-email-btn');
        if (btn) btn.click();
      })()`);
      await delay(500);

      // 2. Fill credentials
      console.log(`Typing email: ${email}...`);
      await client.evaluate(`{
        document.getElementById('email-username-input').value = '${email}';
        document.getElementById('email-password-input').value = '${password}';
      }`);

      // 3. Click login
      console.log("Clicking Login button...");
      await client.evaluate(`document.getElementById('email-action-btn').click()`);
      await delay(5000); // Allow firebase login to resolve and state to trigger render

      // 4. Verify logged in status
      let success = await client.evaluate(`!!document.getElementById('auth-logout-btn') || !!window.appState.state.currentUser`);
      if (success) {
        // Navigate back to auth to ensure we are on the profile page
        await client.evaluate(`window.appState.navigateTo('auth')`);
        await delay(2000);
      }
      
      const isNowLoggedIn = await client.evaluate(`!!document.getElementById('auth-logout-btn')`);
      if (!isNowLoggedIn) {
        // Log error message on screen
        const errMsg = await client.evaluate(`(() => {
          const el = document.querySelector('.stitch-card-sm[style*="background-color: var(--color-error-container)"]');
          return el ? el.innerText : 'Unknown auth failure';
        })()`);
        throw new Error(`Login failed for ${email}: ${errMsg}`);
      }
      console.log(`Successfully authenticated via Firebase Auth as ${email}!`);

      // 5. Verify correct Dashboard access
      if (expectedRole === 'customer') {
        console.log("Verifying Customer view...");
        // Customers are on the standard profile/auth view, check role text
        const displayedRole = await client.evaluate(`(() => {
          const el = document.querySelector('.stitch-badge-primary');
          return el ? el.innerText.trim() : '';
        })()`);
        console.log(`Displayed user role: ${displayedRole}`);
        if (displayedRole.toLowerCase() !== 'customer') {
          throw new Error(`Expected customer role, got ${displayedRole}`);
        }
      } else if (expectedRole === 'provider') {
        console.log("Verifying Provider Dashboard navigation...");
        const hasProviderBtn = await client.evaluate(`!!document.getElementById('go-provider-db-btn')`);
        if (!hasProviderBtn) {
          throw new Error("Provider Dashboard button (#go-provider-db-btn) is missing!");
        }
        
        // Go to Provider Dashboard
        await client.evaluate(`document.getElementById('go-provider-db-btn').click()`);
        await delay(3000);
        
        const inDashboard = await client.evaluate(`document.body.innerText.includes('CHIMBO Provider') || document.body.innerText.includes('CHIMBO Muuzaji')`);
        if (!inDashboard) {
          throw new Error("Failed to load Provider Dashboard");
        }
        console.log("Successfully loaded CHIMBO Provider Dashboard!");

        // Write: Create a posting to verify Firestore writes work on the deployed URL
        console.log("Testing Firestore Write: Creating a new device listing...");
        await client.evaluate(`(() => {
          document.getElementById('add-product-trigger').click();
        })()`);
        await delay(2500);

        await client.evaluate(`(() => {
          document.getElementById('prod-name-input').value = 'iPhone 15 Pro Max';
          document.getElementById('prod-brand-input').value = 'Apple';
          document.getElementById('prod-description-input').value = 'Super clean iPhone 15 Pro Max';
          document.getElementById('prod-price-input').value = '3200000';
          document.getElementById('prod-save-btn').click();
        })()`);
        await delay(6000); // wait for Firestore write and form re-navigation

        // Verify write was successful by checking list
        const listingAdded = await client.evaluate(`document.body.innerText.includes('iPhone 15 Pro Max')`);
        if (!listingAdded) {
          throw new Error("Firestore write test failed! New listing 'iPhone 15 Pro Max' not found in Provider Dashboard.");
        }
        console.log("Firestore write test succeeded! 'iPhone 15 Pro Max' successfully created and retrieved.");

      } else if (expectedRole === 'admin') {
        console.log("Verifying Admin Dashboard navigation...");
        const hasAdminBtn = await client.evaluate(`!!document.getElementById('go-admin-db-btn')`);
        if (!hasAdminBtn) {
          throw new Error("Admin Dashboard button (#go-admin-db-btn) is missing!");
        }
        
        // Go to Admin Dashboard
        await client.evaluate(`document.getElementById('go-admin-db-btn').click()`);
        await delay(3000);
        
        const inDashboard = await client.evaluate(`document.body.innerText.includes('Admin Panel') || document.body.innerText.includes('Msimamizi') || document.body.innerText.includes('Uhakiki')`);
        if (!inDashboard) {
          throw new Error("Failed to load Admin Dashboard");
        }
        console.log("Successfully loaded CHIMBO Admin Dashboard!");
      }

      // Re-navigate to profile/auth page and logout
      console.log("Navigating to profile page to log out...");
      await client.evaluate(`(() => {
        const navProfile = document.getElementById('nav-profile');
        if (navProfile) navProfile.click();
      })()`);
      await delay(2000);

      const logoutBtn = await client.evaluate(`!!document.getElementById('auth-logout-btn')`);
      if (logoutBtn) {
        await client.evaluate(`document.getElementById('auth-logout-btn').click()`);
        await delay(2000);
      }
    };

    // Run the flows sequentially
    await runLoginFlow("customer@chimbo.com", "password123", "customer");
    await runLoginFlow("provider@chimbo.com", "password123", "provider");
    await runLoginFlow("admin@chimbo.com", "password123", "admin");

    console.log("\n=== VERIFICATION SUMMARY ===");
    console.log("Total Console Errors Captured:", client.consoleErrors.length);
    console.log("Total Uncaught Exceptions Captured:", client.uncaughtExceptions.length);

    if (client.consoleErrors.length > 0 || client.uncaughtExceptions.length > 0) {
      console.error("\nErrors encountered:");
      client.consoleErrors.forEach(err => console.error(" - Console Error:", err));
      client.uncaughtExceptions.forEach(err => console.error(" - Exception:", err));
      process.exitCode = 1;
    } else {
      console.log("\nALL VERIFICATIONS PASSED WITH ZERO CONSOLE ERRORS!");
      process.exitCode = 0;
    }

  } catch (err) {
    console.error("\nVerification Failed with error:", err);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.close();
    }
    chromeProcess.kill();
    console.log("Chrome terminated.");
  }
}

run();

