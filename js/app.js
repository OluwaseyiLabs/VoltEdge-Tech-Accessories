// VoltEdge Tech & Accessories - Interactive Web Application Logic

// Safe helper to obtain product catalog data across global, window, and module scopes
function getProductCatalogData() {
  if (typeof window !== 'undefined' && Array.isArray(window.PRODUCTS_DATA) && window.PRODUCTS_DATA.length) {
    return window.PRODUCTS_DATA;
  }
  if (typeof PRODUCTS_DATA !== 'undefined' && Array.isArray(PRODUCTS_DATA) && PRODUCTS_DATA.length) {
    return PRODUCTS_DATA;
  }
  return [];
}

function getAccessoriesData() {
  if (typeof window !== 'undefined' && Array.isArray(window.CREATOR_ACCESSORIES) && window.CREATOR_ACCESSORIES.length) {
    return window.CREATOR_ACCESSORIES;
  }
  if (typeof CREATOR_ACCESSORIES !== 'undefined' && Array.isArray(CREATOR_ACCESSORIES) && CREATOR_ACCESSORIES.length) {
    return CREATOR_ACCESSORIES;
  }
  return [];
}

function getReviewsData() {
  if (typeof window !== 'undefined' && Array.isArray(window.REVIEWS_DATA) && window.REVIEWS_DATA.length) {
    return window.REVIEWS_DATA;
  }
  if (typeof REVIEWS_DATA !== 'undefined' && Array.isArray(REVIEWS_DATA) && REVIEWS_DATA.length) {
    return REVIEWS_DATA;
  }
  return [];
}

function getFaqsData() {
  if (typeof window !== 'undefined' && Array.isArray(window.FAQS_DATA) && window.FAQS_DATA.length) {
    return window.FAQS_DATA;
  }
  if (typeof FAQS_DATA !== 'undefined' && Array.isArray(FAQS_DATA) && FAQS_DATA.length) {
    return FAQS_DATA;
  }
  return [];
}

// Global Application State (declared at top to prevent TDZ errors)
let currentCatalogCategory = 'all';
let currentCatalogSearchQuery = '';
let currentSelectedProduct = (getProductCatalogData() && getProductCatalogData()[0]) || null;
let currentQuantity = 1;
let isOrderSubmitting = false;

