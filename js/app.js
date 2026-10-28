// VoltEdge Tech & Accessories - Interactive Web Application Logic

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initializations
  initAnnouncementCountdown();
  initCatalogSearch();
  renderProducts('all');
  renderAccessories();
  renderReviews();
  renderFAQs();
  initOrderForm();
  initFeedbackForm();
  initQuickViewModal();
  initMobileNav();
  initScrollEffects();
});

// Format Currency in Nigerian Naira (₦)
function formatNaira(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG');
}

// 2. Announcement Countdown to 2:00 PM Dispatch Cut-off
function initAnnouncementCountdown() {
  const timerEl = document.getElementById('dispatch-countdown');
  if (!timerEl) return;

  function updateTimer() {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setHours(14, 0, 0, 0); // 2:00 PM

    // If past 2 PM, target 2 PM tomorrow
    if (now > cutoff) {
      cutoff.setDate(cutoff.getDate() + 1);
    }

    const diff = cutoff - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    timerEl.textContent = `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }

  updateTimer();
  setInterval(updateTimer, 1000);
}

// Global Catalog Filter & Search State
let currentCatalogCategory = 'all';
let currentCatalogSearchQuery = '';

// Helper to normalize strings for search (removes commas, dashes, slashes, spaces)
function normalizeSearchText(str) {
  return String(str || '').toLowerCase().replace(/[,.\-_\/\s]/g, '');
}

// Multi-Attribute Search Matching (Product Name, Specs / Features, Product SKU)
function matchesProduct(product, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;

  // 1. Check Product Name
  const nameFields = [product.name, product.shortName].filter(Boolean);
  
  // 2. Check Product SKU & ID
  const skuFields = [product.sku, product.id].filter(Boolean);

  // 3. Check Specs / Features
  const specFields = [];
  if (product.specsHighlight) specFields.push(product.specsHighlight);
  if (product.finish) specFields.push(product.finish);
  if (product.tagline) specFields.push(product.tagline);
  if (product.categoryLabel) specFields.push(product.categoryLabel);
  if (Array.isArray(product.bullets)) specFields.push(...product.bullets);
  if (product.technicalSpecs && typeof product.technicalSpecs === 'object') {
    for (const [k, v] of Object.entries(product.technicalSpecs)) {
      specFields.push(k, String(v));
    }
  }

  const nameText = nameFields.join(' ').toLowerCase();
  const skuText = skuFields.join(' ').toLowerCase();
  const specsText = specFields.join(' ').toLowerCase();

  const qNorm = normalizeSearchText(q);
  const nameNorm = normalizeSearchText(nameText);
  const skuNorm = normalizeSearchText(skuText);
  const specsNorm = normalizeSearchText(specsText);

  // Substring or normalized comparison (e.g. "30000mAh" matching "30,000mAh", "12V", "Black", "VE-PB-30K-BLK")
  if (nameText.includes(q) || (qNorm.length >= 2 && nameNorm.includes(qNorm))) return true;
  if (skuText.includes(q) || (qNorm.length >= 2 && skuNorm.includes(qNorm))) return true;
  if (specsText.includes(q) || (qNorm.length >= 2 && specsNorm.includes(qNorm))) return true;

  // Multi-word token check (each word must match across Name, Specs, or SKU)
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const combined = `${nameText} ${skuText} ${specsText}`;
    const combinedNorm = `${nameNorm} ${skuNorm} ${specsNorm}`;
    const allMatch = tokens.every(tok => {
      const tokNorm = normalizeSearchText(tok);
      return combined.includes(tok) || (tokNorm.length >= 2 && combinedNorm.includes(tokNorm));
    });
    if (allMatch) return true;
  }

  return false;
}

// 3. Render Product Catalog with Category Filtering & Real-Time Search
function renderProducts(filter = currentCatalogCategory, searchQuery = currentCatalogSearchQuery) {
  currentCatalogCategory = filter;
  currentCatalogSearchQuery = searchQuery;

  const grid = document.getElementById('products-grid');
  const filterTabs = document.querySelector('.filter-tabs');
  const emptyState = document.getElementById('catalog-empty-state');
  if (!grid) return;

  const trimmedQuery = (searchQuery || '').trim();

  // If search query is present, search across all products (or within category if desired)
  let products = PRODUCTS_DATA;
  if (trimmedQuery) {
    products = products.filter(p => matchesProduct(p, trimmedQuery));
    
    // Sort so exact/substring name & SKU matches appear at top
    products.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aSku = (a.sku || '').toLowerCase();
      const bSku = (b.sku || '').toLowerCase();
      const qLower = trimmedQuery.toLowerCase();
      
      const aDirect = aName.includes(qLower) || aSku.includes(qLower);
      const bDirect = bName.includes(qLower) || bSku.includes(qLower);
      
      if (aDirect && !bDirect) return -1;
      if (!aDirect && bDirect) return 1;
      return 0;
    });
  } else if (filter !== 'all') {
    products = products.filter(p => p.category === filter);
  }

  // EMPTY STATE: If zero products match, hide catalog entirely and show clean empty state message
  if (products.length === 0) {
    grid.style.display = 'none';
    if (filterTabs) filterTabs.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    grid.innerHTML = '';
    return;
  }

  // Products matched: show catalog grid and tabs, hide empty state
  grid.style.display = 'grid';
  if (filterTabs) filterTabs.style.display = 'flex';
  if (emptyState) emptyState.style.display = 'none';

  grid.innerHTML = products.map(product => {
    return `
      <article class="product-card" data-id="${product.id}">
        <div class="product-card-top">
          <img src="${product.image}" alt="${product.name}" class="product-card-img" loading="lazy">
          <div class="card-badges">
            <span class="card-badge ${product.badgeType}">${product.badge}</span>
            <span class="warranty-pill"><i class="ph ph-shield-check"></i> 1-Yr Warranty</span>
          </div>
          <button class="quick-view-btn" onclick="openQuickView('${product.id}')" aria-label="Quick view of ${product.name}">
            <i class="ph ph-eye"></i> Quick View
          </button>
        </div>

        <div class="product-card-body">
          <div class="product-meta">
            <span class="product-sku">${product.sku}</span>
            <div class="product-rating">
              <i class="ph-fill ph-star"></i>
              <span>${product.rating}</span>
              <span style="color: var(--text-dim); font-size: 0.72rem;">(${product.reviewsCount})</span>
            </div>
          </div>

          <h3 class="product-title">${product.name}</h3>
          <p class="product-tagline">${product.tagline}</p>

          <ul class="product-bullets">
            ${product.bullets.slice(0, 3).map(b => `
              <li class="product-bullet">
                <i class="ph-bold ph-check bullet-icon"></i>
                <span>${b}</span>
              </li>
            `).join('')}
          </ul>

          <div class="product-card-footer">
            <div class="price-wrap">
              <span class="price-label">Price in Naira</span>
              <span class="price-amount">${formatNaira(product.price)}</span>
            </div>
            <button class="btn btn-volt btn-sm" onclick="selectForOrder('${product.id}')">
              <i class="ph ph-shopping-cart-simple"></i> Order Now
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// Handle Category Tab Switches
window.filterCategory = function(cat, buttonEl) {
  const searchInput = document.getElementById('catalog-search-input');
  const clearBtn = document.getElementById('catalog-search-clear');
  
  // When switching category tabs, clear the search bar to reveal that category cleanly
  if (searchInput && searchInput.value) {
    searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    currentCatalogSearchQuery = '';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (buttonEl) {
    buttonEl.classList.add('active');
  } else {
    const targetTab = document.querySelector(`.tab-btn[onclick*="'${cat}'"]`);
    if (targetTab) targetTab.classList.add('active');
  }
  renderProducts(cat, '');
};

// Initialize Real-Time Dynamic Search Component
function initCatalogSearch() {
  const searchInput = document.getElementById('catalog-search-input');
  const clearBtn = document.getElementById('catalog-search-clear');
  const searchBar = document.getElementById('catalog-search-bar');
  if (!searchInput) return;

  // Instant Search from the First Letter: updates product grid on every keystroke
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value;

    // Show or hide small "X" clear button inside right of search bar
    if (clearBtn) {
      clearBtn.style.display = query.length > 0 ? 'inline-flex' : 'none';
    }

    // Set "All Products" tab as active when searching across catalog
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      if (onclickAttr.includes("'all'")) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    renderProducts('all', query);
  });

  // Focus and Blur state classes to guarantee visual feedback
  searchInput.addEventListener('focus', () => {
    if (searchBar) searchBar.classList.add('is-focused');
  });

  searchInput.addEventListener('blur', () => {
    if (searchBar) searchBar.classList.remove('is-focused');
  });

  // Clear Button inside right side of search bar
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearProductSearch();
      searchInput.focus();
    });
  }
}

