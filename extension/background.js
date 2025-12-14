// Background service worker: receives reviews from content script and
// forwards them to the Vercel backend /api/analyze

// TODO: Replace with your deployed Vercel URL
const BACKEND_ANALYZE_URL = "https://amazon-review-detector.vercel.app/api/analyze";

// ============================================================================
// JOB STATE MANAGEMENT
// ============================================================================

const jobs = {}; // In-memory job state: { [jobId]: { ... } }

function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function findJobByTabId(tabId) {
  return Object.keys(jobs).find(jobId => jobs[jobId].reviewsTabId === tabId);
}

async function saveJobState() {
  await chrome.storage.local.set({ jobs });
}

async function loadJobState() {
  const result = await chrome.storage.local.get('jobs');
  if (result.jobs) {
    Object.assign(jobs, result.jobs);
  }
}

async function failJob(jobId, errorMessage) {
  const job = jobs[jobId];
  if (!job) return;

  console.error(`❌ Job ${jobId} failed: ${errorMessage}`);
  job.status = "error";
  job.error = errorMessage;
  await saveJobState();

  notifyPopup({
    type: "EXTRACTION_ERROR",
    jobId,
    error: errorMessage,
  });

  if (job.reviewsTabId) {
    try {
      await chrome.tabs.remove(job.reviewsTabId);
    } catch (e) {
      console.warn("Could not close tab:", e);
    }
  }
  delete jobs[jobId];
  await saveJobState();
}

// Load job state on startup
loadJobState();

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handler 1: Quick extraction (original behavior)
  if (message.type === "REVIEWS_EXTRACTED") {
    const { reviews } = message.payload || {};
    if (!Array.isArray(reviews) || !reviews.length) return;

    console.log("Background received", reviews.length, "reviews");

    // Send each review individually to the backend
    reviews.forEach((review) => {
      const body = {
        text: review.body || "",
        metadata: review,
      };

      fetch(BACKEND_ANALYZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            console.log("/api/analyze response for review", review.id, data);
          } catch (e) {
            console.error(
              "Non-JSON response from /api/analyze for review",
              review.id,
              "status",
              res.status,
              "body snippet:",
              text.slice(0, 200)
            );
            throw e;
          }
        })
        .catch((err) => {
          console.error("Error calling /api/analyze for review", review.id, err);
        });
    });

    sendResponse({ ok: true });
    return true;
  }

  // Handler 2: Start full extraction job
  if (message.type === "START_FULL_EXTRACTION") {
    handleStartFullExtraction(sender);
    sendResponse({ ok: true });
    return true;
  }

  // Handler 3: Cancel extraction job
  if (message.type === "CANCEL_EXTRACTION") {
    handleCancelExtraction(message.jobId);
    sendResponse({ ok: true });
    return true;
  }

  // Handler 4: Page reviews received from content script
  if (message.type === "PAGE_REVIEWS") {
    handlePageReviews(message);
    return true;
  }
});

// ============================================================================
// URL NORMALIZATION HELPER
// ============================================================================

function normalizeReviewUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    
    // Extract only the essential parameters for comparison
    const pageNumber = params.get('pageNumber') || '1';
    const asinMatch = urlObj.pathname.match(/\/product-reviews\/([A-Z0-9]{10})/);
    const asin = asinMatch ? asinMatch[1] : '';
    
    // Create normalized key: domain + path + ASIN + pageNumber
    return `${urlObj.origin}${urlObj.pathname}?pageNumber=${pageNumber}`;
  } catch (e) {
    console.error("Error normalizing URL:", e);
    return url;
  }
}

// ============================================================================
// FULL EXTRACTION JOB HANDLERS
// ============================================================================

