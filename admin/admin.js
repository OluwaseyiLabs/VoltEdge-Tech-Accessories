/**
 * VoltEdge Admin Platform - Core Application Logic
 * CMS, Product Catalogue & Inventory Management Desk
 */

// Supabase Client Handle (Initialized dynamically from /api/config backed by .env)
let supabaseClient = null;

async function getAdminConfig() {
  const localUrl = localStorage.getItem('voltedge_supabase_url');
  const localKey = localStorage.getItem('voltedge_supabase_key');
  if (localUrl && localKey) {
    return { supabaseUrl: localUrl, supabaseAnonKey: localKey };
  }

  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.supabaseUrl && cfg.supabaseAnonKey) {
        return cfg;
      }
    }
  } catch (e) {
    console.warn('Could not load /api/config:', e);
  }
  return null;
}

// Global Application State
const STATE = {
  currentUser: null,
  currentAdmin: null,
  activeView: 'overview',
  categories: [],
  products: [],
  inventory: [],
  movements: [],
  reservations: [],
  admins: [],
  activityLogs: [],
  isSetupMode: false,
  selectedProduct: null,
  productImagesBuffer: [] // temporary images during product creation/edit
};

// ==========================================
// 1. INITIALIZATION & AUTHENTICATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  const config = await getAdminConfig();
  if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
    showToast('Missing configuration. Please verify SUPABASE_URL and SUPABASE_ANON_KEY in .env', 'error');
    return;
  }

  supabaseClient = window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
  if (!supabaseClient) {
    showToast('Failed to initialize Supabase client. Check script tags.', 'error');
    return;
  }

  // Check auth session
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  
  if (session && session.user) {
    await handleAuthenticatedSession(session.user);
  } else {
    await checkInitialSetupNeeded();
    showAuthView();
  }

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await handleAuthenticatedSession(session.user);
    } else if (event === 'SIGNED_OUT') {
      STATE.currentUser = null;
      STATE.currentAdmin = null;
      showAuthView();
    }
  });
});

async function checkInitialSetupNeeded() {
  try {
    const { count, error } = await supabaseClient
      .from('admin_profiles')
      .select('*', { count: 'exact', head: true });

    if (!error && (count === 0 || count === null)) {
      setSetupMode(true);
    }
  } catch (e) {
    console.warn('Error checking admin profiles count:', e);
  }
}

function showAuthView() {
  document.getElementById('authContainer').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';
}

function showAppView() {
  document.getElementById('authContainer').style.display = 'none';
  document.getElementById('appContainer').style.display = 'flex';
}

function toggleSetupMode() {
  setSetupMode(!STATE.isSetupMode);
}

function setSetupMode(isSetup) {
  STATE.isSetupMode = isSetup;
  const setupFields = document.getElementById('setupFields');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const setupPromptText = document.getElementById('setupPromptText');
  const setupToggleBtn = document.getElementById('setupToggleBtn');

  if (isSetup) {
    setupFields.style.display = 'block';
    authTitle.textContent = 'Initialize Owner Account';
    authSubtitle.textContent = 'Create the primary executive administrator account for VoltEdge.';
    authSubmitBtn.querySelector('span').textContent = 'Create Owner Account';
    setupPromptText.textContent = 'Already have an administrator account?';
    setupToggleBtn.textContent = 'Sign In';
  } else {
    setupFields.style.display = 'none';
    authTitle.textContent = 'Sign In to Dashboard';
    authSubtitle.textContent = 'Enter your administrator credentials to manage products and inventory.';
    authSubmitBtn.querySelector('span').textContent = 'Sign In';
    setupPromptText.textContent = 'Need to initialize the first owner account?';
    setupToggleBtn.textContent = 'First-Time Setup';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const fullName = document.getElementById('authFullName') ? document.getElementById('authFullName').value.trim() : '';
  const submitBtn = document.getElementById('authSubmitBtn');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> <span>Please wait...</span>';

  try {
    if (STATE.isSetupMode) {
      if (!fullName) {
        showToast('Please provide your full name', 'warning');
        resetAuthBtn();
        return;
      }

      // Call bootstrap_initial_owner RPC
      const { data, error } = await supabaseClient.rpc('bootstrap_initial_owner', {
        p_email: email,
        p_password: password,
        p_full_name: fullName
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.error || 'Failed to initialize owner account');
      }

      showToast('Owner account initialized successfully! Signing in...', 'success');
      
      // Sign in with new credentials
      const { data: authData, error: signInErr } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (signInErr) throw signInErr;
    } else {
      // Standard Sign In
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;
      showToast('Signed in successfully!', 'success');
    }
  } catch (err) {
    console.error('Auth error:', err);
    showToast(err.message || 'Authentication failed. Please verify credentials.', 'error');
    resetAuthBtn();
  }
}

function resetAuthBtn() {
  const submitBtn = document.getElementById('authSubmitBtn');
  submitBtn.disabled = false;
  submitBtn.innerHTML = `<span>${STATE.isSetupMode ? 'Create Owner Account' : 'Sign In'}</span> <i class="ph-bold ph-arrow-right"></i>`;
}

async function handleAuthenticatedSession(user) {
  STATE.currentUser = user;

  try {
    // Fetch Admin Profile
    const { data: profile, error } = await supabaseClient
      .from('admin_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error || !profile) {
      console.warn('User has no admin profile:', error);
      showToast('Access denied: You do not have an active administrator profile.', 'error');
      await supabaseClient.auth.signOut();
      return;
    }

    if (!profile.is_active) {
      showToast('Your administrator account is deactivated. Contact the owner.', 'error');
      await supabaseClient.auth.signOut();
      return;
    }

    STATE.currentAdmin = profile;

    // Update UI Profile Display
    document.getElementById('userName').textContent = profile.full_name || user.email;
    document.getElementById('userRole').textContent = profile.role;
    document.getElementById('userAvatar').textContent = (profile.full_name || user.email || 'A')[0].toUpperCase();

    // Enforce role-based menu restrictions
    applyRolePermissions(profile.role);

    showAppView();
    await loadInitialData();
  } catch (err) {
    console.error('Error fetching admin profile:', err);
    showToast('Failed to load profile details.', 'error');
  }
}

function applyRolePermissions(role) {
  const isSuper = role === 'OWNER' || role === 'ADMINISTRATOR';
  document.querySelectorAll('.admin-restricted').forEach(el => {
    el.style.display = isSuper ? '' : 'none';
  });
}

async function handleSignOut() {
  if (confirm('Are you sure you want to sign out?')) {
    await supabaseClient.auth.signOut();
    showToast('Signed out successfully.', 'info');
  }
}

// ==========================================
// 2. DATA LOADING & SUBSCRIPTIONS
// ==========================================

async function loadInitialData() {
  await Promise.all([
    loadCategories(),
    loadProducts(),
    loadInventory(),
    loadReservations(),
    loadAdmins(),
    loadActivityLogs()
  ]);
  updateDashboardKPIs();
}

async function loadCategories() {
  const { data, error } = await supabaseClient
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });

  if (!error && data) {
    STATE.categories = data;
    renderCategoriesTable();
    populateCategoryDropdowns();
  }
}

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from('products')
    .select(`
      *,
      category:categories(id, name, slug),
      inventory:inventory(stock_on_hand, reserved_quantity, available_quantity, low_stock_threshold, sales_enabled),
      images:product_images(id, thumbnail_url, card_url, detail_url, storage_path, alt_text, is_primary, display_order)
    `)
    .order('sort_order', { ascending: true });

  if (!error && data) {
    STATE.products = data;
    renderProductsTable();
    renderOverviewTable();
    document.getElementById('navProductCount').textContent = data.length;
  } else {
    console.error('Error loading products:', error);
  }
}

