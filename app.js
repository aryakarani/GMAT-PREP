// ========================================
// GMAT Focus Practice — Solo Trainer
// Rasch/Elo Adaptive with Calibrated Difficulty
// Framework-free, multi-stage adaptive testing
// ========================================

'use strict';

// ========================================
// STATE MANAGEMENT
// ========================================

const APP_STATE = {
  questionBank: [],           // All loaded questions
  itemStats: new Map(),       // Map<id, {attempts, correct, theta}>
  currentSection: null,       // 'Quant', 'Verbal', 'Data Insights'
  currentTest: {              // ✅ Assembled test items only (rendering guard)
    Quant: { items: [], userTheta: 0.0 },
    Verbal: { items: [], userTheta: 0.0 },
    'Data Insights': { items: [], userTheta: 0.0 }
  },
  sectionQuestions: [],       // Current section's assembled items
  currentQuestionIndex: 0,
  responses: {},              // { questionIndex: answerIndex }
  flags: new Set(),
  editsRemaining: 3,
  editHistory: {},
  timerSeconds: 0,
  timerInterval: null,
  userTheta: 0.0,            // Current user ability estimate
  blockIndex: 0,
  blockSize: 4,
  usedItemIds: new Set(),
  currentAttempt: null,
  settings: {
    showTheta: false,
    scaledScoreEnabled: false,
    exposureControl: true,
    scaledMapping: [
      { pct: 55, score: 605 },
      { pct: 65, score: 655 },
      { pct: 75, score: 705 },
      { pct: 85, score: 745 },
      { pct: 95, score: 805 }
    ]
  }
};

// ========================================
// INDEXEDDB / LOCALSTORAGE ABSTRACTION
// ========================================

const DB = {
  dbName: 'GMATFocusDB',
  dbVersion: 2,
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not available, falling back to localStorage');
        resolve(false);
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('IndexedDB failed, falling back to localStorage');
        resolve(false);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('questions')) {
          db.createObjectStore('questions', { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains('stats')) {
          db.createObjectStore('stats', { keyPath: 'id' });
        }
      };
    });
  },

  async saveQuestions(questions) {
    if (this.db) {
      const tx = this.db.transaction('questions', 'readwrite');
      const store = tx.objectStore('questions');
      await store.clear();
      for (const q of questions) {
        await store.put(q);
      }
      return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
      });
    } else {
      localStorage.setItem('questionBank', JSON.stringify(questions));
    }
  },

  async loadQuestions() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('questions', 'readonly');
        const store = tx.objectStore('questions');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } else {
      const stored = localStorage.getItem('questionBank');
      return stored ? JSON.parse(stored) : [];
    }
  },

  /**
   * Item stats tracking for Rasch/Elo calibration
   * Schema: { id, attempts, correct, theta }
   */
  async saveStats(statsMap) {
    if (this.db) {
      const tx = this.db.transaction('stats', 'readwrite');
      const store = tx.objectStore('stats');
      for (const [id, stat] of statsMap.entries()) {
        await store.put({ id, ...stat });
      }
      return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
      });
    } else {
      const obj = Object.fromEntries(statsMap);
      localStorage.setItem('itemStats', JSON.stringify(obj));
    }
  },

  async loadStats() {
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction('stats', 'readonly');
        const store = tx.objectStore('stats');
        const request = store.getAll();
        request.onsuccess = () => {
          const map = new Map();
          request.result.forEach(s => {
            map.set(s.id, { attempts: s.attempts, correct: s.correct, theta: s.theta });
          });
          resolve(map);
        };
        request.onerror = () => reject(request.error);
      });
    } else {
      const stored = localStorage.getItem('itemStats');
      if (stored) {
        const obj = JSON.parse(stored);
        return new Map(Object.entries(obj));
      }
      return new Map();
    }
  }
};

// ========================================
// RASCH/ELO CALIBRATION
// ========================================

/**
 * Initialize theta for a new item based on difficulty tag
 * E = -1.0, M = 0.0, H = +1.0
 */
function getInitialTheta(difficulty) {
  if (difficulty === 'E') return -1.0;
  if (difficulty === 'H') return 1.0;
  return 0.0; // M
}

/**
 * Calculate probability of correct response using 1PL Rasch model
 * p_correct = 1 / (1 + exp(-(userTheta - itemTheta)))
 */
function raschProbability(userTheta, itemTheta) {
  return 1.0 / (1.0 + Math.exp(-(userTheta - itemTheta)));
}

/**
 * Adaptive learning rate: start at 0.15, decay to 0.05 with attempts
 */
function getLearningRate(attempts) {
  if (attempts < 5) return 0.15;
  if (attempts < 20) return 0.10;
  return 0.05;
}

