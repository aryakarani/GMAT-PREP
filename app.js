// ========================================
// GMAT Focus Practice — Solo Trainer
// Static Banks with Heuristic Routing
// Framework-free, ES2019-safe for iOS Safari
// ========================================

'use strict';

// ========================================
// STATE MANAGEMENT
// ========================================

const APP_STATE = {
  currentSection: null,
  sectionQuestions: [],       // Current section's assembled items
  currentQuestionIndex: 0,
  responses: {},              // { questionIndex: answerIndex }
  flags: new Set(),
  editsRemaining: 3,
  editHistory: {},
  timerSeconds: 0,
  timerInterval: null,
  sessionUsedIds: new Set(),  // IDs used in current test
  usedItemIds: new Set(),     // IDs used across sessions (localStorage)
  currentAttempt: null,
  settings: {
    exposureControl: true,
    scaledScoreEnabled: false,
    scaledMapping: [
      { pct: 55, score: 605 },
      { pct: 65, score: 655 },
      { pct: 75, score: 705 },
      { pct: 85, score: 745 },
      { pct: 95, score: 805 }
    ]
  }
};

// Global banks storage (used by all functions)
window.BANKS = null;

// Full test run state
window.currentRun = null;

// ========================================
// UTILITY FUNCTIONS
// ========================================

function showToast(message, type) {
  if (type === void 0) type = 'success';
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(function() {
    toast.remove();
  }, 3000);
}

function showScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(function(s) { s.classList.remove('active'); });
  
  const targetScreen = document.getElementById(screenId);
  if (!targetScreen) {
    console.error('Screen with id "' + screenId + '" not found!');
    showToast('Error: Screen "' + screenId + '" not found', 'error');
    return;
  }
  targetScreen.classList.add('active');
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

// ========================================
// 1) ROBUST BANK LOADER (iOS-safe)
// ========================================

/**
 * Load all question banks with iOS-safe fetch
 * @param {Object} options - { force: boolean }
 */
async function loadBanks(options) {
  if (options === void 0) options = {};
  const force = options.force || false;
  
  try {
    const qs = force ? ('?v=' + Date.now()) : '';
    const opts = { 
      cache: 'no-store', 
      headers: { 'Cache-Control': 'no-cache' } 
    };

    const files = {
      Quant: './data/bank_quant.json' + qs,
      Verbal: './data/bank_verbal.json' + qs,
      'Data Insights': './data/bank_di.json' + qs
    };

    const qRes = await fetch(files.Quant, opts);
    const vRes = await fetch(files.Verbal, opts);
    const dRes = await fetch(files['Data Insights'], opts);

    // Check all responses
    const responses = [
      { name: 'Quant', res: qRes },
      { name: 'Verbal', res: vRes },
      { name: 'Data Insights', res: dRes }
    ];
    
    for (var i = 0; i < responses.length; i++) {
      var r = responses[i];
      if (!r.res.ok) {
        throw new Error('Bank HTTP ' + r.res.status + ': ' + r.res.url + ' (' + r.name + ')');
      }
    }

    const qBank = await qRes.json();
    const vBank = await vRes.json();
    const dBank = await dRes.json();

    // Validate shape and content
    if (!qBank || !qBank.items || !Array.isArray(qBank.items) || qBank.items.length === 0) {
      throw new Error('Quant bank is empty or invalid');
    }
    if (!vBank || !vBank.items || !Array.isArray(vBank.items) || vBank.items.length === 0) {
      throw new Error('Verbal bank is empty or invalid');
    }
    if (!dBank || !dBank.items || !Array.isArray(dBank.items) || dBank.items.length === 0) {
      throw new Error('Data Insights bank is empty or invalid');
    }

    // Store in window.BANKS
    window.BANKS = {
      Quant: qBank.items,
      Verbal: vBank.items,
      'Data Insights': dBank.items
    };
    
    // Load used item IDs from localStorage
    const usedIds = localStorage.getItem('usedItemIds');
    if (usedIds) {
      APP_STATE.usedItemIds = new Set(JSON.parse(usedIds));
    }
    
    // Load settings
    const savedSettings = localStorage.getItem('settings');
    if (savedSettings) {
      var parsed = JSON.parse(savedSettings);
      for (var key in parsed) {
        if (parsed.hasOwnProperty(key)) {
          APP_STATE.settings[key] = parsed[key];
        }
      }
    }
    
    updateBankStats();
    showToast('✅ Question banks loaded successfully (' + 
      window.BANKS.Quant.length + ' Quant, ' + 
      window.BANKS.Verbal.length + ' Verbal, ' + 
      window.BANKS['Data Insights'].length + ' DI)', 'success');
    
    return window.BANKS;
  } catch (err) {
    console.error('Failed to load banks:', err);
    showToast('❌ Failed to load banks: ' + err.message, 'error');
    throw err;
  }
}

/**
 * Update bank statistics display
 */
