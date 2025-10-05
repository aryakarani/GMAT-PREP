// ========================================
// GMAT Focus Practice — Solo Trainer
// Static Banks with Heuristic Routing
// Framework-free, offline-capable
// ========================================

'use strict';

// ========================================
// STATE MANAGEMENT
// ========================================

const APP_STATE = {
  questionBanks: {
    Quant: [],
    Verbal: [],
    'Data Insights': []
  },
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
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => s.classList.remove('active'));
  
  const targetScreen = document.getElementById(screenId);
  if (!targetScreen) {
    console.error(`Screen with id '${screenId}' not found!`);
    showToast(`Error: Screen '${screenId}' not found`, 'error');
    return;
  }
  targetScreen.classList.add('active');
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ========================================
// QUESTION BANK MANAGEMENT
// ========================================

async function loadBanks() {
  try {
    const [quantRes, verbalRes, diRes] = await Promise.all([
      fetch('./data/bank_quant.json'),
      fetch('./data/bank_verbal.json'),
      fetch('./data/bank_di.json')
    ]);
    
    if (!quantRes.ok || !verbalRes.ok || !diRes.ok) {
      const errors = [];
      if (!quantRes.ok) errors.push(`Quant: ${quantRes.status}`);
      if (!verbalRes.ok) errors.push(`Verbal: ${verbalRes.status}`);
      if (!diRes.ok) errors.push(`DI: ${diRes.status}`);
      throw new Error(`Failed to fetch question banks: ${errors.join(', ')}`);
    }
    
    const [quantData, verbalData, diData] = await Promise.all([
      quantRes.json(),
      verbalRes.json(),
      diRes.json()
    ]);
    
    APP_STATE.questionBanks.Quant = quantData.items || [];
    APP_STATE.questionBanks.Verbal = verbalData.items || [];
    APP_STATE.questionBanks['Data Insights'] = diData.items || [];
    
    // Load used item IDs from localStorage
    const usedIds = localStorage.getItem('usedItemIds');
    if (usedIds) {
      APP_STATE.usedItemIds = new Set(JSON.parse(usedIds));
    }
    
    // Load settings
    const savedSettings = localStorage.getItem('settings');
    if (savedSettings) {
      APP_STATE.settings = { ...APP_STATE.settings, ...JSON.parse(savedSettings) };
    }
    
    updateBankStats();
    showToast('Question banks loaded successfully', 'success');
  } catch (err) {
    console.error('Failed to load banks:', err);
    showToast('Failed to load question banks: ' + err.message, 'error');
    throw err; // Re-throw to handle in startSession
  }
}

/**
 * Update bank statistics display
 */
