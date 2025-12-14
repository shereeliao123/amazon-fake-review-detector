document.getElementById('extractBtn').addEventListener('click', async () => {
  const btn = document.getElementById('extractBtn');
  const status = document.getElementById('status');
  
  btn.disabled = true;
  btn.textContent = 'Extracting...';
  status.textContent = 'Please wait...';
  status.className = '';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.id) {
      throw new Error('No active tab found');
    }
    
    if (!tab.url || !tab.url.includes('amazon.')) {
      status.textContent = 'Please navigate to an Amazon product page';
      status.className = 'error';
      btn.disabled = false;
      btn.textContent = 'Extract Reviews';
      return;
    }
    
    chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_REVIEWS' }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
        status.className = 'error';
      } else if (response && response.success) {
        status.textContent = 'Reviews extracted! Check console for details.';
        status.className = 'success';
      } else {
        status.textContent = 'Extraction completed';
        status.className = 'success';
      }
      
      btn.disabled = false;
      btn.textContent = 'Extract Reviews';
    });
  } catch (error) {
    status.textContent = 'Error: ' + error.message;
    status.className = 'error';
    btn.disabled = false;
    btn.textContent = 'Extract Reviews';
  }
});

Then **reload the extension** in Chrome.