/**
 * VoltEdge - Live Catalogue & Real-Time Inventory Synchronizer
 * Bridges Supabase database with the live storefront with graceful fallback.
 * Loads configuration dynamically from /api/config (backed by .env).
 */

(function() {
  const SYNC_STATE = {
    isSynced: false,
    lastSyncTime: null,
    error: null
  };

  /**
   * Fetches client configuration dynamically from serverless environment
   */
  async function getClientConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.supabaseUrl && cfg.supabaseAnonKey) {
          return cfg;
        }
      }
    } catch (e) {
      // Local offline mode or direct file opening
    }
    return null;
  }

  /**
   * Fetches published products and categories from Supabase via PostgREST
   */
  async function fetchLiveCatalogue() {
    const config = await getClientConfig();
    if (!config) {
      console.info('[VoltEdge Sync] Config endpoint not available. Using high-speed local catalogue cache.');
      return false;
    }

    const endpoint = `${config.supabaseUrl}/rest/v1/products?select=*,category:categories(id,slug,name),inventory(stock_on_hand,reserved_quantity,available_quantity,low_stock_threshold,sales_enabled),images:product_images(thumbnail_url,card_url,detail_url,is_primary,display_order)&is_published=eq.true&publication_status=eq.PUBLISHED&order=sort_order.asc`;
    const catEndpoint = `${config.supabaseUrl}/rest/v1/categories?is_active=eq.true&order=sort_order.asc`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

    try {
      const headers = {
        'apikey': config.supabaseAnonKey,
        'Authorization': `Bearer ${config.supabaseAnonKey}`,
        'Accept': 'application/json'
      };

      const [prodRes, catRes] = await Promise.all([
        fetch(endpoint, { method: 'GET', headers, signal: controller.signal }),
        fetch(catEndpoint, { method: 'GET', headers, signal: controller.signal }).catch(err => {
          console.warn('[VoltEdge Sync] Categories query warning:', err);
          return null;
        })
      ]);

      clearTimeout(timeoutId);

      if (catRes && catRes.ok) {
        try {
          const categories = await catRes.json();
          if (Array.isArray(categories) && categories.length) {
            window.CATEGORIES_DATA = categories;
          }
        } catch (e) {
          console.warn('[VoltEdge Sync] Failed parsing categories response:', e);
        }
      }

      if (!prodRes.ok) {
        throw new Error(`Supabase HTTP ${prodRes.status}: ${prodRes.statusText}`);
      }

      const products = await prodRes.json();
      if (!Array.isArray(products) || !products.length) {
        console.warn('[VoltEdge Sync] Empty catalogue returned from Supabase. Retaining fallback data.');
        return false;
      }

      applyLiveCatalogue(products);
      SYNC_STATE.isSynced = true;
      SYNC_STATE.lastSyncTime = new Date();
      return true;
    } catch (err) {
      clearTimeout(timeoutId);
      SYNC_STATE.error = err.message;
      console.info('[VoltEdge Sync] Live catalogue sync deferred (using high-speed local cache):', err.message);
      return false;
    }
  }

  /**
   * Merges Supabase products with the storefront data structures
   */
  function applyLiveCatalogue(supabaseProducts) {
    const coreProducts = [];
    const creatorAccessories = [];

    supabaseProducts.forEach(sp => {
      const cat = sp.category || {};
      const inv = sp.inventory || {};
      const onHand = inv.stock_on_hand || 0;
      const reserved = inv.reserved_quantity || 0;
      const available = inv.available_quantity !== undefined ? inv.available_quantity : Math.max(0, onHand - reserved);
      const threshold = inv.low_stock_threshold || 5;
      const salesEnabled = inv.sales_enabled !== false;

      // In stock determination
      const inStock = available > 0 && salesEnabled;

      // Primary image selection & multi-image collection
      let primaryImage = null;
      let allImages = [];
      if (Array.isArray(sp.images) && sp.images.length) {
        const sorted = [...sp.images].sort((a, b) => {
          if (b.is_primary !== a.is_primary) return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0);
          return (a.display_order || 0) - (b.display_order || 0);
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

      // Check if creator accessory (category 'accessories' or price 0)
      if (cat.slug === 'accessories' || Number(sp.price) === 0) {
        creatorAccessories.push({
          id: sp.slug,
          sku: sp.sku,
          title: sp.name,
          subtitle: sp.short_name || sp.short_description || '',
          description: sp.description || sp.tagline || '',
          status: inStock ? (sp.badge || 'Available by Enquiry / Pre-order') : 'Temporarily Unavailable',
          image: accImg,
          images: accImages,
          features: Array.isArray(sp.features) ? sp.features : (Array.isArray(sp.bullets) ? sp.bullets : []),
          inStock: inStock
        });
      } else {
        // Core Product
        coreProducts.push({
          id: sp.slug,
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
          availableQuantity: available,
          lowStockThreshold: threshold,
          salesEnabled: salesEnabled,
          isLowStock: inStock && available <= threshold,
          tagline: sp.tagline || sp.short_description || '',
          bullets: Array.isArray(sp.bullets) ? sp.bullets : [],
          technicalSpecs: typeof sp.technical_specs === 'object' && sp.technical_specs !== null ? sp.technical_specs : {}
        });
      }
    });

    if (coreProducts.length) {
      window.PRODUCTS_DATA = coreProducts;
    }

    if (creatorAccessories.length) {
      window.CREATOR_ACCESSORIES = creatorAccessories;
    }

    // Trigger UI updates on the page if functions are present
    if (typeof window.renderProducts === 'function') {
      try {
        const cat = typeof window.currentCatalogCategory !== 'undefined' ? window.currentCatalogCategory : 'all';
        const q = typeof window.currentCatalogSearchQuery !== 'undefined' ? window.currentCatalogSearchQuery : '';
        window.renderProducts(cat, q);
      } catch (e) {
        console.warn('[VoltEdge Sync] Re-render products error:', e);
      }
    }

    if (typeof window.renderAccessories === 'function') {
      try {
        window.renderAccessories();
      } catch (e) {
        console.warn('[VoltEdge Sync] Re-render accessories error:', e);
      }
    }

    // Dispatch global event for listeners
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('voltedge:catalog-synced', {
        detail: {
          productsCount: coreProducts.length,
          accessoriesCount: creatorAccessories.length,
          timestamp: new Date()
        }
      }));
    }
  }

  // Auto-run sync on page load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        fetchLiveCatalogue();
      });
    } else {
      fetchLiveCatalogue();
    }
  }

  // Export helper
  window.VoltEdgeSync = {
    fetchLiveCatalogue,
    getState: () => ({ ...SYNC_STATE })
  };
})();