/**
 * Update item theta after user response (Elo-style update)
 * theta_next = theta + k * (outcome - p_correct)
 * where outcome = 1 if correct, 0 if incorrect
 */
function updateItemTheta(itemId, userTheta, wasCorrect) {
  let stat = APP_STATE.itemStats.get(itemId);
  
  if (!stat) {
    // Initialize from bank
    const item = APP_STATE.questionBank.find(q => q.id === itemId);
    stat = {
      attempts: 0,
      correct: 0,
      theta: item ? getInitialTheta(item.difficulty) : 0.0
    };
    APP_STATE.itemStats.set(itemId, stat);
  }
  
  const p = raschProbability(userTheta, stat.theta);
  const k = getLearningRate(stat.attempts);
  const outcome = wasCorrect ? 1 : 0;
  
  // Update theta
  stat.theta += k * (outcome - p);
  stat.attempts++;
  if (wasCorrect) stat.correct++;
  
  // Save to IndexedDB (async, non-blocking)
  DB.saveStats(APP_STATE.itemStats).catch(err => 
    console.warn('Failed to save stats:', err)
  );
  
  return stat.theta;
}

/**
 * Update user ability theta after response (mirrored update)
 * θ_user_next = θ_user + k_user * (outcome - p_correct)
 */
function updateUserTheta(userTheta, itemTheta, wasCorrect, attempts) {
  const p = raschProbability(userTheta, itemTheta);
  const k = getLearningRate(attempts);
  const outcome = wasCorrect ? 1 : 0;
  
  return userTheta + k * (outcome - p);
}

/**
 * Get effective theta for an item (from stats if available, else initial)
 */
function getItemTheta(itemId, difficulty) {
  const stat = APP_STATE.itemStats.get(itemId);
  return stat ? stat.theta : getInitialTheta(difficulty);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ========================================
// QUESTION BANK MANAGEMENT
// ========================================

async function loadSampleData() {
  try {
    const response = await fetch('./data/questions.sample.json');
    const data = await response.json();
    return data.items || [];
  } catch (err) {
    console.error('Failed to load sample data:', err);
    return [];
  }
}

async function initializeBank() {
  await DB.init();
  
  let questions = await DB.loadQuestions();
  
  // Load item stats
  APP_STATE.itemStats = await DB.loadStats();
  
  // Load settings
  const savedSettings = localStorage.getItem('settings');
  if (savedSettings) {
    APP_STATE.settings = { ...APP_STATE.settings, ...JSON.parse(savedSettings) };
  }
  
  // Load used item IDs
  const usedIds = localStorage.getItem('usedItemIds');
  if (usedIds) {
    APP_STATE.usedItemIds = new Set(JSON.parse(usedIds));
  }
  
  // If empty bank, load sample
  if (questions.length === 0) {
    questions = await loadSampleData();
    if (questions.length > 0) {
      await DB.saveQuestions(questions);
      showToast('Sample bank installed (24 items)', 'success');
    }
  }
  
  APP_STATE.questionBank = questions;
  updateBankStats();
  
  // Apply settings to UI
  document.getElementById('showThetaCheck').checked = APP_STATE.settings.showTheta;
  document.getElementById('heuristicScalingCheck').checked = APP_STATE.settings.scaledScoreEnabled;
  document.getElementById('exposureControlCheck').checked = APP_STATE.settings.exposureControl;
}

/**
 * Update bank statistics with theta-based difficulty bins
 * Easy: theta < -0.6, Medium: [-0.6, 0.6], Hard: > 0.6
 */
function updateBankStats() {
  const total = APP_STATE.questionBank.length;
  
  // Section counts
  const quantCount = APP_STATE.questionBank.filter(q => q.section === 'Quant').length;
  const verbalCount = APP_STATE.questionBank.filter(q => q.section === 'Verbal').length;
  const diCount = APP_STATE.questionBank.filter(q => q.section === 'Data Insights').length;
  
  // Theta-based difficulty bins
  let easyCount = 0, mediumCount = 0, hardCount = 0;
  
  APP_STATE.questionBank.forEach(q => {
    const theta = getItemTheta(q.id, q.difficulty);
    if (theta < -0.6) easyCount++;
    else if (theta > 0.6) hardCount++;
    else mediumCount++;
  });
  
  document.getElementById('totalItems').textContent = total;
  document.getElementById('quantCount').textContent = quantCount;
  document.getElementById('verbalCount').textContent = verbalCount;
  document.getElementById('diCount').textContent = diCount;
  document.getElementById('easyCount').textContent = easyCount;
  document.getElementById('mediumCount').textContent = mediumCount;
  document.getElementById('hardCount').textContent = hardCount;
  
  renderThetaHistogram();
}

/**
 * Render theta distribution histogram
 */
function renderThetaHistogram() {
  const container = document.getElementById('thetaHistogram');
  container.innerHTML = '';
  
  if (APP_STATE.questionBank.length === 0) return;
  
  // Create 10 bins from -2 to +2
  const bins = Array(10).fill(0);
  const binWidth = 0.4; // each bin is 0.4 theta units
  
  APP_STATE.questionBank.forEach(q => {
    const theta = getItemTheta(q.id, q.difficulty);
    const binIdx = Math.floor((theta + 2) / binWidth);
    const idx = Math.max(0, Math.min(9, binIdx));
    bins[idx]++;
  });
  
  const maxBin = Math.max(...bins, 1);
  
  bins.forEach((count, i) => {
    const bar = document.createElement('div');
    bar.className = 'theta-bar';
    bar.style.height = `${(count / maxBin) * 100}%`;
    bar.title = `θ ${(i * binWidth - 2).toFixed(1)} to ${((i + 1) * binWidth - 2).toFixed(1)}: ${count} items`;
    container.appendChild(bar);
  });
}

// ========================================
// IMPORT / EXPORT
// ========================================

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;

    const item = {};
    headers.forEach((header, idx) => {
      item[header] = values[idx] ? values[idx].trim() : '';
    });

    // Convert to normalized format
    items.push({
      id: item.id,
      section: item.section,
      type: item.type,
      difficulty: item.difficulty,
      skills: item.skills ? item.skills.split('|').map(s => s.trim()) : [],
      prompt: item.prompt,
      options: item.options ? item.options.split('|').map(o => o.trim()) : [],
      answer: parseInt(item.answer, 10),
      table: item.table_json ? JSON.parse(item.table_json) : null,
      explanation: item.explanation || ''
    });
  }

  return items;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Import questions with validation
 * Supports both JSON and CSV formats
 */
