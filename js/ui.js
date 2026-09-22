// ================================================================
//  UI: DAILY TAB
// ================================================================
window.currentViewMode = localStorage.getItem('dailyViewMode') || (window.innerWidth < 640 ? 'focus' : window.innerWidth < 1024 ? 'compact' : 'cards');
window.currentFocusedPeriod = 1;
window.unsavedPeriods = new Set();

function toggleCard(headerEl, i) {
    if (window.currentViewMode === 'cards') {
        const card = headerEl.closest('.period-card');
        if (card) card.classList.toggle('collapsed');
    } else if (window.currentViewMode === 'compact') {
        setFocusPeriod(i);
    } else if (window.currentViewMode === 'focus') {
        setFocusPeriod(i);
    } else if (window.currentViewMode === 'grid') {
        // no-op
    }
}


function parseClassSection(val) {
    if (!val) return { class: '', section: '' };
    const parts = val.split('-');
    if (parts.length === 2) {
        return {
            class: parts[0].trim(),
            section: parts[1].trim()
        };
    }
    const match = val.match(/^([0-9]+)\s*([a-zA-Z]*)$/);
    if (match) {
        return {
            class: match[1],
            section: match[2]
        };
    }
    if (/^[0-9]+$/.test(val.trim())) {
        const num = parseInt(val.trim());
        if (num >= 1 && num <= 10) {
            return { class: val.trim(), section: '' };
        }
    }
    return { class: '', section: val };
}

