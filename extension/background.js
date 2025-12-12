// Background service worker: receives reviews from content script and
// forwards them to the Vercel backend /api/analyze

// TODO: Replace with your deployed Vercel URL
const BACKEND_ANALYZE_URL = "http://localhost:3000/api/analyze/";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "REVIEWS_EXTRACTED") return;

  const { reviews } = message.payload || {};
  if (!Array.isArray(reviews) || !reviews.length) return;

  // For now, send each review individually to the backend.
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
      .then((res) => res.json())
      .then((data) => {
        console.log("/api/analyze response for review", review.id, data);
      })
      .catch((err) => {
        console.error("Error calling /api/analyze for review", review.id, err);
      });
  });

  // Optional async response
  sendResponse({ ok: true });
  return true;
});
