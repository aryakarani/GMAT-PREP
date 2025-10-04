# GMAT Focus Practice — Solo Trainer

A **framework-free, static web app** for practicing GMAT Focus Edition questions with multi-stage adaptive difficulty routing. This is **not official GMAT content**—all included questions are original, GMAT-style practice items.

---

## ✨ Features

- **Three Sections**: Quantitative (21), Verbal (23), Data Insights (20)
- **Per-Section Timers**: Choose 45/30/15 minutes; hard stop at 0:00
- **Multi-Stage Adaptivity (MST)**: Questions adapt across Easy/Medium/Hard buckets based on your performance in 4–5 question blocks
- **3-Edit Cap**: Change your answer up to 3 times per section
- **Data Insights Calculator**: On-screen calculator available only during DI sections
- **Scratchpad**: Take quick notes (not persisted)
- **Question Bank Import/Export**: Import custom JSON or CSV question banks; export your current bank
- **Results & History**: Track raw percentages by section and review past attempts

---

## 🚀 Quick Start

### Run Locally
1. Clone or download this repository
2. Open `index.html` in any modern browser
3. No build step required!

### Deploy to Netlify
1. Drag-drop this folder into [Netlify Drop](https://app.netlify.com/drop)
2. Or connect your Git repo with publish directory = `.` (repo root)
3. No build configuration needed

---

## 📥 Importing a Question Bank

### JSON Format
```json
{
  "meta": {
    "version": 1,
    "source": "user-supplied",
    "createdAt": "2025-10-04T00:00:00Z"
  },
  "items": [
    {
      "id": "Q-000001",
      "section": "Quant",
      "type": "Problem Solving",
      "difficulty": "M",
      "skills": ["algebra", "linear"],
      "prompt": "Solve for x: 2x + 5 = 15",
      "options": ["3", "4", "5", "6", "7"],
      "answer": 2,
      "explanation": "2x = 10, so x = 5"
    }
  ]
}
```

### CSV Format
Columns: `id`, `section`, `type`, `difficulty`, `skills` (pipe-separated), `prompt`, `options` (pipe-separated), `answer` (0-indexed), `table_json` (optional), `explanation`

Example:
```csv
id,section,type,difficulty,skills,prompt,options,answer,table_json,explanation
Q-000001,Quant,Problem Solving,M,algebra|linear,Solve for x: 2x + 5 = 15,3|4|5|6|7,2,,2x = 10 so x = 5
```

### Import Steps
1. Click **"Bank Management"** on the setup screen
2. Click **"Import JSON/CSV"**
3. Select your file
4. The app validates, de-dupes by ID, and stores items in IndexedDB

### Export
- **Export Bank**: Download your current question bank as JSON
- **Export Attempt** (from Results screen): Download your responses and results

---

## 🧩 How Adaptivity Works

### Multi-Stage Testing (MST)
The app uses a **block-based adaptive algorithm**:

1. **Difficulty Buckets**: Easy (E), Medium (M), Hard (H)
2. **Starting Point**: All sections start at Medium difficulty
3. **Block Sizes**:
   - Quantitative & Verbal: 4 questions per block
   - Data Insights: 5 questions per block

### Routing Logic
After each block is completed:
- **Score ≥ 75%** in block → **Step Up** difficulty (M→H, E→M)
- **Score ≤ 50%** in block → **Step Down** difficulty (H→M, M→E)
- **Otherwise** → Stay at current difficulty

### Content Balancing
Within each block, the app attempts to balance content types:
- **Quant**: At least one ratio/percent, one algebra/linear, one data sufficiency
- **Verbal**: At least one critical reasoning, one reading comprehension
- **Data Insights**: At least one table/graphics, one two-part/MSR

### Exposure Control
- Previously used questions are tracked in `localStorage.usedItemIds`
- The algorithm avoids re-using questions across attempts
- Click **"Reset Exposure"** in Settings to clear this history

### Bank Exhaustion
If a difficulty bucket runs out of questions:
1. The app backfills from Medium first
2. Then from Easy/Hard as needed
3. A console warning is logged
4. Practice continues normally

---

## 📊 Section Details

| Section | Questions | Default Time | Calculator |
|---------|-----------|--------------|------------|
| **Quantitative Reasoning** | 21 | 45 min | No |
| **Verbal Reasoning** | 23 | 45 min | No |
| **Data Insights** | 20 | 45 min | Yes |

---

## ⚙️ Settings

- **Timer Options**: 45 / 30 / 15 minutes per section
- **Section Order**: QVD, QDV, VQD, VDQ, DQV, DVQ
- **Reset Exposure**: Clear the history of used questions
- **Heuristic Scaling**: Toggle experimental scaled score estimates (default off)

---

## 🧪 Acceptance Tests

To verify the app works correctly:

1. ✅ **Import**: Upload a CSV with 50+ items → Bank counts update per difficulty
2. ✅ **Timer**: Start Quant with 45:00 → Top bar shows countdown
3. ✅ **Adaptivity**: Complete a 4-question block with ≥75% → Next block routes to Hard
4. ✅ **Edit Cap**: Change an already-answered question → Edits decrement; blocks at 0
5. ✅ **DI Calculator**: Navigate to Data Insights → Calculator button appears
6. ✅ **Results**: Complete section → Shows raw % and appends to history
7. ✅ **Export**: Click "Export Attempt" → Downloads JSON with responses

---

## 🛠️ Technology Stack

- **Pure Vanilla**: HTML, CSS, JavaScript (ES6+)
- **Storage**: IndexedDB with localStorage fallback
- **No dependencies**: Zero npm packages, no build step
- **Responsive**: Works on desktop, tablet, and mobile

---

## 📝 License & Disclaimer

This is an **unofficial practice tool**. It does not contain any official GMAT content. All included questions are original items written to mimic GMAT Focus Edition style.

Use of this app does not guarantee any specific score on the actual GMAT exam. For official prep materials, visit [mba.com](https://www.mba.com).

---

## 🤝 Contributing

To add your own question bank:
1. Create questions following the JSON schema above
2. Ensure each question has a unique `id`
3. Import via the Bank Management panel

For issues or improvements, feel free to fork and submit a pull request!

---

**Happy practicing! 🎯**
