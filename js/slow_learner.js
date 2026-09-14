// ================================================================
//  SLOW LEARNER PROGRESS MONITORING SCRIPT
// ================================================================

// ================================================================
//  SLOW LEARNER PROGRESS MONITORING SCRIPT
// ================================================================

let currentActiveDate = getTodayStr();
let allSlowLearnerEntries = [];
let isInitialized = false;

function normalizeDateStr(d) {
    if (!d) return '';
    if (typeof d === 'string') {
        const s = d.trim();
        if (s.includes('T')) return s.split('T')[0];
        if (s.includes(' ')) return s.split(' ')[0];
        return s;
    }
    try {
        const dateObj = new Date(d);
        if (!isNaN(dateObj.getTime())) {
            return dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
        }
    } catch (e) {}
    return String(d).trim();
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch (e) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getTodayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function getSlowLearnerStorageKey() {
    let uid = 'offline';
    const getClient = window.getSupabaseClient || (typeof getSupabaseClient === 'function' ? getSupabaseClient : null);
    if (getClient) {
        const client = getClient();
        if (client) {
            try {
                const { data: { session } } = await client.auth.getSession();
                if (session?.user?.id) uid = session.user.id;
            } catch (e) {}
        }
    }
    if (uid === 'offline') {
        const cached = localStorage.getItem('cachedProfile');
        if (cached) {
            try {
                const p = JSON.parse(cached);
                if (p.email) uid = p.email;
            } catch (e) {}
        }
    }
    return `slow_learner_entries_${uid}`;
}

async function loadAllSlowLearnerEntries() {
    // 1. Read from primary local storage
    const key = await getSlowLearnerStorageKey();
    let localEntries = [];
    try {
        const raw = localStorage.getItem(key);
        if (raw) localEntries = JSON.parse(raw);
    } catch (e) {
        console.error('Error parsing local slow learner entries', e);
    }
    if (!Array.isArray(localEntries)) localEntries = [];

    // Also fallback-merge from offline storage so local entries are never dropped
    if (key !== 'slow_learner_entries_offline') {
        try {
            const offRaw = localStorage.getItem('slow_learner_entries_offline');
            if (offRaw) {
                const offEntries = JSON.parse(offRaw);
                if (Array.isArray(offEntries) && offEntries.length > 0) {
                    const existingIds = new Set(localEntries.map(e => e.id));
                    offEntries.forEach(oe => {
                        if (!existingIds.has(oe.id)) localEntries.push(oe);
                    });
                }
            }
        } catch (e) {}
    }

    allSlowLearnerEntries = localEntries;

    // 2. Fetch fresh copy from Supabase if online and merge
    const fetchFn = window.fetchSlowLearnerFromSupabase || (typeof fetchSlowLearnerFromSupabase === 'function' ? fetchSlowLearnerFromSupabase : null);
    if (fetchFn && localStorage.getItem('offlineMode') !== 'true') {
        try {
            const result = await fetchFn();
            if (result && result.ok && Array.isArray(result.data)) {
                if (result.data.length > 0) {
                    const entryMap = new Map();
                    // Local items first
                    localEntries.forEach(e => entryMap.set(e.id, e));
                    // Overlay remote items
                    result.data.forEach(e => entryMap.set(e.id, e));
                    allSlowLearnerEntries = Array.from(entryMap.values());
                    await saveSlowLearnerEntriesLocally(allSlowLearnerEntries);
                } else if (localEntries.length > 0) {
                    // Remote has 0 rows, sync local entries up
                    const syncFn = window.syncSlowLearnerToSupabase || (typeof syncSlowLearnerToSupabase === 'function' ? syncSlowLearnerToSupabase : null);
                    if (syncFn) syncFn(localEntries);
                }
            }
        } catch (err) {
            console.warn('Supabase fetch failed/bypassed, using local cache:', err);
        }
    }
    return allSlowLearnerEntries;
}

async function saveSlowLearnerEntriesLocally(entries) {
    try {
        const key = await getSlowLearnerStorageKey();
        localStorage.setItem(key, JSON.stringify(entries));
    } catch (e) {
        console.error('Error saving slow learner entries locally', e);
    }
}

function updateSlDateSubtitle() {
    const input = document.getElementById('slHeaderDateInput');
    const subtitle = document.getElementById('slModalDateSubtitle');
    if (!input || !subtitle) return;
    const dateVal = normalizeDateStr(input.value) || currentActiveDate || getTodayStr();
    const dateObj = new Date(dateVal + 'T00:00:00');
    const dateFormatted = isNaN(dateObj.getTime()) ? dateVal : dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    subtitle.textContent = `Date: ${dateFormatted} — Progress Monitoring Record`;
}

function updateBackLinks(dateStr) {
    const d = normalizeDateStr(dateStr) || currentActiveDate || getTodayStr();
    const backBtn = document.querySelector('.sl-header-back-btn');
    if (backBtn) backBtn.href = `dashboard.html?date=${encodeURIComponent(d)}`;
}

function renderSlowLearnerForDate(dateStr) {
    const container = document.getElementById('slModalRowsContainer');
    if (!container) return;
    container.innerHTML = '';

    const targetDate = normalizeDateStr(dateStr) || currentActiveDate;
    const matching = allSlowLearnerEntries.filter(e => normalizeDateStr(e.date) === targetDate);

    if (matching.length === 0) {
        for (let i = 0; i < 5; i++) {
            addSlowLearnerRow({ date: targetDate });
        }
    } else {
        matching.forEach(entry => addSlowLearnerRow(entry));
    }
}

function addSlowLearnerRow(data = {}) {
    const container = document.getElementById('slModalRowsContainer');
    if (!container) return;

    const defaultDate = normalizeDateStr(data.date) || currentActiveDate || normalizeDateStr(document.getElementById('slHeaderDateInput')?.value) || getTodayStr();
    const tr = document.createElement('tr');
    tr.className = 'sl-row-item';
    const rowId = data.id || generateUUID();
    tr.setAttribute('data-id', escapeHtml(rowId));

    const classOpts = [1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}" ${data.className === String(n) ? 'selected' : ''}>${n}</option>`).join('');
    
    tr.innerHTML = `
        <td>
            <input type="date" class="sl-input sl-input-date" value="${escapeHtml(defaultDate)}" onchange="handleRowDateChange(this)" />
        </td>
        <td>
            <select class="sl-input sl-input-class"><option value="">-</option>${classOpts}</select>
        </td>
        <td>
            <input type="text" class="sl-input sl-input-section" placeholder="Sec" value="${escapeHtml(data.section || '')}" />
        </td>
        <td>
            <div style="display: flex; align-items: center; gap: 4px; position: relative;">
                <input type="text" class="sl-input sl-input-name" placeholder="Enter student name... (Type # to search)" value="${escapeHtml(data.studentName || '')}" oninput="handleStudentSearchInput(this)" onkeydown="handleStudentSearchKeydown(event, this)" autocomplete="off" />
            </div>
        </td>
        <td>
            <div style="display: flex; align-items: center; gap: 4px; position: relative;">
                <input type="text" class="sl-input sl-input-subject" placeholder="Subject... (Type # to search)" value="${escapeHtml(data.subject || '')}" oninput="handleSubjectSearchInput(this)" onkeydown="handleStudentSearchKeydown(event, this)" autocomplete="off" />
            </div>
        </td>
        <td>
            <textarea class="sl-input sl-textarea-gap" rows="2" placeholder="Describe learning gap...">${escapeHtml(data.learningGap || '')}</textarea>
        </td>
        <td>
            <textarea class="sl-input sl-textarea-strategy" rows="2" placeholder="Strategy/Method used...">${escapeHtml(data.strategy || '')}</textarea>
        </td>
        <td>
            <select class="sl-input sl-select-progress">
                <option value="" ${!data.progress ? 'selected' : ''}>-- Select Progress --</option>
                <option value="Improving" ${data.progress === 'Improving' ? 'selected' : ''}>Improving</option>
                <option value="Satisfactory" ${data.progress === 'Satisfactory' ? 'selected' : ''}>Satisfactory</option>
                <option value="Little Improvement" ${data.progress === 'Little Improvement' ? 'selected' : ''}>Little Improvement</option>
                <option value="Needs Attention" ${data.progress === 'Needs Attention' ? 'selected' : ''}>Needs Attention</option>
            </select>
        </td>
        <td>
            <textarea class="sl-input sl-textarea-nextstep" rows="2" placeholder="Next step or action plan...">${escapeHtml(data.nextStep || '')}</textarea>
        </td>
        <td style="text-align: center;">
            <button type="button" class="btn-sl-delete" onclick="removeSlowLearnerRow(this)" title="Delete Row">
                🗑
            </button>
        </td>
    `;

    container.appendChild(tr);
}

function handleRowDateChange(input) {
    const tr = input.closest('tr');
    if (!tr) return;
    const rowDate = normalizeDateStr(input.value);
    if (rowDate && rowDate !== currentActiveDate) {
        // Update row attribute or keep in current dataset
        tr.setAttribute('data-date', rowDate);
    }
}

function removeSlowLearnerRow(btn) {
    const tr = btn.closest('tr');
    if (tr) tr.remove();
    const container = document.getElementById('slModalRowsContainer');
    if (container && container.querySelectorAll('tr.sl-row-item').length === 0) {
        addSlowLearnerRow({ date: currentActiveDate });
    }
}

function clearAllSlowLearnerRows() {
    if (!confirm(`Are you sure you want to clear all rows for ${currentActiveDate}?`)) return;
    const container = document.getElementById('slModalRowsContainer');
    if (container) container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
        addSlowLearnerRow({ date: currentActiveDate });
    }
}