function updateBankStats() {
  const quantTotal = APP_STATE.questionBanks.Quant.length;
  const verbalTotal = APP_STATE.questionBanks.Verbal.length;
  const diTotal = APP_STATE.questionBanks['Data Insights'].length;
  const totalItems = quantTotal + verbalTotal + diTotal;
  
  // Calculate remaining (unused) questions per section
  const quantRemaining = APP_STATE.questionBanks.Quant.filter(q => !APP_STATE.usedItemIds.has(q.id)).length;
  const verbalRemaining = APP_STATE.questionBanks.Verbal.filter(q => !APP_STATE.usedItemIds.has(q.id)).length;
  const diRemaining = APP_STATE.questionBanks['Data Insights'].filter(q => !APP_STATE.usedItemIds.has(q.id)).length;
  
  // Calculate by difficulty
  const allQuestions = [
    ...APP_STATE.questionBanks.Quant,
    ...APP_STATE.questionBanks.Verbal,
    ...APP_STATE.questionBanks['Data Insights']
  ];
  
  const easyTotal = allQuestions.filter(q => q.difficulty === 'E').length;
  const mediumTotal = allQuestions.filter(q => q.difficulty === 'M').length;
  const hardTotal = allQuestions.filter(q => q.difficulty === 'H').length;
  
  const easyRemaining = allQuestions.filter(q => q.difficulty === 'E' && !APP_STATE.usedItemIds.has(q.id)).length;
  const mediumRemaining = allQuestions.filter(q => q.difficulty === 'M' && !APP_STATE.usedItemIds.has(q.id)).length;
  const hardRemaining = allQuestions.filter(q => q.difficulty === 'H' && !APP_STATE.usedItemIds.has(q.id)).length;
  
  document.getElementById('totalItems').textContent = `${totalItems - APP_STATE.usedItemIds.size} / ${totalItems}`;
  document.getElementById('quantCount').textContent = `${quantRemaining} / ${quantTotal}`;
  document.getElementById('verbalCount').textContent = `${verbalRemaining} / ${verbalTotal}`;
  document.getElementById('diCount').textContent = `${diRemaining} / ${diTotal}`;
  document.getElementById('easyCount').textContent = `${easyRemaining} / ${easyTotal}`;
  document.getElementById('mediumCount').textContent = `${mediumRemaining} / ${mediumTotal}`;
  document.getElementById('hardCount').textContent = `${hardRemaining} / ${hardTotal}`;
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
// HEURISTIC ADAPTIVE SELECTION
// ========================================

/**
 * Calculate rolling accuracy over last N questions
 */
function calculateRollingAccuracy(lastN = 5) {
  const answeredIndices = Object.keys(APP_STATE.responses)
    .map(idx => parseInt(idx, 10))
    .sort((a, b) => a - b)
    .slice(-lastN);
  
  if (answeredIndices.length === 0) return 0.5; // Start at medium
  
  let correct = 0;
  answeredIndices.forEach(idx => {
    const question = APP_STATE.sectionQuestions[idx];
    if (APP_STATE.responses[idx] === question.answer) {
      correct++;
    }
  });
  
  return correct / answeredIndices.length;
}

/**
 * Sample questions without replacement with difficulty routing
 * @param {string} section - Section name
 * @param {number} count - Number of questions needed
 * @returns {Array} Selected questions
 */
function sampleQuestions(section, count) {
  let pool = APP_STATE.questionBanks[section];
  
  if (!pool || pool.length === 0) {
    console.error('No questions available for section:', section);
    showToast(`No questions available for ${section}. Please reload banks.`, 'error');
    return [];
  }
  
  // Filter out used items if exposure control is enabled
  if (APP_STATE.settings.exposureControl) {
    pool = pool.filter(q => !APP_STATE.usedItemIds.has(q.id) && !APP_STATE.sessionUsedIds.has(q.id));
    
    // If pool exhausted, show warning and use all available
    if (pool.length < count) {
      showToast('⚠️ Question bank exhausted, allowing some repeats', 'warning');
      pool = APP_STATE.questionBanks[section].filter(q => !APP_STATE.sessionUsedIds.has(q.id));
    }
  }
  
  // Separate by difficulty
  const easyPool = pool.filter(q => q.difficulty === 'E');
  const mediumPool = pool.filter(q => q.difficulty === 'M');
  const hardPool = pool.filter(q => q.difficulty === 'H');
  
  // Calculate target counts (30% E, 50% M, 20% H)
  const easyTarget = Math.round(count * 0.30);
  const mediumTarget = Math.round(count * 0.50);
  const hardTarget = count - easyTarget - mediumTarget;
  
  // Sample from each difficulty bucket
  const selected = [];
  selected.push(...randomSample(easyPool, Math.min(easyTarget, easyPool.length)));
  selected.push(...randomSample(mediumPool, Math.min(mediumTarget, mediumPool.length)));
  selected.push(...randomSample(hardPool, Math.min(hardTarget, hardPool.length)));
  
  // If we didn't get enough, backfill from any available
  if (selected.length < count) {
    const remaining = pool.filter(q => !selected.includes(q));
    selected.push(...randomSample(remaining, count - selected.length));
  }
  
  // Shuffle to mix difficulties
  return shuffle(selected).slice(0, count);
}

/**
 * Random sample without replacement
 */
function randomSample(array, n) {
  const result = [];
  const used = new Set();
  const max = Math.min(n, array.length);
  
  while (result.length < max) {
    const idx = Math.floor(Math.random() * array.length);
    if (!used.has(idx)) {
      used.add(idx);
      result.push(array[idx]);
    }
  }
  
  return result;
}

/**
 * Shuffle array (Fisher-Yates)
 */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Get next question with heuristic difficulty routing
 */
function getNextQuestion() {
  const rollingAcc = calculateRollingAccuracy(5);
  const pool = APP_STATE.questionBanks[APP_STATE.currentSection].filter(
    q => !APP_STATE.sessionUsedIds.has(q.id) && 
         (APP_STATE.settings.exposureControl ? !APP_STATE.usedItemIds.has(q.id) : true)
  );
  
  if (pool.length === 0) {
    showToast('⚠️ Question bank exhausted, reset exposure', 'warning');
    return null;
  }
  
  // Determine difficulty preference based on rolling accuracy
  let targetDifficulty;
  if (rollingAcc >= 0.80) {
    targetDifficulty = 'H'; // High accuracy -> harder questions
  } else if (rollingAcc <= 0.50) {
    targetDifficulty = 'E'; // Low accuracy -> easier questions
  } else {
    targetDifficulty = 'M'; // Medium accuracy -> medium questions
  }
  
  // Filter by preferred difficulty, with fallback
  let candidates = pool.filter(q => q.difficulty === targetDifficulty);
  if (candidates.length === 0) {
    candidates = pool; // Fallback to any available
  }
  
  // Random selection within difficulty bucket
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ========================================
// SESSION MANAGEMENT
// ========================================

async function startSession() {
  try {
    const section = document.getElementById('sectionSelect').value;
    const timerMinutes = parseInt(document.getElementById('timerSelect').value, 10);
    
    const sectionSize = section === 'Quant' ? 21 : (section === 'Verbal' ? 23 : 20);
    let available = APP_STATE.questionBanks[section]?.length || 0;
    
    // Lazy-load banks if not ready
    if (available === 0) {
      showToast('Loading question banks…', 'info');
      
      try {
        await loadBanks();
        available = APP_STATE.questionBanks[section]?.length || 0;
      } catch (loadError) {
        console.error('Failed to load banks in startSession:', loadError);
        showToast('Failed to load question banks. Please check your connection and try again.', 'error');
        return;
      }
    }
    
    if (available < sectionSize) {
      showToast(`Not enough ${section} questions (need ${sectionSize}, have ${available})`, 'error');
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
    APP_STATE.sessionUsedIds = new Set();
    
    // Sample questions for this session
    APP_STATE.sectionQuestions = sampleQuestions(section, sectionSize);
    
    if (APP_STATE.sectionQuestions.length === 0) {
      showToast('Failed to load questions. Please try reloading the banks.', 'error');
      return;
    }
    
    // Mark as used in session
    APP_STATE.sectionQuestions.forEach(q => APP_STATE.sessionUsedIds.add(q.id));
    
    // Show/hide calculator based on section
    const calcBtn = document.getElementById('calculatorBtn');
    calcBtn.style.display = section === 'Data Insights' ? 'inline-block' : 'none';
    
    // Start timer
    startTimer();
    
    // Show question screen
    showScreen('questionScreen');
    renderQuestion();
    updateTopBar();
  } catch (error) {
    console.error('Error starting session:', error);
    showToast('Failed to start practice session: ' + error.message, 'error');
  }
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
  document.getElementById('editsLeft').textContent = `Edits: ${APP_STATE.editsRemaining}`;
  
  // Update difficulty label based on current question
  const idx = APP_STATE.currentQuestionIndex;
  if (idx < APP_STATE.sectionQuestions.length) {
    const question = APP_STATE.sectionQuestions[idx];
    
    let diffLabel, diffClass;
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
    diffElement.className = `difficulty-label ${diffClass}`;
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

// ========================================
// RESULTS & SCALED SCORING
// ========================================

function calculateScaledScore(percentage) {
  const mapping = APP_STATE.settings.scaledMapping.sort((a, b) => a.pct - b.pct);
  
  if (percentage <= mapping[0].pct) {
    return mapping[0].score;
  }
  
  if (percentage >= mapping[mapping.length - 1].pct) {
    return mapping[mapping.length - 1].score;
  }
  
  for (let i = 0; i < mapping.length - 1; i++) {
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
  
  let correct = 0;
  let total = APP_STATE.sectionQuestions.length;
  
  APP_STATE.sectionQuestions.forEach((q, idx) => {
    if (APP_STATE.responses[idx] === q.answer) {
      correct++;
    }
  });
  
  const percentage = Math.round((correct / total) * 100);
  const scaledScore = calculateScaledScore(percentage);
  
  // Mark questions as used
  APP_STATE.sectionQuestions.forEach(q => {
    APP_STATE.usedItemIds.add(q.id);
  });
  localStorage.setItem('usedItemIds', JSON.stringify([...APP_STATE.usedItemIds]));
  
  // Update bank stats
  updateBankStats();
  
  // Save to history
  const result = {
    section: APP_STATE.currentSection,
    correct,
    total,
    percentage,
    scaledScore: APP_STATE.settings.scaledScoreEnabled ? scaledScore : null,
    timestamp: new Date().toISOString(),
    itemIds: APP_STATE.sectionQuestions.map(q => q.id),
    responses: APP_STATE.responses,
    editsUsed: 3 - APP_STATE.editsRemaining
  };
  
  const history = JSON.parse(localStorage.getItem('results') || '[]');
  history.unshift(result);
  localStorage.setItem('results', JSON.stringify(history));
  
  APP_STATE.currentAttempt = result;
  
  showResultsScreen(result, history);
}

function showResultsScreen(result, history) {
  showScreen('resultsScreen');
  
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
      <span class="result-stat-label">Edits Used</span>
      <span class="result-stat-value">${result.editsUsed} / 3</span>
    </div>
  `;
  
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
  
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Section</th>
        <th>Score</th>
        <th>%</th>
        <th>Scaled</th>
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
// BANK STATS MODAL
// ========================================

function showBankStats() {
  const modal = document.getElementById('bankStatsModal');
  const content = document.getElementById('bankStatsContent');
  
  const allQuestions = [
    ...APP_STATE.questionBanks.Quant,
    ...APP_STATE.questionBanks.Verbal,
    ...APP_STATE.questionBanks['Data Insights']
  ];
  
  const totalItems = allQuestions.length;
  const usedItems = allQuestions.filter(q => APP_STATE.usedItemIds.has(q.id)).length;
  const remainingItems = totalItems - usedItems;
  
  // Per section stats
  const sections = ['Quant', 'Verbal', 'Data Insights'];
  const sectionStats = sections.map(sec => {
    const items = APP_STATE.questionBanks[sec];
    const used = items.filter(q => APP_STATE.usedItemIds.has(q.id)).length;
    const remaining = items.length - used;
    
    // By difficulty
    const easyTotal = items.filter(q => q.difficulty === 'E').length;
    const mediumTotal = items.filter(q => q.difficulty === 'M').length;
    const hardTotal = items.filter(q => q.difficulty === 'H').length;
    
    const easyRemaining = items.filter(q => q.difficulty === 'E' && !APP_STATE.usedItemIds.has(q.id)).length;
    const mediumRemaining = items.filter(q => q.difficulty === 'M' && !APP_STATE.usedItemIds.has(q.id)).length;
    const hardRemaining = items.filter(q => q.difficulty === 'H' && !APP_STATE.usedItemIds.has(q.id)).length;
    
    return {
      section: sec,
      total: items.length,
      used,
      remaining,
      easyTotal,
      mediumTotal,
      hardTotal,
      easyRemaining,
      mediumRemaining,
      hardRemaining
    };
  });
  
  let html = `
    <div class="stats-grid">
      <div class="stat-card">
        <h4>Total Items</h4>
        <div class="stat-value">${totalItems}</div>
        <div class="stat-detail">${remainingItems} remaining</div>
      </div>
      <div class="stat-card">
        <h4>Used Items</h4>
        <div class="stat-value">${usedItems}</div>
        <div class="stat-detail">${Math.round((usedItems / totalItems) * 100)}% of bank</div>
      </div>
    </div>
    
    <h3 style="margin-top: 2rem; margin-bottom: 1rem;">Section Breakdown</h3>
  `;
  
  sectionStats.forEach(s => {
    html += `
      <div class="section-stats-card">
        <h4>${s.section}</h4>
        <p><strong>Total:</strong> ${s.total} questions (${s.remaining} remaining)</p>
        <div class="difficulty-grid">
          <div class="difficulty-stat">
            <span class="difficulty-label E">Easy</span>
            <span>${s.easyRemaining} / ${s.easyTotal}</span>
          </div>
          <div class="difficulty-stat">
            <span class="difficulty-label M">Medium</span>
            <span>${s.mediumRemaining} / ${s.mediumTotal}</span>
          </div>
          <div class="difficulty-stat">
            <span class="difficulty-label H">Hard</span>
            <span>${s.hardRemaining} / ${s.hardTotal}</span>
          </div>
        </div>
      </div>
    `;
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
  document.getElementById('startBtn').addEventListener('click', startSession);
  document.getElementById('resetBankBtn').addEventListener('click', resetBankExposure);
  document.getElementById('bankStatsBtn').addEventListener('click', showBankStats);
  document.getElementById('reloadBankBtn').addEventListener('click', () => {
    loadBanks();
    showToast('Banks reloaded', 'success');
  });
  
  // Settings
  document.getElementById('heuristicScalingCheck').addEventListener('change', (e) => {
    APP_STATE.settings.scaledScoreEnabled = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
  });
  
  document.getElementById('exposureControlCheck').addEventListener('change', (e) => {
    APP_STATE.settings.exposureControl = e.target.checked;
    localStorage.setItem('settings', JSON.stringify(APP_STATE.settings));
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
  // Attach listeners immediately so UI is responsive even if loading takes time
  initEventListeners();
  initCalculator();
  loadHistoryOnSetup();
  
  try {
    await loadBanks();
  } catch (error) {
    console.error('Failed to load banks during init:', error);
    // Continue anyway, banks will be loaded lazily
  }
  
  // Apply settings to UI
  document.getElementById('heuristicScalingCheck').checked = APP_STATE.settings.scaledScoreEnabled;
  document.getElementById('exposureControlCheck').checked = APP_STATE.settings.exposureControl;
  
  showScreen('setupScreen');
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