async function loadInventory() {
  const { data, error } = await supabaseClient
    .from('inventory')
    .select(`
      *,
      product:products(id, name, sku, short_name, price, badge, badge_type)
    `);

  if (!error && data) {
    STATE.inventory = data;
    renderInventoryTable();
    populateInventoryModalDropdown();
  }

  // Load Inventory Movements
  const { data: movements, error: movErr } = await supabaseClient
    .from('inventory_movements')
    .select(`
      *,
      product:products(name, sku)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!movErr && movements) {
    STATE.movements = movements;
    renderMovementsTable();
  }
}

async function loadReservations() {
  const { data, error } = await supabaseClient
    .from('inventory_reservations')
    .select(`
      *,
      items:inventory_reservation_items(*)
    `)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!error && data) {
    STATE.reservations = data;
    renderReservationsTable();
  }
}

async function loadAdmins() {
  if (STATE.currentAdmin && (STATE.currentAdmin.role === 'OWNER' || STATE.currentAdmin.role === 'ADMINISTRATOR')) {
    const { data, error } = await supabaseClient
      .from('admin_profiles')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      STATE.admins = data;
      renderAdminsTable();
    }
  }
}

async function loadActivityLogs() {
  if (STATE.currentAdmin && (STATE.currentAdmin.role === 'OWNER' || STATE.currentAdmin.role === 'ADMINISTRATOR')) {
    const { data, error } = await supabaseClient
      .from('admin_activity_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);

    if (!error && data) {
      STATE.activityLogs = data;
      renderActivityLogsTable();
    }
  }
}

// ==========================================
// 3. NAVIGATION & UI VIEWS
// ==========================================

function switchView(viewName) {
  STATE.activeView = viewName;

  // Sidebar link highlight
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Section visibility
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`view${capitalize(viewName)}`);
  if (targetSec) targetSec.classList.add('active');

  // View Title & Primary Button adjustments
  const viewTitles = {
    overview: 'Dashboard Overview',
    products: 'Product Catalogue',
    inventory: 'Inventory & Stock Management',
    categories: 'Catalogue Categories',
    orders: 'Orders & Live Reservations',
    admins: 'Team Members & Roles',
    logs: 'Activity Audit Log'
  };

  document.getElementById('viewHeading').textContent = viewTitles[viewName] || 'Dashboard';
  
  const headerActionBtn = document.getElementById('headerActionBtn');
  const headerActionLabel = document.getElementById('headerActionLabel');

  if (viewName === 'inventory') {
    headerActionBtn.style.display = '';
    headerActionLabel.textContent = 'Stock Adjustment';
  } else if (viewName === 'admins') {
    headerActionBtn.style.display = '';
    headerActionLabel.textContent = 'Add Team Member';
  } else if (viewName === 'categories') {
    headerActionBtn.style.display = 'none';
  } else {
    headerActionBtn.style.display = '';
    headerActionLabel.textContent = 'New Product';
  }

  // Close mobile sidebar if open
  document.getElementById('sidebar').classList.remove('mobile-open');
}

function handlePrimaryHeaderAction() {
  if (STATE.activeView === 'inventory') {
    openInventoryModal();
  } else if (STATE.activeView === 'admins') {
    openAdminModal();
  } else {
    openCreateProductModal();
  }
}

function toggleMobileMenu() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}

// ==========================================
// 4. OVERVIEW & KPIS
// ==========================================

function updateDashboardKPIs() {
  let activeCount = 0;
  let totalStockOnHand = 0;
  let totalReserved = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  STATE.products.forEach(p => {
    if (p.publication_status === 'PUBLISHED') activeCount++;
    const inv = p.inventory || {};
    const onHand = inv.stock_on_hand || 0;
    const reserved = inv.reserved_quantity || 0;
    const available = inv.available_quantity || Math.max(0, onHand - reserved);
    const threshold = inv.low_stock_threshold || 5;

    totalStockOnHand += onHand;
    totalReserved += reserved;

    if (available === 0 || !inv.sales_enabled) {
      outOfStockCount++;
    } else if (available <= threshold) {
      lowStockCount++;
    }
  });

  document.getElementById('kpiActiveProducts').textContent = activeCount;
  document.getElementById('kpiTotalProducts').textContent = `${STATE.products.length} total in catalogue`;
  document.getElementById('kpiStockOnHand').textContent = totalStockOnHand.toLocaleString();
  document.getElementById('kpiReservedUnits').textContent = totalReserved.toLocaleString();
  
  const totalAlerts = lowStockCount + outOfStockCount;
  document.getElementById('kpiStockAlerts').textContent = totalAlerts;
  document.getElementById('kpiStockAlertsSub').textContent = `${lowStockCount} low stock, ${outOfStockCount} sold out`;

  // Banner
  const alertBanner = document.getElementById('stockAlertsBanner');
  if (totalAlerts > 0) {
    alertBanner.style.display = 'block';
    document.getElementById('stockAlertMessage').textContent = 
      `Attention: ${totalAlerts} product(s) require inventory replenishment (${outOfStockCount} out of stock, ${lowStockCount} low stock).`;
  } else {
    alertBanner.style.display = 'none';
  }
}

function renderOverviewTable() {
  const tbody = document.getElementById('overviewProductsTable');
  if (!STATE.products.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">No products in catalogue yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.products.slice(0, 6).map(p => {
    const inv = p.inventory || {};
    const available = inv.available_quantity !== undefined ? inv.available_quantity : (inv.stock_on_hand || 0);
    const threshold = inv.low_stock_threshold || 5;
    const status = getStockStatus(available, threshold, inv.sales_enabled);
    const imgUrl = getPrimaryImageUrl(p);

    return `
      <tr>
        <td>
          <div class="product-cell">
            <img src="${imgUrl}" alt="${escapeHtml(p.name)}" class="product-thumb" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22 width=%2244%22 height=%2244%22><rect width=%2244%22 height=%2244%22 fill=%22%23eee%22/></svg>'">
            <div class="product-meta">
              <h4>${escapeHtml(p.name)}</h4>
              <span>${escapeHtml(p.short_name || p.sku)}</span>
            </div>
          </div>
        </td>
        <td><code>${escapeHtml(p.sku)}</code></td>
        <td>${escapeHtml(p.category ? p.category.name : '--')}</td>
        <td><strong>₦${Number(p.price).toLocaleString()}</strong></td>
        <td>
          <span class="badge badge-${status.key}">
            <span class="badge-dot"></span>
            <span>${status.label} (${available})</span>
          </span>
        </td>
        <td>
          <span class="badge badge-${(p.publication_status || 'DRAFT').toLowerCase()}">
            <span>${p.publication_status || 'DRAFT'}</span>
          </span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="openEditProductModal('${p.id}')">Edit</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// 5. PRODUCT CATALOGUE MANAGEMENT
// ==========================================

function renderProductsTable(filteredList = null) {
  const tbody = document.getElementById('productsTableBody');
  const list = filteredList || STATE.products;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No matching products found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const inv = p.inventory || {};
    const onHand = inv.stock_on_hand || 0;
    const reserved = inv.reserved_quantity || 0;
    const available = inv.available_quantity !== undefined ? inv.available_quantity : Math.max(0, onHand - reserved);
    const threshold = inv.low_stock_threshold || 5;
    const status = getStockStatus(available, threshold, inv.sales_enabled);
    const imgUrl = getPrimaryImageUrl(p);

    return `
      <tr>
        <td>
          <div class="product-cell">
            <img src="${imgUrl}" alt="${escapeHtml(p.name)}" class="product-thumb">
            <div class="product-meta">
              <h4>${escapeHtml(p.name)}</h4>
              <span>${p.badge ? `<span style="color: var(--accent); font-weight:600;">[${escapeHtml(p.badge)}]</span> ` : ''}${escapeHtml(p.specs_highlight || '')}</span>
            </div>
          </div>
        </td>
        <td><code>${escapeHtml(p.sku)}</code></td>
        <td>${escapeHtml(p.category ? p.category.name : '--')}</td>
        <td>
          <div><strong>₦${Number(p.price).toLocaleString()}</strong></div>
          ${p.compare_at_price ? `<div style="font-size: 0.75rem; text-decoration: line-through; color: var(--text-light);">₦${Number(p.compare_at_price).toLocaleString()}</div>` : ''}
        </td>
        <td>
          <span class="badge badge-${status.key}">
            <span class="badge-dot"></span>
            <span>${status.label} (${available})</span>
          </span>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
            ${onHand} on hand • ${reserved} hold
          </div>
        </td>
        <td>
          <span class="badge badge-${(p.publication_status || 'DRAFT').toLowerCase()}">
            <span>${p.publication_status || 'DRAFT'}</span>
          </span>
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 0.4rem;">
            <button class="btn btn-secondary btn-sm" onclick="openEditProductModal('${p.id}')" title="Edit Product">
              <i class="ph-bold ph-pencil-simple"></i>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleProductPublish('${p.id}')" title="${p.publication_status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}">
              <i class="ph-bold ${p.publication_status === 'PUBLISHED' ? 'ph-eye-slash' : 'ph-eye'}"></i>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="openInventoryForProduct('${p.id}')" title="Adjust Stock">
              <i class="ph-bold ph-stack"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterProducts() {
  const query = document.getElementById('productSearchInput').value.toLowerCase().trim();
  const catFilter = document.getElementById('productCategoryFilter').value;
  const stockFilter = document.getElementById('productStockFilter').value;
  const statusFilter = document.getElementById('productStatusFilter').value;

  const filtered = STATE.products.filter(p => {
    // Search query
    if (query) {
      const matchName = (p.name || '').toLowerCase().includes(query);
      const matchSku = (p.sku || '').toLowerCase().includes(query);
      const matchShort = (p.short_name || '').toLowerCase().includes(query);
      if (!matchName && !matchSku && !matchShort) return false;
    }

    // Category filter
    if (catFilter && p.category_id !== catFilter) return false;

    // Publication status filter
    if (statusFilter && p.publication_status !== statusFilter) return false;

    // Stock filter
    if (stockFilter) {
      const inv = p.inventory || {};
      const available = inv.available_quantity !== undefined ? inv.available_quantity : (inv.stock_on_hand || 0);
      const threshold = inv.low_stock_threshold || 5;

      if (stockFilter === 'out_of_stock' && (available > 0 && inv.sales_enabled)) return false;
      if (stockFilter === 'low_stock' && (available > threshold || available <= 0 || !inv.sales_enabled)) return false;
      if (stockFilter === 'in_stock' && (available <= threshold || !inv.sales_enabled)) return false;
    }

    return true;
  });

  renderProductsTable(filtered);
}

function openCreateProductModal() {
  STATE.selectedProduct = null;
  STATE.productImagesBuffer = [];
  document.getElementById('productForm').reset();
  document.getElementById('formProductId').value = '';
  document.getElementById('productModalTitle').textContent = 'Add New Product';
  document.getElementById('formPubStatus').value = 'PUBLISHED';
  document.getElementById('formWarranty').value = '1-Year Product Warranty';
  document.getElementById('formDispatchBadge').value = 'Same-Day Dispatch Eligible';
  renderModalImageGallery();
  switchProductTab('tabGeneral');
  document.getElementById('productModal').classList.add('active');
}

function openEditProductModal(productId) {
  const product = STATE.products.find(p => p.id === productId);
  if (!product) return;

  STATE.selectedProduct = product;
  STATE.productImagesBuffer = [...(product.images || [])];

  document.getElementById('formProductId').value = product.id;
  document.getElementById('productModalTitle').textContent = `Edit Product: ${product.name}`;
  document.getElementById('formName').value = product.name || '';
  document.getElementById('formSku').value = product.sku || '';
  document.getElementById('formSlug').value = product.slug || '';
  document.getElementById('formCategory').value = product.category_id || '';
  document.getElementById('formPubStatus').value = product.publication_status || 'DRAFT';
  document.getElementById('formShortName').value = product.short_name || '';
  document.getElementById('formTagline').value = product.tagline || '';
  document.getElementById('formFinish').value = product.finish || '';
  document.getElementById('formDescription').value = product.description || '';
  document.getElementById('formPrice').value = product.price || '';
  document.getElementById('formComparePrice').value = product.compare_at_price || '';
  document.getElementById('formBadge').value = product.badge || '';
  document.getElementById('formBadgeType').value = product.badge_type || 'accent';
  document.getElementById('formWarranty').value = product.warranty || '1-Year Product Warranty';
  document.getElementById('formSpecsHighlight').value = product.specs_highlight || '';
  document.getElementById('formDispatchBadge').value = product.dispatch_badge || 'Same-Day Dispatch Eligible';

  // Bullets
  const bullets = Array.isArray(product.bullets) ? product.bullets : (Array.isArray(product.features) ? product.features : []);
  document.getElementById('formBullets').value = bullets.join('\n');

  // Specs
  const specs = product.technical_specs || {};
  document.getElementById('formTechnicalSpecs').value = JSON.stringify(specs, null, 2);

  renderModalImageGallery();
  switchProductTab('tabGeneral');
  document.getElementById('productModal').classList.add('active');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('active');
}

function switchProductTab(tabId) {
  document.querySelectorAll('.modal-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
}

function handleProductNameInput() {
  const nameInput = document.getElementById('formName');
  const slugInput = document.getElementById('formSlug');
  // Auto-generate slug if new product and user hasn't edited slug directly
  if (!STATE.selectedProduct) {
    slugInput.value = generateSlug(nameInput.value);
  }
}

async function handleProductFormSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('saveProductBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> <span>Saving...</span>';

  try {
    const id = document.getElementById('formProductId').value;
    const name = document.getElementById('formName').value.trim();
    const sku = document.getElementById('formSku').value.trim().toUpperCase();
    const slug = document.getElementById('formSlug').value.trim().toLowerCase();
    const category_id = document.getElementById('formCategory').value;
    const publication_status = document.getElementById('formPubStatus').value;
    const is_published = publication_status === 'PUBLISHED';
    const short_name = document.getElementById('formShortName').value.trim();
    const tagline = document.getElementById('formTagline').value.trim();
    const finish = document.getElementById('formFinish').value.trim();
    const description = document.getElementById('formDescription').value.trim();
    const price = parseFloat(document.getElementById('formPrice').value);
    const compareVal = document.getElementById('formComparePrice').value;
    const compare_at_price = compareVal ? parseFloat(compareVal) : null;
    const badge = document.getElementById('formBadge').value.trim() || null;
    const badge_type = document.getElementById('formBadgeType').value;
    const warranty = document.getElementById('formWarranty').value.trim();
    const specs_highlight = document.getElementById('formSpecsHighlight').value.trim() || null;
    const dispatch_badge = document.getElementById('formDispatchBadge').value.trim();

    // Parse bullets
    const bulletsRaw = document.getElementById('formBullets').value;
    const bullets = bulletsRaw.split('\n').map(s => s.trim()).filter(Boolean);

    // Parse specs JSON
    let technical_specs = {};
    const specsRaw = document.getElementById('formTechnicalSpecs').value.trim();
    if (specsRaw) {
      try {
        technical_specs = JSON.parse(specsRaw);
      } catch (err) {
        showToast('Invalid JSON in Technical Specifications field', 'warning');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="ph-bold ph-floppy-disk"></i> <span>Save Product</span>';
        switchProductTab('tabFeatures');
        return;
      }
    }

    const payload = {
      name,
      sku,
      slug,
      category_id,
      publication_status,
      is_published,
      short_name: short_name || name,
      tagline: tagline || short_name || name,
      short_description: tagline || short_name || name,
      finish,
      description: description || tagline || name,
      price,
      compare_at_price,
      badge,
      badge_type,
      warranty,
      specs_highlight,
      dispatch_badge,
      bullets,
      features: bullets,
      technical_specs
    };

    let resultProductId = id;

    if (id) {
      // Update
      const { data, error } = await supabaseClient
        .from('products')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      showToast(`Product "${name}" updated successfully!`, 'success');
      logActivity('UPDATE_PRODUCT', 'products', id, payload);
    } else {
      // Insert
      const { data, error } = await supabaseClient
        .from('products')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      resultProductId = data.id;
      showToast(`Product "${name}" created successfully!`, 'success');
      logActivity('CREATE_PRODUCT', 'products', data.id, payload);
    }

    // Save image associations if buffer contains images
    if (resultProductId && STATE.productImagesBuffer.length) {
      for (const img of STATE.productImagesBuffer) {
        if (!img.id) {
          // New image inserted
          await supabaseClient.from('product_images').insert([{
            product_id: resultProductId,
            thumbnail_url: img.thumbnail_url,
            card_url: img.card_url,
            detail_url: img.detail_url,
            storage_path: img.storage_path,
            alt_text: name,
            is_primary: !!img.is_primary,
            display_order: img.display_order || 1
          }]);
        }
      }
    }

    closeProductModal();
    await loadProducts();
    await loadInventory();
    updateDashboardKPIs();
  } catch (err) {
    console.error('Error saving product:', err);
    showToast(err.message || 'Failed to save product. Please check fields.', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="ph-bold ph-floppy-disk"></i> <span>Save Product</span>';
  }
}

async function toggleProductPublish(productId) {
  const p = STATE.products.find(x => x.id === productId);
  if (!p) return;

  const nextStatus = p.publication_status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED';
  const nextPublished = nextStatus === 'PUBLISHED';

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({
        publication_status: nextStatus,
        is_published: nextPublished
      })
      .eq('id', productId);

    if (error) throw error;
    showToast(`Product is now ${nextStatus}`, 'success');
    logActivity('TOGGLE_PUBLICATION', 'products', productId, { publication_status: nextStatus });
    await loadProducts();
    updateDashboardKPIs();
  } catch (err) {
    console.error('Error updating status:', err);
    showToast('Failed to update publication status', 'error');
  }
}

// ==========================================
// 6. CLIENT-SIDE WEBP IMAGE PIPELINE
// ==========================================

function renderModalImageGallery() {
  const gallery = document.getElementById('modalImageGallery');
  if (!STATE.productImagesBuffer || !STATE.productImagesBuffer.length) {
    gallery.innerHTML = `
      <div style="grid-column: 1 / -1; font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.5rem;">
        No images uploaded yet. Upload a high-resolution picture above.
      </div>
    `;
    return;
  }

  gallery.innerHTML = STATE.productImagesBuffer.map((img, idx) => `
    <div class="image-card">
      <img src="${img.card_url || img.detail_url || img.thumbnail_url}">
      ${img.is_primary ? `<span class="image-primary-pill">Primary</span>` : ''}
      <div class="image-card-actions">
        ${!img.is_primary ? `
          <button type="button" class="btn btn-secondary btn-sm" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;" onclick="setPrimaryImage(${idx})">
            Set Primary
          </button>
        ` : `<span></span>`}
        <button type="button" class="btn btn-danger btn-sm" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;" onclick="removeBufferImage(${idx})">
          <i class="ph-bold ph-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function setPrimaryImage(index) {
  STATE.productImagesBuffer.forEach((img, i) => {
    img.is_primary = (i === index);
  });
  renderModalImageGallery();
}

function removeBufferImage(index) {
  const removed = STATE.productImagesBuffer.splice(index, 1)[0];
  if (removed && removed.is_primary && STATE.productImagesBuffer.length > 0) {
    STATE.productImagesBuffer[0].is_primary = true;
  }
  renderModalImageGallery();
}

function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('dragover');
}

function handleImageDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    processImageFiles(e.dataTransfer.files);
  }
}

