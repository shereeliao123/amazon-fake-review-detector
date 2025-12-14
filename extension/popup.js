// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let currentJobId = null;

// ============================================================================
// UI ELEMENTS
// ============================================================================

const extractAllBtn = document.getElementById('extractAllBtn');
const cancelBtn = document.getElementById('cancelBtn');
const status = document.getElementById('status');
const progress = document.getElementById('progress');

// ============================================================================
// INITIALIZATION
// ============================================================================

// Restore state on popup open
async function initializePopup() {
  try {
    // Check if there's an active job
    const { jobs } = await chrome.storage.local.get('jobs');
    
    if (jobs && Object.keys(jobs).length > 0) {
      // Find the most recent running job
      const runningJob = Object.values(jobs).find(j => j.status === 'running' || j.status === 'sending');
      
      if (runningJob) {
        currentJobId = runningJob.jobId;
        updateUIForRunningJob(runningJob);
      }
    }
  } catch (error) {
    console.error('Error initializing popup:', error);
  }
}

initializePopup();

// ============================================================================
// EVENT HANDLERS
// ============================================================================

extractAllBtn.addEventListener('click', async () => {
  extractAllBtn.disabled = true;
  extractAllBtn.textContent = 'Starting...';
  status.textContent = 'Validating page...';
  status.className = '';
  progress.textContent = '';
  progress.className = '';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.id) {
      throw new Error('No active tab found');
    }
    
    if (!tab.url || !tab.url.includes('amazon.')) {
      status.textContent = 'Please navigate to an Amazon product page';
      status.className = 'error';
      extractAllBtn.disabled = false;
      extractAllBtn.textContent = 'Extract ALL Reviews';
      return;
    }
    
    // Check if it's a product page
    if (!tab.url.includes('/dp/') && !tab.url.includes('/gp/product/')) {
      status.textContent = 'Please navigate to an Amazon product page (not reviews page)';
      status.className = 'error';
      extractAllBtn.disabled = false;
      extractAllBtn.textContent = 'Extract ALL Reviews';
      return;
    }
    
    // Start full extraction
    chrome.runtime.sendMessage({ type: 'START_FULL_EXTRACTION' }, (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
        status.className = 'error';
        extractAllBtn.disabled = false;
        extractAllBtn.textContent = 'Extract ALL Reviews';
      } else {
        status.textContent = 'Starting extraction...';
        status.className = '';
        extractAllBtn.style.display = 'none';
        cancelBtn.style.display = 'block';
      }
    });
  } catch (error) {
    status.textContent = 'Error: ' + error.message;
    status.className = 'error';
    extractAllBtn.disabled = false;
    extractAllBtn.textContent = 'Extract ALL Reviews';
  }
});

cancelBtn.addEventListener('click', () => {
  if (!currentJobId) return;
  
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelling...';
  
  chrome.runtime.sendMessage({ type: 'CANCEL_EXTRACTION', jobId: currentJobId }, () => {
    // UI will be updated by EXTRACTION_ERROR message
  });
});

// ============================================================================
// MESSAGE LISTENER (for progress updates from background)
// ============================================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EXTRACTION_PROGRESS') {
    currentJobId = message.jobId;
    updateProgress(message);
  }
  
  if (message.type === 'EXTRACTION_DONE') {
    currentJobId = null;
    showSuccess(message);
  }
  
  if (message.type === 'EXTRACTION_ERROR') {
    currentJobId = null;
    showError(message);
  }
});

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

function updateUIForRunningJob(job) {
  currentJobId = job.jobId;
  extractAllBtn.style.display = 'none';
  cancelBtn.style.display = 'block';
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Cancel Extraction';
  
  status.textContent = job.status === 'sending' ? 'Sending to backend...' : 'Extraction in progress...';
  status.className = '';
  
  progress.className = 'active';
  progress.textContent = `Collected ${job.collectedCount}/${job.totalCount || '?'} reviews (Page ${job.currentPage}/${job.totalPages || '?'})`;
}

function updateProgress(message) {
  status.textContent = message.status || 'Extracting...';
  status.className = '';
  
  progress.className = 'active';
  progress.textContent = `${message.current}/${message.total || '?'} reviews | Page ${message.currentPage}/${message.totalPages || '?'}`;
}

function showSuccess(message) {
  extractAllBtn.style.display = 'block';
  extractAllBtn.disabled = false;
  extractAllBtn.textContent = 'Extract ALL Reviews';
  cancelBtn.style.display = 'none';
  
  status.textContent = `✅ Success! Extracted ${message.total} reviews and sent to backend.`;
  status.className = 'success';
  
  progress.className = '';
  progress.textContent = '';
}

function showError(message) {
  extractAllBtn.style.display = 'block';
  extractAllBtn.disabled = false;
  extractAllBtn.textContent = 'Extract ALL Reviews';
  cancelBtn.style.display = 'none';
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Cancel Extraction';
  
  status.textContent = `❌ ${message.error || 'Unknown error'}`;
  status.className = 'error';
  
  progress.className = '';
  progress.textContent = '';
}