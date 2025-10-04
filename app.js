// ========================================
// GMAT Focus Practice — Solo Trainer
// Framework-free, multi-stage adaptive testing
// ========================================

'use strict';

// ========================================
// STATE MANAGEMENT
// ========================================

const APP_STATE = {
  questionBank: [],           // All loaded questions
  currentSection: null,       // 'Quant', 'Verbal', 'Data Insights'
  sectionQuestions: [],       // Selected questions for current section
  currentQuestionIndex: 0,    // Index in sectionQuestions
  responses: {},              // { questionIndex: answerIndex }
  flags: new Set(),           // Set of flagged question indices
  editsRemaining: 3,          // Answer change limit
  editHistory: {},            // Track which questions have been edited: { questionIndex: editCount }
  timerSeconds: 0,           // Countdown timer
  timerInterval: null,
  currentDifficulty: 'M',    // E, M, H
  blockIndex: 0,              // Current block number
  blockSize: 4,               // 4 for Q/V, 5 for DI
  mstRoute: [],               // Track difficulty progression: ['M', 'M', 'H', ...]
  usedItemIds: new Set(),     // Exposure control
  currentAttempt: null        // Store current attempt data for export
};

// ========================================
// INDEXEDDB / LOCALSTORAGE ABSTRACTION
// ========================================

const DB = {
  dbName: 'GMATFocusDB',
  dbVersion: 1,
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
      };
    });
  },

  async saveQuestions(questions) {
    if (this.db) {
      const tx = this.db.transaction('questions', 'readwrite');
      const store = tx.objectStore('questions');
      
      // Clear existing
      await store.clear();
      
      // Add new questions
      for (const q of questions) {
        await store.put(q);
      }
      
      return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
      });
    } else {
      // LocalStorage fallback
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
      // LocalStorage fallback
      const stored = localStorage.getItem('questionBank');
      return stored ? JSON.parse(stored) : [];
    }
  }
};

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
  
  // If empty, load sample data
  if (questions.length === 0) {
    questions = await loadSampleData();
    if (questions.length > 0) {
      await DB.saveQuestions(questions);
    }
  }
  
  APP_STATE.questionBank = questions;
  
  // Load used item IDs from localStorage
  const usedIds = localStorage.getItem('usedItemIds');
  if (usedIds) {
    APP_STATE.usedItemIds = new Set(JSON.parse(usedIds));
  }
  
  updateBankStats();
}

