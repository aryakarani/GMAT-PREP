# GMAT Focus Practice App - Testing Guide

## 🎯 Quick Validation Checklist

### Desktop Testing (5 minutes)

#### 1. Bank Loading ✅
```
Action: Open app → Click "Reload Banks"
Expected: 
  - Toast shows "✅ Question banks loaded successfully (500 Quant, 500 Verbal, 500 DI)"
  - Stats show: "1500 / 1500" (or your actual totals)
  - Section counts visible: Quant: 500/500, Verbal: 500/500, DI: 500/500
```

#### 2. Full Test with Section Order ✅
```
Action: 
  1. Select "Verbal → Data Insights → Quant" from dropdown
  2. Click "Start Practice" (big button)
  
Expected:
  - First section: Verbal (23 questions)
  - After submission: Brief results (3s), then auto-start Data Insights
  - Second section: Data Insights (20 questions)
  - After submission: Brief results (3s), then auto-start Quant
  - Third section: Quant (21 questions)
  - After submission: Results screen, toast "🎉 Full test complete!"
```

#### 3. Duplicate Detection ✅
```
Action: During any section, open browser console (F12) and run:
  
  const ids = APP_STATE.sectionQuestions.map(q => q.id);
  const uniqueIds = new Set(ids);
  console.log('Total:', ids.length, 'Unique:', uniqueIds.size);
  
Expected:
  - Total and Unique should be equal (e.g., "Total: 21 Unique: 21")
  - If different, duplicates detected → BUG!
```

#### 4. Individual Section Buttons ✅
```
Action: Click "Start Quant (21)"
Expected:
  - Starts Quant section directly (not part of full test)
  - 21 questions loaded
  - No section auto-advance after completion
  - Returns to setup screen after viewing results
```

#### 5. Exposure Control ✅
```
Action:
  1. Enable "Enable exposure control (avoid repeats)" checkbox
  2. Complete a section (e.g., Quant)
  3. Click "New Practice Session"
  4. Start Quant again
  
Expected:
  - Different questions than first run
  - Toast shows if bank getting low
  - "Reset Exposure" button clears used questions
```

---

### Mobile Testing (iPhone Safari, 10 minutes)

#### 1. Initial Load ✅
```
Action: Open app on iPhone
Expected:
  - App loads without errors
  - Stats visible (not 0/0)
  - All buttons responsive to touch
  - No console errors (use Safari Web Inspector)
```

#### 2. Bank Reload ✅
```
Action: Tap "Reload Banks"
Expected:
  - Loading happens (may take 1-2 seconds)
  - Success toast appears
  - Stats update with correct counts
  - If error: Shows exact URL and status
```

#### 3. Full Test on Mobile ✅
```
Action:
  1. Choose section order
  2. Tap "Start Practice"
  
Expected:
  - Works identically to desktop
  - Touch interactions smooth
  - Timer counts down correctly
  - Can navigate between questions
  - Auto-advances between sections
```

#### 4. Calculator (Data Insights) ✅
```
Action:
  1. Start Data Insights section
  2. Tap calculator icon (🧮) in top bar
  
Expected:
  - Calculator modal opens
  - All buttons work (0-9, +, -, ×, ÷, √, %)
  - Can perform calculations
  - Modal closes correctly
```

#### 5. Touch Interactions ✅
```
Action: During question screen
  - Tap answer options
  - Tap flag button
  - Tap next/previous
  - Tap review button
  
Expected:
  - All taps register immediately
  - No double-tap required
  - No zoom on button press
  - Selections update visually
```

---

## 🔬 Advanced Testing

### Test 1: Uniqueness Stress Test
```javascript
// In browser console during section:
let totalQuestions = 0;
let duplicatesFound = 0;

for (let i = 0; i < 100; i++) {
  const items = assembleSection('Quant', 21);
  const ids = items.map(q => q.id);
  const uniqueIds = new Set(ids);
  
  totalQuestions += items.length;
  if (ids.length !== uniqueIds.size) {
    duplicatesFound++;
  }
}

console.log('Runs:', 100);
console.log('Total questions:', totalQuestions);
console.log('Duplicates found:', duplicatesFound);
// Expected: Duplicates found: 0
```

### Test 2: Section Order Verification
```javascript
// In browser console:
window.currentRun = {
  queue: ['Verbal', 'Quant', 'Data Insights'],
  index: 0,
  sessions: {}
};

console.log('Expected order:', window.currentRun.queue);
console.log('Current index:', window.currentRun.index);
// Then start sections and verify order matches
```

### Test 3: Bank Exhaustion
```javascript
// In browser console:
APP_STATE.usedItemIds = new Set(window.BANKS.Quant.map(q => q.id).slice(0, 480));
console.log('Used IDs:', APP_STATE.usedItemIds.size);
console.log('Available:', window.BANKS.Quant.length - APP_STATE.usedItemIds.size);
// Then try to start Quant section - should warn about exhaustion
```

### Test 4: Cache Validation
```
1. Open Network tab in DevTools
2. Click "Reload Banks"
3. Check requests to /data/bank_*.json
Expected:
  - Request headers include "Cache-Control: no-cache"
  - Response headers include "Cache-Control: no-store"
  - URL includes cache-buster: ?v=1234567890
```

---

## 🐛 Bug Detection Guide

### ❌ Duplicates Within Section
**Symptoms:**
- Same question appears twice in one section
- Question IDs repeat in console log