function collectRowsFromDOM() {
    const rows = document.querySelectorAll('#slModalRowsContainer tr.sl-row-item');
    const entries = [];

    rows.forEach(tr => {
        const rowDateInput = tr.querySelector('.sl-input-date')?.value;
        const date = normalizeDateStr(rowDateInput) || currentActiveDate;
        const className = tr.querySelector('.sl-input-class')?.value || '';
        const section = tr.querySelector('.sl-input-section')?.value.trim() || '';
        const studentName = tr.querySelector('.sl-input-name')?.value.trim() || '';
        const subject = tr.querySelector('.sl-input-subject')?.value.trim() || '';
        const learningGap = tr.querySelector('.sl-textarea-gap')?.value.trim() || '';
        const strategy = tr.querySelector('.sl-textarea-strategy')?.value.trim() || '';
        const progress = tr.querySelector('.sl-select-progress')?.value || '';
        const nextStep = tr.querySelector('.sl-textarea-nextstep')?.value.trim() || '';

        let id = tr.getAttribute('data-id');
        if (!id || id.startsWith('sl-')) {
            id = generateUUID();
            tr.setAttribute('data-id', id);
        }

        entries.push({
            id,
            date,
            className,
            section,
            studentName,
            subject,
            learningGap,
            strategy,
            progress,
            nextStep
        });
    });

    return entries;
}

