/**
 * VoltEdge - Live Catalogue & Real-Time Inventory Synchronizer
 * Bridges Supabase authoritative database with the storefront with automatic offline/fallback snapshot.
 * Preserves all storefront aesthetics, Quick View, cart, and multi-product checkout.
 */

(function(window, document) {
  'use strict';

  const SNAPSHOT_STORAGE_KEY = 'voltedge_catalogue_snapshot';
  const CONFIG_CACHE_KEY = 'voltedge_client_config';

  // Default publishable development credentials (safe for public client access)
  const DEFAULT_CONFIG = {
    supabaseUrl: 'https://ohqlojvwczzealcnmbcs.supabase.co',
    supabaseAnonKey: 'sb_publishable_IqpW1FGzJML7je2Oy91iYg_chGTSJn5'
  };

  const SYNC_STATE = {
    isSynced: false,
    isFallback: false,
    lastSyncTime: null,
    error: null,
    retryTimer: null
  };

  /**
   * Fetches client configuration dynamically from serverless environment or uses cached/default config
   */
  async function getClientConfig() {
    try {
      const res = await fetch('/api/config', { cache: 'no-cache' });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.supabaseUrl && cfg.supabaseAnonKey) {
          try {
            localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(cfg));
          } catch (e) {}
          return cfg;
        }
      }
    } catch (e) {
      // Local offline mode or direct file opening
    }

    try {
      const cached = localStorage.getItem(CONFIG_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.supabaseUrl && parsed.supabaseAnonKey) return parsed;
      }
    } catch (e) {}

    return DEFAULT_CONFIG;
  }

  /**
   * Maintains automatic last-known-good catalogue snapshot in localStorage
   */
  function saveSnapshot(products, categories) {
    try {
      const snapshot = {
        timestamp: Date.now(),
        products: products,
        categories: categories,
        version: '2.0'
      };
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[VoltEdge Sync] Could not save snapshot to localStorage:', e);
    }
  }

  /**
   * Retrieves automatic last-known-good snapshot
   */
  function getSnapshot() {
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.products) && parsed.products.length > 0) {
        return parsed;
      }
    } catch (e) {
      console.warn('[VoltEdge Sync] Error reading snapshot:', e);
    }
    return null;
  }

  /**
   * Displays or hides the offline/fallback indicator banner
   */
  function updateFallbackUI(isFallback, reason) {
    let banner = document.getElementById('catalog-fallback-banner');
    
    if (isFallback) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'catalog-fallback-banner';
        banner.className = 'catalog-fallback-banner';
        banner.innerHTML = `
          <div class="container fallback-banner-content" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <i class="ph-bold ph-cloud-slash" style="font-size: 1.25rem; color: #f59e0b;"></i>
              <span style="font-size: 0.88rem; font-weight: 600;">
                Offline Snapshot Active &bull; Displaying cached product catalogue. Live inventory verification and online checkout are temporarily paused.
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <button type="button" onclick="window.VoltEdgeSync.fetchLiveCatalogue()" class="btn btn-sm" style="padding: 0.35rem 0.85rem; font-size: 0.8rem; background: #ffffff; color: #1e293b; border: 1px solid #cbd5e1; border-radius: 9999px; cursor: pointer; font-weight: 700;">
                <i class="ph-bold ph-arrows-clockwise"></i> Reconnect
              </button>
              <a href="https://wa.me/2347047922403" target="_blank" rel="noopener noreferrer" style="font-size: 0.82rem; color: inherit; text-decoration: underline; font-weight: 700;">
                Order on WhatsApp &rarr;
              </a>
            </div>
          </div>
        `;
        banner.style.cssText = 'background: #fffbeb; color: #92400e; border-bottom: 1px solid #fde68a; padding: 0.65rem 1rem; position: sticky; top: 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.04);';
        
        const header = document.getElementById('site-header') || document.querySelector('header');
        if (header && header.parentNode) {
          header.parentNode.insertBefore(banner, header.nextSibling);
        } else {
          document.body.prepend(banner);
        }
      } else {
        banner.style.display = 'block';
      }
    } else if (banner) {
      banner.style.display = 'none';
    }

    window.IS_FALLBACK_MODE = isFallback;
  }

  /**
   * Fetches published products and active categories from Supabase PostgREST
   */
  async function fetchLiveCatalogue() {
    const config = await getClientConfig();
    const endpoint = `${config.supabaseUrl}/rest/v1/products?select=*,category:categories(id,slug,name),inventory(stock_on_hand,reserved_quantity,available_quantity,low_stock_threshold,sales_enabled),images:product_images(thumbnail_url,card_url,detail_url,is_primary,display_order)&is_published=eq.true&publication_status=eq.PUBLISHED&order=sort_order.asc`;
    const catEndpoint = `${config.supabaseUrl}/rest/v1/categories?is_active=eq.true&order=sort_order.asc`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s network timeout

    try {
      const headers = {
        'apikey': config.supabaseAnonKey,
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
        'Accept': 'application/json'
      };

      const [prodRes, catRes] = await Promise.all([
        fetch(endpoint, { method: 'GET', headers, signal: controller.signal }),
        fetch(catEndpoint, { method: 'GET', headers, signal: controller.signal }).catch(() => null)
      ]);

      clearTimeout(timeoutId);

      let categories = [];
      if (catRes && catRes.ok) {
        try {
          categories = await catRes.json();
          if (Array.isArray(categories) && categories.length) {
            window.CATEGORIES_DATA = categories;
          }
        } catch (e) {}
      }

      if (!prodRes.ok) {
        throw new Error(`Supabase HTTP ${prodRes.status}: ${prodRes.statusText}`);
      }

      const products = await prodRes.json();
      if (!Array.isArray(products) || !products.length) {
        throw new Error('Empty catalogue received from Supabase');
      }

      // Live success: Apply live catalogue & update snapshot
      applyLiveCatalogue(products, false);
      saveSnapshot(products, categories);

      SYNC_STATE.isSynced = true;
      SYNC_STATE.isFallback = false;
      SYNC_STATE.lastSyncTime = new Date();
      SYNC_STATE.error = null;

      updateFallbackUI(false);
      return true;
    } catch (err) {
      clearTimeout(timeoutId);
      SYNC_STATE.error = err.message;
      console.warn('[VoltEdge Sync] Live fetch failed, activating automatic read-only fallback:', err.message);

      // Controlled fallback: use automatic snapshot or bundled products.js
      const snapshot = getSnapshot();
      if (snapshot && Array.isArray(snapshot.products) && snapshot.products.length) {
        console.info(`[VoltEdge Sync] Activated cached snapshot from ${new Date(snapshot.timestamp).toLocaleString()}`);
        if (Array.isArray(snapshot.categories) && snapshot.categories.length) {
          window.CATEGORIES_DATA = snapshot.categories;
        }
        applyLiveCatalogue(snapshot.products, true);
      } else if (typeof window.PRODUCTS_DATA !== 'undefined' && Array.isArray(window.PRODUCTS_DATA)) {
        console.info('[VoltEdge Sync] Fallback to bundled products definition.');
      }

      SYNC_STATE.isSynced = false;
      SYNC_STATE.isFallback = true;
      updateFallbackUI(true, err.message);

      // Schedule reconnection attempt
      scheduleReconnect();
      return false;
    }
  }

  function scheduleReconnect() {
    if (SYNC_STATE.retryTimer) clearTimeout(SYNC_STATE.retryTimer);
    SYNC_STATE.retryTimer = setTimeout(() => {
      fetchLiveCatalogue();
    }, 20000); // Retry every 20 seconds
  }

  /**
   * Merges Supabase products with storefront data structures
   */
  function applyLiveCatalogue(supabaseProducts, isFallback) {
    const coreProducts = [];
    const creatorAccessories = [];

    supabaseProducts.forEach(sp => {
      const cat = sp.category || {};
      const inv = sp.inventory || {};
      const onHand = Number(inv.stock_on_hand) || 0;
      const reserved = Number(inv.reserved_quantity) || 0;
      const available = inv.available_quantity !== undefined 
        ? Number(inv.available_quantity) 
        : Math.max(0, onHand - reserved);
      const threshold = Number(inv.low_stock_threshold) || 5;
      const salesEnabled = inv.sales_enabled !== false;

      // In-stock determination (authoritative stock check)
      const inStock = !isFallback && available > 0 && salesEnabled;

      // Primary image selection & multi-image collection
      let primaryImage = null;
      let allImages = [];
      if (Array.isArray(sp.images) && sp.images.length) {
        const sorted = [...sp.images].sort((a, b) => {
          if (b.is_primary !== a.is_primary) return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0);
          return (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
        });
        primaryImage = sorted[0].card_url || sorted[0].detail_url || sorted[0].thumbnail_url;
        allImages = sorted.map(img => img.detail_url || img.card_url || img.thumbnail_url).filter(Boolean);
      }

      const defaultCoreImg = 'assets/images/pb-black.jpg';
      const defaultAccImg = 'assets/images/bundle-wfh.jpg';
      const coreImg = primaryImage || defaultCoreImg;
      const coreImages = allImages.length ? allImages : [coreImg];
      const accImg = primaryImage || defaultAccImg;
      const accImages = allImages.length ? allImages : [accImg];

      // Format bullets and specs
      const bullets = Array.isArray(sp.bullets) && sp.bullets.length 
        ? sp.bullets 
        : (Array.isArray(sp.features) ? sp.features : []);
      const technicalSpecs = typeof sp.technical_specs === 'object' && sp.technical_specs !== null 
        ? sp.technical_specs 
        : {};

      if (cat.slug === 'accessories' || Number(sp.price) === 0) {
        // Creator Accessory
        creatorAccessories.push({
          id: sp.slug,
          uuid: sp.id,
          sku: sp.sku,
          title: sp.name,
          subtitle: sp.short_name || sp.short_description || '',
          description: sp.description || sp.tagline || '',
          status: inStock ? (sp.badge || 'Available by Enquiry / Pre-order') : 'Temporarily Unavailable',
          image: accImg,
          images: accImages,
          features: bullets,
          inStock: inStock
        });
      } else {
        // Core Product
        coreProducts.push({
          id: sp.slug,
          uuid: sp.id,
          sku: sp.sku,
          name: sp.name,
          shortName: sp.short_name || sp.name,
          category: cat.slug || 'powerbanks',
          categoryLabel: cat.name || 'Equipment',
          price: Number(sp.price),
          compareAtPrice: sp.compare_at_price ? Number(sp.compare_at_price) : null,
          badge: sp.badge || '',
          badgeType: sp.badge_type || 'accent',
          rating: Number(sp.rating) || 5.0,
          reviewsCount: Number(sp.reviews_count) || 20,
          image: coreImg,
          images: coreImages,
          specsHighlight: sp.specs_highlight || '',
          warranty: sp.warranty || '1-Year Product Warranty',
          dispatchBadge: sp.dispatch_badge || 'Same-Day Dispatch Eligible',
          finish: sp.finish || '',
          inStock: inStock,
          availableQuantity: isFallback ? 0 : available,
          lowStockThreshold: threshold,
          salesEnabled: salesEnabled,
          isLowStock: inStock && available <= threshold,
          tagline: sp.tagline || sp.short_description || '',
          bullets: bullets,
          technicalSpecs: technicalSpecs,
          isFallbackData: isFallback
        });
      }
    });

    if (coreProducts.length) {
      window.PRODUCTS_DATA = coreProducts;
    }

    if (creatorAccessories.length) {
      window.CREATOR_ACCESSORIES = creatorAccessories;
    }

    // Trigger UI re-rendering across active storefront views
    updateStorefrontViews(coreProducts, creatorAccessories);

    // Sync individual product detail page if active
    updateProductDetailPage(coreProducts);

    // Revalidate cart items with live database prices and stock availability
    if (window.VoltEdgeCart && typeof window.VoltEdgeCart.revalidateCart === 'function') {
      window.VoltEdgeCart.revalidateCart();
    } else if (window.VoltEdgeCart && typeof window.VoltEdgeCart.updateBadges === 'function') {
      window.VoltEdgeCart.updateBadges();
      window.VoltEdgeCart.renderDrawer();
    }

    // Dispatch global event for other components
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('voltedge:catalog-synced', {
        detail: {
          productsCount: coreProducts.length,
          accessoriesCount: creatorAccessories.length,
          isFallback: isFallback,
          timestamp: new Date()
        }
      }));
    }
  }

  /**
   * Refreshes storefront category tabs and product grid
   */
  function updateStorefrontViews(coreProducts, creatorAccessories) {
    if (typeof window.renderFilterTabs === 'function') {
      try { window.renderFilterTabs(); } catch (e) {}
    }

    if (typeof window.renderProducts === 'function') {
      try {
        const cat = typeof window.currentCatalogCategory !== 'undefined' ? window.currentCatalogCategory : 'all';
        const q = typeof window.currentCatalogSearchQuery !== 'undefined' ? window.currentCatalogSearchQuery : '';
        window.renderProducts(cat, q);
      } catch (e) {}
    }

    if (typeof window.renderAccessories === 'function') {
      try { window.renderAccessories(); } catch (e) {}
    }

    // Refresh checkout display if on checkout page
    if (typeof window.renderCheckoutDisplay === 'function') {
      try { window.renderCheckoutDisplay(); } catch (e) {}
    }
  }

  /**
   * Dynamically synchronizes Product Detail Page (/products/<slug>/) with authoritative Supabase data
   */
  function updateProductDetailPage(products) {
    if (typeof window === 'undefined' || !window.location.pathname.includes('/products/')) return;

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const slugIdx = pathSegments.indexOf('products');
    if (slugIdx === -1 || !pathSegments[slugIdx + 1]) return;

    const currentSlug = pathSegments[slugIdx + 1].toLowerCase();
    const product = products.find(p => p.id.toLowerCase() === currentSlug || p.sku.toLowerCase() === currentSlug);
    if (!product) return;

    // 1. Update Price
    const priceEl = document.querySelector('.pdp-price');
    if (priceEl) {
      priceEl.textContent = '₦' + Number(product.price).toLocaleString('en-NG');
    }

    // 2. Update Warranty
    const badgeEl = document.querySelector('.pdp-badge');
    if (badgeEl && product.warranty) {
      badgeEl.innerHTML = `<i class="ph-fill ph-shield-check"></i> ${product.warranty}`;
    }

    // 3. Update Title & SKU
    const titleEl = document.querySelector('.pdp-title');
    if (titleEl && product.name) titleEl.textContent = product.name;

    // 4. Update Tagline
    const tagEl = document.querySelector('.pdp-tagline');
    if (tagEl && product.tagline) tagEl.textContent = product.tagline;

    // 5. Update Add to Cart Button based on real stock
    const addBtn = document.querySelector('.pdp-btn-add');
    if (addBtn) {
      if (product.inStock === false || (product.availableQuantity !== undefined && product.availableQuantity <= 0)) {
        addBtn.disabled = true;
        addBtn.classList.add('btn-disabled', 'btn-out-of-stock');
        addBtn.style.opacity = '0.6';
        addBtn.style.cursor = 'not-allowed';
        addBtn.innerHTML = '<i class="ph-bold ph-prohibit"></i> Out of Stock';
      } else {
        addBtn.disabled = false;
        addBtn.classList.remove('btn-disabled', 'btn-out-of-stock');
        addBtn.style.opacity = '1';
        addBtn.style.cursor = 'pointer';
        addBtn.innerHTML = `<i class="ph-bold ph-shopping-bag"></i> Add to Cart • ₦${Number(product.price).toLocaleString('en-NG')}`;
      }
    }
  }

  // Periodic real-time inventory poll (every 30 seconds)
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchLiveCatalogue();
    }
  }, 30000);

  // Re-fetch when user switches back to browser tab or reconnects to network
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fetchLiveCatalogue();
    });
    window.addEventListener('online', () => {
      console.log('[VoltEdge Sync] Network online restored. Syncing with Supabase...');
      fetchLiveCatalogue();
    });
  }

  // Auto-run on page initialization
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fetchLiveCatalogue);
    } else {
      fetchLiveCatalogue();
    }
  }

  // Expose global controller
  window.VoltEdgeSync = {
    fetchLiveCatalogue,
    getState: () => ({ ...SYNC_STATE }),
    getSnapshot
  };

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