**Check:**
```javascript
const ids = APP_STATE.sectionQuestions.map(q => q.id);
const uniqueIds = new Set(ids);
if (ids.length !== uniqueIds.size) {
  console.error('DUPLICATES FOUND!');
  console.log('Total:', ids.length, 'Unique:', uniqueIds.size);
  console.log('IDs:', ids);
}
```

### ❌ Section Order Not Respected
**Symptoms:**
- Sections run in wrong order
- Order different than dropdown selection

**Check:**
```javascript
console.log('Selected order:', document.getElementById('orderSelect').value);
console.log('Current run:', window.currentRun);
console.log('Expected queue:', window.currentRun?.queue);
console.log('Current index:', window.currentRun?.index);
```

### ❌ Banks Not Loading on Mobile
**Symptoms:**
- Stats show 0/0
- Toast shows error
- Questions don't load

**Check:**
1. Open Safari Web Inspector (Settings → Safari → Advanced → Web Inspector)
2. Check Console for errors
3. Check Network tab for failed requests
4. Look for exact error message in toast

**Common Causes:**
- Network timeout
- Netlify headers not deployed
- JSON file path incorrect
- CORS issues

---

## 📊 Acceptance Criteria

### Must Pass (Critical) ✅

- [ ] **Desktop Chrome**: Full test with section order works
- [ ] **Desktop Chrome**: No duplicate questions (100 runs)
- [ ] **Desktop Chrome**: Individual section buttons work
- [ ] **iPhone Safari**: Banks load successfully (not 0/0)
- [ ] **iPhone Safari**: Full test works identically to desktop
- [ ] **iPhone Safari**: No duplicate questions
- [ ] **Both platforms**: Exposure control works
- [ ] **Both platforms**: Timer counts down correctly

### Should Pass (Important) ✅

- [ ] **Desktop**: Reload Banks with force works
- [ ] **Desktop**: Stats update after sections
- [ ] **Mobile**: Touch interactions smooth
- [ ] **Mobile**: Calculator works (DI section)
- [ ] **Both**: All 43 buttons have type="button"
- [ ] **Both**: Event listeners work on DOMContentLoaded

### Nice to Have (Optional) ✅

- [ ] **Desktop**: Keyboard shortcuts work (arrows, 1-5)
- [ ] **Desktop**: Flag button works
- [ ] **Mobile**: Scratchpad works
- [ ] **Both**: History persists across sessions
- [ ] **Both**: Settings persist across sessions

---

## 🚀 Deployment Verification

### Pre-Deploy Checklist
```bash
# 1. Verify ES2019 compliance
node -e "
const fs = require('fs');
const code = fs.readFileSync('./app.js', 'utf8');
console.log(code.includes('toSorted') ? '❌ FAIL' : '✅ PASS');
"

# 2. Verify button types
grep -c 'type="button"' index.html
# Expected: 43

# 3. Verify netlify.toml
grep -A 2 '/data/\*.json' netlify.toml
# Expected: Cache-Control = "no-store"

# 4. Verify bank files exist
ls -lh data/*.json
# Expected: bank_quant.json, bank_verbal.json, bank_di.json
```

### Post-Deploy Checklist
```bash
# 1. Check deployed headers
curl -I https://your-app.netlify.app/data/bank_quant.json | grep Cache-Control
# Expected: Cache-Control: no-store

# 2. Check app loads
curl -s https://your-app.netlify.app/ | grep "GMAT Focus Practice"
# Expected: Match found

# 3. Check JS loads
curl -s https://your-app.netlify.app/app.js | head -n 5
# Expected: JavaScript code visible
```

---

## 🎓 Common Issues & Solutions

### Issue: "Banks not loaded yet"
**Solution:**
- Wait 2-3 seconds after page load
- Click "Reload Banks" manually
- Check console for actual error

### Issue: "Duplicate questions detected"
**Solution:**
- Should NEVER happen
- If it does: Open GitHub issue immediately
- Include: section, IDs, console logs

### Issue: Section order not working
**Solution:**
- Use "Start Practice" button (not individual buttons)
- Individual buttons are for single-section practice
- Check dropdown selection before starting

### Issue: Calculator not showing
**Solution:**
- Calculator only appears in Data Insights section
- Check if button is hidden (display: none)
- Try clicking calculator icon in top bar

### Issue: Timer not working
**Solution:**
- Check if timer is counting down
- Verify timerSeconds is set in APP_STATE
- Check console for timer errors

---

## 📞 Support

### Reporting Bugs
Include:
1. **Platform**: Desktop/Mobile, Browser, OS version
2. **Steps**: Exact steps to reproduce
3. **Expected**: What should happen
4. **Actual**: What actually happened
5. **Console**: Any errors from console
6. **Screenshot**: If visual issue

### Debugging Tips
1. **Always check console** (F12 or Web Inspector)
2. **Check Network tab** for failed requests
3. **Check APP_STATE** for current state
4. **Check window.BANKS** for loaded data
5. **Check window.currentRun** for test state

---

## ✅ Final Sign-Off

Once all tests pass:
- ✅ Desktop Chrome verified
- ✅ iPhone Safari verified
- ✅ No duplicates in 100 runs
- ✅ Section order works
- ✅ Exposure control works
- ✅ All buttons responsive
- ✅ Timer works correctly

**Status: Ready for Production** 🚀