async function collectAndPersistCurrentDate(syncToRemote = false) {
    const currentRows = collectRowsFromDOM();
    const validRows = currentRows.filter(r => r.studentName || r.learningGap || r.subject || r.className);

    // Normalize date on all valid rows
    validRows.forEach(r => {
        r.date = normalizeDateStr(r.date) || currentActiveDate;
    });

    // Replace entries for currentActiveDate
    const otherDates = allSlowLearnerEntries.filter(e => normalizeDateStr(e.date) !== currentActiveDate);
    allSlowLearnerEntries = [...otherDates, ...validRows];

    await saveSlowLearnerEntriesLocally(allSlowLearnerEntries);

    if (syncToRemote && localStorage.getItem('offlineMode') !== 'true') {
        const syncFn = window.syncSlowLearnerToSupabase || (typeof syncSlowLearnerToSupabase === 'function' ? syncSlowLearnerToSupabase : null);
        if (syncFn) {
            try {
                const syncResult = await syncFn(validRows, currentActiveDate);
                return syncResult;
            } catch (err) {
                console.error('Supabase sync error:', err);
                return { ok: false, error: err.message };
            }
        }
    }
    return { ok: true };
}

async function handleDateChange() {
    const dateInput = document.getElementById('slHeaderDateInput');
    if (!dateInput || !dateInput.value) return;
    const newDate = normalizeDateStr(dateInput.value);
    if (newDate === currentActiveDate) return;

    // 1. Persist current edits before switching dates
    await collectAndPersistCurrentDate(false);

    // 2. Switch date
    currentActiveDate = newDate;
    updateSlDateSubtitle();
    updateBackLinks(newDate);

    // 3. Render rows for new date
    renderSlowLearnerForDate(newDate);
}

