// Background service worker: receives reviews from content script and
// forwards them to the Vercel backend /api/analyze

// TODO: Replace with your deployed Vercel URL
const BACKEND_ANALYZE_URL = "https://amazon-review-detector.vercel.app/api/analyze";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "REVIEWS_EXTRACTED") return;

  const { reviews } = message.payload || {};
  if (!Array.isArray(reviews) || !reviews.length) return;

  console.log("Background received", reviews.length, "reviews");

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

  // Optional async response
  sendResponse({ ok: true });
  return true;
});