function updateBankStats() {
  const total = APP_STATE.questionBank.length;
  const easy = APP_STATE.questionBank.filter(q => q.difficulty === 'E').length;
  const medium = APP_STATE.questionBank.filter(q => q.difficulty === 'M').length;
  const hard = APP_STATE.questionBank.filter(q => q.difficulty === 'H').length;

  document.getElementById('totalItems').textContent = total;
  document.getElementById('easyCount').textContent = easy;
  document.getElementById('mediumCount').textContent = medium;
  document.getElementById('hardCount').textContent = hard;
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

async function importQuestions(file) {
  const text = await file.text();
  let items = [];

  if (file.name.endsWith('.json')) {
    const data = JSON.parse(text);
    items = data.items || [];
  } else if (file.name.endsWith('.csv')) {
    items = parseCSV(text);
  }

  // Validate and de-dupe
  const validItems = items.filter(item => 
    item.id && 
    item.section && 
    item.difficulty && 
    item.prompt && 
    Array.isArray(item.options) && 
    item.options.length > 0 &&
    typeof item.answer === 'number'
  );

  // De-dupe by ID
  const existingIds = new Set(APP_STATE.questionBank.map(q => q.id));
  const newItems = validItems.filter(item => !existingIds.has(item.id));

  if (newItems.length === 0) {
    showToast('No new questions to import', 'warning');
    return;
  }

  APP_STATE.questionBank.push(...newItems);
  await DB.saveQuestions(APP_STATE.questionBank);
  updateBankStats();
  
  showToast(`Imported ${newItems.length} new questions`, 'success');
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

// ========================================
// MULTI-STAGE ADAPTIVITY (MST)
// ========================================

/**
 * MST Routing Logic:
 * - Start at Medium difficulty
 * - Block size: 4 for Quant/Verbal, 5 for Data Insights
 * - After each block: score >= 75% → step up, <= 50% → step down
 * - Content balancing within each block
 * - Exposure control: avoid re-using questions
 */

function getBlockSize(section) {
  return section === 'Data Insights' ? 5 : 4;
}

function selectQuestionsForSection(section, totalCount) {
  const blockSize = getBlockSize(section);
  APP_STATE.blockSize = blockSize;
  APP_STATE.currentDifficulty = 'M'; // Start at Medium
  APP_STATE.blockIndex = 0;
  APP_STATE.mstRoute = [];
  
  const questions = [];
  const totalBlocks = Math.ceil(totalCount / blockSize);
  
  let currentDiff = 'M';
  
  for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
    const isLastBlock = blockNum === totalBlocks - 1;
    const questionsNeeded = isLastBlock ? (totalCount - questions.length) : blockSize;
    
    const blockQuestions = selectBlockQuestions(section, currentDiff, questionsNeeded);
    questions.push(...blockQuestions);
    APP_STATE.mstRoute.push(currentDiff);
    
    // Pre-calculate next difficulty for routing (actual routing happens during test)
    // For now, we just mark the route
  }
  
  return questions;
}

function selectBlockQuestions(section, difficulty, count) {
  // Get available questions for this section and difficulty
  let pool = APP_STATE.questionBank.filter(q => 
    q.section === section && 
    q.difficulty === difficulty &&
    !APP_STATE.usedItemIds.has(q.id)
  );
  
  // Bank exhaustion handling: backfill from other difficulties
  if (pool.length < count) {
    console.warn(`Insufficient ${difficulty} questions for ${section}. Backfilling...`);
    
    // Try Medium first
    if (difficulty !== 'M') {
      const mediumPool = APP_STATE.questionBank.filter(q =>
        q.section === section &&
        q.difficulty === 'M' &&
        !APP_STATE.usedItemIds.has(q.id)
      );
      pool = pool.concat(mediumPool);
    }
    
    // Then Easy/Hard
    if (pool.length < count) {
      const otherPool = APP_STATE.questionBank.filter(q =>
        q.section === section &&
        q.difficulty !== difficulty &&
        !APP_STATE.usedItemIds.has(q.id)
      );
      pool = pool.concat(otherPool);
    }
  }
  
  // Content balancing: try to diversify question types
  const selected = [];
  const typesSeen = new Set();
  
  // First pass: select diverse types
  for (const q of pool) {
    if (selected.length >= count) break;
    if (!typesSeen.has(q.type)) {
      selected.push(q);
      typesSeen.add(q.type);
    }
  }
  
  // Second pass: fill remaining with any available
  for (const q of pool) {
    if (selected.length >= count) break;
    if (!selected.includes(q)) {
      selected.push(q);
    }
  }
  
  // Shuffle selected questions
  return shuffleArray(selected.slice(0, count));
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

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
  
  return total > 0 ? (correct / total) : 0;
}

function getNextDifficulty(currentDiff, blockScore) {
  if (blockScore >= 0.75) {
    // Step up
    if (currentDiff === 'E') return 'M';
    if (currentDiff === 'M') return 'H';
    return 'H'; // Already at Hard
  } else if (blockScore <= 0.50) {
    // Step down
    if (currentDiff === 'H') return 'M';
    if (currentDiff === 'M') return 'E';
    return 'E'; // Already at Easy
  }
  return currentDiff; // Stay same
}

// Note: In a real adaptive test, we would dynamically select questions
// after each block. For this implementation, we pre-select with Medium
// as baseline and track the route for demonstration.

// ========================================
// SESSION MANAGEMENT
// ========================================

function startSession() {
  const section = document.getElementById('sectionSelect').value;
  const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10);
  
  if (APP_STATE.questionBank.length === 0) {
    showToast('Please import questions first', 'error');
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
  
  // Determine section size
  let sectionSize;
  if (section === 'Quant') sectionSize = 21;
  else if (section === 'Verbal') sectionSize = 23;
  else sectionSize = 20; // Data Insights
  
  // Select questions using MST
  APP_STATE.sectionQuestions = selectQuestionsForSection(section, sectionSize);
  
  if (APP_STATE.sectionQuestions.length === 0) {
    showToast('Not enough questions in bank for this section', 'error');
    return;
  }
  
  // Show/hide calculator based on section
  const calcBtn = document.getElementById('calculatorBtn');
  calcBtn.style.display = section === 'Data Insights' ? 'inline-block' : 'none';
  
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
  showToast('Time is up!', 'warning');
  
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
  
  // Add warning/danger classes
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
 * Edit-cap enforcement:
 * - Initial selection is free
 * - Changing an already-set answer consumes one edit
 * - Track per-question edit counts
 * - Block changes when editsRemaining === 0
 */
function selectAnswer(optIdx) {
  const idx = APP_STATE.currentQuestionIndex;
  const previousAnswer = APP_STATE.responses[idx];
  
  // If changing an existing answer
  if (previousAnswer !== undefined && previousAnswer !== optIdx) {
    if (APP_STATE.editsRemaining <= 0) {
      showToast('No edits remaining! Cannot change answer.', 'error');
      return;
    }
    
    APP_STATE.editsRemaining--;
    APP_STATE.editHistory[idx] = (APP_STATE.editHistory[idx] || 0) + 1;
    updateTopBar();
  }
  
  // Set the answer
  APP_STATE.responses[idx] = optIdx;
  
  // Re-render to update selection
  renderQuestion();
}

function updateTopBar() {
  document.getElementById('sectionLabel').textContent = APP_STATE.currentSection;
  document.getElementById('editsLeft').textContent = `Edits: ${APP_STATE.editsRemaining}`;
  
  // Update difficulty label based on current block
  const currentBlockNum = Math.floor(APP_STATE.currentQuestionIndex / APP_STATE.blockSize);
  const difficulty = APP_STATE.mstRoute[currentBlockNum] || APP_STATE.currentDifficulty;
  
  const diffLabel = document.getElementById('difficultyLabel');
  diffLabel.textContent = difficulty === 'E' ? 'Easy' : difficulty === 'M' ? 'Medium' : 'Hard';
  diffLabel.className = `difficulty-label ${difficulty}`;
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
  
  APP_STATE.sectionQuestions.forEach((q, idx) => {
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

/**
 * Edit-cap enforcement in Review:
 * - Clicking a review item to change answer follows same rules
 * - selectAnswer() already handles this
 */

// ========================================
// RESULTS & HISTORY
// ========================================

function submitSection() {
  clearInterval(APP_STATE.timerInterval);
  
  // Calculate score
  let correct = 0;
  let total = APP_STATE.sectionQuestions.length;
  
  APP_STATE.sectionQuestions.forEach((q, idx) => {
    if (APP_STATE.responses[idx] === q.answer) {
      correct++;
    }
  });
  
  const percentage = Math.round((correct / total) * 100);
  
  // Mark questions as used
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
    timestamp: new Date().toISOString(),
    itemsUsed: APP_STATE.sectionQuestions.map(q => q.id),
    mstRoute: APP_STATE.mstRoute,
    responses: APP_STATE.responses
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
  resultsContent.innerHTML = `
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
    </div>
    <div class="result-stat">
      <span class="result-stat-label">MST Route</span>
      <span class="result-stat-value">${result.mstRoute.join(' → ')}</span>
    </div>
  `;
  
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
        <th>Route</th>
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
      <td>${h.mstRoute ? h.mstRoute.join('→') : 'N/A'}</td>
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
      // Calculate previous operation
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
    e.target.value = ''; // Reset input
  });
  
  document.getElementById('exportBankBtn').addEventListener('click', exportBank);
  document.getElementById('startBtn').addEventListener('click', startSession);
  
  document.getElementById('resetExposureCheck').addEventListener('change', (e) => {
    if (e.target.checked) {
      APP_STATE.usedItemIds.clear();
      localStorage.removeItem('usedItemIds');
      showToast('Exposure tracking reset', 'success');
      e.target.checked = false;
    }
  });
  
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
  
  // Close modals on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('scratchpadModal');
      closeModal('calculatorModal');
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
  
  // Keyboard navigation in questions
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('questionScreen').classList.contains('active')) return;
    
    if (e.key === 'ArrowLeft') {
      navigateQuestion(-1);
    } else if (e.key === 'ArrowRight') {
      navigateQuestion(1);
    } else if (e.key >= '1' && e.key <= '5') {
      const optIdx = parseInt(e.key, 10) - 1;
      if (optIdx < APP_STATE.sectionQuestions[APP_STATE.currentQuestionIndex].options.length) {
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