function updateBankStats() {
  if (!window.BANKS) {
    document.getElementById('totalItems').textContent = '0 / 0';
    document.getElementById('quantCount').textContent = '0 / 0';
    document.getElementById('verbalCount').textContent = '0 / 0';
    document.getElementById('diCount').textContent = '0 / 0';
    document.getElementById('easyCount').textContent = '0 / 0';
    document.getElementById('mediumCount').textContent = '0 / 0';
    document.getElementById('hardCount').textContent = '0 / 0';
    return;
  }
  
  const quantTotal = window.BANKS.Quant.length;
  const verbalTotal = window.BANKS.Verbal.length;
  const diTotal = window.BANKS['Data Insights'].length;
  const totalItems = quantTotal + verbalTotal + diTotal;
  
  // Calculate remaining (unused) questions per section
  const quantRemaining = window.BANKS.Quant.filter(function(q) { 
    return !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  const verbalRemaining = window.BANKS.Verbal.filter(function(q) { 
    return !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  const diRemaining = window.BANKS['Data Insights'].filter(function(q) { 
    return !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  
  // Calculate by difficulty
  const allQuestions = [].concat(
    window.BANKS.Quant,
    window.BANKS.Verbal,
    window.BANKS['Data Insights']
  );
  
  const easyTotal = allQuestions.filter(function(q) { return q.difficulty === 'E'; }).length;
  const mediumTotal = allQuestions.filter(function(q) { return q.difficulty === 'M'; }).length;
  const hardTotal = allQuestions.filter(function(q) { return q.difficulty === 'H'; }).length;
  
  const easyRemaining = allQuestions.filter(function(q) { 
    return q.difficulty === 'E' && !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  const mediumRemaining = allQuestions.filter(function(q) { 
    return q.difficulty === 'M' && !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  const hardRemaining = allQuestions.filter(function(q) { 
    return q.difficulty === 'H' && !APP_STATE.usedItemIds.has(q.id); 
  }).length;
  
  document.getElementById('totalItems').textContent = (totalItems - APP_STATE.usedItemIds.size) + ' / ' + totalItems;
  document.getElementById('quantCount').textContent = quantRemaining + ' / ' + quantTotal;
  document.getElementById('verbalCount').textContent = verbalRemaining + ' / ' + verbalTotal;
  document.getElementById('diCount').textContent = diRemaining + ' / ' + diTotal;
  document.getElementById('easyCount').textContent = easyRemaining + ' / ' + easyTotal;
  document.getElementById('mediumCount').textContent = mediumRemaining + ' / ' + mediumTotal;
  document.getElementById('hardCount').textContent = hardRemaining + ' / ' + hardTotal;
}

/**
 * Reset bank exposure (clear used items)
 */
function resetBankExposure() {
  if (confirm('Reset bank exposure? This will allow all questions to be used again.')) {
    APP_STATE.usedItemIds.clear();
    localStorage.removeItem('usedItemIds');
    updateBankStats();
    showToast('Bank exposure reset successfully', 'success');
  }
}

// ========================================
// 3) SAMPLER - NO DUPLICATES
// ========================================

/**
 * Shuffle array in place (Fisher-Yates)
 */
function shuffleInPlace(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = a[i];
    a[i] = a[j];
    a[j] = temp;
  }
  return a;
}

/**
 * Sample without replacement
 */
function sampleWithoutReplacement(pool, count) {
  var copied = pool.slice();
  var shuffled = shuffleInPlace(copied);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Assert uniqueness of question IDs
 */
function assertUnique(items) {
  var seen = new Set();
  for (var i = 0; i < items.length; i++) {
    var id = items[i].id;
    if (seen.has(id)) {
      throw new Error('Duplicate questions detected in assembly: ' + id);
    }
    seen.add(id);
  }
}

/**
 * Assemble a section with uniqueness guarantees
 * @param {string} section - Section name
 * @param {number} count - Number of questions
 * @returns {Array} Selected questions
 */
function assembleSection(section, count) {
  if (!window.BANKS) {
    throw new Error('Banks not loaded');
  }
  
  var pool = window.BANKS[section];
  if (!pool || pool.length === 0) {
    throw new Error('No questions available for section: ' + section);
  }
  
  // Apply exposure control if enabled
  var availablePool = pool;
  if (APP_STATE.settings.exposureControl) {
    availablePool = pool.filter(function(q) {
      return !APP_STATE.usedItemIds.has(q.id);
    });
    
    if (availablePool.length < count) {
      showToast('⚠️ Bank exhausted for ' + section + '. Using all remaining unique items.', 'warning');
      // Use all remaining
      availablePool = pool.filter(function(q) {
        return !APP_STATE.usedItemIds.has(q.id);
      });
      if (availablePool.length === 0) {
        // Last resort: use all
        availablePool = pool;
      }
    }
  }
  
  // Build weighted pool by difficulty (30% E, 50% M, 20% H)
  var easyPool = availablePool.filter(function(q) { return q.difficulty === 'E'; });
  var mediumPool = availablePool.filter(function(q) { return q.difficulty === 'M'; });
  var hardPool = availablePool.filter(function(q) { return q.difficulty === 'H'; });
  
  var easyTarget = Math.round(count * 0.30);
  var mediumTarget = Math.round(count * 0.50);
  var hardTarget = count - easyTarget - mediumTarget;
  
  var selected = [];
  var selectedIds = new Set();
  
  // Sample from each bucket, ensuring no duplicates
  function addUnique(sourcePool, target) {
    var sampled = sampleWithoutReplacement(sourcePool, target);
    for (var i = 0; i < sampled.length; i++) {
      var item = sampled[i];
      if (!selectedIds.has(item.id)) {
        selected.push(item);
        selectedIds.add(item.id);
      }
    }
  }
  
  addUnique(easyPool, easyTarget);
  addUnique(mediumPool, mediumTarget);
  addUnique(hardPool, hardTarget);
  
  // Backfill if needed
  if (selected.length < count) {
    var remaining = availablePool.filter(function(q) {
      return !selectedIds.has(q.id);
    });
    addUnique(remaining, count - selected.length);
  }
  
  // Final shuffle
  shuffleInPlace(selected);
  
  // Assert uniqueness
  assertUnique(selected);
  
  return selected.slice(0, count);
}

// ========================================
// 2) SECTION ORDER & FULL TEST
// ========================================

/**
 * Start a full test with section order
 */
async function startFullTest() {
  try {
    // Ensure banks are loaded
    if (!window.BANKS) {
      showToast('Loading question banks...', 'info');
      await loadBanks();
    }
    
    // Read section order from dropdown
    const orderValue = document.getElementById('orderSelect').value;
    const orderMap = {
      'QVD': ['Quant', 'Verbal', 'Data Insights'],
      'QDV': ['Quant', 'Data Insights', 'Verbal'],
      'VQD': ['Verbal', 'Quant', 'Data Insights'],
      'VDQ': ['Verbal', 'Data Insights', 'Quant'],
      'DQV': ['Data Insights', 'Quant', 'Verbal'],
      'DVQ': ['Data Insights', 'Verbal', 'Quant']
    };
    
    const queue = orderMap[orderValue];
    if (!queue) {
      throw new Error('Invalid section order: ' + orderValue);
    }
    
    // Initialize full test run
    window.currentRun = {
      queue: queue,
      index: 0,
      sessions: {}
    };
    
    // Start first section
    startNextSectionInQueue();
    
  } catch (err) {
    console.error('Failed to start full test:', err);
    showToast('❌ Failed to start full test: ' + err.message, 'error');
  }
}

/**
 * Start next section in queue
 */
function startNextSectionInQueue() {
  if (!window.currentRun) {
    console.error('No active run');
    return;
  }
  
  if (window.currentRun.index >= window.currentRun.queue.length) {
    // Test complete
    showToast('🎉 Full test complete!', 'success');
    window.currentRun = null;
    return;
  }
  
  const section = window.currentRun.queue[window.currentRun.index];
  const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10);
  
  try {
    startSingleSection(section, timerMinutes);
  } catch (err) {
    showToast('❌ Error starting ' + section + ': ' + err.message, 'error');
  }
}

/**
 * Start a single section
 * @param {string} section - Section name
 * @param {number} timerMinutes - Timer duration in minutes
 */
function startSingleSection(section, timerMinutes) {
  if (timerMinutes === void 0) timerMinutes = 45;
  
  if (!window.BANKS) {
    throw new Error('Banks not loaded. Please reload banks first.');
  }
  
  const sectionSize = section === 'Quant' ? 21 : (section === 'Verbal' ? 23 : 20);
  
  // Assemble section
  const items = assembleSection(section, sectionSize);
  
  if (items.length === 0) {
    throw new Error('Failed to assemble questions for ' + section);
  }
  
  // Reset state
  APP_STATE.currentSection = section;
  APP_STATE.sectionQuestions = items;
  APP_STATE.currentQuestionIndex = 0;
  APP_STATE.responses = {};
  APP_STATE.flags = new Set();
  APP_STATE.editsRemaining = 3;
  APP_STATE.editHistory = {};
  APP_STATE.timerSeconds = timerMinutes * 60;
  APP_STATE.sessionUsedIds = new Set();
  
  // Mark as used in session
  items.forEach(function(q) {
    APP_STATE.sessionUsedIds.add(q.id);
  });
  
  // Show/hide calculator based on section
  const calcBtn = document.getElementById('calculatorBtn');
  if (calcBtn) {
    calcBtn.style.display = section === 'Data Insights' ? 'inline-block' : 'none';
  }
  
  // Start timer
  startTimer();
  
  // Show question screen
  showScreen('questionScreen');
  renderQuestion();
  updateTopBar();
  
  showToast('✅ ' + section + ' started (' + items.length + ' questions)', 'success');
}

/**
 * Start single section (from individual buttons)
 */
async function startSingle(section) {
  try {
    if (!window.BANKS) {
      showToast('Loading question banks...', 'info');
      await loadBanks();
    }
    
    const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10);
    startSingleSection(section, timerMinutes);
  } catch (err) {
    console.error('Failed to start single section:', err);
    showToast('❌ Failed to start ' + section + ': ' + err.message, 'error');
  }
}

// ========================================
// SESSION MANAGEMENT
// ========================================

function startTimer() {
  if (APP_STATE.timerInterval) {
    clearInterval(APP_STATE.timerInterval);
  }
  
  APP_STATE.timerInterval = setInterval(function() {
    APP_STATE.timerSeconds--;
    updateTimerDisplay();
    
    if (APP_STATE.timerSeconds <= 0) {
      clearInterval(APP_STATE.timerInterval);
      handleTimeUp();
    }
  }, 1000);
}

function handleTimeUp() {
  showToast('⏰ Time is up!', 'warning');
  
  if (document.getElementById('questionScreen').classList.contains('active')) {
    showReviewScreen();
  } else if (document.getElementById('reviewScreen').classList.contains('active')) {
    submitSection();
  }
}

function updateTimerDisplay() {
  const display = document.getElementById('timerDisplay');
  display.textContent = formatTime(APP_STATE.timerSeconds);
  
  display.classList.remove('warning', 'danger');
  if (APP_STATE.timerSeconds <= 300) {
    display.classList.add('warning');
  }
  if (APP_STATE.timerSeconds <= 60) {
    display.classList.add('danger');
  }
}

// ========================================
// QUESTION RENDERING
// ========================================

function renderQuestion() {
  const idx = APP_STATE.currentQuestionIndex;
  const question = APP_STATE.sectionQuestions[idx];
  
  if (!question) {
    console.error('No question found at index:', idx);
    showToast('Error: Question not found', 'error');
    return;
  }
  
  // Update question number
  const questionNumberEl = document.getElementById('questionNumber');
  if (!questionNumberEl) {
    console.error('Question number element not found');
    return;
  }
  questionNumberEl.textContent = 
    'Question ' + (idx + 1) + ' of ' + APP_STATE.sectionQuestions.length;
  
  // Update flag button
  const flagBtn = document.getElementById('flagBtn');
  if (APP_STATE.flags.has(idx)) {
    flagBtn.classList.add('flagged');
  } else {
    flagBtn.classList.remove('flagged');
  }
  
  // Render prompt
  document.getElementById('questionPrompt').textContent = question.prompt;
  
  // Render table if exists
  const tableContainer = document.getElementById('questionTable');
  if (question.table) {
    tableContainer.style.display = 'block';
    const table = document.createElement('table');
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    question.table.headers.forEach(function(h) {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    question.table.rows.forEach(function(row) {
      const tr = document.createElement('tr');
      row.forEach(function(cell) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
  } else {
    tableContainer.style.display = 'none';
  }
  
  // Render options
  const optionsContainer = document.getElementById('optionsContainer');
  optionsContainer.innerHTML = '';
  
  question.options.forEach(function(option, optIdx) {
    const div = document.createElement('div');
    div.className = 'option-item';
    if (APP_STATE.responses[idx] === optIdx) {
      div.classList.add('selected');
    }
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'answer';
    radio.value = optIdx;
    radio.id = 'option-' + optIdx;
    radio.checked = APP_STATE.responses[idx] === optIdx;
    
    const label = document.createElement('label');
    label.htmlFor = 'option-' + optIdx;
    label.textContent = option;
    
    div.appendChild(radio);
    div.appendChild(label);
    
    div.addEventListener('click', function() { selectAnswer(optIdx); });
    
    optionsContainer.appendChild(div);
  });
  
  // Update nav buttons
  document.getElementById('prevBtn').disabled = idx === 0;
}

function selectAnswer(optIdx) {
  const idx = APP_STATE.currentQuestionIndex;
  const previousAnswer = APP_STATE.responses[idx];
  
  // If changing an existing answer, consume an edit
  if (previousAnswer !== undefined && previousAnswer !== optIdx) {
    if (APP_STATE.editsRemaining <= 0) {
      showToast('❌ No edits remaining! Cannot change answer.', 'error');
      return;
    }
    
    APP_STATE.editsRemaining--;
    APP_STATE.editHistory[idx] = (APP_STATE.editHistory[idx] || 0) + 1;
  }
  
  // Set the answer
  APP_STATE.responses[idx] = optIdx;
  
  // Re-render to update selection
  renderQuestion();
  updateTopBar();
}

function updateTopBar() {
  document.getElementById('sectionLabel').textContent = APP_STATE.currentSection;
  document.getElementById('editsLeft').textContent = 'Edits: ' + APP_STATE.editsRemaining;
  
  // Update difficulty label based on current question
  const idx = APP_STATE.currentQuestionIndex;
  if (idx < APP_STATE.sectionQuestions.length) {
    const question = APP_STATE.sectionQuestions[idx];
    
    var diffLabel, diffClass;
    if (question.difficulty === 'E') {
      diffLabel = 'Easy';
      diffClass = 'E';
    } else if (question.difficulty === 'H') {
      diffLabel = 'Hard';
      diffClass = 'H';
    } else {
      diffLabel = 'Medium';
      diffClass = 'M';
    }
    
    const diffElement = document.getElementById('difficultyLabel');
    diffElement.textContent = diffLabel;
    diffElement.className = 'difficulty-label ' + diffClass;
  }
}

function navigateQuestion(direction) {
  const newIdx = APP_STATE.currentQuestionIndex + direction;
  
  if (newIdx < 0 || newIdx >= APP_STATE.sectionQuestions.length) {
    return;
  }
  
  APP_STATE.currentQuestionIndex = newIdx;
  renderQuestion();
  updateTopBar();
}

function toggleFlag() {
  const idx = APP_STATE.currentQuestionIndex;
  
  if (APP_STATE.flags.has(idx)) {
    APP_STATE.flags.delete(idx);
  } else {
    APP_STATE.flags.add(idx);
  }
  
  renderQuestion();
}

// ========================================
// REVIEW SCREEN
// ========================================

function showReviewScreen() {
  showScreen('reviewScreen');
  renderReviewGrid();
}

function renderReviewGrid() {
  const grid = document.getElementById('reviewGrid');
  grid.innerHTML = '';
  
  APP_STATE.sectionQuestions.forEach(function(q, idx) {
    const item = document.createElement('div');
    item.className = 'review-item';
    
    if (APP_STATE.responses[idx] !== undefined) {
      item.classList.add('answered');
    }
    
    if (APP_STATE.flags.has(idx)) {
      item.classList.add('flagged');
    }
    
    const number = document.createElement('div');
    number.className = 'review-item-number';
    number.textContent = idx + 1;
    
    const status = document.createElement('div');
    status.className = 'review-item-status';
    status.textContent = APP_STATE.responses[idx] !== undefined ? '✓' : '—';
    
    item.appendChild(number);
    item.appendChild(status);
    
    item.addEventListener('click', function() {
      APP_STATE.currentQuestionIndex = idx;
      showScreen('questionScreen');
      renderQuestion();
      updateTopBar();
    });
    
    grid.appendChild(item);
  });
}

// ========================================
// RESULTS & SCALED SCORING
// ========================================

function calculateScaledScore(percentage) {
  const mapping = APP_STATE.settings.scaledMapping.slice().sort(function(a, b) { 
    return a.pct - b.pct; 
  });
  
  if (percentage <= mapping[0].pct) {
    return mapping[0].score;
  }
  
  if (percentage >= mapping[mapping.length - 1].pct) {
    return mapping[mapping.length - 1].score;
  }
  
  for (var i = 0; i < mapping.length - 1; i++) {
    const p1 = mapping[i];
    const p2 = mapping[i + 1];
    
    if (percentage >= p1.pct && percentage <= p2.pct) {
      const ratio = (percentage - p1.pct) / (p2.pct - p1.pct);
      return Math.round(p1.score + ratio * (p2.score - p1.score));
    }
  }
  
  return 705;
}

function submitSection() {
  clearInterval(APP_STATE.timerInterval);
  
  var correct = 0;
  var total = APP_STATE.sectionQuestions.length;
  
  APP_STATE.sectionQuestions.forEach(function(q, idx) {
    if (APP_STATE.responses[idx] === q.answer) {
      correct++;
    }
  });
  
  const percentage = Math.round((correct / total) * 100);
  const scaledScore = calculateScaledScore(percentage);
  
  // Mark questions as used
  APP_STATE.sectionQuestions.forEach(function(q) {
    APP_STATE.usedItemIds.add(q.id);
  });
  localStorage.setItem('usedItemIds', JSON.stringify(Array.from(APP_STATE.usedItemIds)));
  
  // Update bank stats
  updateBankStats();
  
  // Save to history
  const result = {
    section: APP_STATE.currentSection,
    correct: correct,
    total: total,
    percentage: percentage,
    scaledScore: APP_STATE.settings.scaledScoreEnabled ? scaledScore : null,
    timestamp: new Date().toISOString(),
    itemIds: APP_STATE.sectionQuestions.map(function(q) { return q.id; }),
    responses: APP_STATE.responses,
    editsUsed: 3 - APP_STATE.editsRemaining
  };
  
  const history = JSON.parse(localStorage.getItem('results') || '[]');
  history.unshift(result);
  localStorage.setItem('results', JSON.stringify(history));
  
  APP_STATE.currentAttempt = result;
  
  // Check if this is part of a full test
  if (window.currentRun) {
    window.currentRun.sessions[APP_STATE.currentSection] = result;
    window.currentRun.index++;
    
    // Show brief results then continue
    showResultsScreen(result, history);
    
    // Auto-advance after 3 seconds
    setTimeout(function() {
      if (window.currentRun && window.currentRun.index < window.currentRun.queue.length) {
        startNextSectionInQueue();
      } else {
        showToast('🎉 Full test complete!', 'success');
        window.currentRun = null;
      }
    }, 3000);
  } else {
    showResultsScreen(result, history);
  }
}

function showResultsScreen(result, history) {
  showScreen('resultsScreen');
  
  const resultsContent = document.getElementById('resultsContent');
  
  var html = '<div class="result-stat">' +
    '<span class="result-stat-label">Section</span>' +
    '<span class="result-stat-value">' + result.section + '</span>' +
    '</div>' +
    '<div class="result-stat">' +
    '<span class="result-stat-label">Score</span>' +
    '<span class="result-stat-value">' + result.correct + ' / ' + result.total + '</span>' +
    '</div>' +
    '<div class="result-stat">' +
    '<span class="result-stat-label">Percentage</span>' +
    '<span class="result-stat-value">' + result.percentage + '%</span>' +
    '</div>';
  
  if (result.scaledScore !== null) {
    html += '<div class="result-stat">' +
      '<span class="result-stat-label">Heuristic Scaled Score</span>' +
      '<span class="result-stat-value">' + result.scaledScore + '</span>' +
      '</div>';
  }
  
  html += '<div class="result-stat">' +
    '<span class="result-stat-label">Edits Used</span>' +
    '<span class="result-stat-value">' + result.editsUsed + ' / 3</span>' +
    '</div>';
  
  resultsContent.innerHTML = html;
  
  renderHistory('allHistoryContainer', history);
}

function renderHistory(containerId, history) {
  const container = document.getElementById(containerId);
  
  if (!history || history.length === 0) {
    container.innerHTML = '<p class="empty-state">No attempts yet. Start practicing!</p>';
    return;
  }
  
  const table = document.createElement('table');
  table.className = 'history-table';
  
  table.innerHTML = '<thead>' +
    '<tr>' +
    '<th>Date</th>' +
    '<th>Section</th>' +
    '<th>Score</th>' +
    '<th>%</th>' +
    '<th>Scaled</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' +
    '</tbody>';
  
  const tbody = table.querySelector('tbody');
  
  history.forEach(function(h) {
    const tr = document.createElement('tr');
    const date = new Date(h.timestamp).toLocaleString();
    
    tr.innerHTML = '<td>' + date + '</td>' +
      '<td>' + h.section + '</td>' +
      '<td>' + h.correct + '/' + h.total + '</td>' +
      '<td>' + h.percentage + '%</td>' +
      '<td>' + (h.scaledScore !== null ? h.scaledScore : '—') + '</td>';
    
    tbody.appendChild(tr);
  });
  
  container.innerHTML = '';
  container.appendChild(table);
}

function loadHistoryOnSetup() {
  const history = JSON.parse(localStorage.getItem('results') || '[]');
  renderHistory('historyContainer', history);
}

function exportAttempt() {
  if (!APP_STATE.currentAttempt) return;

  const blob = new Blob([JSON.stringify(APP_STATE.currentAttempt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gmat-attempt-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Attempt exported successfully', 'success');
}

// ========================================
// BANK STATS MODAL
// ========================================

function showBankStats() {
  if (!window.BANKS) {
    showToast('Banks not loaded yet', 'warning');
    return;
  }
  
  const modal = document.getElementById('bankStatsModal');
  const content = document.getElementById('bankStatsContent');
  
  const allQuestions = [].concat(
    window.BANKS.Quant,
    window.BANKS.Verbal,
    window.BANKS['Data Insights']
  );
  
  const totalItems = allQuestions.length;
  const usedItems = allQuestions.filter(function(q) { 
    return APP_STATE.usedItemIds.has(q.id); 
  }).length;
  const remainingItems = totalItems - usedItems;
  
  // Per section stats
  const sections = ['Quant', 'Verbal', 'Data Insights'];
  const sectionStats = sections.map(function(sec) {
    const items = window.BANKS[sec];
    const used = items.filter(function(q) { 
      return APP_STATE.usedItemIds.has(q.id); 
    }).length;
    const remaining = items.length - used;
    
    // By difficulty
    const easyTotal = items.filter(function(q) { return q.difficulty === 'E'; }).length;
    const mediumTotal = items.filter(function(q) { return q.difficulty === 'M'; }).length;
    const hardTotal = items.filter(function(q) { return q.difficulty === 'H'; }).length;
    
    const easyRemaining = items.filter(function(q) { 
      return q.difficulty === 'E' && !APP_STATE.usedItemIds.has(q.id); 
    }).length;
    const mediumRemaining = items.filter(function(q) { 
      return q.difficulty === 'M' && !APP_STATE.usedItemIds.has(q.id); 
    }).length;
    const hardRemaining = items.filter(function(q) { 
      return q.difficulty === 'H' && !APP_STATE.usedItemIds.has(q.id); 
    }).length;
    
    return {
      section: sec,
      total: items.length,
      used: used,
      remaining: remaining,
      easyTotal: easyTotal,
      mediumTotal: mediumTotal,
      hardTotal: hardTotal,
      easyRemaining: easyRemaining,
      mediumRemaining: mediumRemaining,
      hardRemaining: hardRemaining
    };
  });
  
  var html = '<div class="stats-grid">' +
    '<div class="stat-card">' +
    '<h4>Total Items</h4>' +
    '<div class="stat-value">' + totalItems + '</div>' +
    '<div class="stat-detail">' + remainingItems + ' remaining</div>' +
    '</div>' +
    '<div class="stat-card">' +
    '<h4>Used Items</h4>' +
    '<div class="stat-value">' + usedItems + '</div>' +
    '<div class="stat-detail">' + Math.round((usedItems / totalItems) * 100) + '% of bank</div>' +
    '</div>' +
    '</div>' +
    '<h3 style="margin-top: 2rem; margin-bottom: 1rem;">Section Breakdown</h3>';
  
  sectionStats.forEach(function(s) {
    html += '<div class="section-stats-card">' +
      '<h4>' + s.section + '</h4>' +
      '<p><strong>Total:</strong> ' + s.total + ' questions (' + s.remaining + ' remaining)</p>' +
      '<div class="difficulty-grid">' +
      '<div class="difficulty-stat">' +
      '<span class="difficulty-label E">Easy</span>' +
      '<span>' + s.easyRemaining + ' / ' + s.easyTotal + '</span>' +
      '</div>' +
      '<div class="difficulty-stat">' +
      '<span class="difficulty-label M">Medium</span>' +
      '<span>' + s.mediumRemaining + ' / ' + s.mediumTotal + '</span>' +
      '</div>' +
      '<div class="difficulty-stat">' +
      '<span class="difficulty-label H">Hard</span>' +
      '<span>' + s.hardRemaining + ' / ' + s.hardTotal + '</span>' +
      '</div>' +
      '</div>' +
      '</div>';
  });
  
  content.innerHTML = html;
  openModal('bankStatsModal');
}

// ========================================
// SCALED SCORE MAPPING
// ========================================

function showScaledMappingEditor() {
  const textarea = document.getElementById('scaledMappingText');
  const mapping = APP_STATE.settings.scaledMapping;
  
  const text = mapping.map(function(m) { 
    return m.pct + ':' + m.score; 
  }).join('\n');
  textarea.value = text;
  
  openModal('scaledMappingModal');
}

function saveScaledMapping() {
  const textarea = document.getElementById('scaledMappingText');
  const lines = textarea.value.trim().split('\n');
  
  try {
    const mapping = lines.map(function(line) {
      const parts = line.split(':');
      const pct = parseFloat(parts[0].trim());
      const score = parseFloat(parts[1].trim());
      if (isNaN(pct) || isNaN(score)) {
        throw new Error('Invalid format');
      }
      return { pct: pct, score: score };
    });
    
    if (mapping.length < 2) {
      throw new Error('Need at least 2 points');
    }
    
    APP_STATE.settings.scaledMapping = mapping.sort(function(a, b) { 
      return a.pct - b.pct; 
    });
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
    
    closeModal('scaledMappingModal');
    showToast('Scaled score mapping saved', 'success');
  } catch (err) {
    showToast('Invalid mapping format: ' + err.message, 'error');
  }
}

// ========================================
// CALCULATOR
// ========================================

var calcState = {
  display: '0',
  operand1: null,
  operator: null,
  waitingForOperand: false
};

function initCalculator() {
  const display = document.getElementById('calcDisplay');
  const buttons = document.querySelectorAll('.calc-btn');
  
  buttons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      const val = btn.dataset.val;
      handleCalcInput(val);
    });
  });
}

function handleCalcInput(val) {
  const display = document.getElementById('calcDisplay');
  
  if (val === 'C') {
    calcState = { display: '0', operand1: null, operator: null, waitingForOperand: false };
    display.value = '0';
    return;
  }
  
  if (val === 'back') {
    calcState.display = calcState.display.slice(0, -1) || '0';
    display.value = calcState.display;
    return;
  }
  
  if ((val >= '0' && val <= '9') || val === '.') {
    if (calcState.waitingForOperand) {
      calcState.display = val;
      calcState.waitingForOperand = false;
    } else {
      calcState.display = calcState.display === '0' ? val : calcState.display + val;
    }
    display.value = calcState.display;
    return;
  }
  
  if (val === 'sqrt') {
    const num = parseFloat(calcState.display);
    calcState.display = String(Math.sqrt(num));
    display.value = calcState.display;
    calcState.waitingForOperand = true;
    return;
  }
  
  if (['+', '-', '*', '/', '%'].indexOf(val) !== -1) {
    if (calcState.operator && !calcState.waitingForOperand) {
      const result = performCalc(
        parseFloat(calcState.operand1),
        parseFloat(calcState.display),
        calcState.operator
      );
      calcState.display = String(result);
      display.value = calcState.display;
    }
    
    calcState.operand1 = calcState.display;
    calcState.operator = val;
    calcState.waitingForOperand = true;
    return;
  }
  
  if (val === '=') {
    if (calcState.operator && calcState.operand1 !== null) {
      const result = performCalc(
        parseFloat(calcState.operand1),
        parseFloat(calcState.display),
        calcState.operator
      );
      calcState.display = String(result);
      display.value = calcState.display;
      calcState.operator = null;
      calcState.operand1 = null;
      calcState.waitingForOperand = true;
    }
  }
}

function performCalc(a, b, op) {
  switch(op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '%': return a % b;
    default: return b;
  }
}

// ========================================
// MODALS
// ========================================

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// ========================================
// 4) EVENT LISTENERS (iOS-safe wiring)
// ========================================

function initEventListeners() {
  // Setup screen - bind on DOMContentLoaded
  const startPracticeBtn = document.getElementById('startBtn');
  const startQuantBtn = document.getElementById('startQuantBtn');
  const startVerbalBtn = document.getElementById('startVerbalBtn');
  const startDIBtn = document.getElementById('startDIbtn');
  
  if (startPracticeBtn) {
    startPracticeBtn.onclick = startFullTest;
  }
  if (startQuantBtn) {
    startQuantBtn.onclick = function() { startSingle('Quant'); };
  }
  if (startVerbalBtn) {
    startVerbalBtn.onclick = function() { startSingle('Verbal'); };
  }
  if (startDIBtn) {
    startDIBtn.onclick = function() { startSingle('Data Insights'); };
  }
  
  // Bank management
  const reloadBankBtn = document.getElementById('reloadBankBtn');
  if (reloadBankBtn) {
    reloadBankBtn.onclick = function() {
      loadBanks({ force: true }).then(function() {
        showToast('Banks reloaded successfully', 'success');
      }).catch(function(err) {
        showToast('Failed to reload: ' + err.message, 'error');
      });
    };
  }
  
  document.getElementById('resetBankBtn').addEventListener('click', resetBankExposure);
  document.getElementById('bankStatsBtn').addEventListener('click', showBankStats);
  
  // Settings
  document.getElementById('heuristicScalingCheck').addEventListener('change', function(e) {
    APP_STATE.settings.scaledScoreEnabled = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('exposureControlCheck').addEventListener('change', function(e) {
    APP_STATE.settings.exposureControl = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('editScaledMappingBtn').addEventListener('click', showScaledMappingEditor);
  document.getElementById('saveScaledMappingBtn').addEventListener('click', saveScaledMapping);
  
  // Question screen
  document.getElementById('prevBtn').addEventListener('click', function() { navigateQuestion(-1); });
  document.getElementById('nextBtn').addEventListener('click', function() { navigateQuestion(1); });
  document.getElementById('flagBtn').addEventListener('click', toggleFlag);
  document.getElementById('reviewBtn').addEventListener('click', showReviewScreen);
  
  document.getElementById('scratchpadBtn').addEventListener('click', function() { openModal('scratchpadModal'); });
  document.getElementById('calculatorBtn').addEventListener('click', function() { openModal('calculatorModal'); });
  
  // Review screen
  document.getElementById('backToQuestionsBtn').addEventListener('click', function() {
    showScreen('questionScreen');
    renderQuestion();
    updateTopBar();
  });
  document.getElementById('submitSectionBtn').addEventListener('click', submitSection);
  
  // Results screen
  document.getElementById('exportAttemptBtn').addEventListener('click', exportAttempt);
  document.getElementById('backToSetupBtn').addEventListener('click', function() {
    showScreen('setupScreen');
    loadHistoryOnSetup();
  });
  
  // Modals
  document.getElementById('closeScratchpad').addEventListener('click', function() { closeModal('scratchpadModal'); });
  document.getElementById('closeCalculator').addEventListener('click', function() { closeModal('calculatorModal'); });
  document.getElementById('closeScaledMapping').addEventListener('click', function() { closeModal('scaledMappingModal'); });
  document.getElementById('closeBankStats').addEventListener('click', function() { closeModal('bankStatsModal'); });
  
  // Close modals on ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeModal('scratchpadModal');
      closeModal('calculatorModal');
      closeModal('scaledMappingModal');
      closeModal('bankStatsModal');
    }
  });
  
  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (!document.getElementById('questionScreen').classList.contains('active')) return;
    
    if (e.key === 'ArrowLeft') {
      navigateQuestion(-1);
    } else if (e.key === 'ArrowRight') {
      navigateQuestion(1);
    } else if (e.key >= '1' && e.key <= '5') {
      const optIdx = parseInt(e.key, 10) - 1;
      const question = APP_STATE.sectionQuestions[APP_STATE.currentQuestionIndex];
      if (question && optIdx < question.options.length) {
        selectAnswer(optIdx);
      }
    }
  });
}

// ========================================
// INITIALIZATION
// ========================================

async function init() {
  // Attach listeners immediately
  initEventListeners();
  initCalculator();
  loadHistoryOnSetup();
  
  // Load banks
  try {
    await loadBanks();
  } catch (error) {
    console.error('Failed to load banks during init:', error);
    showToast('⚠️ Banks failed to load. Click "Reload Banks" to retry.', 'warning');
  }
  
  // Apply settings to UI
  document.getElementById('heuristicScalingCheck').checked = APP_STATE.settings.scaledScoreEnabled;
  document.getElementById('exposureControlCheck').checked = APP_STATE.settings.exposureControl;
  
  showScreen('setupScreen');
}

// Start app when DOM is ready
window.addEventListener('DOMContentLoaded', init);
