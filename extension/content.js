// Extract reviews from Amazon product pages and send them to the background script

function extractReviews() {
  const reviews = [];

  // This targets the review list on typical Amazon product pages.
  // Amazon can change DOM structure, so this is a best-effort starter.
  const reviewElements = document.querySelectorAll("[id^='customer_review-']");

  reviewElements.forEach((el) => {
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

      if (body || title) {
        reviews.push({ id, title, body, rating, author, date });
      }
    } catch (e) {
      // Ignore individual review parsing errors
    }
  });

  return reviews;
}

function sendReviews() {
  const reviews = extractReviews();
  if (!reviews.length) return;

  chrome.runtime.sendMessage({
    type: "REVIEWS_EXTRACTED",
    payload: { reviews },
  });
}

// Run once after page load settles
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(sendReviews, 2000);
} else {
  window.addEventListener("DOMContentLoaded", () => setTimeout(sendReviews, 2000));
}