async function saveAllSlowLearnerRows(redirectOnSave = true) {
    const syncResult = await collectAndPersistCurrentDate(true);

    let syncMsg = 'Saved locally.';
    if (syncResult && syncResult.ok) {
        syncMsg = 'Synced to Supabase.';
    } else if (syncResult && syncResult.error) {
        console.warn('Supabase sync warning:', syncResult.error);
        syncMsg = 'Saved locally.';
    }

    if (typeof showToast === 'function') {
        showToast(`💾 Slow Learner records saved for ${currentActiveDate}! ${syncMsg}`, 'success');
    }

    if (redirectOnSave) {
        setTimeout(() => {
            navigateBackToDashboard();
        }, 800);
    }
}

function navigateBackToDashboard() {
    const d = currentActiveDate || normalizeDateStr(document.getElementById('slHeaderDateInput')?.value) || '';
    window.location.href = d ? `dashboard.html?date=${encodeURIComponent(d)}` : 'dashboard.html';
}

function exportSlowLearnerCSV() {
    const rows = collectRowsFromDOM();
    const validRows = rows.filter(r => r.studentName || r.learningGap || r.subject);

    if (validRows.length === 0) {
        if (typeof showToast === 'function') showToast('No records to export for this date', 'warning');
        return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Date,Class,Section,Student Name,Subject,Learning Gap,Strategy/Method Used,Progress,Next Step\n';

    validRows.forEach(row => {
        const line = [
            `"${(row.date || '').replace(/"/g, '""')}"`,
            `"${(row.className || '').replace(/"/g, '""')}"`,
            `"${(row.section || '').replace(/"/g, '""')}"`,
            `"${(row.studentName || '').replace(/"/g, '""')}"`,
            `"${(row.subject || '').replace(/"/g, '""')}"`,
            `"${(row.learningGap || '').replace(/"/g, '""')}"`,
            `"${(row.strategy || '').replace(/"/g, '""')}"`,
            `"${(row.progress || '').replace(/"/g, '""')}"`,
            `"${(row.nextStep || '').replace(/"/g, '""')}"`
        ].join(',');
        csvContent += line + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `slow_learner_progress_${currentActiveDate || new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function initSlowLearner() {
    if (isInitialized) return;
    isInitialized = true;

    // 1. Resolve active date from URL query parameter or header input or today
    const urlParams = new URLSearchParams(window.location.search);
    const paramDate = urlParams.get('date');
    if (paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate)) {
        currentActiveDate = normalizeDateStr(paramDate);
    } else {
        const headerVal = document.getElementById('slHeaderDateInput')?.value;
        currentActiveDate = headerVal ? normalizeDateStr(headerVal) : getTodayStr();
    }

    const dateInput = document.getElementById('slHeaderDateInput');
    if (dateInput) {
        dateInput.value = currentActiveDate;
        dateInput.onchange = handleDateChange;
    }
    updateSlDateSubtitle();
    updateBackLinks(currentActiveDate);

    // Update school name if available
    if (window.App && window.App.school && window.App.school.schoolName) {
        const schoolEl = document.querySelector('.sl-modal-school');
        if (schoolEl) schoolEl.textContent = window.App.school.schoolName;
    }

    // 2. Load dataset and render
    await loadAllSlowLearnerEntries();
    renderSlowLearnerForDate(currentActiveDate);

    // 3. Load student autocomplete database
    const loadFn = window.loadTestStudents || (typeof loadTestStudents === 'function' ? loadTestStudents : null);
    if (loadFn) {
        try {
            await loadFn();
        } catch (error) {
            console.error('Error loading student autocomplete DB:', error);
        }
    }
}

// Expose functions globally
window.initSlowLearner = initSlowLearner;
window.handleDateChange = handleDateChange;
window.handleRowDateChange = handleRowDateChange;
window.navigateBackToDashboard = navigateBackToDashboard;
window.getSlowLearnerEntries = loadAllSlowLearnerEntries;
window.saveSlowLearnerEntriesLocally = saveSlowLearnerEntriesLocally;
window.addSlowLearnerRow = addSlowLearnerRow;
window.removeSlowLearnerRow = removeSlowLearnerRow;
window.clearAllSlowLearnerRows = clearAllSlowLearnerRows;
window.saveAllSlowLearnerRows = saveAllSlowLearnerRows;
window.updateSlDateSubtitle = updateSlDateSubtitle;
window.exportSlowLearnerCSV = exportSlowLearnerCSV;
window.renderModalRows = renderSlowLearnerForDate;
window.getTodayStr = getTodayStr;

// ================================================================
//  STUDENT SEARCH (AUTOCOMPLETE)
// ================================================================

function getGlobalDropdown() {
    let dropdown = document.getElementById('globalStudentDropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'globalStudentDropdown';
        dropdown.className = 'student-autocomplete-dropdown';
        dropdown.style.display = 'none';
        document.body.appendChild(dropdown);
        
        // Hide on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#globalStudentDropdown') && 
                !e.target.classList.contains('sl-input-name') &&
                !e.target.classList.contains('sl-input-subject')) {
                dropdown.style.display = 'none';
            }
        });
    }
    return dropdown;
}

function handleStudentSearchInput(input) {
    const tr = input.closest('tr');
    const dropdown = getGlobalDropdown();
    const val = input.value;
    
    if (!val.startsWith('#')) {
        dropdown.style.display = 'none';
        return;
    }
    
    // Position dropdown below input correctly, relative to document
    const rect = input.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    dropdown.style.left = (rect.left + window.scrollX) + 'px';
    dropdown.style.width = rect.width + 'px';
    
    if (!window.studentsDBReady) {
        dropdown.innerHTML = '<div class="autocomplete-empty">⏳ Loading student list...</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    const search = val.slice(1).trim().toLowerCase();
    
    const rowClass = tr.querySelector('.sl-input-class')?.value || '';
    const rowSec = tr.querySelector('.sl-input-section')?.value.trim().toLowerCase() || '';
    
    if (!rowClass || !rowSec) {
        dropdown.innerHTML = '<div class="autocomplete-empty">Select Class and Section<br>to search students.</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    let matches = window.studentsDB || [];
    matches = matches.filter(s => s.class == rowClass);
    matches = matches.filter(s => s.section.toLowerCase() === rowSec);
    
    if (search) {
        matches = matches.filter(s => s.name.toLowerCase().includes(search));
    }
    
    if (matches.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-empty">No students found</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    dropdown.innerHTML = '';

    const header = document.createElement('div');
    header.style.padding = '8px 12px';
    header.style.fontSize = '11px';
    header.style.fontWeight = '700';
    header.style.color = 'var(--sl-text-accent)';
    header.style.textTransform = 'uppercase';
    header.style.letterSpacing = '0.5px';
    header.style.borderBottom = '1px solid var(--sl-border)';
    header.style.marginBottom = '4px';
    header.innerHTML = `🔎 Search Class ${rowClass}-${rowSec.toUpperCase()} Students`;
    dropdown.appendChild(header);

    // show matches
    matches.forEach(student => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `<span style="opacity:0.5; width:20px; display:inline-block;">${student.rollNo || ''}</span> ${student.name}`;
        
        item.onmousedown = (e) => {
            e.preventDefault(); // prevent blur
            input.value = student.name;
            dropdown.style.display = 'none';
        };
        
        item.addEventListener('mouseenter', () => {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
        
        dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
}

const DEFAULT_SUBJECTS = [
    'Mathematics', 'Science', 'English', 'Social Studies', 'Hindi', 
    'Physics', 'Chemistry', 'Biology', 'Computer Science'
];

function handleSubjectSearchInput(input) {
    const dropdown = getGlobalDropdown();
    const val = input.value;
    
    if (!val.startsWith('#')) {
        dropdown.style.display = 'none';
        return;
    }
    
    const rect = input.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    dropdown.style.left = (rect.left + window.scrollX) + 'px';
    dropdown.style.width = rect.width + 'px';
    
    const search = val.slice(1).trim().toLowerCase();
    
    let matches = DEFAULT_SUBJECTS;
    if (search) {
        matches = matches.filter(s => s.toLowerCase().includes(search));
    }
    
    if (matches.length === 0) {
        dropdown.innerHTML = '<div class="autocomplete-empty">No subjects found</div>';
        dropdown.style.display = 'block';
        return;
    }
    
    dropdown.innerHTML = '';
    
    const header = document.createElement('div');
    header.style.padding = '8px 12px';
    header.style.fontSize = '11px';
    header.style.fontWeight = '700';
    header.style.color = 'var(--sl-text-accent)';
    header.style.textTransform = 'uppercase';
    header.style.letterSpacing = '0.5px';
    header.style.borderBottom = '1px solid var(--sl-border)';
    header.style.marginBottom = '4px';
    header.innerHTML = `🔎 Search Subjects`;
    dropdown.appendChild(header);

    matches.forEach(subject => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = subject;
        
        item.onmousedown = (e) => {
            e.preventDefault(); 
            input.value = subject;
            dropdown.style.display = 'none';
        };
        
        item.addEventListener('mouseenter', () => {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
        
        dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
}

function handleStudentSearchKeydown(event, input) {
    const dropdown = document.getElementById('globalStudentDropdown');
    if (!dropdown || dropdown.style.display === 'none') return;
    
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;
    
    let activeIdx = Array.from(items).findIndex(i => i.classList.contains('active'));
    
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (activeIdx < items.length - 1) activeIdx++;
        else activeIdx = 0;
        items.forEach(i => i.classList.remove('active'));
        items[activeIdx].classList.add('active');
        items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (activeIdx > 0) activeIdx--;
        else activeIdx = items.length - 1;
        items.forEach(i => i.classList.remove('active'));
        items[activeIdx].classList.add('active');
        items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIdx >= 0 && activeIdx < items.length) {
            const mousedownEvent = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            items[activeIdx].dispatchEvent(mousedownEvent);
        }
    } else if (event.key === 'Escape') {
        dropdown.style.display = 'none';
    }
}

// Add to window
window.handleStudentSearchInput = handleStudentSearchInput;
window.handleSubjectSearchInput = handleSubjectSearchInput;
window.handleStudentSearchKeydown = handleStudentSearchKeydown;