// Reset and Clear Search: clears query and displays all products again
function clearProductSearch() {
  const searchInput = document.getElementById('catalog-search-input');
  const clearBtn = document.getElementById('catalog-search-clear');
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';

  // Restore 'All Products' tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const onclickAttr = btn.getAttribute('onclick') || '';
    if (onclickAttr.includes("'all'")) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderProducts('all', '');
}
window.clearProductSearch = clearProductSearch;

// 4. Render Creator Accessories
function renderAccessories() {
  const grid = document.getElementById('accessories-grid');
  if (!grid) return;

  grid.innerHTML = CREATOR_ACCESSORIES.map(acc => {
    const waText = encodeURIComponent(`Hello VoltEdge, I would like to enquire about availability and pricing for the ${acc.title} (${acc.sku}).`);
    return `
      <div class="accessory-card">
        <div class="accessory-img-wrap">
          <img src="${acc.image}" alt="${acc.title}" class="accessory-img" loading="lazy">
          <span class="accessory-status-badge">Enquiry Only</span>
        </div>
        <div class="accessory-body">
          <span class="product-sku" style="margin-bottom: 0.25rem;">${acc.sku}</span>
          <h4 class="accessory-title">${acc.title}</h4>
          <span class="accessory-sub">${acc.subtitle}</span>
          <p class="accessory-desc">${acc.description}</p>
          
          <div class="accessory-features">
            ${acc.features.map(f => `<span class="acc-feature-tag">${f}</span>`).join('')}
          </div>

          <div class="accessory-footer">
            <a href="https://wa.me/2347047922403?text=${waText}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="width: 100%;">
              <i class="ph ph-chat-circle-dots" style="color: #25D366;"></i> Ask About Availability
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 5. Render Reviews
function renderReviews() {
  const grid = document.getElementById('reviews-grid');
  if (!grid) return;

  grid.innerHTML = REVIEWS_DATA.map(rev => `
    <div class="review-card">
      <div class="review-header">
        <div class="reviewer-info">
          <h4>${rev.name}</h4>
          <p class="reviewer-role">${rev.role}</p>
          <p class="reviewer-loc"><i class="ph ph-map-pin"></i> ${rev.location}</p>
        </div>
        <div class="review-stars">
          ${'<i class="ph-fill ph-star"></i>'.repeat(rev.rating)}
        </div>
      </div>

      <span class="review-product-tag">${rev.product}</span>
      <p class="review-content">"${rev.content}"</p>

      <div class="review-footer">
        <i class="ph-fill ph-check-circle verified-icon"></i>
        <span>${rev.date}</span>
      </div>
    </div>
  `).join('');
}

// 6. Render FAQs
function renderFAQs() {
  const container = document.getElementById('faq-accordion');
  if (!container) return;

  container.innerHTML = FAQS_DATA.map((faq, index) => `
    <div class="faq-item ${index === 0 ? 'open' : ''}">
      <button class="faq-question" onclick="toggleFAQ(this)">
        <span>${faq.question}</span>
        <span class="faq-toggle-icon"><i class="ph ph-plus"></i></span>
      </button>
      <div class="faq-answer">
        <p>${faq.answer}</p>
      </div>
    </div>
  `).join('');
}

window.toggleFAQ = function(buttonEl) {
  const item = buttonEl.closest('.faq-item');
  const isOpen = item.classList.contains('open');
  
  // Close others if desired
  document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('open'));

  if (!isOpen) {
    item.classList.add('open');
  }
};

// 7. Interactive Order Form Logic
let currentSelectedProduct = PRODUCTS_DATA[0];
let currentQuantity = 1;

function initOrderForm() {
  const select = document.getElementById('order-product-select');
  if (!select) return;

  // Populate select options
  select.innerHTML = PRODUCTS_DATA.map(p => `
    <option value="${p.id}">${p.name} — ${formatNaira(p.price)}</option>
  `).join('');

  select.addEventListener('change', (e) => {
    const found = PRODUCTS_DATA.find(p => p.id === e.target.value);
    if (found) {
      currentSelectedProduct = found;
      updateOrderCalculations();
      validateOrderForm();
    }
  });

  // Quantity controls
  const qtyInput = document.getElementById('order-qty-input');
  const minusBtn = document.getElementById('qty-minus');
  const plusBtn = document.getElementById('qty-plus');

  if (minusBtn && plusBtn && qtyInput) {
    minusBtn.addEventListener('click', () => {
      if (currentQuantity > 1) {
        currentQuantity--;
        qtyInput.value = currentQuantity;
        updateOrderCalculations();
      }
    });

    plusBtn.addEventListener('click', () => {
      if (currentQuantity < 50) {
        currentQuantity++;
        qtyInput.value = currentQuantity;
        updateOrderCalculations();
      }
    });

    qtyInput.addEventListener('change', (e) => {
      let val = parseInt(e.target.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 100) val = 100;
      currentQuantity = val;
      qtyInput.value = val;
      updateOrderCalculations();
    });
  }

  // Delivery notes character counter
  const notes = document.getElementById('order-notes');
  const charCount = document.getElementById('notes-char-count');
  if (notes && charCount) {
    notes.addEventListener('input', () => {
      charCount.textContent = `${notes.value.length} / 500 characters`;
    });
  }

  // Real-time validation & blur listeners on all required fields
  const inputsToWatch = [
    'order-fullname',
    'order-email',
    'order-country-code',
    'order-phone',
    'order-state',
    'order-address',
    'terms-checkbox'
  ];

  inputsToWatch.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => validateOrderForm(false));
      el.addEventListener('change', () => validateOrderForm(false));
      el.addEventListener('keyup', () => validateOrderForm(false));
      el.addEventListener('blur', () => validateOrderForm(true));
    }
  });

  // Submit button below order summary
  const submitBtn = document.getElementById('btn-submit-order');
  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isValid = validateOrderForm(true);
      if (!isValid) {
        // Focus first field with error
        const firstErrorField = document.querySelector('.form-control.has-error, .terms-checkbox-wrap.has-error');
        if (firstErrorField) {
          firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
          if (firstErrorField.focus) firstErrorField.focus();
        }
        showToast('Please correct the highlighted errors in your order form.', 'error');
        return;
      }
      handleOrderSubmit(e);
    });
  }

  // Also support form enter-to-submit
  const form = document.getElementById('volt-order-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (validateOrderForm(true)) {
        handleOrderSubmit(e);
      } else {
        showToast('Please correct the highlighted errors in your order form.', 'error');
      }
    });
  }

  // Terms & Privacy modal trigger links
  const linkTerms = document.getElementById('link-terms-conditions');
  const linkPrivacy = document.getElementById('link-privacy-policy');
  const termsModal = document.getElementById('terms-modal');
  const closeTermsBtn = document.getElementById('close-terms-modal');
  const acceptTermsBtn = document.getElementById('btn-accept-terms-modal');

  const openTerms = (e) => {
    if (e) e.preventDefault();
    if (termsModal) termsModal.classList.add('active');
  };

  if (linkTerms) linkTerms.addEventListener('click', openTerms);
  if (linkPrivacy) linkPrivacy.addEventListener('click', openTerms);

  if (closeTermsBtn && termsModal) {
    closeTermsBtn.addEventListener('click', () => termsModal.classList.remove('active'));
  }

  if (termsModal) {
    termsModal.addEventListener('click', (e) => {
      if (e.target === termsModal) termsModal.classList.remove('active');
    });
  }

  if (acceptTermsBtn && termsModal) {
    acceptTermsBtn.addEventListener('click', () => {
      const termsCheckbox = document.getElementById('terms-checkbox');
      if (termsCheckbox) {
        termsCheckbox.checked = true;
        validateOrderForm(false);
      }
      termsModal.classList.remove('active');
      showToast('Terms & Conditions accepted', 'info');
    });
  }

  updateOrderCalculations();
  validateOrderForm(false); // Initial state: grey and disabled
}

// Live Validation: Submit button remains disabled/grey until all fields are filled AND terms accepted
function validateOrderForm(showErrors = false) {
  const nameInput = document.getElementById('order-fullname');
  const emailInput = document.getElementById('order-email');
  const phoneInput = document.getElementById('order-phone');
  const addressInput = document.getElementById('order-address');
  const stateInput = document.getElementById('order-state');
  const termsCheckbox = document.getElementById('terms-checkbox');
  const termsWrap = document.getElementById('terms-wrap');
  const submitBtn = document.getElementById('btn-submit-order');
  const submitHint = document.getElementById('submit-hint');

  // Specific Field Error Elements
  const errName = document.getElementById('error-order-fullname');
  const errEmail = document.getElementById('error-order-email');
  const errPhone = document.getElementById('error-order-phone');
  const errAddress = document.getElementById('error-order-address');
  const errTerms = document.getElementById('error-order-terms');

  if (!submitBtn) return false;

  const isNameValid = nameInput && nameInput.value.trim().length >= 2;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmailValid = emailInput && emailRegex.test(emailInput.value.trim());
  const phoneDigits = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';
  const isPhoneValid = phoneDigits.length >= 7;
  const isAddressValid = addressInput && addressInput.value.trim().length >= 4;
  const isStateValid = stateInput && stateInput.value.trim().length > 0;
  const isProductValid = !!currentSelectedProduct;
  const isTermsAccepted = termsCheckbox && termsCheckbox.checked;

  const allFieldsFilled = isNameValid && isEmailValid && isPhoneValid && isAddressValid && isStateValid && isProductValid;
  const isReadyToSubmit = allFieldsFilled && isTermsAccepted;

  // Toggle Error Visuals
  if (showErrors) {
    toggleFieldError(nameInput, errName, !isNameValid);
    toggleFieldError(emailInput, errEmail, !isEmailValid);
    toggleFieldError(phoneInput, errPhone, !isPhoneValid);
    toggleFieldError(addressInput, errAddress, !isAddressValid);
    if (termsWrap) {
      if (!isTermsAccepted) {
        termsWrap.classList.add('has-error');
        if (errTerms) errTerms.classList.add('show');
      } else {
        termsWrap.classList.remove('has-error');
        if (errTerms) errTerms.classList.remove('show');
      }
    }
  } else {
    // If field is now valid, dismiss error immediately
    if (isNameValid) toggleFieldError(nameInput, errName, false);
    if (isEmailValid) toggleFieldError(emailInput, errEmail, false);
    if (isPhoneValid) toggleFieldError(phoneInput, errPhone, false);
    if (isAddressValid) toggleFieldError(addressInput, errAddress, false);
    if (isTermsAccepted && termsWrap) {
      termsWrap.classList.remove('has-error');
      if (errTerms) errTerms.classList.remove('show');
    }
  }

  if (isReadyToSubmit) {
    submitBtn.disabled = false;
    submitBtn.removeAttribute('disabled');
    if (submitHint) {
      submitHint.innerHTML = '<i class="ph-fill ph-check-circle" style="color: var(--primary);"></i> Information complete. Click above to submit your order.';
      submitHint.classList.add('ready');
    }
  } else {
    submitBtn.disabled = true;
    submitBtn.setAttribute('disabled', 'disabled');
    if (submitHint) {
      submitHint.classList.remove('ready');
      if (!allFieldsFilled) {
        submitHint.innerHTML = '<i class="ph ph-info"></i> Please fill in your details and agree to terms to submit.';
      } else if (!isTermsAccepted) {
        submitHint.innerHTML = '<i class="ph ph-warning" style="color: #d97706;"></i> Please accept the Terms and Conditions to enable order submission.';
      }
    }
  }

  return isReadyToSubmit;
}

// Helper to toggle visual error state on an input element
function toggleFieldError(inputEl, errorEl, isError) {
  if (inputEl) {
    if (isError) {
      inputEl.classList.add('has-error');
    } else {
      inputEl.classList.remove('has-error');
    }
  }
  if (errorEl) {
    if (isError) {
      errorEl.classList.add('show');
    } else {
      errorEl.classList.remove('show');
    }
  }
}

function updateOrderCalculations() {
  if (!currentSelectedProduct) return;

  // Update preview image & details
  const prevImg = document.getElementById('order-preview-img');
  const prevSku = document.getElementById('order-preview-sku');
  const prevName = document.getElementById('order-preview-name');
  const prevUnitPrice = document.getElementById('order-unit-price');
  const prevSubtotal = document.getElementById('order-subtotal');
  const prevTotal = document.getElementById('order-total');
  const prevQtyText = document.getElementById('order-summary-qty');

  if (prevImg) prevImg.src = currentSelectedProduct.image;
  if (prevSku) prevSku.textContent = currentSelectedProduct.sku;
  if (prevName) prevName.textContent = currentSelectedProduct.name;
  if (prevUnitPrice) prevUnitPrice.textContent = formatNaira(currentSelectedProduct.price);

  const subtotal = currentSelectedProduct.price * currentQuantity;
  if (prevSubtotal) prevSubtotal.textContent = formatNaira(subtotal);
  if (prevTotal) prevTotal.textContent = formatNaira(subtotal);
  if (prevQtyText) prevQtyText.textContent = `${currentQuantity} ${currentQuantity > 1 ? 'units' : 'unit'}`;
}

// Global function to trigger order selection from cards
window.selectForOrder = function(productId) {
  const prod = PRODUCTS_DATA.find(p => p.id === productId);
  if (!prod) return;

  currentSelectedProduct = prod;
  const select = document.getElementById('order-product-select');
  if (select) select.value = productId;

  updateOrderCalculations();
  validateOrderForm();

  // Smooth scroll to order section
  const orderSection = document.getElementById('order-form-section');
  if (orderSection) {
    orderSection.scrollIntoView({ behavior: 'smooth' });
    showToast(`Selected "${prod.shortName}" for your order`, 'info');
  }
};

// n8n Webhook Integration for "Voltedge Order Processing Automation"
const N8N_ORDER_CONFIG = {
  workflowName: 'Voltedge Order Processing Automation',
  webhookUrl: 'https://ucy00zep.rpcld.net/webhook/voltedge-order',
  testWebhookUrl: 'https://ucy00zep.rpcld.net/webhook/voltedge-order'
};

/**
 * Sends order details to n8n production webhook ("Voltedge Order Processing Automation")
 */
async function sendOrderToN8n(orderDetails) {
  const webhookUrl = N8N_ORDER_CONFIG.webhookUrl;

  console.log(`[VoltEdge Automation] Sending order ${orderDetails.orderId} to production webhook at ${webhookUrl}...`, orderDetails);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      },
      body: JSON.stringify(orderDetails)
    });

    let responseData = null;
    try {
      responseData = await response.json();
    } catch {
      responseData = await response.text();
    }

    if (response.ok) {
      console.log(`[VoltEdge Automation] Order ${orderDetails.orderId} successfully delivered to n8n (${webhookUrl}):`, responseData);
      return { success: true, url: webhookUrl, data: responseData };
    } else {
      console.warn(`[VoltEdge Automation] Webhook response ${response.status} (${response.statusText}):`, responseData);
      return { success: false, url: webhookUrl, status: response.status, data: responseData };
    }
  } catch (error) {
    console.error(`[VoltEdge Automation] Network error sending order to n8n webhook:`, error);
    return { success: false, error: error.message };
  }
}

// Form submission handler
async function handleOrderSubmit(e) {
  if (e) e.preventDefault();

  if (!validateOrderForm()) {
    showToast('Please fill all required information and accept the terms to proceed.', 'error');
    return;
  }

  const nameInput = document.getElementById('order-fullname');
  const emailInput = document.getElementById('order-email');
  const countryCodeSelect = document.getElementById('order-country-code');
  const phoneInput = document.getElementById('order-phone');
  const addressInput = document.getElementById('order-address');
  const stateInput = document.getElementById('order-state');
  const notesInput = document.getElementById('order-notes');
  const termsCheckbox = document.getElementById('terms-checkbox');
  const submitBtn = document.getElementById('btn-submit-order');

  const name = nameInput.value.trim();
  const email = emailInput ? emailInput.value.trim() : '';
  const countryCode = countryCodeSelect ? countryCodeSelect.value : '+234';
  const phone = phoneInput.value.trim();
  const fullPhone = `${countryCode} ${phone}`;
  const address = addressInput.value.trim();
  const state = stateInput.value;
  const notes = notesInput ? notesInput.value.trim() : '';

  // Order ID format: VE-YYYYMMDD-XXXX (VE-yearmonthdate-randomnumber, e.g. VE-20261021-3405)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const trackingCode = `VE-${year}${month}${day}-${randomSuffix}`;
  const totalAmount = currentSelectedProduct.price * currentQuantity;

  // Complete Order Payload for n8n workflow "Voltedge Order Processing Automation"
  const orderDetails = {
    // Unique Identification & Tracking
    orderId: trackingCode,
    order_id: trackingCode,
    trackingCode: trackingCode,
    workflowName: N8N_ORDER_CONFIG.workflowName,
    createdAt: now.toISOString(),
    timestamp: now.toISOString(),

    // Customer Information (Nested)
    customer: {
      fullName: name,
      name: name,
      email: email,
      countryCode: countryCode,
      phone: phone,
      fullPhone: fullPhone,
      address: address,
      state: state,
      deliveryState: state,
      notes: notes
    },

    // Selected Product Information (Nested)
    product: {
      id: currentSelectedProduct.id,
      name: currentSelectedProduct.name,
      shortName: currentSelectedProduct.shortName,
      sku: currentSelectedProduct.sku || currentSelectedProduct.id,
      unitPrice: currentSelectedProduct.price,
      formattedUnitPrice: formatNaira(currentSelectedProduct.price),
      quantity: currentQuantity,
      totalAmount: totalAmount,
      formattedTotal: formatNaira(totalAmount)
    },

    // Order items array for multi-item compatible nodes
    items: [
      {
        id: currentSelectedProduct.id,
        name: currentSelectedProduct.name,
        shortName: currentSelectedProduct.shortName,
        sku: currentSelectedProduct.sku || currentSelectedProduct.id,
        unitPrice: currentSelectedProduct.price,
        quantity: currentQuantity,
        totalPrice: totalAmount
      }
    ],

    // Flattened fields for easy n8n node referencing ($json.email, $json.phone, etc.)
    fullName: name,
    customerName: name,
    email: email,
    customerEmail: email,
    countryCode: countryCode,
    phoneNumber: phone,
    phone: fullPhone,
    customerPhone: fullPhone,
    deliveryAddress: address,
    address: address,
    state: state,
    deliveryState: state,
    orderNotes: notes,
    notes: notes,
    productId: currentSelectedProduct.id,
    productName: currentSelectedProduct.name,
    productShortName: currentSelectedProduct.shortName,
    sku: currentSelectedProduct.sku || currentSelectedProduct.id,
    quantity: currentQuantity,
    unitPrice: currentSelectedProduct.price,
    formattedUnitPrice: formatNaira(currentSelectedProduct.price),
    totalAmount: totalAmount,
    totalPrice: totalAmount,
    formattedTotal: formatNaira(totalAmount),
    currency: 'NGN',
    paymentStatus: 'pending_email_instruction',
    status: 'order_submitted',
    source: 'VoltEdge Dashboard Order Form'
  };

  // Cache order locally in localStorage
  try {
    localStorage.setItem('voltedge_last_order', JSON.stringify(orderDetails));
    const existingOrders = JSON.parse(localStorage.getItem('voltedge_orders') || '[]');
    existingOrders.unshift(orderDetails);
    localStorage.setItem('voltedge_orders', JSON.stringify(existingOrders.slice(0, 30)));
  } catch (err) {
    console.warn('Could not store order locally:', err);
  }

  // Populate confirmation modal
  const confOrderCode = document.getElementById('conf-order-code');
  const confProductInfo = document.getElementById('conf-product-info');
  const confCustomerName = document.getElementById('conf-customer-name');
  const confCustomerEmail = document.getElementById('conf-customer-email');
  const confCustomerPhone = document.getElementById('conf-customer-phone');
  const confCustomerAddress = document.getElementById('conf-customer-address');
  const modalViewLink = document.getElementById('modal-view-order-link');

  if (confOrderCode) confOrderCode.textContent = trackingCode;
  if (confProductInfo) confProductInfo.textContent = `${currentQuantity}x ${currentSelectedProduct.name} (${formatNaira(totalAmount)})`;
  if (confCustomerName) confCustomerName.textContent = name;
  if (confCustomerEmail) confCustomerEmail.textContent = email;
  if (confCustomerPhone) confCustomerPhone.textContent = fullPhone;
  if (confCustomerAddress) confCustomerAddress.textContent = `${address}, ${state}`;
  if (modalViewLink) {
    modalViewLink.href = `order-success.html?orderId=${encodeURIComponent(trackingCode)}`;
  }

  // WhatsApp support link inside modal for customer assistance
  const supportWaBtn = document.getElementById('conf-support-wa');
  if (supportWaBtn) {
    const waHelpText = encodeURIComponent(
      `Hello VoltEdge team, I just placed order ${trackingCode} (${currentQuantity}x ${currentSelectedProduct.name}) and have a question or need assistance with my order.`
    );
    supportWaBtn.href = `https://wa.me/2347047922403?text=${waHelpText}`;
  }

  // Visual loading on submit button while webhook dispatches
  const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ph-bold ph-spinner spin-anim"></i> <span>Sending Order...</span>';
  }

  // Send order details to n8n Webhook
  try {
    await sendOrderToN8n(orderDetails);
  } catch (err) {
    console.error('Webhook execution notice:', err);
  } finally {
    if (submitBtn) {
      submitBtn.innerHTML = originalBtnHTML;
    }
  }

  // Open modal
  const modal = document.getElementById('order-success-modal');
  if (modal) {
    modal.classList.add('active');
  }

  // Clear form inputs
  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (addressInput) addressInput.value = '';
  if (notesInput) notesInput.value = '';
  if (termsCheckbox) termsCheckbox.checked = false;
  validateOrderForm();

  showToast(`Order ${trackingCode} submitted and sent to processing!`, 'success');
}