async function handleStartFullExtraction(sender) {
  console.log("🚀 Starting full extraction job...");

  try {
    // Get the active tab (should be product page)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      notifyPopup({ type: "EXTRACTION_ERROR", error: "No active tab found" });
      return;
    }

    // Ask content script for "See all reviews" URL
    chrome.tabs.sendMessage(tab.id, { type: "GET_ALL_REVIEWS_URL" }, async (response) => {
      if (chrome.runtime.lastError || !response || response.error) {
        const error = response?.error || chrome.runtime.lastError?.message || "Unknown error";
        console.error("❌ Failed to get reviews URL:", error);
        notifyPopup({ type: "EXTRACTION_ERROR", error: `Failed to get reviews URL: ${error}` });
        return;
      }

      const reviewsUrl = response.url;
      console.log("✅ Got reviews URL:", reviewsUrl);

      // Create job
      const jobId = generateJobId();
      jobs[jobId] = {
        jobId,
        status: "starting",
        productUrl: tab.url,
        reviewsTabId: null,
        totalCount: null,
        collectedCount: 0,
        currentPage: 0,
        totalPages: null,
        seenReviewIds: new Set(),
        lastPageUrl: null,
        stuckPageCount: 0,
        reviews: [],
        error: null,
        startedAt: Date.now(),
        cancelledAt: null,
      };

      await saveJobState();

      // Open reviews page in background tab
      chrome.tabs.create({ url: reviewsUrl, active: false }, async (reviewsTab) => {
        jobs[jobId].reviewsTabId = reviewsTab.id;
        jobs[jobId].status = "running";
        await saveJobState();

        console.log(`✅ Opened reviews tab ${reviewsTab.id} for job ${jobId}`);
        notifyPopup({
          type: "EXTRACTION_PROGRESS",
          jobId,
          status: "Opening reviews page...",
          current: 0,
          total: null,
          currentPage: 0,
          totalPages: null,
        });
      });
    });
  } catch (error) {
    console.error("❌ Error starting full extraction:", error);
    notifyPopup({ type: "EXTRACTION_ERROR", error: error.message });
  }
}

async function handleCancelExtraction(jobId) {
  const job = jobs[jobId];
  if (!job) {
    console.warn("⚠️ Job not found:", jobId);
    return;
  }

  console.log("🛑 Cancelling job:", jobId);
  job.status = "cancelled";
  job.cancelledAt = Date.now();
  await saveJobState();

  // Close the reviews tab if it exists
  if (job.reviewsTabId) {
    try {
      await chrome.tabs.remove(job.reviewsTabId);
    } catch (e) {
      console.warn("⚠️ Could not close tab:", e);
    }
  }

  notifyPopup({
    type: "EXTRACTION_ERROR",
    jobId,
    error: "Extraction cancelled by user",
  });

  delete jobs[jobId];
  await saveJobState();
}