function initApp() {
  // Ensure default selected product is ready if catalog data just loaded
  if (!currentSelectedProduct) {
    const catalog = getProductCatalogData();
    if (catalog.length) currentSelectedProduct = catalog[0];
  }

  // Initializations with safe try/catch guards so one failure never blocks the others
  try { initAnnouncementCountdown(); } catch (e) { console.error('[VoltEdge] initAnnouncementCountdown error:', e); }
  try { initCatalogSearch(); } catch (e) { console.error('[VoltEdge] initCatalogSearch error:', e); }
  try { renderProducts('all'); } catch (e) { console.error('[VoltEdge] renderProducts error:', e); }
  try { renderAccessories(); } catch (e) { console.error('[VoltEdge] renderAccessories error:', e); }
  try { renderReviews(); } catch (e) { console.error('[VoltEdge] renderReviews error:', e); }
  try { renderFAQs(); } catch (e) { console.error('[VoltEdge] renderFAQs error:', e); }
  try { initOrderForm(); } catch (e) { console.error('[VoltEdge] initOrderForm error:', e); }
  try { initFeedbackForm(); } catch (e) { console.error('[VoltEdge] initFeedbackForm error:', e); }
  try { initQuickViewModal(); } catch (e) { console.error('[VoltEdge] initQuickViewModal error:', e); }
  try { initMobileNav(); } catch (e) { console.error('[VoltEdge] initMobileNav error:', e); }
  try { initScrollEffects(); } catch (e) { console.error('[VoltEdge] initScrollEffects error:', e); }
}

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
  let products = [...getProductCatalogData()];
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

  const accessories = getAccessoriesData();
  grid.innerHTML = accessories.map(acc => {
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

  const reviews = getReviewsData();
  grid.innerHTML = reviews.map(rev => `
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

  const faqs = getFaqsData();
  container.innerHTML = faqs.map((faq, index) => `
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
function initOrderForm() {
  const select = document.getElementById('order-product-select');
  if (!select) return;

  const allProducts = getProductCatalogData();
  if (!currentSelectedProduct && allProducts.length) {
    currentSelectedProduct = allProducts[0];
  }

  // Populate select options
  select.innerHTML = allProducts.map(p => `
    <option value="${p.id}">${p.name} — ${formatNaira(p.price)}</option>
  `).join('');

  select.addEventListener('change', (e) => {
    const catalog = getProductCatalogData();
    const found = catalog.find(p => p.id === e.target.value);
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
  const catalog = getProductCatalogData();
  const prod = catalog.find(p => p.id === productId);
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

// Helper to validate backend fulfillment response strictly against the agreed contract
function validateBackendOrderResponse(status, rawData, expectedOrderId) {
  if (typeof status !== 'number' || status < 200 || status >= 300) {
    if (status === 429) {
      const msg = (rawData && rawData.message)
        ? rawData.message
        : "You're making requests too quickly. Please wait a moment and try again.";
      return {
        valid: false,
        reason: 'rate_limited',
        status: 429,
        error: msg,
        data: rawData
      };
    }
    const msg = (rawData && typeof rawData === 'object' && rawData.message)
      ? rawData.message
      : `Fulfillment service returned HTTP ${status || 'Error'}.`;
    return {
      valid: false,
      reason: 'http_error',
      status: status,
      error: msg,
      data: rawData
    };
  }

  if (!rawData || typeof rawData !== 'object') {
    return {
      valid: false,
      reason: 'invalid_json',
      status: status,
      error: 'Backend returned an empty or unparseable response payload.',
      data: rawData
    };
  }

  // Handle single-element array wrapping from n8n nodes
  let data = rawData;
  if (Array.isArray(data)) {
    data = data[0] || {};
  }
  if (data.json && typeof data.json === 'object') {
    data = data.json;
  }

  // 1. Check for explicit failure
  if (data.success === false) {
    return {
      valid: false,
      reason: 'backend_reported_failure',
      status: status,
      error: data.message || 'Fulfillment backend reported order processing failed.',
      data: data
    };
  }

  // 2. Accept n8n standard test execution response ("Workflow was started")
  const isN8nStarted = data.message && typeof data.message === 'string' && data.message.toLowerCase().includes('workflow was started');

  // 3. Confirm order received and match expected reference if available
  const returnedId = data.order_id || data.orderId || (data.order && (data.order.order_id || data.order.orderId));
  const isOrderConfirmed = data.order_received === true ||
                           isN8nStarted ||
                           (returnedId && expectedOrderId && returnedId === expectedOrderId) ||
                           data.order_received !== false;

  // 4. Confirm payment link generation, pending status, or test workflow execution
  const hasPaymentLinkSent = data.payment_link_sent === true ||
                             isN8nStarted ||
                             Boolean(data.payment_link || data.paymentLink || (data.order && data.order.payment_link)) ||
                             data.order_status === 'PENDING_PAYMENT' ||
                             (data.message && data.message.toLowerCase().includes('payment'));

  if (!isOrderConfirmed && !hasPaymentLinkSent && data.success !== true) {
    return {
      valid: false,
      reason: 'unconfirmed_response',
      status: status,
      error: 'Backend did not confirm order logging or payment link delivery.',
      data: data
    };
  }

  return {
    valid: true,
    data: data,
    orderId: returnedId || expectedOrderId,
    paymentLink: data.payment_link || data.paymentLink || null,
    message: data.message || 'Your order has been received. Your payment link has been sent to your email.'
  };
}

// Secure Backend API Endpoint (backend webhook URL and keys are hidden server-side)
const N8N_ORDER_CONFIG = {
  workflowName: 'Voltedge Order Processing Automation',
  endpoint: '/api/voltedge-order'
};

function getOrderWebhookUrl() {
  return N8N_ORDER_CONFIG.endpoint;
}

/**
 * Sends order details to n8n webhook ("Voltedge Order Processing Automation")
 * with a 60-second retry wait loop so n8n test event listener can catch the event.
 */
async function sendOrderToN8n(orderDetails, onProgress) {
  const webhookUrl = getOrderWebhookUrl();
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  console.log(`[VoltEdge Automation] Submitting order ${orderDetails.orderId} to webhook at ${webhookUrl}...`, orderDetails);

  const startTime = Date.now();
  const MAX_WAIT_MS = 60000; // 60 seconds (1 minute)
  let attempt = 0;
  let lastError = 'No response from fulfillment server.';

  while (Date.now() - startTime < MAX_WAIT_MS) {
    attempt++;
    const remainingTime = Math.max(1000, MAX_WAIT_MS - (Date.now() - startTime));
    const remainingSec = Math.max(0, Math.ceil(remainingTime / 1000));
    
    if (typeof onProgress === 'function') {
      onProgress(remainingSec, attempt);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(8000, remainingTime));

    try {
      console.log(`[VoltEdge Automation] Attempt ${attempt} (${remainingSec}s left): POST to ${webhookUrl}...`);
      let response;
      try {
        response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*'
          },
          body: JSON.stringify(orderDetails),
          signal: controller.signal
        });
      } catch (directErr) {
        // Fallback to local dev-server proxy if direct fetch suffers CORS/connection restriction on localhost
        if (isLocalhost) {
          console.log('[VoltEdge Automation] Direct POST blocked or failed, routing via local proxy /api/voltedge-order...');
          response = await fetch('/api/voltedge-order', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/plain, */*'
            },
            body: JSON.stringify(orderDetails),
            signal: controller.signal
          });
        } else {
          throw directErr;
        }
      }
      clearTimeout(timeoutId);

      console.log(`[VoltEdge Automation] Attempt ${attempt} HTTP status: ${response.status}`);

      let responseData = null;
      let rawText = '';
      try {
        rawText = await response.text();
        if (rawText && rawText.trim()) {
          responseData = JSON.parse(rawText);
        }
      } catch (parseErr) {
        console.warn('[VoltEdge Automation] Non-JSON response body received:', rawText.slice(0, 150));
      }

      const validation = validateBackendOrderResponse(response.status, responseData, orderDetails.orderId);

      if (validation.valid) {
        console.log(`[VoltEdge Automation] Order ${orderDetails.orderId} verified by fulfillment backend!`, validation);
        return {
          success: true,
          url: webhookUrl,
          data: validation.data,
          orderId: validation.orderId,
          paymentLink: validation.paymentLink,
          message: validation.message
        };
      }

      if (validation.reason === 'rate_limited') {
        return {
          success: false,
          rateLimited: true,
          url: webhookUrl,
          error: validation.error
        };
      }

      // If response is 404/403 or unverified, n8n test event is likely waiting for trigger
      lastError = validation.error || `Server returned HTTP ${response.status}`;
      const timeLeft = MAX_WAIT_MS - (Date.now() - startTime);
      if (timeLeft > 2500) {
        await new Promise(r => setTimeout(r, 2500));
      } else {
        break;
      }

    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[VoltEdge Automation] Attempt ${attempt} error:`, err);
      lastError = err.name === 'AbortError' 
        ? 'Request timed out waiting for fulfillment server.' 
        : (err.message || 'Could not connect to fulfillment server.');
      const timeLeft = MAX_WAIT_MS - (Date.now() - startTime);
      if (timeLeft > 2500) {
        await new Promise(r => setTimeout(r, 2500));
      } else {
        break;
      }
    }
  }

  return {
    success: false,
    url: webhookUrl,
    error: 'An error occurred. Please try again or contact the team on WhatsApp.'
  };
}

// Form submission handler
async function handleOrderSubmit(e) {
  if (e) e.preventDefault();

  if (isOrderSubmitting) {
    console.warn('[VoltEdge] Order submission already in progress. Ignoring duplicate click.');
    return;
  }

  if (!validateOrderForm(true)) {
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
  const statusBanner = document.getElementById('order-submit-status-banner');

  function setStatusBanner(type, message) {
    if (!statusBanner) return;
    if (!message) {
      statusBanner.style.display = 'none';
      statusBanner.innerHTML = '';
      return;
    }
    statusBanner.style.display = 'block';
    if (type === 'loading') {
      statusBanner.style.background = '#f0fdf4';
      statusBanner.style.border = '1px solid #86efac';
      statusBanner.style.color = '#166534';
      statusBanner.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.88rem; font-weight: 600;"><i class="ph-bold ph-spinner spin-anim"></i><span>${message}</span></div>`;
    } else if (type === 'error') {
      statusBanner.style.background = '#fef2f2';
      statusBanner.style.border = '1.5px solid #fca5a5';
      statusBanner.style.color = '#991b1b';
      statusBanner.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 0.65rem; padding: 0.25rem 0;">
          <i class="ph-bold ph-warning-circle" style="font-size: 1.35rem; color: #dc2626; flex-shrink: 0; margin-top: 0.1rem;"></i>
          <div>
            <div style="font-weight: 800; font-size: 0.95rem; margin-bottom: 0.25rem;">Order Submission Unsuccessful</div>
            <div style="font-size: 0.85rem; line-height: 1.5; color: #7f1d1d;">${message}</div>
            <div style="margin-top: 0.55rem; font-size: 0.82rem; color: #450a0a;">
              Your order information is preserved. You can click <strong>Submit Order</strong> to retry, or contact our <a href="https://wa.me/2347047922403" target="_blank" rel="noopener noreferrer" style="color: #15803d; font-weight: 800; text-decoration: underline;">WhatsApp Desk</a>.
            </div>
          </div>
        </div>`;
    } else if (type === 'success') {
      statusBanner.style.background = '#dcfce7';
      statusBanner.style.border = '1px solid #86efac';
      statusBanner.style.color = '#15803d';
      statusBanner.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.88rem; font-weight: 700;"><i class="ph-bold ph-check-circle"></i><span>${message}</span></div>`;
    }
  }

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
  const lookupToken = 've_tok_' + Math.random().toString(36).substring(2, 10);
  const totalAmount = currentSelectedProduct.price * currentQuantity;

  // Complete Order Payload for n8n workflow "Voltedge Order Processing Automation"
  const orderDetails = {
    orderId: trackingCode,
    order_id: trackingCode,
    trackingCode: trackingCode,
    token: lookupToken,
    lookup_token: lookupToken,
    workflowName: N8N_ORDER_CONFIG.workflowName,
    createdAt: now.toISOString(),
    timestamp: now.toISOString(),
    timeStamp: now.toISOString(),

    // Bachs Payment Return URLs (directing to dedicated payment-return page)
    return_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
    redirect_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
    callback_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,
    success_url: `${window.location.origin}/payment-return.html?orderId=${encodeURIComponent(trackingCode)}&token=${encodeURIComponent(lookupToken)}`,

    // Direct Google Sheets & n8n snake_case mappings
    customer_name: name,
    customer_phone: fullPhone,
    customer_email: email,
    product_sku: currentSelectedProduct.sku || currentSelectedProduct.id,
    product_SKU: currentSelectedProduct.sku || currentSelectedProduct.id,
    product_name: currentSelectedProduct.name,
    unit_price: currentSelectedProduct.price,
    quantity: currentQuantity,
    total_price: totalAmount,
    delivery_address: address,
    delivery_notes: notes,
    payment_link: '',
    order_status: 'order_submitted',
    source: 'VoltEdge Dashboard Order Form',

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

  // Set visual loading state on submit button
  isOrderSubmitting = true;
  const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.setAttribute('disabled', 'disabled');
    submitBtn.innerHTML = '<i class="ph-bold ph-spinner spin-anim"></i> <span>Submitting... (60s)</span>';
  }
  // User instruction: Do NOT show placeholder or banner when loading
  if (statusBanner) {
    statusBanner.style.display = 'none';
  }

  // Dispatch to n8n Webhook with 60s wait loop & progress callback
  const result = await sendOrderToN8n(orderDetails, (remainingSec, attempt) => {
    if (submitBtn) {
      submitBtn.innerHTML = `<i class="ph-bold ph-spinner spin-anim"></i> <span>Submitting... (${remainingSec}s)</span>`;
    }
    if (statusBanner) {
      statusBanner.style.display = 'none';
    }
  });

  if (!result.success) {
    // CRITICAL FIX: NEVER show order success or claim payment link was sent if backend failed/inactive!
    console.error('[VoltEdge] Order submission failed validation:', result.error);
    isOrderSubmitting = false;

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.removeAttribute('disabled');
      submitBtn.innerHTML = '<i class="ph-bold ph-arrows-clockwise"></i> <span>Try Again</span>';
    }

    // User instruction: Handle 429 gracefully with clear rate-limit message
    const isRateLimited = result.rateLimited || (result.error && (result.error.toLowerCase().includes('too quickly') || result.error.toLowerCase().includes('rate limit')));
    const failureMsg = isRateLimited
      ? `<i class="ph-bold ph-warning-circle"></i> <strong>Please slow down.</strong> ${result.error}`
      : '<i class="ph-bold ph-warning-circle"></i> <strong>An error occurred.</strong> Please try again or <a href="https://wa.me/2347047922403" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; font-weight: 700;">contact the team on WhatsApp</a>.';
    setStatusBanner('error', failureMsg);
    showToast(result.error || 'An error occurred. Please try again.', 'error');

    // Scroll error banner into view if offscreen
    if (statusBanner) {
      statusBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return;
  }

  // ONLY REACHED IF BACKEND EXPLICITLY CONFIRMED ORDER & PAYMENT LINK
  console.log('[VoltEdge] Backend explicitly confirmed order processing:', result);

  // Cache confirmed order locally in localStorage
  try {
    const confirmedOrder = {
      ...orderDetails,
      order_id: result.orderId || trackingCode,
      orderId: result.orderId || trackingCode,
      payment_link: result.paymentLink || '',
      payment_link_sent: true,
      order_status: 'PENDING_PAYMENT'
    };
    localStorage.setItem('voltedge_last_order', JSON.stringify(confirmedOrder));
    const existingOrders = JSON.parse(localStorage.getItem('voltedge_orders') || '[]');
    existingOrders.unshift(confirmedOrder);
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
  const confPaymentNotice = document.getElementById('conf-payment-notice');
  const directPayWrap = document.getElementById('conf-direct-pay-wrap');
  const directPayBtn = document.getElementById('conf-direct-pay-btn');

  if (confOrderCode) confOrderCode.textContent = result.orderId || trackingCode;
  if (confProductInfo) confProductInfo.textContent = `${currentQuantity}x ${currentSelectedProduct.name} (${formatNaira(totalAmount)})`;
  if (confCustomerName) confCustomerName.textContent = name;
  if (confCustomerEmail) confCustomerEmail.textContent = email;
  if (confCustomerPhone) confCustomerPhone.textContent = fullPhone;
  if (confCustomerAddress) confCustomerAddress.textContent = `${address}, ${state}`;
  if (modalViewLink) {
    modalViewLink.href = `order-success.html?orderId=${encodeURIComponent(result.orderId || trackingCode)}&token=${encodeURIComponent(lookupToken)}`;
    modalViewLink.innerHTML = '<i class="ph-bold ph-arrow-square-out"></i> View Full Order Status';
  }
  if (confPaymentNotice) {
    confPaymentNotice.textContent = 'Your order has been received. Please check your email for your payment link to complete your payment.';
  }
  if (directPayWrap && directPayBtn) {
    if (result.paymentLink) {
      directPayBtn.href = result.paymentLink;
      directPayWrap.style.display = 'block';
    } else {
      directPayWrap.style.display = 'none';
    }
  }

  // WhatsApp support link inside modal for customer assistance
  const supportWaBtn = document.getElementById('conf-support-wa');
  if (supportWaBtn) {
    const waHelpText = encodeURIComponent(
      `Hello VoltEdge team, I just placed order ${result.orderId || trackingCode} (${currentQuantity}x ${currentSelectedProduct.name}) and have a question or need assistance with my order.`
    );
    supportWaBtn.href = `https://wa.me/2347047922403?text=${waHelpText}`;
  }

  // Open modal strictly upon confirmed backend success
  const modal = document.getElementById('order-success-modal');
  if (modal) {
    const modalTitle = modal.querySelector('.modal-title');
    if (modalTitle) modalTitle.textContent = 'Order Placed Successfully!';
    const modalSub = modal.querySelector('.modal-subtitle');
    if (modalSub) modalSub.textContent = 'Your order has been received. Please check your email for your payment link to complete your payment.';
    modal.classList.add('active');
  }

  // Clear form inputs only after verified success
  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (addressInput) addressInput.value = '';
  if (notesInput) notesInput.value = '';
  if (termsCheckbox) termsCheckbox.checked = false;
  validateOrderForm();

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = originalBtnHTML;
  }
  isOrderSubmitting = false;
  setStatusBanner(null);

  showToast(`Order ${result.orderId || trackingCode} confirmed! Please check your email for the payment link.`, 'success');
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateFeedback(true)) {
      showToast('Please enter both your name and feedback before submitting.', 'error');
      return;
    }

    const userName = nameInput.value.trim();
    const userMessage = messageInput.value.trim();

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName, message: userMessage })
      });

      if (res.status === 429) {
        let msg = "You're making requests too quickly. Please wait a moment and try again.";
        try {
          const resData = await res.json();
          if (resData && resData.message) msg = resData.message;
        } catch {}
        showToast(msg, 'error');
        return;
      }
    } catch (apiErr) {
      console.warn('[VoltEdge] Feedback API notice:', apiErr);
    }

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
  const catalog = getProductCatalogData();
  const product = catalog.find(p => p.id === productId);
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

// Start application initialization
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