async function renderDailyTab() {
    const dateInput = document.getElementById('dailyDate');
    if (dateInput && !dateInput.value) {
        const urlParams = new URLSearchParams(window.location.search);
        const paramDate = urlParams.get('date');
        if (paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate)) {
            dateInput.value = paramDate;
        } else {
            dateInput.value = getTodayStr();
        }
    }
    const dateStr = (dateInput && dateInput.value) ? dateInput.value : getTodayStr();
    const settings = getSettings();
    const periodsPerDay = settings.periodsPerDay || 8;
    const entry = getDayEntry(dateStr);
    const periods = entry ? entry.periods : [];

    const container = document.getElementById('periodCards');
    if (!container) return; // Might be hidden
    container.innerHTML = '<div style="text-align:center; padding: 20px;"><span class="spinner"></span> Loading timetable...</div>';
    
    // Fetch timetable safely with timeout so UI never hangs
    let timetableMap = window.currentTimetableMap || {};
    if (typeof fetchTodayTimetable === 'function') {
        try {
            const fetched = await Promise.race([
                fetchTodayTimetable(dateStr),
                new Promise(resolve => setTimeout(() => resolve({}), 1200))
            ]);
            if (fetched) timetableMap = fetched;
        } catch (err) {
            console.warn('Timetable fetch bypassed due to error/timeout:', err);
        }
    }
    container.innerHTML = `<div class="grid-header" id="gridHeader">
        <div></div>
        <div>Period</div>
        <div>Class</div>
        <div>Sec</div>
        <div>Subject</div>
        <div>Classwork</div>
        <div>Homework</div>
        <div>Files</div>
    </div>`;

    for (let i = 1; i <= periodsPerDay; i++) {
        const existing = periods.find(p => p.periodNumber === i) || {
            periodNumber: i, classSection: '', subject: '',
            classwork: '', homework: '', photoUrl: '', files: []
        };
        const timetable = timetableMap[i] || {};
        
        const classSection = existing.classSection || timetable.classSection || '';
        const subject = existing.subject || timetable.subject || '';
        const classwork = existing.classwork || '';
        const homework = existing.homework || '';
        const existingFiles = existing.files || [];
        
        // Initialize file state
        window.periodFiles = window.periodFiles || {};
        window.periodFiles[i] = {
            existing: existingFiles,
            pending: []
        };
        
        // Asynchronously refresh signed URLs
        if (existingFiles.length > 0 && window.FileUploadService) {
            const pathsToRefresh = existingFiles.filter(f => f.path).map(f => f.path);
            if (pathsToRefresh.length > 0) {
                window.FileUploadService.getSignedUrls(pathsToRefresh).then(urlMap => {
                    let updated = false;
                    for (const f of window.periodFiles[i].existing) {
                        if (f.path && urlMap[f.path] && f.url !== urlMap[f.path]) {
                            f.url = urlMap[f.path];
                            updated = true;
                        }
                    }
                    if (updated) {
                        const zone = document.getElementById(`file-zone-${i}`);
                        if (zone) zone.innerHTML = renderFileAttachZone(i);
                        
                        // update local storage silently
                        const entry = getDayEntry(dateStr);
                        if (entry) {
                            const p = entry.periods.find(p => p.periodNumber === i);
                            if (p) {
                                p.files = window.periodFiles[i].existing;
                                saveDayEntry(dateStr, entry.periods);
                            }
                        }
                    }
                }).catch(console.error);
            }
        }
        
        const card = document.createElement('div');
        card.className = 'period-card' + (i === window.currentFocusedPeriod ? ' active focused' : '');
        
        const fileCount = existingFiles.length;
        const filesHtml = `
            <div class="file-attach-zone" id="file-zone-${i}">
                ${renderFileAttachZone(i)}
            </div>
            <button class="compact-files-btn" onclick="switchToFocusForFiles(${i})" title="Manage files">
                📎 ${fileCount > 0 ? fileCount : ''}
            </button>
        `;
        
        // Ensure dropdown options match the parsed class
        const parsed = parseClassSection(classSection);
        const classDropdownOptions = [
            '<option value="">Class...</option>',
            ...[1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${parsed.class === String(n) ? 'selected' : ''}>${n}</option>`)
        ].join('');

        const summaryStr = `${parsed.class ? `${parsed.class}${parsed.section ? `-${parsed.section}` : ''} · ` : ''}${subject ? escHtml(subject) : 'No Subject'}`;
        card.innerHTML = `
          <div class="period-row-contents">
            <div style="display: flex; justify-content: center; align-items: start;">
                <span class="period-status-dot status-empty" id="row-status-${i}"></span>
            </div>
            <div class="period-card-header" onclick="toggleCard(this, ${i})" style="cursor:pointer; display: flex; align-items: start;">
                <div style="display:flex; align-items:center; gap:4px; height: 32px;">
                    <span class="period-badge">P${i} <span style="opacity:0.8; font-size:11px; margin-left:4px; display:none;">(${i}/${periodsPerDay})</span></span>
                    <span class="compact-chevron" style="font-size:12px; color:var(--text-muted);">&#9660;</span>
                    <span class="compact-summary" style="display: none; font-size: 13px; color: var(--text-muted); margin-left: 8px;">${summaryStr}</span>
                </div>
            </div>
            <div class="period-meta" style="display:flex; gap:8px; align-items:start;" onclick="event.stopPropagation()">
                <select class="daily-class-dropdown" data-period="${i}" data-field="class">${classDropdownOptions}</select>
            </div>
            <div class="period-input-wrapper" style="display:flex; align-items:start;" onclick="event.stopPropagation()">
                <input type="text" class="daily-section-input" data-period="${i}" data-field="section" value="${escHtml(parsed.section)}" placeholder="Sec" />
            </div>
            <div class="period-input-wrapper" style="display:flex; align-items:start;" onclick="event.stopPropagation()">
                <input type="text" class="daily-subject-input" data-period="${i}" data-field="subject" value="${escHtml(subject)}" placeholder="Subject" />
            </div>
            <div class="period-body">
                <div style="display:flex; flex-direction:column; height:100%;">
                    <label style="font-size:12px; margin-top:8px; display:block;">Classwork</label>
                    <textarea class="daily-work" data-period="${i}" data-field="classwork" rows="2" placeholder="What was taught?">${escHtml(classwork)}</textarea>
                </div>
                <div style="display:flex; flex-direction:column; height:100%;">
                    <label style="font-size:12px; margin-top:8px; display:block;">Homework</label>
                    <textarea class="daily-home" data-period="${i}" data-field="homework" rows="2" placeholder="Homework assigned?">${escHtml(homework)}</textarea>
                </div>
                <div class="period-card-footer" style="display: flex; align-items: start; min-height: 32px;">
                    <div style="width: 100%;">${filesHtml}</div>
                </div>
            </div>
          </div>
        `;
        
        const updateSummary = () => {
            const cls = card.querySelector('.daily-class-dropdown').value;
            const sec = card.querySelector('.daily-section-input').value;
            const sub = card.querySelector('.daily-subject-input').value;
            const summarySpan = card.querySelector('.compact-summary');
            if (summarySpan) {
                summarySpan.textContent = `${cls ? `${cls}${sec ? `-${sec}` : ''} · ` : ''}${sub ? sub : 'No Subject'}`;
            }
        };
        card.querySelector('.daily-class-dropdown').addEventListener('change', updateSummary);
        card.querySelector('.daily-section-input').addEventListener('input', updateSummary);
        card.querySelector('.daily-subject-input').addEventListener('input', updateSummary);
        
        container.appendChild(card);
    }
    
    const dailyStatus = document.getElementById('dailyStatus');
    if (dailyStatus) {
        dailyStatus.textContent = entry ? `✅ Loaded entry for ${formatDate(dateStr)}` :
            `📝 No entry yet for ${formatDate(dateStr)}`;
    }

    // Setup view controls and classes
    updateViewModeClasses();
    renderDailyControls();
    
    // Attach listeners for live status updates
    attachLiveStatusListeners();

    // Attach active-row highlighters for grid mode
    if (!container.dataset.focusListenersAttached) {
        container.dataset.focusListenersAttached = "true";
        container.addEventListener('focusin', function(e) {
            if (window.currentViewMode !== 'grid') return;
            const target = e.target;
            if (target.matches('input, textarea, select')) {
                const row = target.closest('.period-row-contents');
                if (row) row.classList.add('active-row');
            }
        });
        container.addEventListener('focusout', function(e) {
            if (window.currentViewMode !== 'grid') return;
            const target = e.target;
            if (target.matches('input, textarea, select')) {
                const row = target.closest('.period-row-contents');
                if (row) row.classList.remove('active-row');
            }
        });
    }

    // Attach grid keyboard navigation (only attach once, check if attached)
    if (!container.dataset.gridNavAttached) {
        container.dataset.gridNavAttached = "true";
        container.addEventListener('keydown', function(e) {
            if (window.currentViewMode !== 'grid') return;
            
            const target = e.target;
            if (!target.matches('input, textarea, select')) return;

            // Esc
            if (e.key === 'Escape') {
                target.blur();
                return;
            }

            const fieldName = target.getAttribute('data-field');
            if (!fieldName) return;
            
            const card = target.closest('.period-card');
            if (!card) return;
            
            const allCards = Array.from(container.querySelectorAll('.period-card'));
            const rowIdx = allCards.indexOf(card);
            
            let moveDir = 0; // -1 for up, 1 for down
            
            if (e.key === 'ArrowUp' && target.tagName !== 'TEXTAREA') {
                moveDir = -1;
            } else if (e.key === 'ArrowDown' && target.tagName !== 'TEXTAREA') {
                moveDir = 1;
            } else if (e.key === 'Enter') {
                if (target.tagName === 'TEXTAREA') {
                    if (e.ctrlKey || e.metaKey) moveDir = 1;
                } else {
                    moveDir = 1;
                }
            }
            
            if (moveDir !== 0) {
                e.preventDefault();
                let nextIdx = rowIdx + moveDir;
                let found = false;
                
                // Find next valid field in that column
                while (nextIdx >= 0 && nextIdx < allCards.length) {
                    const nextCard = allCards[nextIdx];
                    const nextField = nextCard.querySelector(`[data-field="${fieldName}"]:not([disabled]):not([readonly])`);
                    if (nextField) {
                        nextField.focus();
                        found = true;
                        break;
                    }
                    nextIdx += moveDir;
                }
                
                // If we reached the end and are moving down, focus save or submit button
                if (!found && moveDir === 1 && nextIdx >= allCards.length) {
                    const submitBtn = document.getElementById('submitForApprovalBtn');
                    const saveBtn = document.getElementById('saveDailyBtn');
                    if (submitBtn && submitBtn.style.display !== 'none' && !submitBtn.disabled) {
                        submitBtn.focus();
                    } else if (saveBtn && !saveBtn.disabled) {
                        saveBtn.focus();
                    }
                }
            }
        });
    }

    // Refresh approval status banner and button visibility
    updateApprovalBanner(dateStr);
}

// ================================================================
//  VIEW MODES & STATUS BAR
// ================================================================
function switchViewMode(mode) {
    window.currentViewMode = mode;
    localStorage.setItem('dailyViewMode', mode);
    
    if (mode !== 'focus') {
        window.previousViewMode = null;
    }
    
    updateViewModeClasses();
    renderDailyControls();
    
    // Auto-focus only when explicitly switching to grid mode
    if (mode === 'grid') {
        setTimeout(() => {
            const firstField = document.querySelector('.view-grid .period-card input:not([disabled]):not([readonly])');
            if (firstField) firstField.focus();
        }, 100);
    }
}

function updateViewModeClasses() {
    const container = document.getElementById('periodCards');
    if (!container) return;
    container.className = 'period-cards mt-12 view-' + window.currentViewMode;
    
    // Robust fallback to hide/show grid header instantly even if styles.css is cached
    const gridHeader = document.getElementById('gridHeader');
    if (gridHeader) {
        if (window.currentViewMode === 'grid') {
            gridHeader.style.display = ''; // Let CSS handle 'grid'
        } else {
            gridHeader.style.display = 'none'; // Force hide for other views
        }
    }
    
    // In focus mode, ensure at least one card is focused
    if (window.currentViewMode === 'focus') {
        setFocusPeriod(window.currentFocusedPeriod);
    }
}

function setFocusPeriod(num) {
    const periodsPerDay = window.getSettings ? window.getSettings().periodsPerDay : 8;
    if (num < 1) num = 1;
    if (num > periodsPerDay) num = periodsPerDay;
    window.currentFocusedPeriod = num;
    
    const cards = document.querySelectorAll('.period-card');
    cards.forEach((card, idx) => {
        if (idx + 1 === num) {
            // If already active in compact mode, clicking header toggles it off
            if (window.currentViewMode === 'compact' && card.classList.contains('active')) {
                card.classList.remove('active', 'focused');
            } else {
                card.classList.add('active', 'focused');
            }
        } else {
            card.classList.remove('active', 'focused');
        }
    });
    
    if (window.currentViewMode === 'focus') {
        renderDailyControls(); // Re-render to update focus navigation disabled states
    }

    setTimeout(() => {
        if (window.currentViewMode === 'focus') {
            const activePill = document.querySelector('.status-pill.active');
            if (activePill) activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 50);
}

function renderDailyControls() {
    const controlsContainer = document.getElementById('dailyControls');
    if (!controlsContainer) return;

    // View Switcher HTML
    const viewSwitcherHtml = `
        <div style="display: flex; gap: 12px; align-items: center; width: 100%; flex-wrap: wrap;">
            <div class="view-mode-switcher" style="display: flex; gap: 4px; align-items: center; flex: 1;">
                <button class="view-btn ${window.currentViewMode === 'cards' ? 'active' : ''}" onclick="switchViewMode('cards')">📋 Cards</button>
                <button class="view-btn ${window.currentViewMode === 'compact' ? 'active' : ''}" onclick="switchViewMode('compact')">📑 Compact</button>
                <button class="view-btn ${window.currentViewMode === 'grid' ? 'active' : ''}" onclick="switchViewMode('grid')">▦ Grid</button>
                <button class="view-btn ${window.currentViewMode === 'focus' ? 'active' : ''}" onclick="switchViewMode('focus')">📱 Focus</button>
                ${window.currentViewMode === 'focus' && window.previousViewMode === 'grid' ? `<button class="view-btn" onclick="switchViewMode('grid')" style="background:var(--primary); color:white; margin-left:8px;">← Back to Grid</button>` : ''}
            </div>
            <button class="btn btn-outline" onclick="showKeyboardHelp()" title="Keyboard Shortcuts" style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px; color: var(--text-muted); border-color: var(--border); background: transparent; border-radius: 8px;">
                ⌨ Shortcuts
            </button>
        </div>
    `;

    // Status / Navigation Bar HTML
    const periodsPerDay = window.getSettings ? window.getSettings().periodsPerDay : 8;
    
    const statsHtml = `
        <div class="completion-stats">
            <div><span id="completedCount">0</span> / ${periodsPerDay} Completed</div>
            <div class="stats-bar-container"><div id="completedBar" class="stats-bar-fill" style="width: 0%"></div></div>
        </div>
    `;

    let statusPillsHtml = '<div class="period-status-bar">';
    for (let i = 1; i <= periodsPerDay; i++) {
        statusPillsHtml += `<button class="status-pill" id="status-pill-${i}" onclick="setFocusPeriod(${i})">
            <span class="status-num">${i}</span><span class="status-icon">⚪</span>
        </button>`;
    }
    statusPillsHtml += '</div>';

    // Focus Navigation HTML (Only shows in focus mode)
    let focusNavHtml = '';
    if (window.currentViewMode === 'focus') {
        const prevDisabled = window.currentFocusedPeriod <= 1 ? 'disabled' : '';
        const nextDisabled = window.currentFocusedPeriod >= periodsPerDay ? 'disabled' : '';
        focusNavHtml = `
            <div class="focus-nav">
                <button class="btn btn-outline" onclick="setFocusPeriod(${window.currentFocusedPeriod - 1})" ${prevDisabled}>← Prev</button>
                <span class="focus-nav-title">Period ${window.currentFocusedPeriod}</span>
                <button class="btn btn-outline" onclick="setFocusPeriod(${window.currentFocusedPeriod + 1})" ${nextDisabled}>Next →</button>
            </div>
        `;
    }

    controlsContainer.innerHTML = statsHtml + viewSwitcherHtml + statusPillsHtml + focusNavHtml;
    updateStatusBar(); // Populate actual statuses based on DOM inputs
}

function updateStatusBar() {
    const cards = document.querySelectorAll('.period-card');
    let completed = 0;
    
    cards.forEach((card, idx) => {
        const periodNum = idx + 1;
        const workVal = card.querySelector('.daily-work')?.value?.trim() || '';
        const homeVal = card.querySelector('.daily-home')?.value?.trim() || '';
        
        let icon = '⚪'; // Empty
        let stateClass = 'status-empty';
        
        if (window.unsavedPeriods.has(periodNum)) {
            icon = '✏️'; // Editing
            stateClass = 'status-progress';
        } else if (workVal && homeVal) {
            icon = '🟢'; // Completed
            stateClass = 'status-complete';
            completed++;
        } else if (workVal || homeVal) {
            icon = '🟡'; // In Progress
            stateClass = 'status-progress';
        }

        const pill = document.getElementById(`status-pill-${periodNum}`);
        if (pill) {
            const iconSpan = pill.querySelector('.status-icon');
            if (iconSpan) iconSpan.textContent = icon;
            pill.className = `status-pill ${stateClass} ${periodNum === window.currentFocusedPeriod ? 'active' : ''}`;
        }
        
        const statusDot = document.getElementById(`row-status-${periodNum}`);
        if (statusDot) {
            statusDot.className = `period-status-dot ${stateClass}`;
        }
    });

    const countEl = document.getElementById('completedCount');
    const barEl = document.getElementById('completedBar');
    if (countEl) countEl.textContent = completed;
    if (barEl) {
        const total = window.getSettings ? window.getSettings().periodsPerDay : 8;
        barEl.style.width = Math.round((completed / total) * 100) + '%';
    }
}

function attachLiveStatusListeners() {
    const inputs = document.querySelectorAll('.daily-work, .daily-home, .daily-class-dropdown, .daily-section-input, .daily-subject-input');
    inputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const periodNum = parseInt(e.target.dataset.period);
            if (periodNum) {
                window.unsavedPeriods.add(periodNum);
                updateStatusBar();
            }
        });
    });
}

// ================================================================
//  APPROVAL BANNER (teacher view)
// ================================================================
async function updateApprovalBanner(dateStr, knownStatus = null) {
    const banner = document.getElementById('approvalStatusBanner');
    const icon = document.getElementById('approvalStatusIcon');
    const title = document.getElementById('approvalStatusTitle');
    const subtitle = document.getElementById('approvalStatusSubtitle');
    const revisionBox = document.getElementById('revisionNoteBox');
    const revisionText = document.getElementById('revisionNoteText');
    const submitBtn = document.getElementById('submitForApprovalBtn');
    const saveBtn = document.getElementById('saveDailyBtn');
    const resetBtn = document.getElementById('resetDailyBtn');

    if (!banner) return;

    // Only show for Supabase-authenticated users
    const client = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!client) {
        banner.classList.add('hidden');
        if (submitBtn) submitBtn.style.display = 'none';
        return;
    }

    const dayStatus = knownStatus || await fetchDayStatus(dateStr);

    const periodCards = document.getElementById('periodCards');
    const allInputs = periodCards ? periodCards.querySelectorAll('input, textarea, select') : [];

    if (!dayStatus) {
        // No submitted entry — draft / empty state
        banner.classList.add('hidden');
        if (submitBtn) submitBtn.style.display = 'block';
        allInputs.forEach(el => el.disabled = false);
        if (saveBtn) saveBtn.disabled = false;
        if (resetBtn) resetBtn.disabled = false;
        return;
    }

    banner.classList.remove('hidden');
    revisionBox.classList.add('hidden');

    switch (dayStatus.status) {
        case 'submitted': {
            icon.textContent = '⏳';
            title.textContent = 'Submitted — Awaiting Approval';
            const submittedAt = dayStatus.submittedAt
                ? new Date(dayStatus.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : '';
            subtitle.textContent = submittedAt ? `Sent for review on ${submittedAt}` : 'Awaiting principal review';
            banner.className = 'approval-status-banner status-submitted';
            // Lock editing
            allInputs.forEach(el => el.disabled = true);
            if (saveBtn) saveBtn.disabled = true;
            if (resetBtn) resetBtn.disabled = true;
            if (submitBtn) submitBtn.style.display = 'none';
            break;
        }
        case 'approved': {
            icon.textContent = '✅';
            title.textContent = 'Approved & Signed';
            const approvedAt = dayStatus.approvedAt
                ? new Date(dayStatus.approvedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : '';
            subtitle.textContent = approvedAt ? `Signed on ${approvedAt}` : 'Diary locked';
            banner.className = 'approval-status-banner status-approved';
            // Lock editing permanently
            allInputs.forEach(el => el.disabled = true);
            if (saveBtn) saveBtn.disabled = true;
            if (resetBtn) resetBtn.disabled = true;
            if (submitBtn) submitBtn.style.display = 'none';
            break;
        }
        case 'revision_requested': {
            icon.textContent = '🔄';
            title.textContent = 'Revision Requested';
            subtitle.textContent = 'Please review the principal’s note and resubmit.';
            banner.className = 'approval-status-banner status-revision';
            // Show revision note
            if (dayStatus.revisionNote) {
                revisionBox.classList.remove('hidden');
                if (revisionText) revisionText.textContent = dayStatus.revisionNote;
            }
            // Allow editing again
            allInputs.forEach(el => el.disabled = false);
            if (saveBtn) saveBtn.disabled = false;
            if (resetBtn) resetBtn.disabled = false;
            if (submitBtn) submitBtn.style.display = 'block';
            break;
        }
        default: {
            // e.g., 'draft'
            banner.classList.add('hidden');
            if (submitBtn) submitBtn.style.display = 'block';
            allInputs.forEach(el => el.disabled = false);
        }
    }
}

async function handleSubmitForApproval() {
    const dateStr = document.getElementById('dailyDate').value;
    if (!dateStr) { showToast('Please select a date first.', 'warning'); return; }

    const btn = document.getElementById('submitForApprovalBtn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Submitting...';

    // We now pass targetStatus: 'submitted' directly to saveDaily, unifying the persistence flow
    const result = await saveDaily({ targetStatus: 'submitted' });

    btn.disabled = false;
    btn.innerHTML = origText;

    if (result && result.ok) {
        updateApprovalBanner(dateStr, { 
            status: 'submitted', 
            submittedAt: result.submittedAt 
        });
    } else {
        updateApprovalBanner(dateStr);
    }
}

window.updateApprovalBanner = updateApprovalBanner;
window.handleSubmitForApproval = handleSubmitForApproval;

// ================================================================
//  AUTOSAVE
// ================================================================


function renderFileAttachZone(periodNumber) {
    const state = window.periodFiles[periodNumber];
    if (!state) return '';
    
    const allFiles = [...state.existing, ...state.pending];
    
    let html = '<div class="file-list">';
    allFiles.forEach((fileObj, idx) => {
        const isExisting = fileObj.isExisting;
        const icon = window.FileUploadService ? window.FileUploadService.getFileIcon(fileObj.type) : '📎';
        const sizeStr = window.FileUploadService ? window.FileUploadService.formatFileSize(fileObj.size) : '';
        
        html += `
            <div class="file-item">
                <span class="file-item-icon">${icon}</span>
                <span class="file-item-name">
                    ${isExisting && fileObj.url ? `<a href="${fileObj.url}" target="_blank">${escHtml(fileObj.name)}</a>` : escHtml(fileObj.name)}
                </span>
                <span class="file-item-size">${sizeStr}</span>
                <button type="button" class="file-item-remove" onclick="removeFile(${periodNumber}, ${idx}, ${isExisting})" title="Remove file">&times;</button>
            </div>
        `;
    });
    html += '</div>';
    
    if (allFiles.length < (window.FileUploadService?.MAX_FILES_PER_PERIOD || 10)) {
        html += `
            <button type="button" class="file-add-btn" onclick="triggerFileUpload(${periodNumber})">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Attach Files
            </button>
            <input type="file" id="file-input-${periodNumber}" multiple style="display:none;" onchange="handleFilesSelect(event, ${periodNumber})" />
        `;
    }
    
    return html;
}

function triggerFileUpload(periodNumber) {
    document.getElementById(`file-input-${periodNumber}`).click();
}

function handleFilesSelect(event, periodNumber) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const state = window.periodFiles[periodNumber];
    const allFiles = [...state.existing, ...state.pending];
    
    let addedCount = 0;
    
    for (const file of files) {
        if (window.FileUploadService) {
            const validation = window.FileUploadService.validateFileForPeriod(file, allFiles);
            if (!validation.valid) {
                showToast(validation.error, 'error');
                continue;
            }
        }
        
        state.pending.push(file);
        allFiles.push(file);
        addedCount++;
    }
    
    if (addedCount > 0) {
        document.getElementById(`file-zone-${periodNumber}`).innerHTML = renderFileAttachZone(periodNumber);
        
        // Trigger autosave if needed
        const e = new Event('input', { bubbles: true });
        document.getElementById(`file-zone-${periodNumber}`).dispatchEvent(e);
    }
    
    // Reset input
    event.target.value = '';
}

async function removeFile(periodNumber, index, isExisting) {
    const state = window.periodFiles[periodNumber];
    
    if (isExisting) {
        if (!confirm('Are you sure you want to delete this file? This cannot be undone.')) return;
        const fileObj = state.existing[index];
        
        // Optimistically remove from UI
        state.existing.splice(index, 1);
        document.getElementById(`file-zone-${periodNumber}`).innerHTML = renderFileAttachZone(periodNumber);
        
        try {
            if (window.FileUploadService && fileObj.id) {
                await window.FileUploadService.deleteAttachment(fileObj.id, fileObj.path);
                showToast('File deleted successfully', 'success');
            }
        } catch (err) {
            // Revert on failure
            state.existing.splice(index, 0, fileObj);
            document.getElementById(`file-zone-${periodNumber}`).innerHTML = renderFileAttachZone(periodNumber);
            showToast('Failed to delete file: ' + err.message, 'error');
        }
    } else {
        // Just remove from pending array
        const pendingIndex = index - state.existing.length;
        if (pendingIndex >= 0 && pendingIndex < state.pending.length) {
            state.pending.splice(pendingIndex, 1);
            document.getElementById(`file-zone-${periodNumber}`).innerHTML = renderFileAttachZone(periodNumber);
        }
    }
}

async function saveDaily(options = {}) {
    const isEvent = options && typeof options.preventDefault === 'function';
    if (isEvent) {
        options.preventDefault();
        options = {};
    }
    const targetStatus = options.targetStatus || 'draft';
    const dateStr = document.getElementById('dailyDate').value;
    if (!dateStr) { 
        if (!window.isAutoSaving) showToast('Please select a date.', 'warning'); 
        return; 
    }
    const cards = document.querySelectorAll('.period-card');
    const periods = [];
    let hasData = false;

    const saveBtn = document.getElementById('saveDailyBtn');
    const stickySaveBtn = document.getElementById('stickySaveBtn');
    const floatingStatus = document.getElementById('floatingSaveStatus');
    
    let originalBtnHtml = '';
    if (!window.isAutoSaving) {
        if (saveBtn) {
            originalBtnHtml = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
        }
        if (stickySaveBtn) {
            stickySaveBtn.disabled = true;
            stickySaveBtn.textContent = 'Saving...';
        }
    } else if (floatingStatus) {
        floatingStatus.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> ⟳ Saving...';
        floatingStatus.classList.add('visible');
    }

    try {
        for (const card of cards) {
            const classDropdown = card.querySelector('.daily-class-dropdown');
            const periodNum = parseInt(classDropdown?.dataset.period || '0');
            const classDropdownVal = classDropdown?.value || '';
            const sectionVal = card.querySelector('.daily-section-input')?.value?.trim() || '';
            const classVal = (classDropdownVal && sectionVal) ? `${classDropdownVal}-${sectionVal}` : (classDropdownVal || sectionVal);
            const subjectVal = card.querySelector('.daily-subject-input')?.value?.trim() || '';
            const workVal = card.querySelector('.daily-work')?.value?.trim() || '';
            const homeVal = card.querySelector('.daily-home')?.value?.trim() || '';
            const state = window.periodFiles ? window.periodFiles[periodNum] : { existing: [], pending: [] };

            periods.push({
                periodNumber: periodNum,
                classSection: classVal,
                subject: subjectVal,
                classwork: workVal,
                homework: homeVal,
                files: state.existing,
                pendingFiles: state.pending
            });

            if (classVal || subjectVal || workVal || homeVal || state.existing.length > 0 || state.pending.length > 0) hasData = true;
        }

        if (!hasData && !window.isAutoSaving) {
            if (!confirm("All fields are empty. Do you want to clear this day's entry?")) {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnHtml; }
                if (stickySaveBtn) { stickySaveBtn.disabled = false; stickySaveBtn.textContent = '✓ Save All'; }
                return;
            }
        }

        const syncUI = () => {
            periods.forEach(p => {
                const state = window.periodFiles[p.periodNumber];
                if (state) {
                    state.existing = p.files || [];
                    state.pending = p.pendingFiles || [];
                    const zone = document.getElementById(`file-zone-${p.periodNumber}`);
                    if (zone) zone.innerHTML = renderFileAttachZone(p.periodNumber);
                }
            });
        };

        if (typeof saveEntryToSupabase === 'function') {
            const result = await saveEntryToSupabase(dateStr, periods, { targetStatus });
            if (!result.ok && !window.isAutoSaving) {
                showToast(`⚠️ Sync failed. Saved offline.`, 'warning');
                syncUI();
            } else if (result.ok && !window.isAutoSaving) {
                if (targetStatus === 'submitted') {
                    showToast(`📤 Diary submitted for approval! (${result.count || periods.length} periods)`, 'success');
                } else {
                    showToast(`✅ Saved activities for ${formatDate(dateStr)}`, 'success');
                }
                syncUI();
            }
            
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnHtml; }
            if (stickySaveBtn) { stickySaveBtn.disabled = false; stickySaveBtn.textContent = '✓ Save All'; }
            if (floatingStatus) { floatingStatus.classList.remove('visible'); }
            
            if (typeof updateBadge === 'function') updateBadge();
            if (document.getElementById('tab-view')?.classList.contains('active')) renderViewTab();
            
            return result;
        } else {
            saveDayEntry(dateStr, periods);
            if (!window.isAutoSaving) {
                showToast(`✅ Saved activities for ${formatDate(dateStr)}`, 'success');
                syncUI();
            }
            if (typeof updateBadge === 'function') updateBadge();
            if (document.getElementById('tab-view')?.classList.contains('active')) renderViewTab();

            return { ok: true, periodsSaved: periods.length };
        }
    } catch (err) {
        if (!window.isAutoSaving) showToast(`❌ Error saving: ${err.message}`, 'error');
        return { ok: false, error: err.message };
    } finally {
        if (!window.isAutoSaving) {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = originalBtnHtml; }
            if (stickySaveBtn) { stickySaveBtn.disabled = false; stickySaveBtn.textContent = '✓ Save All'; }
        } else if (floatingStatus) {
            floatingStatus.innerHTML = '✓ Saved';
            setTimeout(() => floatingStatus.classList.remove('visible'), 2000);
        }
        
        window.unsavedPeriods.clear();
        updateStatusBar();
    }
}


function copyPreviousDay() {
    const dateStr = document.getElementById('dailyDate').value;
    if (!dateStr) { showToast('Please select a date.', 'warning'); return; }
    const activities = getActivities();
    const sorted = activities.map(a => a.date).sort();
    const idx = sorted.indexOf(dateStr);
    let prevDate = null;
    if (idx > 0) prevDate = sorted[idx - 1];
    else if (sorted.length > 0 && sorted[0] !== dateStr) prevDate = sorted[sorted.length - 1];
    if (!prevDate) { showToast('No previous day found to copy from.', 'info'); return; }
    const prevEntry = getDayEntry(prevDate);
    if (!prevEntry) { showToast('No data for previous day.', 'info'); return; }

    const tbody = document.getElementById('periodTableBody');
    const trs = tbody.querySelectorAll('tr');
    trs.forEach(tr => {
        const periodNum = parseInt(tr.querySelector('.period-num')?.textContent || '0');
        const prevPeriod = prevEntry.periods.find(p => p.periodNumber === periodNum);
        if (prevPeriod) {
            const parsed = parseClassSection(prevPeriod.classSection || '');
            const classDropdown = tr.querySelector('.daily-class-dropdown');
            if (classDropdown) classDropdown.value = parsed.class;
            const sectionInput = tr.querySelector('.daily-section-input');
            if (sectionInput) sectionInput.value = parsed.section;
            tr.querySelector('.daily-work').value = prevPeriod.classwork || '';
            tr.querySelector('.daily-home').value = prevPeriod.homework || '';
            
            const photoCell = tr.querySelector('.photo-cell');
            if (photoCell) {
                const pUrl = prevPeriod.photoUrl || '';
                if (pUrl) {
                    photoCell.innerHTML = `
                        <div class="photo-preview-container">
                            <img src="${pUrl}" class="photo-preview-thumb" onclick="openLightbox('${pUrl}')" />
                            <button class="photo-remove-btn" onclick="removePhotoRow(${periodNum})" title="Remove photo">&times;</button>
                        </div>
                        <input type="hidden" class="daily-photo-url" data-period="${periodNum}" value="${escHtml(pUrl)}" />
                    `;
                } else {
                    photoCell.innerHTML = `
                        <button class="btn btn-outline btn-xs btn-photo-trigger" onclick="triggerPhotoUpload(${periodNum})" style="margin: 0 auto; display: flex;">📷 Add</button>
                        <input type="file" id="photo-input-${periodNum}" class="hidden" accept="image/*" onchange="handlePhotoSelect(event, ${periodNum})" />
                        <input type="hidden" class="daily-photo-url" data-period="${periodNum}" value="" />
                    `;
                }
            }
        }
    });
    showToast(`📋 Copied from ${formatDate(prevDate)}`, 'info');
    document.getElementById('dailyStatus').textContent = `📋 Copied from ${formatDate(prevDate)} — click Save to confirm.`;
}

function resetDaily() {
    if (!confirm('Reset current day\'s entries? Unsaved changes will be lost.')) return;
    const dateStr = document.getElementById('dailyDate').value;
    if (!dateStr) return;
    const tbody = document.getElementById('periodTableBody');
    tbody.querySelectorAll('tr').forEach(tr => {
        const classDropdown = tr.querySelector('.daily-class-dropdown');
        if (classDropdown) classDropdown.value = '';
        const sectionInput = tr.querySelector('.daily-section-input');
        if (sectionInput) sectionInput.value = '';
        tr.querySelector('.daily-work').value = '';
        tr.querySelector('.daily-home').value = '';
        const periodNum = parseInt(tr.querySelector('.period-num')?.textContent || '0');
        removePhotoRow(periodNum);
    });
    document.getElementById('dailyStatus').textContent = `🔄 Reset for ${formatDate(dateStr)}`;
    showToast('Reset complete.', 'info');
}

// ================================================================
//  UI: VIEW TAB
// ================================================================
function renderViewTab() {
    const activities = getActivities();
    const search = document.getElementById('viewSearch').value.toLowerCase().trim();
    const dateFrom = document.getElementById('viewDateFrom').value;
    const dateTo = document.getElementById('viewDateTo').value;
    const sort = document.getElementById('viewSort').value;

    let filtered = [...activities];
    const currentEmail = localStorage.getItem('lastLoggedInEmail');
    if (currentEmail) {
        filtered = filtered.filter(day => day.teacher_email === currentEmail);
    }

    if (search) {
        filtered = filtered.filter(day => {
            const match = day.periods.some(p =>
                (p.classSection || '').toLowerCase().includes(search) ||
                (p.classwork || '').toLowerCase().includes(search) ||
                (p.homework || '').toLowerCase().includes(search)
            );
            return match || day.date.includes(search);
        });
    }

    if (dateFrom) filtered = filtered.filter(d => d.date >= dateFrom);
    if (dateTo) filtered = filtered.filter(d => d.date <= dateTo);

    // Status filter (from cloud statuses stored on activities if available)
    const statusFilter = document.getElementById('viewStatusFilter');
    if (statusFilter && statusFilter.value !== 'all') {
        filtered = filtered.filter(d => (d.status || 'draft') === statusFilter.value);
    }

    filtered.sort((a, b) => {
        if (sort === 'date-asc') return a.date.localeCompare(b.date);
        return b.date.localeCompare(a.date);
    });

    const container = document.getElementById('viewResults');
    if (filtered.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <span class="emoji">📭</span>
            <h3>No activities found</h3>
            <p>${activities.length === 0 ? 'Start adding your daily activities in the Daily Entry tab!' : 'Try adjusting your search or filters.'}</p>
          </div>
        `;
        return;
    }

    let html = '';
    for (const day of filtered) {
        const dateDisplay = formatDate(day.date);
        const periodCount = day.periods.filter(p => p.classSection || p.classwork || p.homework || p.photoUrl || (p.files && p.files.length > 0)).length;
        const total = day.periods.length;
        
        const progressPercent = total > 0 ? Math.round((periodCount / total) * 100) : 0;
        let progressColor = '#64748b'; // Slate (Neutral)
        if (progressPercent >= 50) progressColor = '#3b82f6'; // Blue (In Progress)
        if (progressPercent === 100) progressColor = '#10b981'; // Green (Complete)

        // Status pill
        const dayStatus = day.status || 'draft';
        const statusPillMap = {
            draft: '<span class="status-pill status-draft">📝 Draft</span>',
            submitted: '<span class="status-pill status-submitted">⏳ Submitted</span>',
            approved: '<span class="status-pill status-approved">✅ Approved</span>',
            revision_requested: '<span class="status-pill status-revision">🔄 Revision</span>',
        };
        const statusPill = statusPillMap[dayStatus] || '';

        html += `
          <div class="day-card" data-date="${day.date}">
            <div class="day-header" onclick="toggleDayCard(this)">
              <div class="day-header-left">
                <div class="day-date">${dateDisplay}</div>
                <div class="day-badge" style="background-color: ${progressColor}15; color: ${progressColor}; border: 1px solid ${progressColor}30;">
                   ${periodCount}/${total} periods
                </div>
                ${statusPill}
              </div>
              <div class="day-actions">
                <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); openHistoryModal('${day.date}')">🕐 History</button>
                <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); toggleDayCard(this.closest('.day-card'))">👁️ View</button>
                <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); editDay('${day.date}')">✏️ Edit</button>
                <button class="btn btn-outline btn-xs btn-outline-danger" onclick="event.stopPropagation(); deleteDay('${day.date}')">🗑</button>
              </div>
            </div>
            <div class="period-list">
              ${day.periods.map(p => `
                <div class="period-item">
                  <span class="p-label"><span class="p-num">P${p.periodNumber}</span></span>
                  <span class="p-class" title="Class & Section"><span class="${p.classSection ? 'badge-class' : ''}">${escHtml(p.classSection) || '—'}</span></span>
                  <span class="p-work" title="Classwork">📖 ${escHtml(p.classwork) || '—'}</span>
                  <span class="p-home" title="Homework">📝 ${escHtml(p.homework) || '—'}</span>
                  <span class="p-files" title="Files" style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
                    ${(p.files && p.files.length > 0) ? p.files.map(f => `<a href="${f.url}" target="_blank" title="${escHtml(f.name)}" class="file-pill"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg> <span>${escHtml(f.name)}</span></a>`).join('') : (p.photoUrl ? `<a href="${p.photoUrl}" target="_blank" title="Photo" class="file-pill"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> <span>Photo</span></a>` : '<span style="color:var(--text-muted)">—</span>')}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
    }
    container.innerHTML = html;
}

function toggleDayCard(el) {
    const card = el.closest('.day-card');
    if (card) card.classList.toggle('expanded');
}


function editDay(dateStr) {
    document.querySelector('[data-tab="daily"]').click();
    document.getElementById('dailyDate').value = dateStr;
    renderDailyTab();
    showToast(`✏️ Editing ${formatDate(dateStr)}`, 'info');
}

async function deleteDay(dateStr) {
    if (!dateStr) return;
    if (!confirm(`Delete entry for ${formatDate(dateStr)}?`)) return;
    
    // Call Supabase to delete if online/available
    if (typeof deleteEntryFromSupabase === 'function') {
        const result = await deleteEntryFromSupabase(dateStr);
        if (!result.ok && result.error !== 'Supabase not configured') {
            showToast(`⚠️ Supabase sync failed: ${result.error}. Deleted locally.`, 'warning');
        }
    }
    
    deleteDayEntry(dateStr);
    
    showToast(`🗑 Deleted ${formatDate(dateStr)}`, 'warning');
    renderViewTab();
    updateBadge();
    const dailyDate = document.getElementById('dailyDate')?.value;
    if (dailyDate === dateStr) renderDailyTab();
}

function deleteCurrentDay() {
    const dateInput = document.getElementById('dailyDate');
    const dateStr = dateInput ? dateInput.value : getTodayStr();
    if (dateStr) {
        deleteDay(dateStr);
    }
}
window.deleteDay = deleteDay;
window.deleteCurrentDay = deleteCurrentDay;

// ================================================================
//  UI: SETTINGS TAB
// ================================================================
async function loadSettingsUI() {
    if (window.App && window.App.school) {
        const schoolNameEl = document.getElementById('settingsSchoolName');
        if (schoolNameEl) {
            schoolNameEl.textContent = `${window.App.school.schoolName} (${window.App.school.schoolCode})`;
        }
    }

    const settings = getSettings();
    document.getElementById('settingsPeriods').value = settings.periodsPerDay || 8;
    
    const subjectSelect = document.getElementById('settingsTeacherSubject');
    const boardSelect = document.getElementById('settingsCurriculumBoard');
    const classSelect = document.getElementById('settingsCurriculumClass');
    const curriculumSubjectSelect = document.getElementById('settingsCurriculumSubject');
    const fileTypeSelect = document.getElementById('settingsCurriculumFileType');

    try {
        let [boards, classes, subjects] = await Promise.all([
            window.apiFetchBoards().catch(() => []),
            window.apiFetchClasses().catch(() => []),
            window.apiFetchSubjects().catch(() => [])
        ]);

        if (!boards || boards.length === 0) {
            boards = [{ id: 1, name: 'CBSE' }, { id: 2, name: 'ICSE' }, { id: 3, name: 'State Board' }];
        }
        if (!classes || classes.length === 0) {
            classes = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: String(i + 1) }));
        }
        if (!subjects || subjects.length === 0) {
            subjects = [
                { id: 1, name: 'Mathematics' },
                { id: 2, name: 'Science' },
                { id: 3, name: 'Social Studies' },
                { id: 4, name: 'English' },
                { id: 5, name: 'Hindi' },
                { id: 6, name: 'Telugu' }
            ];
        }

        if (boardSelect) {
            boardSelect.innerHTML = boards.map(b => `<option value="${escHtml(b.name)}">${escHtml(b.name)}</option>`).join('');
            boardSelect.value = settings.curriculumBoard || 'CBSE';
        }

        if (classSelect) {
            classSelect.innerHTML = classes.map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`).join('');
            classSelect.value = settings.curriculumClass || '10';
        }

        if (curriculumSubjectSelect) {
            curriculumSubjectSelect.innerHTML = subjects.map(s => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`).join('');
            curriculumSubjectSelect.value = settings.curriculumSubject || 'Mathematics';
        }

        if (subjectSelect) {
            subjectSelect.innerHTML = [
                '<option value="">All Subjects (No Restriction)</option>',
                ...subjects.map(s => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`)
            ].join('\n');
            subjectSelect.value = localStorage.getItem('userSubject') || '';
        }
    } catch (err) {
        console.error('Error populating dynamic dropdown options:', err);
    }

    if (fileTypeSelect) fileTypeSelect.value = settings.curriculumFileType || 'topics';
}

function savePeriodsSetting() {
    const val = parseInt(document.getElementById('settingsPeriods').value);
    if (val < 1 || val > 20) { showToast('Please enter a number between 1 and 20.', 'warning'); return; }
    const settings = getSettings();
    settings.periodsPerDay = val;
    saveSettings(settings);
    showToast(`✅ Periods per day set to ${val}`, 'success');
    if (document.getElementById('tab-daily').classList.contains('active')) renderDailyTab();
}

function saveCurriculumConfigSetting() {
    const board = document.getElementById('settingsCurriculumBoard').value;
    const className = document.getElementById('settingsCurriculumClass').value;
    const subject = document.getElementById('settingsCurriculumSubject').value;
    const fileType = document.getElementById('settingsCurriculumFileType').value;
    
    const settings = getSettings();
    settings.curriculumBoard = board;
    settings.curriculumClass = className;
    settings.curriculumSubject = subject;
    settings.curriculumFileType = fileType;
    saveSettings(settings);
    
    showToast('✅ Dynamic content configuration saved.', 'success');
    loadCurriculumCSV(true);
}

async function saveSubjectSetting() {
    const select = document.getElementById('settingsTeacherSubject');
    if (!select) return;
    const newSubject = select.value;
    
    // Save to localStorage immediately
    if (newSubject) {
        localStorage.setItem('userSubject', newSubject);
    } else {
        localStorage.removeItem('userSubject');
    }
    
    // If Supabase is authenticated, update the user metadata in the cloud
    if (isSupabaseConfigValid()) {
        const client = getSupabaseClient();
        if (client) {
            try {
                const { data: { session } } = await client.auth.getSession();
                if (session && session.user) {
                    const saveBtn = document.getElementById('settingsSaveSubject');
                    const origText = saveBtn.textContent;
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Saving...';
                    
                    const { error } = await client.auth.updateUser({
                        data: { subject: newSubject }
                    });
                    
                    saveBtn.disabled = false;
                    saveBtn.textContent = origText;
                    
                    if (error) {
                        showToast(`Failed to sync subject to Supabase: ${error.message}`, 'error');
                        return;
                    }
                    
                    // Trigger session re-read to update UI displays
                    const { data: { session: updatedSession } } = await client.auth.getSession();
                    if (updatedSession) {
                        handleAuthState(updatedSession);
                    }
                }
            } catch (e) {
                console.warn('Could not sync subject with Supabase:', e);
            }
        }
    }
    
    showToast(newSubject ? `✅ Subject configured to ${newSubject}` : '✅ Subject filtering disabled.', 'success');
}

function clearAllData() {
    if (!confirm('⚠️ Are you sure you want to delete ALL local activities? This cannot be undone!')) return;
    if (!confirm('⚠️ Final confirmation: delete all data?')) return;
    saveActivities([]);
    updateBadge();
    renderDailyTab();
    if (document.getElementById('tab-view').classList.contains('active')) renderViewTab();
    showToast('🗑 All data cleared.', 'warning');
}

// ================================================================
//  UI: BADGE
// ================================================================
function updateBadge() {
    let activities = getActivities();
    const currentEmail = localStorage.getItem('lastLoggedInEmail');
    if (currentEmail) {
        activities = activities.filter(a => a.teacher_email === currentEmail);
    }
    const total = activities.reduce((sum, d) => sum + d.periods.filter(p => p.classSection || p.subjectTopics || p.classwork || p.homework || p.photoUrl)
        .length, 0);
    document.getElementById('viewBadge').textContent = total;
}

// ================================================================
//  UI: LIGHTBOX
// ================================================================
function openLightbox(url) {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    img.src = url;
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
    }
    document.body.style.overflow = '';
}

// ================================================================
//  UI: SQL HELPER
// ================================================================
function toggleSqlHelper() {
    const box = document.getElementById('sqlHelperBox');
    const content = document.getElementById('sqlHelperContent');
    const chevron = document.getElementById('sqlHelperChevron');
    if (box.classList.contains('expanded')) {
        box.classList.remove('expanded');
        content.style.maxHeight = '0px';
        chevron.textContent = '▼';
    } else {
        box.classList.add('expanded');
        content.style.maxHeight = content.scrollHeight + 'px';
        chevron.textContent = '▲';
    }
}

async function copySqlScript(event) {
    if (event) event.stopPropagation();
    let sqlText = '';
    try {
        const response = await fetch('/migration.sql');
        if (response.ok) {
            sqlText = await response.text();
        }
    } catch (err) {
        console.warn('Could not fetch migration.sql dynamically:', err);
    }
    
    if (!sqlText) {
        sqlText = `-- Please copy the contents of the migration.sql file located in the root folder of the project.`;
    }

    navigator.clipboard.writeText(sqlText).then(() => {
        const btn = event ? (event.currentTarget || event.target) : null;
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            btn.style.background = '#059669';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = '';
            }, 2000);
        }
        showToast('SQL migration script copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy: ' + err.message, 'error');
    });
}

// ================================================================
//  UI: TEST PHOTO HELPER
// ================================================================
function loadTestPhoto() {
    const dailyTabBtn = document.querySelector('[data-tab="daily"]');
    if (dailyTabBtn) dailyTabBtn.click();
    
    setTimeout(() => {
        const mockBase64 = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        const cell = document.querySelector('#photo-input-1')?.closest('.photo-cell');
        if (cell) {
            cell.innerHTML = `
                <div class="photo-preview-container">
                    <img src="${mockBase64}" class="photo-preview-thumb" onclick="openLightbox('${mockBase64}')" />
                    <button class="photo-remove-btn" onclick="removePhotoRow(1)" title="Remove photo">&times;</button>
                </div>
                <input type="hidden" class="daily-photo-url" data-period="1" value="${mockBase64}" />
            `;
            showToast('🔬 Loaded mock test photo for Period 1!', 'success');
        } else {
            showToast('Could not find Period 1 photo cell.', 'warning');
        }
    }, 100);
}

// ================================================================
//  UI: SUPABASE CONFIG FETCH MODAL CONTROLLERS
// ================================================================
function showFetchConfigModal() {
    const overlay = document.getElementById('config-fetch-overlay');
    if (!overlay) return;

    // Reset inputs
    document.getElementById('fetchConfigUuid').value = '';
    document.getElementById('fetchConfigPin').value = '';

    // Show overlay
    overlay.classList.add('active');
}

function hideFetchConfigModal() {
    const overlay = document.getElementById('config-fetch-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
}

window.showFetchConfigModal = showFetchConfigModal;
window.hideFetchConfigModal = hideFetchConfigModal;


// ================================================================
//  ROLE BASED UI
// ================================================================
function applyRoleBasedUI(role) {
    const adminTabBtn = document.querySelector('[data-tab="admin"]');
    const principalTabBtn = document.querySelector('[data-tab="principal"]');
    
    if (adminTabBtn) {
        adminTabBtn.style.display = (role === 'admin' || role === 'super_admin') ? 'inline-block' : 'none';
    }
    
    if (principalTabBtn) {
        principalTabBtn.style.display = (role === 'principal' || role === 'admin' || role === 'super_admin') ? 'inline-block' : 'none';
    }
}
window.applyRoleBasedUI = applyRoleBasedUI;
window.switchViewMode = switchViewMode;
window.setFocusPeriod = setFocusPeriod;

// Keyboard & Swipe Gestures
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (typeof saveDaily === 'function') {
            const saveBtn = document.getElementById('saveDailyBtn');
            if (saveBtn) {
                const originalText = saveBtn.textContent;
                saveBtn.textContent = 'Saving...';
                saveDaily().then(() => {
                    saveBtn.textContent = '✓ Saved';
                    setTimeout(() => saveBtn.textContent = originalText, 2000);
                });
            } else {
                saveDaily();
            }
        }
        return;
    }
    
    
    if (window.currentViewMode !== 'focus') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return; // Don't trigger when typing
    if (e.ctrlKey && e.key === 'ArrowRight') setFocusPeriod(window.currentFocusedPeriod + 1);
    if (e.ctrlKey && e.key === 'ArrowLeft') setFocusPeriod(window.currentFocusedPeriod - 1);
});

let touchStartX = 0;
window.addEventListener('touchstart', e => {
    if (e.target.closest('.period-cards')) {
        touchStartX = e.changedTouches[0].screenX;
    }
});
window.addEventListener('touchend', e => {
    
    if (window.currentViewMode !== 'focus') return;
    if (e.target.closest('.period-cards')) {
        const touchEndX = e.changedTouches[0].screenX;
        if (touchStartX - touchEndX > 70) setFocusPeriod(window.currentFocusedPeriod + 1); // Swipe left = Next
        if (touchEndX - touchStartX > 70) setFocusPeriod(window.currentFocusedPeriod - 1); // Swipe right = Prev
    }
});


function showKeyboardHelp() {
    const modalHtml = `
        <div class="review-modal-overlay active" id="kbdHelpModal" onclick="this.remove()">
            <div class="review-modal" style="max-width: 450px; padding: 24px;" onclick="event.stopPropagation()">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
                    <h3 style="margin:0;">⌨ Keyboard Navigation</h3>
                    <button class="btn-icon" onclick="document.getElementById('kbdHelpModal').remove()">✕</button>
                </div>
                <div class="kbd-shortcuts-list" style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px;">
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Tab</span><span style="color:var(--text-muted); font-size:13px;">Next field</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Shift + Tab</span><span style="color:var(--text-muted); font-size:13px;">Previous field</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Enter</span><span style="color:var(--text-muted); font-size:13px;">Next period (from input/select)</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Ctrl/⌘ + Enter</span><span style="color:var(--text-muted); font-size:13px;">Next period (from text areas)</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">↑ / ↓</span><span style="color:var(--text-muted); font-size:13px;">Move between periods (inputs only)</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Esc</span><span style="color:var(--text-muted); font-size:13px;">Remove focus</span></div>
                    <div style="display:flex; justify-content:space-between;"><span style="font-weight:bold; background:var(--bg-body); padding:2px 6px; border-radius:4px; font-size:12px; font-family:monospace;">Ctrl/⌘ + S</span><span style="color:var(--text-muted); font-size:13px;">Save diary</span></div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
window.showKeyboardHelp = showKeyboardHelp;