async function handlePageReviews(message) {
  const { jobId, reviews, totalCount, currentPage, totalPages, nextPageUrl, captchaDetected, error } = message;
  const job = jobs[jobId];

  if (!job) {
    console.warn("⚠️ Received PAGE_REVIEWS for unknown job:", jobId);
    return;
  }

  // Handle CAPTCHA
  if (captchaDetected) {
    console.error("🚫 CAPTCHA detected, stopping job");
    job.status = "error";
    job.error = "CAPTCHA detected. Please solve it manually and try again.";
    await saveJobState();

    notifyPopup({
      type: "EXTRACTION_ERROR",
      jobId,
      error: job.error,
    });

    // Leave tab open for user to solve CAPTCHA
    return;
  }

  // Handle errors
  if (error) {
    console.error("❌ Error from content script:", error);
    job.status = "error";
    job.error = error;
    await saveJobState();

    notifyPopup({
      type: "EXTRACTION_ERROR",
      jobId,
      error,
    });

    if (job.reviewsTabId) {
      await chrome.tabs.remove(job.reviewsTabId);
    }
    delete jobs[jobId];
    await saveJobState();
    return;
  }

  // Update job state with deduplication
  if (reviews && reviews.length > 0) {
    // Filter out duplicate reviews based on review ID
    const newReviews = reviews.filter(review => {
      if (!review.id) return true; // Keep reviews without IDs (shouldn't happen)
      if (job.seenReviewIds.has(review.id)) {
        console.log(`⚠️ Skipping duplicate review: ${review.id}`);
        return false;
      }
      job.seenReviewIds.add(review.id);
      return true;
    });
    
    if (newReviews.length > 0) {
      job.reviews.push(...newReviews);
      job.collectedCount = job.reviews.length;
      console.log(`✅ Added ${newReviews.length} new reviews (${reviews.length - newReviews.length} duplicates filtered)`);
    } else {
      console.warn(`⚠️ All ${reviews.length} reviews were duplicates - possible pagination issue`);
      // If we get all duplicates, increment stuck counter
      job.stuckPageCount = (job.stuckPageCount || 0) + 1;
      
      // If stuck for 3 consecutive pages, stop extraction
      if (job.stuckPageCount >= 3) {
        console.error(`❌ Stuck on same page for ${job.stuckPageCount} attempts - stopping extraction`);
        await failJob(jobId, "Pagination stuck - same reviews extracted multiple times");
        return;
      }
    }
  }

  if (totalCount && !job.totalCount) {
    job.totalCount = totalCount;
  }

  if (currentPage) {
    // Check if page actually advanced
    if (job.currentPage && currentPage <= job.currentPage) {
      console.warn(`⚠️ Page number did not advance: ${job.currentPage} -> ${currentPage}`);
      job.stuckPageCount = (job.stuckPageCount || 0) + 1;
    } else {
      job.stuckPageCount = 0; // Reset stuck counter on successful page advance
    }
    job.currentPage = currentPage;
  }

  if (totalPages && !job.totalPages) {
    job.totalPages = totalPages;
  }

  await saveJobState();

  console.log(`📊 Job ${jobId}: Collected ${job.collectedCount}/${job.totalCount || '?'} reviews (page ${job.currentPage}/${job.totalPages || '?'})`);

  // Send progress update to popup
  notifyPopup({
    type: "EXTRACTION_PROGRESS",
    jobId,
    status: `Extracted ${job.collectedCount}/${job.totalCount || '?'} reviews... Page ${job.currentPage}/${job.totalPages || '?'}`,
    current: job.collectedCount,
    total: job.totalCount,
    currentPage: job.currentPage,
    totalPages: job.totalPages,
  });

  // Decide next action
  if (nextPageUrl && job.status === "running") {
    // Safety check: prevent infinite loops
    if (job.currentPage > 100) {
      console.error(`❌ Safety limit reached: ${job.currentPage} pages`);
      await failJob(jobId, "Safety limit: extracted over 100 pages");
      return;
    }
    
    // Normalize URLs for comparison to prevent false positives from varying ref parameters
    const normalizedNextUrl = normalizeReviewUrl(nextPageUrl);
    const normalizedLastUrl = job.lastPageUrl ? normalizeReviewUrl(job.lastPageUrl) : null;
    
    console.log(`🔍 Normalized next URL: ${normalizedNextUrl}`);
    console.log(`🔍 Normalized last URL: ${normalizedLastUrl}`);
    
    // Check if we're stuck on the same URL (normalized comparison)
    if (normalizedLastUrl && normalizedNextUrl === normalizedLastUrl) {
      console.error(`❌ Next page URL is same as current (normalized): ${normalizedNextUrl}`);
      await failJob(jobId, "Pagination stuck - same URL repeated");
      return;
    }
    
    job.lastPageUrl = nextPageUrl;
    await saveJobState();
    
    // Continue to next page after delay
    console.log(`⏳ Waiting 2.5 seconds before loading next page...`);
    setTimeout(async () => {
      if (jobs[jobId] && jobs[jobId].status === "running") {
        console.log(`➡️ Loading next page: ${nextPageUrl}`);
        await chrome.tabs.update(job.reviewsTabId, { url: nextPageUrl });
      }
    }, 2500); // 2.5 second delay between pages
  } else {
    // No more pages - finalize job
    await finalizeJob(jobId);
  }
}