// 8. Give Us a Feedback Form Logic
function initFeedbackForm() {
  const form = document.getElementById('volt-feedback-form');
  const nameInput = document.getElementById('feedback-name');
  const messageInput = document.getElementById('feedback-message');
  const submitBtn = document.getElementById('btn-feedback-submit');
  const charCount = document.getElementById('feedback-char-count');
  const successState = document.getElementById('feedback-success-state');
  const againBtn = document.getElementById('btn-feedback-again');

  // Error message elements
  const errName = document.getElementById('error-feedback-name');
  const errMessage = document.getElementById('error-feedback-message');

  if (!form || !nameInput || !messageInput || !submitBtn) return;

  function validateFeedback(showErrors = false) {
    const isNameValid = nameInput.value.trim().length >= 2;
    const isMessageValid = messageInput.value.trim().length >= 5;
    const isFormValid = isNameValid && isMessageValid;

    if (showErrors) {
      toggleFieldError(nameInput, errName, !isNameValid);
      toggleFieldError(messageInput, errMessage, !isMessageValid);
    } else {
      if (isNameValid) toggleFieldError(nameInput, errName, false);
      if (isMessageValid) toggleFieldError(messageInput, errMessage, false);
    }

    if (isFormValid) {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('disabled');
    } else {
      submitBtn.disabled = true;
      submitBtn.setAttribute('disabled', 'disabled');
    }

    return isFormValid;
  }

  // Real-time input validation & blur handlers
  [nameInput, messageInput].forEach(input => {
    input.addEventListener('input', () => {
      validateFeedback(false);
      if (charCount && input === messageInput) {
        const len = messageInput.value.length;
        charCount.textContent = `${len} / 1000 characters`;
      }
    });
    input.addEventListener('blur', () => {
      if (input.value.trim().length > 0) {
        validateFeedback(true);
      }
    });
    input.addEventListener('change', () => validateFeedback(false));
    input.addEventListener('keyup', () => validateFeedback(false));
  });

  // Handle Form Submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateFeedback(true)) {
      showToast('Please enter both your name and feedback before submitting.', 'error');
      return;
    }

    const userName = nameInput.value.trim();
    form.style.display = 'none';
    if (successState) {
      successState.style.display = 'block';
    }

    showToast(`Thank you for your feedback, ${userName}!`, 'success');
  });

  // Submit another feedback response
  if (againBtn) {
    againBtn.addEventListener('click', () => {
      form.reset();
      form.style.display = 'block';
      if (successState) {
        successState.style.display = 'none';
      }
      if (charCount) {
        charCount.textContent = '0 / 1000 characters';
      }
      validateFeedback();
    });
  }

  validateFeedback(); // Initial state: grey and disabled
}

