// Extract reviews from Amazon product pages and send them to the background script

console.log("🚀 Fake Review Detector: Content script loaded!");

// ============================================================================
// PAGE TYPE DETECTION
// ============================================================================

function isProductPage() {
  return /\/dp\//.test(location.pathname) || /\/gp\/product\//.test(location.pathname);
}

function isReviewsPage() {
  return /\/product-reviews\//.test(location.pathname);
}

function detectCaptcha() {
  const bodyText = document.body.innerText || "";
  return /type the characters you see/i.test(bodyText) || 
         /enter the characters/i.test(bodyText) ||
         document.querySelector('form[action*="/errors/validateCaptcha"]') !== null;
}

function extractReviews() {
  console.log("🔍 Starting review extraction...");
  const reviews = [];

  // This targets the review list on typical Amazon product pages.
  // Amazon can change DOM structure, so this is a best-effort starter.
  const reviewElements = document.querySelectorAll("[id^='customer_review-'], [data-hook='review']");
  console.log(`📝 Found ${reviewElements.length} review elements (including all sections)`);

  reviewElements.forEach((el, index) => {
    try {
      const id = el.id || null;

      const titleEl = el.querySelector(".review-title, .review-title-content span");
      const title = titleEl ? titleEl.textContent.trim() : "";

      const bodyEl = el.querySelector(".review-text-content span, .review-text");
      const body = bodyEl ? bodyEl.textContent.trim() : "";

      const ratingEl = el.querySelector("[data-hook='review-star-rating'] span, .a-icon-alt");
      let rating = null;
      if (ratingEl && ratingEl.textContent) {
        const match = ratingEl.textContent.match(/([0-9.]+) out of 5/);
        rating = match ? parseFloat(match[1]) : null;
      }

      const authorEl = el.querySelector("[data-hook='review-author']");
      const author = authorEl ? authorEl.textContent.trim() : "";

      const dateEl = el.querySelector("[data-hook='review-date']");
      const date = dateEl ? dateEl.textContent.trim() : "";

      const section = getReviewSection(el);

      if (body || title) {
        reviews.push({ id, title, body, rating, author, date, section });
        console.log(`✅ Extracted review ${index + 1} [section: ${section}]:`, { id, title: title.substring(0, 30) + "..." });
      }
    } catch (e) {
      console.error(`❌ Error extracting review ${index}:`, e);
    }
  });

  console.log(`✨ Total reviews extracted: ${reviews.length}`);
  return reviews;
}

function getReviewSection(reviewElement) {
  try {
    // Default when we can't confidently determine section
    let section = "unknown";

    // Heuristic 1: look upwards for any container mentioning "From other countries"
    let node = reviewElement;
    while (node) {
      if (node.textContent && /from other countries/i.test(node.textContent)) {
        section = "from_other_countries";
        break;
      }
      node = node.parentElement;
    }

    if (section !== "unknown") {
      return section;
    }

    // Heuristic 2: look for "Top reviews from" (usually the local-country block)
    node = reviewElement;
    while (node) {
      if (node.textContent && /top reviews from/i.test(node.textContent)) {
        section = "from_your_country";
        break;
      }
      node = node.parentElement;
    }

    return section;
  } catch (e) {
    console.warn("⚠️ Unable to determine review section", e);
    return "unknown";
  }
}

function sendReviews() {
  console.log("📤 Attempting to send reviews...");
  const reviews = extractReviews();
  
  if (!reviews.length) {
    console.warn("⚠️ No reviews found to send");
    return;
  }

  console.log(`📨 Sending ${reviews.length} reviews to background script...`);
  
  chrome.runtime.sendMessage({
    type: "REVIEWS_EXTRACTED",
    payload: { reviews },
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("❌ Error sending message:", chrome.runtime.lastError);
    } else {
      console.log("✅ Message sent successfully, response:", response);
    }
  });
}