async function importQuestions(file) {
  const text = await file.text();
  let items = [];

  try {
    if (file.name.endsWith('.json')) {
      const data = JSON.parse(text);
      items = data.items || [];
    } else if (file.name.endsWith('.csv')) {
      items = parseCSV(text);
    }

    // Validate items
    const validItems = items.filter(item => 
      item.id && 
      item.section && 
      item.difficulty && 
      item.prompt && 
      Array.isArray(item.options) && 
      item.options.length > 0 &&
      typeof item.answer === 'number'
    );

    if (validItems.length === 0) {
      showToast('No valid questions found in file', 'error');
      return;
    }

    // Merge with existing bank (de-dupe by ID)
    const existingIds = new Set(APP_STATE.questionBank.map(q => q.id));
    const newItems = validItems.filter(item => !existingIds.has(item.id));
    const updatedItems = validItems.filter(item => existingIds.has(item.id));

    if (newItems.length === 0 && updatedItems.length === 0) {
      showToast('No new or updated questions to import', 'warning');
      return;
    }

    // Update existing items
    if (updatedItems.length > 0) {
      APP_STATE.questionBank = APP_STATE.questionBank.map(q => {
        const updated = updatedItems.find(u => u.id === q.id);
        return updated || q;
      });
    }

    // Add new items
    APP_STATE.questionBank.push(...newItems);
    
    await DB.saveQuestions(APP_STATE.questionBank);
    updateBankStats();
    
    showToast(`Imported ${newItems.length} new, ${updatedItems.length} updated`, 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
    console.error('Import error:', err);
  }
}

function exportBank() {
  const data = {
    meta: {
      version: 1,
      source: 'GMAT Focus Solo Trainer',
      createdAt: new Date().toISOString(),
      totalItems: APP_STATE.questionBank.length
    },
    items: APP_STATE.questionBank
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gmat-bank-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Bank exported successfully', 'success');
}

function exportAttempt() {
  if (!APP_STATE.currentAttempt) return;

  const blob = new Blob([JSON.stringify(APP_STATE.currentAttempt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gmat-attempt-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Attempt exported successfully', 'success');
}

async function installSampleBank() {
  const questions = await loadSampleData();
  if (questions.length > 0) {
    APP_STATE.questionBank = questions;
    await DB.saveQuestions(questions);
    updateBankStats();
    showToast('Sample bank installed (24 items)', 'success');
  } else {
    showToast('Failed to load sample bank', 'error');
  }
}

// ========================================
// ADAPTIVE TEST ASSEMBLY (Rasch/Elo)
// ========================================

/**
 * Adaptive selection: choose items whose theta is nearest to userTheta
 * With content balancing via skills and exposure control
 */
function selectQuestionsAdaptive(section, totalCount, userTheta) {
  const blockSize = section === 'Data Insights' ? 5 : 4;
  const totalBlocks = Math.ceil(totalCount / blockSize);
  
  const selectedItems = [];
  let currentUserTheta = userTheta;
  
  // Content balancing: track which skill categories we've covered
  const requiredSkills = getRequiredSkills(section);
  const coveredSkills = new Set();
  
  for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
    const isLastBlock = blockNum === totalBlocks - 1;
    const questionsNeeded = isLastBlock ? (totalCount - selectedItems.length) : blockSize;
    
    // Get available pool for this section
    let pool = APP_STATE.questionBank.filter(q => q.section === section);
    
    // Exposure control: filter out used items
    if (APP_STATE.settings.exposureControl) {
      pool = pool.filter(q => !APP_STATE.usedItemIds.has(q.id));
    }
    
    // If pool exhausted, backfill with warning
    if (pool.length < questionsNeeded) {
      showToast('⚠️ Question pool exhausted, allowing repeats', 'warning');
      pool = APP_STATE.questionBank.filter(q => q.section === section);
    }
    
    // Sort pool by theta distance from currentUserTheta
    pool.forEach(q => {
      q._theta = getItemTheta(q.id, q.difficulty);
      q._distance = Math.abs(q._theta - currentUserTheta);
    });
    pool.sort((a, b) => a._distance - b._distance);
    
    // Select items: prioritize nearest theta, but ensure skill diversity
    const blockItems = [];
    const neededSkillsForBlock = Array.from(requiredSkills).filter(s => !coveredSkills.has(s));
    
    // First pass: fulfill required skills
    for (const skill of neededSkillsForBlock) {
      if (blockItems.length >= questionsNeeded) break;
      const candidate = pool.find(q => 
        !blockItems.includes(q) && 
        q.skills && q.skills.includes(skill)
      );
      if (candidate) {
        blockItems.push(candidate);
        candidate.skills?.forEach(s => coveredSkills.add(s));
      }
    }
    
    // Second pass: fill remaining with nearest theta
    for (const q of pool) {
      if (blockItems.length >= questionsNeeded) break;
      if (!blockItems.includes(q)) {
        blockItems.push(q);
      }
    }
    
    selectedItems.push(...blockItems);
    
    // Simulate block performance to estimate next theta (for pre-assembly)
    // In reality, theta updates dynamically during test
    currentUserTheta += (Math.random() - 0.5) * 0.3; // small random walk
  }
  
  return selectedItems.slice(0, totalCount);
}

/**
 * Get required skills for content balancing per section
 */
function getRequiredSkills(section) {
  if (section === 'Quant') {
    return new Set(['percent', 'algebra', 'ratio', 'geometry']);
  } else if (section === 'Verbal') {
    return new Set(['strengthen', 'weaken', 'inference', 'assumption']);
  } else { // Data Insights
    return new Set(['table', 'graphics', 'two-part', 'MSR']);
  }
}

/**
 * Calculate block score for routing decision
 */
function calculateBlockScore(blockStart, blockEnd) {
  let correct = 0;
  let total = 0;
  
  for (let i = blockStart; i < blockEnd && i < APP_STATE.sectionQuestions.length; i++) {
    if (APP_STATE.responses[i] !== undefined) {
      total++;
      const question = APP_STATE.sectionQuestions[i];
      if (APP_STATE.responses[i] === question.answer) {
        correct++;
      }
    }
  }
  
  return total > 0 ? (correct / total) : 0.5;
}

// ========================================
// SESSION MANAGEMENT
// ========================================

function startSession() {
  const section = document.getElementById('sectionSelect').value;
  const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10);
  
  if (APP_STATE.questionBank.length === 0) {
    showToast('Please import or install a question bank first', 'error');
    return;
  }
  
  // Check if section has enough questions
  const sectionPool = APP_STATE.questionBank.filter(q => q.section === section);
  let sectionSize;
  if (section === 'Quant') sectionSize = 21;
  else if (section === 'Verbal') sectionSize = 23;
  else sectionSize = 20; // Data Insights
  
  if (sectionPool.length < sectionSize) {
    showToast(`Not enough ${section} questions in bank (need ${sectionSize}, have ${sectionPool.length})`, 'error');
    return;
  }
  
  // Reset state
  APP_STATE.currentSection = section;
  APP_STATE.currentQuestionIndex = 0;
  APP_STATE.responses = {};
  APP_STATE.flags = new Set();
  APP_STATE.editsRemaining = 3;
  APP_STATE.editHistory = {};
  APP_STATE.timerSeconds = timerMinutes * 60;
  APP_STATE.blockIndex = 0;
  APP_STATE.blockSize = section === 'Data Insights' ? 5 : 4;
  APP_STATE.userTheta = 0.0; // Start at medium difficulty
  
  // ✅ Adaptive selection: assemble test based on theta
  APP_STATE.sectionQuestions = selectQuestionsAdaptive(section, sectionSize, APP_STATE.userTheta);
  
  // ✅ Store in currentTest for rendering guard
  APP_STATE.currentTest[section] = {
    items: APP_STATE.sectionQuestions,
    userTheta: APP_STATE.userTheta
  };
  
  // Show/hide calculator based on section
  const calcBtn = document.getElementById('calculatorBtn');
  calcBtn.style.display = section === 'Data Insights' ? 'inline-block' : 'none';
  
  // Show/hide theta chip based on settings
  const thetaChip = document.getElementById('thetaChip');
  thetaChip.style.display = APP_STATE.settings.showTheta ? 'inline-block' : 'none';
  
  // Start timer
  startTimer();
  
  // Show question screen
  showScreen('questionScreen');
  renderQuestion();
  updateTopBar();
}

function startTimer() {
  if (APP_STATE.timerInterval) {
    clearInterval(APP_STATE.timerInterval);
  }
  
  APP_STATE.timerInterval = setInterval(() => {
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
  
  // If in question view, go to review
  if (document.getElementById('questionScreen').classList.contains('active')) {
    showReviewScreen();
  } else if (document.getElementById('reviewScreen').classList.contains('active')) {
    // If already in review, auto-submit
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

/**
 * ✅ Rendering guard: only use assembled test items from currentTest
 */
function renderQuestion() {
  const idx = APP_STATE.currentQuestionIndex;
  const question = APP_STATE.sectionQuestions[idx]; // ✅ Uses assembled set
  
  if (!question) return;
  
  // Update question number
  document.getElementById('questionNumber').textContent = 
    `Question ${idx + 1} of ${APP_STATE.sectionQuestions.length}`;
  
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
    question.table.headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    question.table.rows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach(cell => {
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
  
  question.options.forEach((option, optIdx) => {
    const div = document.createElement('div');
    div.className = 'option-item';
    if (APP_STATE.responses[idx] === optIdx) {
      div.classList.add('selected');
    }
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'answer';
    radio.value = optIdx;
    radio.id = `option-${optIdx}`;
    radio.checked = APP_STATE.responses[idx] === optIdx;
    
    const label = document.createElement('label');
    label.htmlFor = `option-${optIdx}`;
    label.textContent = option;
    
    div.appendChild(radio);
    div.appendChild(label);
    
    div.addEventListener('click', () => selectAnswer(optIdx));
    
    optionsContainer.appendChild(div);
  });
  
  // Update nav buttons
  document.getElementById('prevBtn').disabled = idx === 0;
}

/**
 * Edit-cap enforcement with Rasch/Elo theta updates
 */
function selectAnswer(optIdx) {
  const idx = APP_STATE.currentQuestionIndex;
  const previousAnswer = APP_STATE.responses[idx];
  
  // If changing an existing answer, consume an edit
  if (previousAnswer !== undefined && previousAnswer !== optIdx) {
    if (APP_STATE.editsRemaining <= 0) {
      showToast('❌ No edits remaining! Cannot change answer.', 'error');
      return; // ✅ Block change and revert
    }
    
    APP_STATE.editsRemaining--;
    APP_STATE.editHistory[idx] = (APP_STATE.editHistory[idx] || 0) + 1;
  }
  
  // Set the answer
  APP_STATE.responses[idx] = optIdx;
  
  // ✅ Update theta estimates (item and user)
  const question = APP_STATE.sectionQuestions[idx];
  const wasCorrect = optIdx === question.answer;
  const itemTheta = getItemTheta(question.id, question.difficulty);
  
  // Update item theta
  updateItemTheta(question.id, APP_STATE.userTheta, wasCorrect);
  
  // Update user theta
  const totalAttempts = Object.keys(APP_STATE.responses).length;
  APP_STATE.userTheta = updateUserTheta(APP_STATE.userTheta, itemTheta, wasCorrect, totalAttempts);
  
  // Update theta chip if visible
  if (APP_STATE.settings.showTheta) {
    document.getElementById('thetaChip').textContent = `θ: ${APP_STATE.userTheta.toFixed(2)}`;
  }
  
  // Re-render to update selection
  renderQuestion();
  updateTopBar();
}

function updateTopBar() {
  document.getElementById('sectionLabel').textContent = APP_STATE.currentSection;
  document.getElementById('editsLeft').textContent = `Edits: ${APP_STATE.editsRemaining}`;
  
  // Update difficulty label based on current item theta
  const idx = APP_STATE.currentQuestionIndex;
  if (idx < APP_STATE.sectionQuestions.length) {
    const question = APP_STATE.sectionQuestions[idx];
    const theta = getItemTheta(question.id, question.difficulty);
    
    let diffLabel, diffClass;
    if (theta < -0.6) {
      diffLabel = 'Easy';
      diffClass = 'E';
    } else if (theta > 0.6) {
      diffLabel = 'Hard';
      diffClass = 'H';
    } else {
      diffLabel = 'Medium';
      diffClass = 'M';
    }
    
    const diffElement = document.getElementById('difficultyLabel');
    diffElement.textContent = diffLabel;
    diffElement.className = `difficulty-label ${diffClass}`;
  }
  
  // Update theta chip
  if (APP_STATE.settings.showTheta) {
    document.getElementById('thetaChip').textContent = `θ: ${APP_STATE.userTheta.toFixed(2)}`;
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

/**
 * ✅ Review uses assembled test items only
 */
function renderReviewGrid() {
  const grid = document.getElementById('reviewGrid');
  grid.innerHTML = '';
  
  APP_STATE.sectionQuestions.forEach((q, idx) => { // ✅ Only assembled items
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
    
    item.addEventListener('click', () => {
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

/**
 * Calculate heuristic scaled score using piecewise linear interpolation
 */
function calculateScaledScore(percentage) {
  const mapping = APP_STATE.settings.scaledMapping.sort((a, b) => a.pct - b.pct);
  
  // Below lowest point
  if (percentage <= mapping[0].pct) {
    return mapping[0].score;
  }
  
  // Above highest point
  if (percentage >= mapping[mapping.length - 1].pct) {
    return mapping[mapping.length - 1].score;
  }
  
  // Find enclosing points and interpolate
  for (let i = 0; i < mapping.length - 1; i++) {
    const p1 = mapping[i];
    const p2 = mapping[i + 1];
    
    if (percentage >= p1.pct && percentage <= p2.pct) {
      const ratio = (percentage - p1.pct) / (p2.pct - p1.pct);
      return Math.round(p1.score + ratio * (p2.score - p1.score));
    }
  }
  
  return 705; // fallback
}

function submitSection() {
  clearInterval(APP_STATE.timerInterval);
  
  // ✅ Calculate score using assembled items only
  let correct = 0;
  let total = APP_STATE.sectionQuestions.length;
  
  APP_STATE.sectionQuestions.forEach((q, idx) => {
    if (APP_STATE.responses[idx] === q.answer) {
      correct++;
    }
  });
  
  const percentage = Math.round((correct / total) * 100);
  const scaledScore = calculateScaledScore(percentage);
  
  // Mark questions as used (exposure control)
  APP_STATE.sectionQuestions.forEach(q => {
    APP_STATE.usedItemIds.add(q.id);
  });
  localStorage.setItem('usedItemIds', JSON.stringify([...APP_STATE.usedItemIds]));
  
  // Save to history
  const result = {
    section: APP_STATE.currentSection,
    correct,
    total,
    percentage,
    scaledScore: APP_STATE.settings.scaledScoreEnabled ? scaledScore : null,
    thetaUserEnd: APP_STATE.userTheta,
    timestamp: new Date().toISOString(),
    itemIds: APP_STATE.sectionQuestions.map(q => q.id),
    responses: APP_STATE.responses,
    editsUsed: 3 - APP_STATE.editsRemaining
  };
  
  const history = JSON.parse(localStorage.getItem('results') || '[]');
  history.unshift(result);
  localStorage.setItem('results', JSON.stringify(history));
  
  APP_STATE.currentAttempt = result;
  
  // Show results
  showResultsScreen(result, history);
}

function showResultsScreen(result, history) {
  showScreen('resultsScreen');
  
  // Render current result
  const resultsContent = document.getElementById('resultsContent');
  
  let html = `
    <div class="result-stat">
      <span class="result-stat-label">Section</span>
      <span class="result-stat-value">${result.section}</span>
    </div>
    <div class="result-stat">
      <span class="result-stat-label">Score</span>
      <span class="result-stat-value">${result.correct} / ${result.total}</span>
    </div>
    <div class="result-stat">
      <span class="result-stat-label">Percentage</span>
      <span class="result-stat-value">${result.percentage}%</span>
    </div>`;
  
  if (result.scaledScore !== null) {
    html += `
    <div class="result-stat">
      <span class="result-stat-label">Heuristic Scaled Score</span>
      <span class="result-stat-value">${result.scaledScore}</span>
    </div>`;
  }
  
  html += `
    <div class="result-stat">
      <span class="result-stat-label">Final θ (Ability)</span>
      <span class="result-stat-value">${result.thetaUserEnd.toFixed(2)}</span>
    </div>
    <div class="result-stat">
      <span class="result-stat-label">Edits Used</span>
      <span class="result-stat-value">${result.editsUsed} / 3</span>
    </div>
  `;
  
  resultsContent.innerHTML = html;
  
  // Render history
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
  
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Section</th>
        <th>Score</th>
        <th>%</th>
        <th>Scaled</th>
        <th>Final θ</th>
      </tr>
    </thead>
    <tbody>
    </tbody>
  `;
  
  const tbody = table.querySelector('tbody');
  
  history.forEach(h => {
    const tr = document.createElement('tr');
    const date = new Date(h.timestamp).toLocaleString();
    
    tr.innerHTML = `
      <td>${date}</td>
      <td>${h.section}</td>
      <td>${h.correct}/${h.total}</td>
      <td>${h.percentage}%</td>
      <td>${h.scaledScore !== null ? h.scaledScore : '—'}</td>
      <td>${h.thetaUserEnd ? h.thetaUserEnd.toFixed(2) : '—'}</td>
    `;
    
    tbody.appendChild(tr);
  });
  
  container.innerHTML = '';
  container.appendChild(table);
}

function loadHistoryOnSetup() {
  const history = JSON.parse(localStorage.getItem('results') || '[]');
  renderHistory('historyContainer', history);
}

// ========================================
// BANK STATS MODAL
// ========================================

function showBankStats() {
  const modal = document.getElementById('bankStatsModal');
  const content = document.getElementById('bankStatsContent');
  
  // Calculate comprehensive stats
  const totalItems = APP_STATE.questionBank.length;
  const totalAttempts = Array.from(APP_STATE.itemStats.values()).reduce((sum, s) => sum + s.attempts, 0);
  const avgTheta = totalItems > 0 
    ? APP_STATE.questionBank.reduce((sum, q) => sum + getItemTheta(q.id, q.difficulty), 0) / totalItems 
    : 0;
  
  // Most answered items
  const mostAnswered = Array.from(APP_STATE.itemStats.entries())
    .sort((a, b) => b[1].attempts - a[1].attempts)
    .slice(0, 10);
  
  // Least answered items (with at least 1 attempt)
  const leastAnswered = Array.from(APP_STATE.itemStats.entries())
    .filter(([id, stat]) => stat.attempts > 0)
    .sort((a, b) => a[1].attempts - b[1].attempts)
    .slice(0, 10);
  
  // Section theta averages
  const sections = ['Quant', 'Verbal', 'Data Insights'];
  const sectionStats = sections.map(sec => {
    const items = APP_STATE.questionBank.filter(q => q.section === sec);
    const avgTheta = items.length > 0
      ? items.reduce((sum, q) => sum + getItemTheta(q.id, q.difficulty), 0) / items.length
      : 0;
    return { section: sec, count: items.length, avgTheta };
  });
  
  let html = `
    <div class="stats-grid">
      <div class="stat-card">
        <h4>Total Items</h4>
        <div class="stat-value">${totalItems}</div>
      </div>
      <div class="stat-card">
        <h4>Total Attempts</h4>
        <div class="stat-value">${totalAttempts}</div>
      </div>
      <div class="stat-card">
        <h4>Avg Item θ</h4>
        <div class="stat-value">${avgTheta.toFixed(2)}</div>
      </div>
    </div>
    
    <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Section Averages</h3>
    <div class="item-list">
  `;
  
  sectionStats.forEach(s => {
    html += `
      <div class="item-row">
        <span><strong>${s.section}</strong> (${s.count} items)</span>
        <span>Avg θ: ${s.avgTheta.toFixed(2)}</span>
      </div>
    `;
  });
  
  html += `</div>`;
  
  if (mostAnswered.length > 0) {
    html += `
      <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Top 10 Most Answered</h3>
      <div class="item-list">
    `;
    mostAnswered.forEach(([id, stat]) => {
      const item = APP_STATE.questionBank.find(q => q.id === id);
      const accuracy = stat.attempts > 0 ? Math.round((stat.correct / stat.attempts) * 100) : 0;
      html += `
        <div class="item-row">
          <span><strong>${id}</strong> ${item ? `(${item.section})` : ''}</span>
          <span>${stat.attempts} attempts • ${accuracy}% correct • θ=${stat.theta.toFixed(2)}</span>
        </div>
      `;
    });
    html += `</div>`;
  }
  
  if (leastAnswered.length > 0) {
    html += `
      <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Top 10 Least Answered</h3>
      <div class="item-list">
    `;
    leastAnswered.forEach(([id, stat]) => {
      const item = APP_STATE.questionBank.find(q => q.id === id);
      const accuracy = stat.attempts > 0 ? Math.round((stat.correct / stat.attempts) * 100) : 0;
      html += `
        <div class="item-row">
          <span><strong>${id}</strong> ${item ? `(${item.section})` : ''}</span>
          <span>${stat.attempts} attempts • ${accuracy}% correct • θ=${stat.theta.toFixed(2)}</span>
        </div>
      `;
    });
    html += `</div>`;
  }
  
  content.innerHTML = html;
  openModal('bankStatsModal');
}

// ========================================
// SCALED SCORE MAPPING
// ========================================

function showScaledMappingEditor() {
  const textarea = document.getElementById('scaledMappingText');
  const mapping = APP_STATE.settings.scaledMapping;
  
  const text = mapping.map(m => `${m.pct}:${m.score}`).join('\n');
  textarea.value = text;
  
  openModal('scaledMappingModal');
}

function saveScaledMapping() {
  const textarea = document.getElementById('scaledMappingText');
  const lines = textarea.value.trim().split('\n');
  
  try {
    const mapping = lines.map(line => {
      const [pct, score] = line.split(':').map(s => parseFloat(s.trim()));
      if (isNaN(pct) || isNaN(score)) {
        throw new Error('Invalid format');
      }
      return { pct, score };
    });
    
    if (mapping.length < 2) {
      throw new Error('Need at least 2 points');
    }
    
    APP_STATE.settings.scaledMapping = mapping.sort((a, b) => a.pct - b.pct);
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

let calcState = {
  display: '0',
  operand1: null,
  operator: null,
  waitingForOperand: false
};

function initCalculator() {
  const display = document.getElementById('calcDisplay');
  const buttons = document.querySelectorAll('.calc-btn');
  
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
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
  
  if (val >= '0' && val <= '9' || val === '.') {
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
  
  if (['+', '-', '*', '/', '%'].includes(val)) {
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
// EVENT LISTENERS
// ========================================

function initEventListeners() {
  // Setup screen
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });
  
  document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        await importQuestions(file);
      } catch (err) {
        showToast('Failed to import: ' + err.message, 'error');
      }
    }
    e.target.value = '';
  });
  
  document.getElementById('exportBankBtn').addEventListener('click', exportBank);
  document.getElementById('installSampleBtn').addEventListener('click', installSampleBank);
  document.getElementById('bankStatsBtn').addEventListener('click', showBankStats);
  document.getElementById('startBtn').addEventListener('click', startSession);
  
  // Settings
  document.getElementById('showThetaCheck').addEventListener('change', (e) => {
    APP_STATE.settings.showTheta = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('heuristicScalingCheck').addEventListener('change', (e) => {
    APP_STATE.settings.scaledScoreEnabled = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('exposureControlCheck').addEventListener('change', (e) => {
    APP_STATE.settings.exposureControl = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('resetExposureCheck').addEventListener('change', (e) => {
    if (e.target.checked) {
      APP_STATE.usedItemIds.clear();
      localStorage.removeItem('usedItemIds');
      showToast('Exposure tracking reset', 'success');
      e.target.checked = false;
    }
  });
  
  document.getElementById('editScaledMappingBtn').addEventListener('click', showScaledMappingEditor);
  document.getElementById('saveScaledMappingBtn').addEventListener('click', saveScaledMapping);
  
  // Question screen
  document.getElementById('prevBtn').addEventListener('click', () => navigateQuestion(-1));
  document.getElementById('nextBtn').addEventListener('click', () => navigateQuestion(1));
  document.getElementById('flagBtn').addEventListener('click', toggleFlag);
  document.getElementById('reviewBtn').addEventListener('click', showReviewScreen);
  
  document.getElementById('scratchpadBtn').addEventListener('click', () => openModal('scratchpadModal'));
  document.getElementById('calculatorBtn').addEventListener('click', () => openModal('calculatorModal'));
  
  // Review screen
  document.getElementById('backToQuestionsBtn').addEventListener('click', () => {
    showScreen('questionScreen');
    renderQuestion();
    updateTopBar();
  });
  document.getElementById('submitSectionBtn').addEventListener('click', submitSection);
  
  // Results screen
  document.getElementById('exportAttemptBtn').addEventListener('click', exportAttempt);
  document.getElementById('backToSetupBtn').addEventListener('click', () => {
    showScreen('setupScreen');
    loadHistoryOnSetup();
  });
  
  // Modals
  document.getElementById('closeScratchpad').addEventListener('click', () => closeModal('scratchpadModal'));
  document.getElementById('closeCalculator').addEventListener('click', () => closeModal('calculatorModal'));
  document.getElementById('closeScaledMapping').addEventListener('click', () => closeModal('scaledMappingModal'));
  document.getElementById('closeBankStats').addEventListener('click', () => closeModal('bankStatsModal'));
  
  // Close modals on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('scratchpadModal');
      closeModal('calculatorModal');
      closeModal('scaledMappingModal');
      closeModal('bankStatsModal');
    }
  });
  
  // Close modals on backdrop click
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal.id);
      }
    });
  });
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
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
  await initializeBank();
  initEventListeners();
  initCalculator();
  loadHistoryOnSetup();
  showScreen('setupScreen');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