// 9. Quick View Modal
function initQuickViewModal() {
  const modal = document.getElementById('quick-view-modal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.modal-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });

  // Success modal close
  const successModal = document.getElementById('order-success-modal');
  if (successModal) {
    const sCloseBtn = successModal.querySelector('.modal-close-btn');
    if (sCloseBtn) {
      sCloseBtn.addEventListener('click', () => successModal.classList.remove('active'));
    }
  }
}

window.openQuickView = function(productId) {
  const product = PRODUCTS_DATA.find(p => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('quick-view-modal');
  const modalBody = document.getElementById('quick-view-body');
  if (!modal || !modalBody) return;

  const specsRows = Object.entries(product.technicalSpecs).map(([key, val]) => `
    <tr>
      <td>${key}</td>
      <td>${val}</td>
    </tr>
  `).join('');

  modalBody.innerHTML = `
    <div class="quick-view-modal-grid">
      <div class="modal-img-wrap">
        <img src="${product.image}" alt="${product.name}">
      </div>
      <div class="modal-body-content">
        <span class="product-sku">${product.sku}</span>
        <h2 style="font-size: 1.5rem; color: var(--text-main); margin: 0.25rem 0 0.5rem; font-weight: 800;">${product.name}</h2>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--primary); margin-bottom: 0.85rem;">
          ${formatNaira(product.price)}
        </div>
        
        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1.15rem; line-height: 1.55;">
          ${product.tagline}
        </p>

        <h4 style="font-size: 0.88rem; color: var(--text-main); margin-bottom: 0.45rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Technical Specifications</h4>
        <table class="modal-specs-table">
          <tbody>
            ${specsRows}
          </tbody>
        </table>

        <div style="display: flex; gap: 0.75rem; margin-top: auto; padding-top: 1rem;">
          <button class="btn btn-primary" style="flex: 1;" onclick="modalSelectOrder('${product.id}')">
            Order This Gear
          </button>
          <a href="https://wa.me/2347047922403?text=${encodeURIComponent('Hello VoltEdge, I have questions regarding the ' + product.name + ' (' + product.sku + ').')}" target="_blank" class="btn btn-ghost">
            Enquire on WhatsApp
          </a>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('active');
};

window.modalSelectOrder = function(productId) {
  const modal = document.getElementById('quick-view-modal');
  if (modal) modal.classList.remove('active');
  selectForOrder(productId);
};

// 9. Mobile Navigation Drawer
function initMobileNav() {
  const toggle = document.getElementById('menu-toggle');
  const drawer = document.getElementById('mobile-drawer');
  const closeBtn = document.getElementById('drawer-close');
  const overlay = document.getElementById('drawer-overlay');

  const openDrawer = () => {
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
  };

  if (toggle) toggle.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', closeDrawer);

  document.querySelectorAll('.drawer-link, .mobile-nav-drawer a.btn').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });
}

// 10. Scroll Effects
function initScrollEffects() {
  const header = document.querySelector('.site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

// 11. Toast Utility
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' ? 'ph-check-circle' : (type === 'error' ? 'ph-warning-circle' : 'ph-info');
  toast.innerHTML = `<i class="ph ${icon}" style="color: var(--volt-primary); font-size: 1.25rem;"></i><span>${message}</span>`;
  
  container.appendChild(toast);

  // Trigger entrance
  requestAnimationFrame(() => toast.classList.add('show'));

  // Remove after 3.5s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}
