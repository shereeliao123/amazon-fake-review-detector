// Extract reviews from Amazon product pages and send them to the background script

console.log("🚀 Fake Review Detector: Content script loaded!");

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