async function finalizeJob(jobId) {
  const job = jobs[jobId];
  if (!job) return;

  console.log(`✅ Job ${jobId} complete! Collected ${job.collectedCount} reviews`);
  job.status = "sending";
  await saveJobState();

  notifyPopup({
    type: "EXTRACTION_PROGRESS",
    jobId,
    status: `Sending ${job.collectedCount} reviews to backend...`,
    current: job.collectedCount,
    total: job.totalCount,
  });

  // Send all reviews to backend in batch
  try {
    await sendReviewsToBackend(job.reviews);
    
    job.status = "done";
    await saveJobState();

    notifyPopup({
      type: "EXTRACTION_DONE",
      jobId,
      total: job.collectedCount,
    });

    // Close the reviews tab
    if (job.reviewsTabId) {
      await chrome.tabs.remove(job.reviewsTabId);
    }

    // Clean up job after a delay
    setTimeout(async () => {
      delete jobs[jobId];
      await saveJobState();
    }, 5000);
  } catch (error) {
    console.error("❌ Error sending reviews to backend:", error);
    job.status = "error";
    job.error = `Failed to send reviews: ${error.message}`;
    await saveJobState();

    notifyPopup({
      type: "EXTRACTION_ERROR",
      jobId,
      error: job.error,
    });
  }
}

async function sendReviewsToBackend(reviews) {
  console.log(`📤 Sending ${reviews.length} reviews to backend...`);
  
  // Send in batches of 20 to avoid overwhelming the backend
  const batchSize = 20;
  for (let i = 0; i < reviews.length; i += batchSize) {
    const batch = reviews.slice(i, i + batchSize);
    
    await Promise.all(batch.map(review => {
      const body = {
        text: review.body || "",
        metadata: review,
      };

      return fetch(BACKEND_ANALYZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            console.log("/api/analyze response for review", review.id, data);
          } catch (e) {
            console.error(
              "Non-JSON response from /api/analyze for review",
              review.id,
              "status",
              res.status
            );
          }
        })
        .catch((err) => {
          console.error("Error calling /api/analyze for review", review.id, err);
        });
    }));
    
    // Small delay between batches
    if (i + batchSize < reviews.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log("✅ All reviews sent to backend");
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might not be open, that's okay
  });
}

// ============================================================================
// TAB EVENT HANDLERS
// ============================================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const jobId = findJobByTabId(tabId);
  if (!jobId) return;

  const job = jobs[jobId];
  if (!job || job.status !== "running") return;

  // When page finishes loading, trigger scraping
  if (changeInfo.status === 'complete') {
    console.log(`📄 Reviews page loaded for job ${jobId}, triggering scrape...`);
    
    // Check if still on a reviews page
    if (!tab.url.includes('/product-reviews/')) {
      console.error("❌ Tab navigated away from reviews page");
      job.status = "error";
      job.error = "Tab was navigated away from reviews page";
      saveJobState();
      notifyPopup({
        type: "EXTRACTION_ERROR",
        jobId,
        error: job.error,
      });
      return;
    }

    // Send scrape command to content script
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "SCRAPE_REVIEW_PAGE", jobId }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("❌ Error sending SCRAPE_REVIEW_PAGE:", chrome.runtime.lastError);
        }
      });
    }, 1000); // Small delay to ensure page is fully rendered
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const jobId = findJobByTabId(tabId);
  if (!jobId) return;

  const job = jobs[jobId];
  if (!job) return;

  console.log("🚫 Reviews tab closed for job", jobId);
  
  if (job.status === "running") {
    job.status = "cancelled";
    job.error = "Background reviews tab was closed";
    job.cancelledAt = Date.now();
    await saveJobState();

    notifyPopup({
      type: "EXTRACTION_ERROR",
      jobId,
      error: job.error,
    });
  }

  delete jobs[jobId];
  await saveJobState();
});