function handleImageFileSelect(e) {
  if (e.target.files && e.target.files.length) {
    processImageFiles(e.target.files);
  }
}

async function processImageFiles(files) {
  const statusEl = document.getElementById('imageCompressionStatus');
  const textEl = document.getElementById('compressionText');
  statusEl.style.display = 'flex';

  const sku = document.getElementById('formSku').value.trim() || 'NEW-ITEM';

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      textEl.textContent = `Optimizing (${i + 1}/${files.length}): ${file.name}...`;

      // 1. Generate WebP Detail (1200px), Card (640px), Thumb (320px)
      const detailBlob = await resizeImageToWebP(file, 1200, 0.85);
      const cardBlob = await resizeImageToWebP(file, 640, 0.85);
      const thumbBlob = await resizeImageToWebP(file, 320, 0.82);

      const timestamp = Date.now();
      const baseName = sanitizeFileName(file.name.replace(/\.[^/.]+$/, ''));
      
      const detailPath = `${sku.toLowerCase()}/${baseName}-${timestamp}-1200w.webp`;
      const cardPath = `${sku.toLowerCase()}/${baseName}-${timestamp}-640w.webp`;
      const thumbPath = `${sku.toLowerCase()}/${baseName}-${timestamp}-320w.webp`;

      textEl.textContent = `Uploading optimized WebP variants to Supabase Storage...`;

      // 2. Upload to Supabase Storage Bucket `product-images`
      const [u1, u2, u3] = await Promise.all([
        supabaseClient.storage.from('product-images').upload(detailPath, detailBlob, { contentType: 'image/webp' }),
        supabaseClient.storage.from('product-images').upload(cardPath, cardBlob, { contentType: 'image/webp' }),
        supabaseClient.storage.from('product-images').upload(thumbPath, thumbBlob, { contentType: 'image/webp' })
      ]);

      if (u1.error || u2.error || u3.error) {
        throw new Error((u1.error || u2.error || u3.error).message);
      }

      // Public URLs
      const detailUrl = supabaseClient.storage.from('product-images').getPublicUrl(detailPath).data.publicUrl;
      const cardUrl = supabaseClient.storage.from('product-images').getPublicUrl(cardPath).data.publicUrl;
      const thumbUrl = supabaseClient.storage.from('product-images').getPublicUrl(thumbPath).data.publicUrl;

      const isFirst = STATE.productImagesBuffer.length === 0;

      STATE.productImagesBuffer.push({
        detail_url: detailUrl,
        card_url: cardUrl,
        thumbnail_url: thumbUrl,
        storage_path: cardPath,
        is_primary: isFirst,
        display_order: STATE.productImagesBuffer.length + 1
      });
    }

    renderModalImageGallery();
    showToast(`Images optimized to WebP and uploaded successfully!`, 'success');
  } catch (err) {
    console.error('Image processing error:', err);
    showToast(err.message || 'Image upload failed', 'error');
  } finally {
    statusEl.style.display = 'none';
    document.getElementById('imageFileInput').value = '';
  }
}

