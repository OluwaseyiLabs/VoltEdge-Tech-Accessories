// VoltEdge Tech & Accessories - Modular Multi-Product Shopping Cart System
// Provides client-side cart management, live persistence in localStorage,
// price validation against trusted catalogue, drawer UI rendering, inline customer delivery form,
// and direct webhook order submission from within the Add to Cart panel.

(function (window) {
  'use strict';

  const STORAGE_KEY = 'voltedge_cart';

  // Helper to obtain catalog data safely
  function getCatalog() {
    if (typeof window !== 'undefined' && Array.isArray(window.PRODUCTS_DATA) && window.PRODUCTS_DATA.length) {
      return window.PRODUCTS_DATA;
    }
    if (typeof PRODUCTS_DATA !== 'undefined' && Array.isArray(PRODUCTS_DATA) && PRODUCTS_DATA.length) {
      return PRODUCTS_DATA;
    }
    return [];
  }

  function formatNaira(amount) {
    if (amount === undefined || amount === null || isNaN(amount)) return '₦0';
    return '₦' + Number(amount).toLocaleString('en-NG');
  }

  // Input Sanitization Utilities
  function sanitizeInput(str, maxLen = 255) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/<[^>]*>?/gm, '')
      .replace(/javascript:/gi, '')
      .replace(/\bon\w+\s*=/gi, '')
      .trim()
      .slice(0, maxLen);
  }

  function sanitizeEmail(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/<[^>]*>?/gm, '')
      .replace(/[\s"'\\]/g, '')
      .trim()
      .slice(0, 120);
  }

  function sanitizePhone(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/[^0-9+\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 25);
  }

  const FRIENDLY_ERROR_HTML = 'An error occurred, please try again later or <a href="https://wa.me/2347047922403" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; font-weight: 700;">contact us on WhatsApp</a>.';
  const FRIENDLY_ERROR_PLAIN = 'An error occurred, please try again later or contact us on WhatsApp.';

  function formatFriendlyErrorMessage(rawMsg) {
    if (!rawMsg || typeof rawMsg !== 'string') return FRIENDLY_ERROR_HTML;
    const lower = rawMsg.toLowerCase();
    if (
      lower.includes('workflow') ||
      lower.includes('n8n') ||
      lower.includes('node') ||
      lower.includes('gateway') ||
      lower.includes('proxy') ||
      lower.includes('server error') ||
      lower.includes('internal error') ||
      lower.includes('aborted') ||
      lower.includes('failed to fetch') ||
      lower.includes('network') ||
      lower.includes('500') ||
      lower.includes('502') ||
      lower.includes('503') ||
      lower.includes('504') ||
      lower.includes('error in') ||
      lower.includes('loading') ||
      lower === 'error'
    ) {
      return FRIENDLY_ERROR_HTML;
    }
    return rawMsg;
  }

  const VoltEdgeCart = {
    isSubmitting: false,

    // Read cart from localStorage
    getCart: function () {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const items = JSON.parse(raw);
        if (!Array.isArray(items)) return [];
        
        // Re-validate each item against current catalog to ensure authentic pricing
        const catalog = getCatalog();
        if (!catalog.length) return items;

        return items.map(item => {
          const match = catalog.find(p => 
            (item.id && p.id && p.id.toLowerCase() === item.id.toLowerCase()) ||
            (item.sku && p.sku && p.sku.toLowerCase() === item.sku.toLowerCase())
          );
          if (match) {
            return {
              id: match.id,
              sku: match.sku,
              name: match.name,
              shortName: match.shortName || match.name,
              price: match.price, // Trusted price
              image: match.image,
              quantity: Math.max(1, Math.min(50, parseInt(item.quantity, 10) || 1))
            };
          }
          return item;
        }).filter(item => item && item.quantity > 0);
      } catch (e) {
        console.warn('[VoltEdge Cart] Error reading cart from storage:', e);
        return [];
      }
    },

    // Save cart to localStorage and notify listeners
    saveCart: function (items) {
      try {
        const validItems = items.filter(i => i && i.quantity > 0);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(validItems));
      } catch (e) {
        console.warn('[VoltEdge Cart] Error saving cart:', e);
      }
      this.updateBadges();
      this.renderDrawer();
      window.dispatchEvent(new CustomEvent('voltedge:cart-updated', { detail: { cart: items } }));
    },

    // Add item to cart
    addItem: function (productIdOrSku, quantity = 1, openDrawerAfter = false) {
      const catalog = getCatalog();
      const product = catalog.find(p => 
        (p.id && p.id.toLowerCase() === String(productIdOrSku).toLowerCase()) ||
        (p.sku && p.sku.toLowerCase() === String(productIdOrSku).toLowerCase())
      );

      if (!product) {
        console.warn(`[VoltEdge Cart] Product not found in catalog: "${productIdOrSku}"`);
        return false;
      }

      const qtyToAdd = Math.max(1, parseInt(quantity, 10) || 1);
      const cart = this.getCart();
      const existing = cart.find(item => 
        (item.sku && product.sku && item.sku.toLowerCase() === product.sku.toLowerCase()) ||
        (item.id && product.id && item.id.toLowerCase() === product.id.toLowerCase())
      );

      if (existing) {
        existing.quantity = Math.min(50, existing.quantity + qtyToAdd);
      } else {
        cart.push({
          id: product.id,
          sku: product.sku,
          name: product.name,
          shortName: product.shortName || product.name,
          price: product.price,
          image: product.image,
          quantity: Math.min(50, qtyToAdd)
        });
      }

      this.saveCart(cart);

      if (typeof window.showToast === 'function') {
        window.showToast(`Added ${qtyToAdd}x ${product.shortName || product.name} to cart`, 'success');
      }

      if (openDrawerAfter) {
        this.openDrawer();
      }

      return true;
    },

    // Update quantity of specific item by SKU or ID
    updateQuantity: function (skuOrId, newQty) {
      const cart = this.getCart();
      const target = cart.find(i => 
        (i.sku && i.sku.toLowerCase() === String(skuOrId).toLowerCase()) ||
        (i.id && i.id.toLowerCase() === String(skuOrId).toLowerCase())
      );

      if (!target) return;

      const qty = parseInt(newQty, 10);
      if (isNaN(qty) || qty <= 0) {
        this.removeItem(skuOrId);
        return;
      }

      target.quantity = Math.min(50, qty);
      this.saveCart(cart);
    },

    // Remove single item by SKU or ID
    removeItem: function (skuOrId) {
      let cart = this.getCart();
      cart = cart.filter(i => 
        (i.sku && i.sku.toLowerCase() !== String(skuOrId).toLowerCase()) &&
        (i.id && i.id.toLowerCase() !== String(skuOrId).toLowerCase())
      );
      this.saveCart(cart);
    },

    // Clear entire cart
    clearCart: function () {
      this.saveCart([]);
    },

    // Total quantity of units across all items
    getTotalCount: function () {
      const cart = this.getCart();
      return cart.reduce((sum, item) => sum + (parseInt(item.quantity, 10) || 0), 0);
    },

    // Combined subtotal of all items in cart
    getSubtotal: function () {
      const cart = this.getCart();
      return cart.reduce((sum, item) => sum + ((Number(item.price) || 0) * (parseInt(item.quantity, 10) || 0)), 0);
    },

    // Update navigation badge counts across the page
    updateBadges: function () {
      const count = this.getTotalCount();
      const badges = document.querySelectorAll('.cart-badge-count, #nav-cart-count, #header-cart-count');
      badges.forEach(b => {
        b.textContent = count;
        if (count > 0) {
          b.style.display = 'inline-flex';
          b.classList.add('has-items');
        } else {
          b.style.display = 'none';
          b.classList.remove('has-items');
        }
      });
    },

    // Prepares the authoritative multi-product payload matching n8n & Google Sheets requirements
    getOrderPayloadData: function () {
      const cart = this.getCart();
      if (!cart.length) return null;

      const catalog = getCatalog();
      const products = cart.map(item => {
        const match = catalog.find(p => p.sku === item.sku || p.id === item.id) || item;
        const unitPrice = Number(match.price) || 0;
        const qty = Number(item.quantity) || 1;
        return {
          product_sku: item.sku || match.sku || 'VE-EQUIPMENT',
          product_name: item.name || match.name || 'VoltEdge Hardware',
          unit_price: unitPrice,
          quantity: qty,
          line_total: unitPrice * qty
        };
      });

      const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0);
      const subtotal = products.reduce((sum, p) => sum + p.line_total, 0);

      // Single vs Multiple product compatibility representations
      const isSingle = products.length === 1;
      const combinedSku = isSingle ? products[0].product_sku : 'MULTIPLE';
      const combinedName = isSingle 
        ? products[0].product_name 
        : products.map(p => `${p.product_name} x${p.quantity}`).join('; ');

      return {
        products: products,
        products_json: JSON.stringify(products),
        product_sku: combinedSku,
        product_SKU: combinedSku,
        product_name: combinedName,
        unit_price: subtotal, // merchandise subtotal for backward compatibility
        quantity: totalUnits, // total units across all items
        total_price: subtotal // + logistics confirmed upon dispatch
      };
    },

    // Open Cart Drawer
    openDrawer: function () {
      const drawer = document.getElementById('cart-drawer');
      const overlay = document.getElementById('cart-drawer-overlay');
      this.renderDrawer();
      if (drawer) {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
      }
      if (overlay) {
        overlay.classList.add('active');
      }
      document.body.style.overflow = 'hidden';
    },

    // Close Cart Drawer
    closeDrawer: function () {
      const drawer = document.getElementById('cart-drawer');
      const overlay = document.getElementById('cart-drawer-overlay');
      if (drawer) {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
      }
      if (overlay) {
        overlay.classList.remove('active');
      }
      document.body.style.overflow = '';
    },

    // Render Cart Drawer HTML
    renderDrawer: function () {
      const itemsContainer = document.getElementById('cart-drawer-items');
      const formWrap = document.getElementById('cart-drawer-form-wrap');
      const footerContainer = document.getElementById('cart-drawer-footer');
      const titleCount = document.getElementById('cart-drawer-count');
      if (!itemsContainer) return;

      const cart = this.getCart();
      const totalCount = this.getTotalCount();
      const subtotal = this.getSubtotal();

      if (titleCount) {
        titleCount.textContent = `(${totalCount} ${totalCount === 1 ? 'item' : 'items'})`;
      }

      if (cart.length === 0) {
        itemsContainer.innerHTML = `
          <div class="cart-empty-state">
            <div class="cart-empty-icon"><i class="ph ph-shopping-bag"></i></div>
            <h4 class="cart-empty-title">Your shopping cart is empty</h4>
            <p class="cart-empty-desc">Explore our high-performance power banks, UPS backups, and remote-work gear.</p>
            <a href="index.html#catalogue" class="btn btn-primary" onclick="VoltEdgeCart.closeDrawer()">
              <i class="ph ph-lightning"></i> Explore Catalogue
            </a>
          </div>
        `;
        if (formWrap) formWrap.style.display = 'none';
        if (footerContainer) footerContainer.style.display = 'none';
        return;
      }

      // Populated cart: show items, checkout form, and footer
      if (formWrap) formWrap.style.display = 'block';
      if (footerContainer) footerContainer.style.display = 'block';

      itemsContainer.innerHTML = cart.map(item => {
        const lineTotal = item.price * item.quantity;
        return `
          <div class="cart-item-row" data-sku="${item.sku}">
            <img src="${item.image || 'assets/images/pb-black.jpg'}" alt="${item.name}" class="cart-item-img">
            <div class="cart-item-info">
              <div class="cart-item-title">${item.name}</div>
              <div class="cart-item-sku">SKU: ${item.sku}</div>
              <div class="cart-item-price-unit">${formatNaira(item.price)} each</div>
              
              <div class="cart-item-actions">
                <div class="cart-qty-stepper">
                  <button type="button" class="cart-qty-btn" onclick="VoltEdgeCart.updateQuantity('${item.sku}', ${item.quantity - 1})" aria-label="Decrease">&minus;</button>
                  <span class="cart-qty-num">${item.quantity}</span>
                  <button type="button" class="cart-qty-btn" onclick="VoltEdgeCart.updateQuantity('${item.sku}', ${item.quantity + 1})" aria-label="Increase">&#43;</button>
                </div>
                <button type="button" class="cart-item-remove" onclick="VoltEdgeCart.removeItem('${item.sku}')" aria-label="Remove item">
                  <i class="ph ph-trash"></i>
                </button>
              </div>
            </div>
            <div class="cart-item-line-total">
              ${formatNaira(lineTotal)}
            </div>
          </div>
        `;
      }).join('');

      // Update footer amounts
      const subtotalEl = document.getElementById('cart-drawer-subtotal');
      const totalEl = document.getElementById('cart-drawer-total');
      if (subtotalEl) subtotalEl.textContent = formatNaira(subtotal);
      if (totalEl) totalEl.textContent = formatNaira(subtotal);

      // Restore previously saved customer details if input fields are blank
      try {
        const savedCustRaw = localStorage.getItem('voltedge_last_customer');
        if (savedCustRaw) {
          const sc = JSON.parse(savedCustRaw);
          const nameInput = document.getElementById('cart-cust-name');
          const phoneInput = document.getElementById('cart-cust-phone');
          const emailInput = document.getElementById('cart-cust-email');
          const stateSelect = document.getElementById('cart-cust-state');
          const addressInput = document.getElementById('cart-cust-address');

          if (nameInput && !nameInput.value && sc.fullName) nameInput.value = sc.fullName;
          if (phoneInput && !phoneInput.value && sc.phone) phoneInput.value = sc.phone;
          if (emailInput && !emailInput.value && sc.email) emailInput.value = sc.email;
          if (stateSelect && !stateSelect.value && sc.state) stateSelect.value = sc.state;
          if (addressInput && !addressInput.value && sc.address) addressInput.value = sc.address;
        }
      } catch (e) {}
    },

    // Open Terms & Conditions modal
    openTermsModal: function (e) {
      if (e) e.preventDefault();
      const termsModal = document.getElementById('terms-modal');
      if (termsModal) {
        termsModal.classList.add('active');
      } else {
        alert("VoltEdge Warranty & Order Terms:\n\n1. All hardware includes a 1-year official replacement warranty.\n2. Orders submitted are confirmed by warehouse prior to dispatch.\n3. Delivery across Lagos and all 36 States & FCT follows standard logistics schedules.");
      }
    },

    // Process Order Submission strictly within the Add to Cart Panel
    submitCartOrder: async function () {
      if (this.isSubmitting) return;

      const cart = this.getCart();
      if (!cart.length) {
        if (typeof window.showToast === 'function') {
          window.showToast('Your shopping cart is empty.', 'error');
        }
        return;
      }

      const nameInput = document.getElementById('cart-cust-name');
      const phoneInput = document.getElementById('cart-cust-phone');
      const emailInput = document.getElementById('cart-cust-email');
      const stateSelect = document.getElementById('cart-cust-state');
      const addressInput = document.getElementById('cart-cust-address');
      const notesInput = document.getElementById('cart-cust-notes');
      const termsCheckbox = document.getElementById('cart-terms-check');
      const termsBox = document.getElementById('cart-terms-box');
      const statusBanner = document.getElementById('cart-submit-status-banner');
      const checkoutBtn = document.getElementById('cart-drawer-checkout-btn');
      const btnText = document.getElementById('cart-checkout-btn-text');
      const btnIcon = document.getElementById('cart-checkout-btn-icon');

      function showError(msg, targetInput, isTerms = false) {
        const friendlyMsg = formatFriendlyErrorMessage(msg);
        if (statusBanner) {
          statusBanner.style.display = 'block';
          statusBanner.innerHTML = `
            <div style="background: #fef2f2; border: 1.5px solid #fca5a5; color: #991b1b; padding: 0.65rem 0.85rem; border-radius: 8px; font-size: 0.82rem; line-height: 1.4; display: flex; align-items: flex-start; gap: 0.45rem;">
              <i class="ph-bold ph-warning-circle" style="font-size: 1.15rem; color: #dc2626; flex-shrink: 0; margin-top: 0.1rem;"></i>
              <div>${friendlyMsg}</div>
            </div>`;
          statusBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (isTerms && termsBox) {
          termsBox.classList.add('error-flash');
          setTimeout(() => termsBox.classList.remove('error-flash'), 1200);
        }
        if (targetInput) {
          targetInput.focus();
        }
        if (typeof window.showToast === 'function') {
          const plainToastMsg = (friendlyMsg === FRIENDLY_ERROR_HTML) ? FRIENDLY_ERROR_PLAIN : msg;
          window.showToast(plainToastMsg, 'error');
        }
      }

      if (statusBanner) {
        statusBanner.style.display = 'none';
        statusBanner.innerHTML = '';
      }

      const name = sanitizeInput(nameInput ? nameInput.value : '', 100);
      if (!name || name.length < 2) {
        return showError('Please enter your full name.', nameInput);
      }

      const rawPhone = sanitizePhone(phoneInput ? phoneInput.value : '');
      const digitsOnly = rawPhone.replace(/\D/g, '');
      if (!digitsOnly || digitsOnly.length < 7) {
        return showError('Please enter a valid phone or WhatsApp number.', phoneInput);
      }
      const fullPhone = `+234 ${rawPhone.replace(/^\+?234/, '').trim()}`;

      const email = sanitizeEmail(emailInput ? emailInput.value : '');
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        return showError('Please enter a valid email address.', emailInput);
      }

      const state = sanitizeInput(stateSelect ? stateSelect.value : '', 60);
      if (!state) {
        return showError('Please select your delivery state / FCT.', stateSelect);
      }

      const address = sanitizeInput(addressInput ? addressInput.value : '', 255);
      if (!address || address.length < 5) {
        return showError('Please enter your complete delivery street address.', addressInput);
      }

      // Check Terms and Conditions check mark!
      if (!termsCheckbox || !termsCheckbox.checked) {
        return showError('Please check the box to agree to the Terms and Conditions and Privacy Policy to proceed.', termsCheckbox, true);
      }

      const notes = sanitizeInput(notesInput ? notesInput.value : '', 500);

      // Save customer details locally for convenience in future sessions
      try {
        localStorage.setItem('voltedge_last_customer', JSON.stringify({
          fullName: name,
          phone: rawPhone,
          email: email,
          state: state,
          address: address
        }));
      } catch (e) {}

      // Generate Order ID & Token
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const trackingCode = `VE-${year}${month}${day}-${randomSuffix}`;
      const lookupToken = 've_tok_' + Math.random().toString(36).substring(2, 10);

      const payloadData = this.getOrderPayloadData();
      const totalAmount = payloadData.total_price;

      const orderDetails = {
        orderId: trackingCode,
        order_id: trackingCode,
        trackingCode: trackingCode,
        token: lookupToken,
        lookup_token: lookupToken,
        workflowName: 'Voltedge Order Processing Automation',
        createdAt: now.toISOString(),
        timestamp: now.toISOString(),
        timeStamp: now.toISOString(),

        return_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
        redirect_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
        callback_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
        success_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,

        products: payloadData.products,
        products_json: payloadData.products_json,
        product_sku: payloadData.product_sku,
        product_SKU: payloadData.product_sku,
        product_name: payloadData.product_name,
        unit_price: payloadData.unit_price,
        quantity: payloadData.quantity,
        total_price: totalAmount,
        totalAmount: totalAmount,
        delivery_address: `${address}, ${state}`,
        delivery_state: state,
        delivery_notes: notes,
        payment_link: '',
        order_status: 'order_submitted',
        source: 'VoltEdge Cart Panel',

        customer_name: name,
        customer_phone: fullPhone,
        customer_email: email,
        customer: {
          fullName: name,
          name: name,
          email: email,
          countryCode: '+234',
          phone: rawPhone,
          fullPhone: fullPhone,
          address: address,
          state: state,
          deliveryState: state,
          notes: notes
        }
      };

      // Set Loading State on Button
      this.isSubmitting = true;
      if (checkoutBtn) checkoutBtn.disabled = true;
      if (btnText) btnText.textContent = 'Please wait a moment...';
      if (btnIcon) btnIcon.className = 'ph-bold ph-spinner spin-anim';

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Always wait up to 60s for webhook
        const resp = await fetch('/api/voltedge-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderDetails),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          const rawErrMsg = data.message || data.error || FRIENDLY_ERROR_PLAIN;
          throw new Error(formatFriendlyErrorMessage(rawErrMsg) === FRIENDLY_ERROR_HTML ? FRIENDLY_ERROR_PLAIN : rawErrMsg);
        }
        // Also catch workflow errors that arrive on a 200 response
        if (data && (data.message || data.error)) {
          const rawMsg = String(data.message || data.error || '').toLowerCase();
          const isWorkflowErr = rawMsg.includes('workflow') || rawMsg.includes('error in') || rawMsg.includes('n8n');
          if (isWorkflowErr) throw new Error(FRIENDLY_ERROR_PLAIN);
        }

        // Backend confirmed order!
        const finalOrderId = data.orderId || data.order_id || trackingCode;
        const finalPaymentLink = data.payment_link || data.paymentLink || data.checkout_url || '';

        // Save order locally for quick lookup / confirmation
        const confirmedOrder = {
          ...orderDetails,
          order_id: finalOrderId,
          orderId: finalOrderId,
          payment_link: finalPaymentLink,
          payment_link_sent: true,
          order_status: 'PENDING_PAYMENT'
        };
        try {
          localStorage.setItem('voltedge_last_order', JSON.stringify(confirmedOrder));
          const existingOrders = JSON.parse(localStorage.getItem('voltedge_orders') || '[]');
          existingOrders.unshift(confirmedOrder);
          localStorage.setItem('voltedge_orders', JSON.stringify(existingOrders.slice(0, 30)));
        } catch (e) {}

        // Clear cart
        this.clearCart();

        // Close drawer
        this.closeDrawer();

        // Show confirmation modal if present on index.html, else redirect to order-success.html
        const successModal = document.getElementById('order-success-modal');
        if (successModal) {
          const confOrderCode = document.getElementById('conf-order-code');
          const confProductInfo = document.getElementById('conf-product-info');
          const confCustomerName = document.getElementById('conf-customer-name');
          const confCustomerEmail = document.getElementById('conf-customer-email');
          const confCustomerPhone = document.getElementById('conf-customer-phone');
          const confCustomerAddress = document.getElementById('conf-customer-address');
          const modalViewLink = document.getElementById('modal-view-order-link');
          const directPayWrap = document.getElementById('conf-direct-pay-wrap');
          const directPayBtn = document.getElementById('conf-direct-pay-btn');

          if (confOrderCode) confOrderCode.textContent = finalOrderId;
          if (confProductInfo) confProductInfo.textContent = `${payloadData.product_name} (${formatNaira(totalAmount)})`;
          if (confCustomerName) confCustomerName.textContent = name;
          if (confCustomerEmail) confCustomerEmail.textContent = email;
          if (confCustomerPhone) confCustomerPhone.textContent = fullPhone;
          if (confCustomerAddress) confCustomerAddress.textContent = `${address}, ${state}`;

          const statusUrl = `order-success.html?orderId=${encodeURIComponent(finalOrderId)}&token=${encodeURIComponent(lookupToken)}`;
          if (modalViewLink) {
            modalViewLink.href = statusUrl;
            modalViewLink.innerHTML = '<i class="ph-bold ph-arrow-square-out"></i> View Full Order Status';
          }

          if (directPayWrap && directPayBtn) {
            if (finalPaymentLink) {
              directPayBtn.href = finalPaymentLink;
              directPayWrap.style.display = 'block';
            } else {
              directPayWrap.style.display = 'none';
            }
          }

          successModal.classList.add('active');
        } else {
          window.location.href = `order-success.html?orderId=${encodeURIComponent(finalOrderId)}&token=${encodeURIComponent(lookupToken)}`;
        }
      } catch (err) {
        console.error('[VoltEdge Cart] Order submission error:', err);
        showError(err.message || FRIENDLY_ERROR_PLAIN);
      } finally {
        this.isSubmitting = false;
        if (checkoutBtn) checkoutBtn.disabled = false;
        if (btnText) btnText.textContent = 'Proceed to Checkout';
        if (btnIcon) btnIcon.className = 'ph-bold ph-arrow-right';
      }
    },

    // Inject drawer DOM into page if not already present
    injectDrawerDOM: function () {
      if (document.getElementById('cart-drawer')) return;

      const overlay = document.createElement('div');
      overlay.id = 'cart-drawer-overlay';
      overlay.className = 'cart-drawer-overlay';
      overlay.onclick = () => this.closeDrawer();

      const drawer = document.createElement('div');
      drawer.id = 'cart-drawer';
      drawer.className = 'cart-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-label', 'Shopping Cart');

      drawer.innerHTML = `
        <div class="cart-drawer-header">
          <div class="cart-drawer-title-wrap">
            <i class="ph-bold ph-shopping-bag cart-title-icon"></i>
            <h3 class="cart-drawer-title">Shopping Cart <span id="cart-drawer-count">(0)</span></h3>
          </div>
          <button type="button" class="cart-drawer-close" onclick="VoltEdgeCart.closeDrawer()" aria-label="Close cart">&times;</button>
        </div>

        <div class="cart-drawer-body">
          <!-- Items List Container -->
          <div id="cart-drawer-items"></div>

          <!-- Inline Customer Delivery Checkout Form -->
          <div id="cart-drawer-form-wrap" class="cart-drawer-form-wrap" style="display: none;">
            <div class="cart-form-divider"></div>
            <div class="cart-form-header">
              <i class="ph-bold ph-truck cart-form-icon"></i>
              <h4>Delivery Information</h4>
            </div>
            <p class="cart-form-desc">Provide your contact and destination details to process your order.</p>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-name">Full Name <span class="required">*</span></label>
              <input type="text" id="cart-cust-name" class="cart-form-input" placeholder="e.g. Babatunde Adeleke" autocomplete="name" required>
            </div>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-phone">Phone / WhatsApp Number <span class="required">*</span></label>
              <div class="cart-phone-input-wrap">
                <span class="cart-phone-prefix">NG +234</span>
                <input type="tel" id="cart-cust-phone" class="cart-form-input" placeholder="803 123 4567" autocomplete="tel" required>
              </div>
            </div>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-email">Email Address <span class="required">*</span></label>
              <input type="email" id="cart-cust-email" class="cart-form-input" placeholder="e.g. babatunde@company.com" autocomplete="email" required>
            </div>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-state">Delivery State / FCT <span class="required">*</span></label>
              <select id="cart-cust-state" class="cart-form-select" required>
                <option value="">Select Delivery State / FCT</option>
                <option value="Abia">Abia</option>
                <option value="Adamawa">Adamawa</option>
                <option value="Akwa Ibom">Akwa Ibom</option>
                <option value="Anambra">Anambra</option>
                <option value="Bauchi">Bauchi</option>
                <option value="Bayelsa">Bayelsa</option>
                <option value="Benue">Benue</option>
                <option value="Borno">Borno</option>
                <option value="Cross River">Cross River</option>
                <option value="Delta">Delta</option>
                <option value="Ebonyi">Ebonyi</option>
                <option value="Edo">Edo</option>
                <option value="Ekiti">Ekiti</option>
                <option value="Enugu">Enugu</option>
                <option value="Federal Capital Territory (Abuja)">Federal Capital Territory (Abuja)</option>
                <option value="Gombe">Gombe</option>
                <option value="Imo">Imo</option>
                <option value="Jigawa">Jigawa</option>
                <option value="Kaduna">Kaduna</option>
                <option value="Kano">Kano</option>
                <option value="Katsina">Katsina</option>
                <option value="Kebbi">Kebbi</option>
                <option value="Kogi">Kogi</option>
                <option value="Kwara">Kwara</option>
                <option value="Lagos">Lagos</option>
                <option value="Nasarawa">Nasarawa</option>
                <option value="Niger">Niger</option>
                <option value="Ogun">Ogun</option>
                <option value="Ondo">Ondo</option>
                <option value="Osun">Osun</option>
                <option value="Oyo">Oyo</option>
                <option value="Plateau">Plateau</option>
                <option value="Rivers">Rivers</option>
                <option value="Sokoto">Sokoto</option>
                <option value="Taraba">Taraba</option>
                <option value="Yobe">Yobe</option>
                <option value="Zamfara">Zamfara</option>
              </select>
            </div>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-address">Delivery Street Address <span class="required">*</span></label>
              <input type="text" id="cart-cust-address" class="cart-form-input" placeholder="House/office address, landmark" autocomplete="street-address" required>
            </div>

            <div class="cart-form-group">
              <label class="cart-form-label" for="cart-cust-notes">Order Notes & Instructions (Optional)</label>
              <input type="text" id="cart-cust-notes" class="cart-form-input" placeholder="e.g. Call before arrival; leave with front desk">
            </div>

            <!-- TERMS AND CONDITIONS CHECK MARK -->
            <div class="cart-terms-box" id="cart-terms-box">
              <label class="cart-terms-label" for="cart-terms-check">
                <input type="checkbox" id="cart-terms-check" class="cart-terms-checkbox" required>
                <span>I agree to VoltEdge <a href="#" onclick="VoltEdgeCart.openTermsModal(event)" class="cart-terms-link">Terms and Conditions</a> and <a href="#" onclick="VoltEdgeCart.openTermsModal(event)" class="cart-terms-link">Privacy Policy</a></span>
              </label>
            </div>

            <div id="cart-submit-status-banner" style="display: none; margin-top: 0.75rem;"></div>
          </div>
        </div>

        <div class="cart-drawer-footer" id="cart-drawer-footer">
          <div class="cart-summary-line">
            <span>Subtotal</span>
            <strong id="cart-drawer-subtotal">₦0</strong>
          </div>
          <div class="cart-summary-line delivery-line">
            <span>Delivery</span>
            <span class="delivery-status">Confirmed upon dispatch</span>
          </div>
          <div class="cart-summary-line total-line">
            <span>Grand Total</span>
            <strong class="cart-grand-total" id="cart-drawer-total">₦0</strong>
          </div>
          
          <div class="cart-drawer-btn-wrap">
            <button type="button" class="btn btn-primary btn-cart-checkout" id="cart-drawer-checkout-btn" onclick="VoltEdgeCart.submitCartOrder()">
              <span id="cart-checkout-btn-text">Proceed to Checkout</span>
              <i class="ph-bold ph-arrow-right" id="cart-checkout-btn-icon"></i>
            </button>
            <button type="button" class="btn-clear-cart" onclick="VoltEdgeCart.clearCart()">
              <i class="ph ph-trash"></i> Clear Cart
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(drawer);
    },

    // Initialize cart on page load
    init: function () {
      this.injectDrawerDOM();
      this.updateBadges();

      // Keyboard support: ESC closes cart drawer
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeDrawer();
        }
      });
    }
  };

  // Expose to window
  window.VoltEdgeCart = VoltEdgeCart;

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VoltEdgeCart.init());
  } else {
    VoltEdgeCart.init();
  }

})(typeof window !== 'undefined' ? window : this);