// Run once after page load settles
console.log("⏳ Waiting 2 seconds before extracting reviews...");
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(() => {
    console.log("⏰ Timeout complete, running extraction now!");
    sendReviews();
  }, 2000);
} else {
  window.addEventListener("DOMContentLoaded", () => {
    console.log("📄 DOMContentLoaded event fired");
    setTimeout(() => {
      console.log("⏰ Timeout complete, running extraction now!");
      sendReviews();
    }, 2000);
  });
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handler 1: Quick extraction (original behavior)
  if (message.type === "EXTRACT_REVIEWS") {
    console.log("📥 Received EXTRACT_REVIEWS message from popup");
    const reviews = extractReviews();
    if (!reviews.length) {
      console.warn("⚠️ No reviews found on EXTRACT_REVIEWS trigger");
    } else {
      console.log(`📨 Sending ${reviews.length} reviews to background script (popup trigger)...`);
    }

    chrome.runtime.sendMessage(
      {
        type: "REVIEWS_EXTRACTED",
        payload: { reviews },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("❌ Error sending reviews from EXTRACT_REVIEWS trigger:", chrome.runtime.lastError);
        } else {
          console.log("✅ Reviews sent from EXTRACT_REVIEWS trigger, response:", response);
        }
      }
    );

    sendResponse({ success: true, count: reviews.length });
    return true;
  }

  // Handler 2: Get "See all reviews" URL (for product pages)
  if (message.type === "GET_ALL_REVIEWS_URL") {
    console.log("📥 Received GET_ALL_REVIEWS_URL request");
    
    if (!isProductPage()) {
      console.warn("⚠️ Not a product page, cannot get reviews URL");
      sendResponse({ error: "Not a product page" });
      return true;
    }

    try {
      // Try multiple selectors for "See all reviews" link
      const selectors = [
        'a[data-hook="see-all-reviews-link-foot"]',
        'a[href*="/product-reviews/"]',
        'a[data-hook="see-all-reviews-link"]'
      ];

      let reviewsLink = null;
      for (const selector of selectors) {
        reviewsLink = document.querySelector(selector);
        if (reviewsLink) break;
      }

      if (!reviewsLink) {
        console.error("❌ Could not find 'See all reviews' link");
        sendResponse({ error: "Could not find reviews link" });
        return true;
      }

      // Extract ASIN from the reviews link
      const asinMatch = reviewsLink.href.match(/\/product-reviews\/([A-Z0-9]{10})/);
      if (!asinMatch) {
        console.error("❌ Could not extract ASIN from reviews URL:", reviewsLink.href);
        sendResponse({ error: "Could not extract ASIN from reviews URL" });
        return true;
      }

      const asin = asinMatch[1];
      
      // Get the domain from the current page
      const domain = location.origin;
      
      // Build properly formatted URL with ALL required parameters
      const url = `${domain}/product-reviews/${asin}/ref=cm_cr_dp_mb_show_all_top?ie=UTF8&reviewerType=all_reviews`;
      
      console.log("✅ Built reviews URL with required parameters:", url);
      sendResponse({ url });
    } catch (e) {
      console.error("❌ Error finding reviews URL:", e);
      sendResponse({ error: e.message });
    }
    return true;
  }

  // Handler 3: Scrape current reviews page (for /product-reviews/ pages)
  if (message.type === "SCRAPE_REVIEW_PAGE") {
    console.log("📥 Received SCRAPE_REVIEW_PAGE request");
    
    if (!isReviewsPage()) {
      console.warn("⚠️ Not a reviews page, cannot scrape");
      sendResponse({ error: "Not a reviews page" });
      return true;
    }

    try {
      // Check for CAPTCHA
      if (detectCaptcha()) {
        console.error("🚫 CAPTCHA detected on page");
        chrome.runtime.sendMessage({
          type: "PAGE_REVIEWS",
          jobId: message.jobId,
          captchaDetected: true,
          error: "CAPTCHA detected"
        });
        sendResponse({ error: "CAPTCHA detected" });
        return true;
      }

      // Extract reviews from current page
      const reviews = extractReviews();
      console.log(`✅ Extracted ${reviews.length} reviews from current page`);

      // Get total review count
      let totalCount = null;
      const totalCountEl = document.querySelector('[data-hook="cr-filter-info-review-rating-count"]');
      if (totalCountEl) {
        const match = totalCountEl.textContent.match(/([0-9,]+)\s+global ratings?/i);
        if (match) {
          totalCount = parseInt(match[1].replace(/,/g, ''), 10);
          console.log(`📊 Total reviews: ${totalCount}`);
        }
      }

      // CRITICAL DEBUGGING: Log actual current URL
      console.log(`🔍 ACTUAL CURRENT URL: ${location.href}`);
      console.log(`🔍 URL search params: ${location.search}`);
      
      // Get current page number from URL or pagination
      let currentPage = 1;
      const urlParams = new URLSearchParams(location.search);
      const pageParam = urlParams.get('pageNumber');
      console.log(`🔍 pageNumber param from URL: ${pageParam}`);
      
      // ALWAYS prioritize pagination UI over URL parameter (Amazon may redirect)
      const paginationText = document.querySelector('.a-pagination .a-selected');
      if (paginationText) {
        const pageNum = parseInt(paginationText.textContent.trim(), 10);
        console.log(`🔍 Page number from pagination UI: ${pageNum}`);
        if (!isNaN(pageNum)) {
          currentPage = pageNum;
        }
      } else if (pageParam) {
        // Only use URL param if no pagination UI found
        currentPage = parseInt(pageParam, 10);
        console.log(`🔍 Using URL param as fallback: ${currentPage}`);
      }
      
      console.log(`📄 Current page (FINAL): ${currentPage}`);

      // Find next page URL with multiple fallback selectors
      let nextPageUrl = null;
      
      // First, check if "Next" button is disabled (indicates last page)
      const disabledNext = document.querySelector('.a-pagination .a-last.a-disabled');
      if (disabledNext) {
        console.log("✅ Next button is disabled - this is the last page");
        nextPageUrl = null;
      } else {
        // Try to find the next page link
        const nextSelectors = [
          '.a-pagination .a-last:not(.a-disabled) a',
          'ul.a-pagination li.a-last:not(.a-disabled) a',
          '.a-pagination li.a-last a',
          'a[aria-label="Next page"]',
        ];
        
        for (const selector of nextSelectors) {
          const nextButton = document.querySelector(selector);
          if (nextButton && nextButton.href) {
            // Verify the href actually contains a page number
            if (nextButton.href.includes('pageNumber=') || nextButton.href.includes('ref=cm_cr_arp_d_paging')) {
              nextPageUrl = nextButton.href;
              console.log(`➡️ Next page URL found (${selector}): ${nextPageUrl}`);
              break;
            } else {
              console.warn(`⚠️ Found button with selector ${selector} but href doesn't look like pagination: ${nextButton.href}`);
            }
          }
        }
        
        // CRITICAL FIX: Add required parameters to nextPageUrl (OUTSIDE the loop)
        if (nextPageUrl) {
          try {
            console.log("🔍 BEFORE parameter addition:", nextPageUrl);
            
            const urlObj = new URL(nextPageUrl);
            
            if (!urlObj.searchParams.has('ie')) {
              urlObj.searchParams.set('ie', 'UTF8');
            }
            if (!urlObj.searchParams.has('reviewerType')) {
              urlObj.searchParams.set('reviewerType', 'all_reviews');
            }
            
            nextPageUrl = urlObj.toString();
            
            console.log("✅ AFTER parameter addition:", nextPageUrl);
          } catch (e) {
            console.error("❌ Error adding parameters:", e);
          }
        }
        
        // If still no URL found, log pagination structure for debugging
        if (!nextPageUrl) {
          console.log("🔍 Debugging: Could not find next page button");
          const pagination = document.querySelector('.a-pagination');
          if (pagination) {
            console.log("Pagination HTML:", pagination.innerHTML);
          }
          console.log("✅ No next page - this is the last page");
        }
      }

      // Calculate total pages (approximate)
      let totalPages = null;
      if (totalCount && reviews.length > 0) {
        // Amazon typically shows 10-14 reviews per page, use 10 for conservative estimate
        totalPages = Math.ceil(totalCount / 10);
      }
      
      // Try to get exact total pages from pagination
      const paginationNumbers = document.querySelectorAll('.a-pagination li:not(.a-disabled) a');
      if (paginationNumbers.length > 0) {
        let maxPage = 0;
        paginationNumbers.forEach(el => {
          const pageNum = parseInt(el.textContent.trim(), 10);
          if (!isNaN(pageNum) && pageNum > maxPage) {
            maxPage = pageNum;
          }
        });
        if (maxPage > 0) {
          totalPages = maxPage;
          console.log(`📊 Total pages from pagination: ${totalPages}`);
        }
      }

      // Send results back to background
      chrome.runtime.sendMessage({
        type: "PAGE_REVIEWS",
        jobId: message.jobId,
        reviews,
        totalCount,
        currentPage,
        totalPages,
        nextPageUrl,
        captchaDetected: false
      });

      sendResponse({ success: true, count: reviews.length });
    } catch (e) {
      console.error("❌ Error scraping review page:", e);
      chrome.runtime.sendMessage({
        type: "PAGE_REVIEWS",
        jobId: message.jobId,
        error: e.message,
        captchaDetected: false
      });
      sendResponse({ error: e.message });
    }
    return true;
  }
});