function resizeImageToWebP(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas WebP blob creation failed'));
        }, 'image/webp', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==========================================
// 7. INVENTORY MANAGEMENT DESK
// ==========================================

function renderInventoryTable(filteredList = null) {
  const tbody = document.getElementById('inventoryTableBody');
  const list = filteredList || STATE.inventory;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2rem;">No inventory records available.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(inv => {
    const p = inv.product || {};
    const onHand = inv.stock_on_hand || 0;
    const reserved = inv.reserved_quantity || 0;
    const available = inv.available_quantity !== undefined ? inv.available_quantity : Math.max(0, onHand - reserved);
    const threshold = inv.low_stock_threshold || 5;
    const status = getStockStatus(available, threshold, inv.sales_enabled);

    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: var(--text-main);">${escapeHtml(p.name || 'Unknown Item')}</div>
          <code>${escapeHtml(p.sku || '')}</code>
        </td>
        <td><strong style="font-size: 1.05rem;">${onHand}</strong></td>
        <td><span style="color: #b45309; font-weight: 600;">${reserved}</span></td>
        <td>
          <strong style="color: ${available > 0 ? '#047857' : '#b91c1c'}; font-size: 1.1rem;">
            ${available}
          </strong>
        </td>
        <td>${threshold} units</td>
        <td>
          <button class="btn btn-sm ${inv.sales_enabled ? 'btn-secondary' : 'btn-danger'}" onclick="toggleSalesEnabled('${inv.product_id}', ${!inv.sales_enabled})">
            <i class="ph-bold ${inv.sales_enabled ? 'ph-check-circle' : 'ph-prohibit'}"></i>
            <span>${inv.sales_enabled ? 'Checkout Active' : 'Sales Paused'}</span>
          </button>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="openInventoryForProduct('${inv.product_id}')">
            <i class="ph-bold ph-pencil"></i>
            <span>Adjust</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderMovementsTable() {
  const tbody = document.getElementById('inventoryMovementsBody');
  if (!STATE.movements.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No stock movements recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.movements.map(m => {
    const prod = m.product || {};
    const isPositive = m.quantity_change > 0;
    const timeStr = new Date(m.created_at).toLocaleString();

    return `
      <tr>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${timeStr}</td>
        <td>
          <div style="font-weight: 600;">${escapeHtml(prod.name || 'Item')}</div>
          <code>${escapeHtml(prod.sku || '')}</code>
        </td>
        <td><span class="badge" style="background:#f1f5f9; color:#334155;">${escapeHtml(m.movement_type)}</span></td>
        <td>
          <strong style="color: ${isPositive ? '#059669' : '#dc2626'};">
            ${isPositive ? '+' : ''}${m.quantity_change}
          </strong>
        </td>
        <td>${m.stock_before} &rarr; <strong>${m.stock_after}</strong></td>
        <td>${escapeHtml(m.reason || m.reference_id || '--')}</td>
      </tr>
    `;
  }).join('');
}

function filterInventory() {
  const query = document.getElementById('inventorySearchInput').value.toLowerCase().trim();
  const filter = document.getElementById('inventoryStockFilter').value;

  const filtered = STATE.inventory.filter(inv => {
    const p = inv.product || {};
    if (query) {
      const matchName = (p.name || '').toLowerCase().includes(query);
      const matchSku = (p.sku || '').toLowerCase().includes(query);
      if (!matchName && !matchSku) return false;
    }

    const onHand = inv.stock_on_hand || 0;
    const reserved = inv.reserved_quantity || 0;
    const available = inv.available_quantity !== undefined ? inv.available_quantity : Math.max(0, onHand - reserved);
    const threshold = inv.low_stock_threshold || 5;

    if (filter === 'low' && (available > threshold || available <= 0)) return false;
    if (filter === 'out' && available > 0 && inv.sales_enabled) return false;
    if (filter === 'reserved' && reserved === 0) return false;

    return true;
  });

  renderInventoryTable(filtered);
}

function openInventoryModal() {
  document.getElementById('inventoryForm').reset();
  document.getElementById('invCurrentOnHand').textContent = '--';
  document.getElementById('invCurrentReserved').textContent = '--';
  document.getElementById('invCurrentAvailable').textContent = '--';
  document.getElementById('inventoryModal').classList.add('active');
}

function openInventoryForProduct(productId) {
  openInventoryModal();
  document.getElementById('invAdjustProductId').value = productId;
  handleInvProductChange();
}

function closeInventoryModal() {
  document.getElementById('inventoryModal').classList.remove('active');
}

function handleInvProductChange() {
  const prodId = document.getElementById('invAdjustProductId').value;
  const inv = STATE.inventory.find(i => i.product_id === prodId);

  if (inv) {
    const onHand = inv.stock_on_hand || 0;
    const reserved = inv.reserved_quantity || 0;
    const available = inv.available_quantity !== undefined ? inv.available_quantity : Math.max(0, onHand - reserved);

    document.getElementById('invCurrentOnHand').textContent = onHand;
    document.getElementById('invCurrentReserved').textContent = reserved;
    document.getElementById('invCurrentAvailable').textContent = available;
  } else {
    document.getElementById('invCurrentOnHand').textContent = '--';
    document.getElementById('invCurrentReserved').textContent = '--';
    document.getElementById('invCurrentAvailable').textContent = '--';
  }
}

async function handleInventorySubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('saveInventoryBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> <span>Saving...</span>';

  try {
    const productId = document.getElementById('invAdjustProductId').value;
    const movementType = document.getElementById('invMovementType').value;
    const quantityChange = parseInt(document.getElementById('invQuantityChange').value, 10);
    const reason = document.getElementById('invReason').value.trim();

    if (!productId || isNaN(quantityChange) || !reason) {
      showToast('Please fill all required adjustment fields.', 'warning');
      return;
    }

    // Call adjust_inventory atomic RPC
    const { data, error } = await supabaseClient.rpc('adjust_inventory', {
      p_product_id: productId,
      p_quantity_change: quantityChange,
      p_movement_type: movementType,
      p_reason: reason
    });

    if (error) throw error;

    showToast(`Inventory adjustment committed! New stock: ${data.stock_after}`, 'success');
    logActivity('ADJUST_INVENTORY', 'inventory', productId, { movementType, quantityChange, reason });

    closeInventoryModal();
    await loadInventory();
    await loadProducts();
    updateDashboardKPIs();
  } catch (err) {
    console.error('Inventory adjustment error:', err);
    showToast(err.message || 'Failed to commit inventory adjustment', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="ph-bold ph-check"></i> <span>Commit Adjustment</span>';
  }
}

async function toggleSalesEnabled(productId, enabled) {
  try {
    const { error } = await supabaseClient
      .from('inventory')
      .update({ sales_enabled: enabled })
      .eq('product_id', productId);

    if (error) throw error;
    showToast(`Checkout ${enabled ? 'resumed' : 'paused'} for item`, 'info');
    await loadInventory();
    await loadProducts();
    updateDashboardKPIs();
  } catch (err) {
    console.error('Error toggling checkout availability:', err);
    showToast('Failed to update checkout availability', 'error');
  }
}

// ==========================================
// 8. ORDERS & RESERVATIONS
// ==========================================

function renderReservationsTable() {
  const tbody = document.getElementById('reservationsTableBody');
  if (!STATE.reservations.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">No active reservations.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.reservations.map(res => {
    const items = res.items || [];
    const itemsSummary = items.map(i => `${i.quantity}x ${escapeHtml(i.sku_snapshot)}`).join(', ');
    const isPending = res.status === 'PENDING';

    return `
      <tr>
        <td><code>${escapeHtml(res.order_id)}</code></td>
        <td>
          <span class="badge badge-${res.status === 'CONFIRMED' ? 'published' : (res.status === 'PENDING' ? 'low-stock' : 'archived')}">
            ${res.status}
          </span>
        </td>
        <td style="font-size: 0.82rem;">${new Date(res.created_at).toLocaleTimeString()}</td>
        <td style="font-size: 0.82rem;">${new Date(res.expires_at).toLocaleTimeString()}</td>
        <td style="font-size: 0.85rem;">${itemsSummary || '--'}</td>
        <td style="text-align: right;">
          ${isPending ? `
            <button class="btn btn-secondary btn-sm" onclick="releaseReservation('${res.order_id}')" title="Release held stock">
              Release Hold
            </button>
          ` : `<span></span>`}
        </td>
      </tr>
    `;
  }).join('');
}

async function releaseReservation(orderId) {
  if (confirm(`Are you sure you want to release the held stock reservation for ${orderId}?`)) {
    try {
      const { data, error } = await supabaseClient.rpc('release_reservation', {
        p_order_id: orderId,
        p_reason: 'Admin manual release from dashboard'
      });

      if (error) throw error;
      showToast(`Reservation for order ${orderId} released!`, 'success');
      await loadReservations();
      await loadInventory();
      await loadProducts();
      updateDashboardKPIs();
    } catch (err) {
      console.error('Error releasing reservation:', err);
      showToast(err.message || 'Failed to release reservation', 'error');
    }
  }
}

// ==========================================
// 9. CATEGORIES, TEAM & AUDIT
// ==========================================

function renderCategoriesTable() {
  const tbody = document.getElementById('categoriesTableBody');
  if (!STATE.categories.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No categories defined.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.categories.map(cat => `
    <tr>
      <td><strong>${cat.sort_order}</strong></td>
      <td><strong>${escapeHtml(cat.name)}</strong></td>
      <td><code>${escapeHtml(cat.slug)}</code></td>
      <td>${escapeHtml(cat.description || '--')}</td>
      <td>
        <span class="badge badge-${cat.is_active ? 'published' : 'draft'}">
          ${cat.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
    </tr>
  `).join('');
}

function renderAdminsTable() {
  const tbody = document.getElementById('adminsTableBody');
  if (!STATE.admins.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No team profiles found.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.admins.map(adm => `
    <tr>
      <td><strong>${escapeHtml(adm.full_name || '--')}</strong></td>
      <td>${escapeHtml(adm.email)}</td>
      <td>
        <span class="badge" style="background:#d1fae5; color:#064e3b; font-weight:700;">
          ${escapeHtml(adm.role)}
        </span>
      </td>
      <td>
        <span class="badge badge-${adm.is_active ? 'published' : 'archived'}">
          ${adm.is_active ? 'Active' : 'Deactivated'}
        </span>
      </td>
      <td style="font-size: 0.82rem; color: var(--text-muted);">${new Date(adm.created_at).toLocaleDateString()}</td>
    </tr>
  `).join('');
}

function renderActivityLogsTable() {
  const tbody = document.getElementById('activityLogsTableBody');
  if (!STATE.activityLogs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No audit logs yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = STATE.activityLogs.map(log => `
    <tr>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(log.timestamp).toLocaleString()}</td>
      <td>${escapeHtml(log.admin_email || 'System')}</td>
      <td><span class="badge" style="background:#f1f5f9; color:#1e293b;">${escapeHtml(log.action)}</span></td>
      <td>${escapeHtml(log.entity_type || '--')}</td>
      <td><code>${escapeHtml(log.entity_id || '--')}</code></td>
    </tr>
  `).join('');
}

function openAdminModal() {
  document.getElementById('adminForm').reset();
  document.getElementById('adminModal').classList.add('active');
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('active');
}

async function handleAdminSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('saveAdminBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner"></span> <span>Creating...</span>';

  try {
    const fullName = document.getElementById('adminNewName').value.trim();
    const email = document.getElementById('adminNewEmail').value.trim();
    const password = document.getElementById('adminNewPassword').value;
    const role = document.getElementById('adminNewRole').value;

    const { data, error } = await supabaseClient.rpc('create_admin_user', {
      p_email: email,
      p_password: password,
      p_full_name: fullName,
      p_role: role
    });

    if (error) throw error;

    showToast(`Team member ${fullName} (${role}) created successfully!`, 'success');
    closeAdminModal();
    await loadAdmins();
    await loadActivityLogs();
  } catch (err) {
    console.error('Error creating admin user:', err);
    showToast(err.message || 'Failed to create team member', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="ph-bold ph-user-plus"></i> <span>Create Account</span>';
  }
}

// ==========================================
// 10. UTILITIES & HELPERS
// ==========================================

function populateCategoryDropdowns() {
  const formCat = document.getElementById('formCategory');
  const filterCat = document.getElementById('productCategoryFilter');

  if (formCat) {
    formCat.innerHTML = '<option value="">Select Category</option>' + 
      STATE.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  if (filterCat) {
    filterCat.innerHTML = '<option value="">All Categories</option>' + 
      STATE.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }
}

function populateInventoryModalDropdown() {
  const select = document.getElementById('invAdjustProductId');
  if (!select) return;

  select.innerHTML = '<option value="">Select a product...</option>' + 
    STATE.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.sku)})</option>`).join('');
}

function getStockStatus(available, threshold, salesEnabled) {
  if (!salesEnabled || available <= 0) {
    return { key: 'out-of-stock', label: 'Out of Stock' };
  }
  if (available <= threshold) {
    return { key: 'low-stock', label: 'Low Stock' };
  }
  return { key: 'in-stock', label: 'In Stock' };
}

function getPrimaryImageUrl(product) {
  if (product.images && product.images.length) {
    const primary = product.images.find(img => img.is_primary) || product.images[0];
    return primary.card_url || primary.detail_url || primary.thumbnail_url;
  }
  return 'assets/images/pb-black.jpg';
}

function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function logActivity(action, entityType, entityId, newValues) {
  if (!STATE.currentUser) return;
  try {
    await supabaseClient.from('admin_activity_logs').insert([{
      administrator_id: STATE.currentUser.id,
      admin_email: STATE.currentUser.email,
      action,
      entity_type: entityType,
      entity_id: String(entityId),
      new_values: newValues
    }]);
  } catch (e) {
    console.warn('Logging activity failed:', e);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'ph-check-circle',
    error: 'ph-x-circle',
    warning: 'ph-warning',
    info: 'ph-info'
  };

  toast.innerHTML = `
    <i class="ph-bold ${iconMap[type] || 'ph-info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
