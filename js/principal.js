// ================================================================
//  PRINCIPAL DASHBOARD MODULE
// ================================================================

let _principalCurrentMode = 'pending'; // 'pending' | 'history'
let _reviewModalData = null; // current submission being reviewed
let _allPendingCache = [];
let _allHistoryCache = [];

// ----------------------------------------------------------------
//  Main render entry point (called when principal tab is activated)
// ----------------------------------------------------------------
async function renderPrincipalDashboard() {
    const container = document.getElementById('principalDashboardContent');
    if (!container) return;

    // Trigger KPI fetch in parallel
    fetchPrincipalKPIs();

    if (_principalCurrentMode === 'pending') {
        // Show loading only if we have no cache
        if (_allPendingCache.length === 0) {
            container.innerHTML = `
                <div class="principal-loading">
                    <div class="spinner"></div>
                    <p>Loading submissions...</p>
                </div>
            `;
        }
        await renderPendingSubmissions(container);
    } else {
        if (_allHistoryCache.length === 0) {
            container.innerHTML = `
                <div class="principal-loading">
                    <div class="spinner"></div>
                    <p>Loading history...</p>
                </div>
            `;
        }
        await renderApprovedHistory(container);
    }
}

// ----------------------------------------------------------------
//  KPI Fetching
// ----------------------------------------------------------------
async function fetchPrincipalKPIs() {
    const client = getSupabaseClient();
    if (!client) return;

    try {
        const todayDateStr = new Date().toISOString().split('T')[0];

        // 1. Total Teachers
        const { count: teacherCount } = await client
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'teacher');
        
        if (document.getElementById('kpiTotalTeachers')) {
            document.getElementById('kpiTotalTeachers').textContent = teacherCount || 0;
        }

        // 2. Pending Diaries, 3. Signed Today, 4. Missing Entries, 5. Late Submissions
        // We fetch all unique teacher_ids that have submitted/approved entries today
        const { data: todayEntries } = await client
            .from('daily_entries')
            .select('teacher_id, status, submitted_at')
            .eq('date', todayDateStr);

        let pendingSet = new Set();
        let signedSet = new Set();
        let activeTeachersToday = new Set();
        let lateSubmissionsCount = 0;
        
        const cutoffSetting = localStorage.getItem('late_submission_cutoff') || '16:00';
        const [cutoffHour, cutoffMinute] = cutoffSetting.split(':').map(Number);

        for (const e of (todayEntries || [])) {
            if (e.status === 'submitted' || e.status === 'approved') activeTeachersToday.add(e.teacher_id);
            if (e.status === 'submitted') pendingSet.add(e.teacher_id);
            if (e.status === 'approved') signedSet.add(e.teacher_id);
            
            // Calculate late submissions (only count once per teacher per day)
            if (e.submitted_at) {
                const subDate = new Date(e.submitted_at);
                const subHour = subDate.getHours();
                const subMinute = subDate.getMinutes();
                if (subHour > cutoffHour || (subHour === cutoffHour && subMinute > cutoffMinute)) {
                    // It's late! But we only want to count the teacher once.
                    // Actually, a KPI for 'Late Submissions' usually counts the number of teachers who submitted late today.
                    // Let's add a property to the teacher set, or just use a separate set.
                }
            }
        }
        
        // Let's use a Set to count unique teachers who submitted late today
        let lateTeachersSet = new Set();
        for (const e of (todayEntries || [])) {
            if (e.submitted_at) {
                const subDate = new Date(e.submitted_at);
                const subHour = subDate.getHours();
                const subMinute = subDate.getMinutes();
                if (subHour > cutoffHour || (subHour === cutoffHour && subMinute > cutoffMinute)) {
                    lateTeachersSet.add(e.teacher_id);
                }
            }
        }

        if (document.getElementById('kpiPendingDiaries')) document.getElementById('kpiPendingDiaries').textContent = pendingSet.size;
        if (document.getElementById('kpiSignedToday')) document.getElementById('kpiSignedToday').textContent = signedSet.size;
        if (document.getElementById('kpiLateSubmissions')) document.getElementById('kpiLateSubmissions').textContent = lateTeachersSet.size;

        const missing = Math.max(0, (teacherCount || 0) - activeTeachersToday.size);
        if (document.getElementById('kpiMissingEntries')) document.getElementById('kpiMissingEntries').textContent = missing;

    } catch (e) {
        console.error("Failed to fetch KPIs:", e);
    }
}

function applyFilters(groups) {
    const filterTeacher = (document.getElementById('principalFilterTeacher')?.value || '').toLowerCase();
    const filterClass = (document.getElementById('principalFilterClass')?.value || '').toLowerCase();
    const filterSubject = (document.getElementById('principalFilterSubject')?.value || '').toLowerCase();
    const filterDate = document.getElementById('principalFilterDate')?.value || '';

    return groups.filter(g => {
        let match = true;
        if (filterTeacher && !g.teacherName.toLowerCase().includes(filterTeacher)) match = false;
        if (filterDate && g.date !== filterDate) match = false;
        
        if (match && (filterClass || filterSubject)) {
            // Check if any entry in this group matches the class/subject filters
            const hasMatchingEntry = (g.entries || []).some(entry => {
                const cMatch = !filterClass || (entry.class_section || '').toLowerCase().includes(filterClass);
                const sMatch = !filterSubject || (entry.subject || '').toLowerCase().includes(filterSubject);
                return cMatch && sMatch;
            });
            if (!hasMatchingEntry) match = false;
        }
        
        return match;
    });
}

async function renderPendingSubmissions(container) {
    const result = await fetchPendingSubmissions(); // from approval.js
    const badge = document.getElementById('pendingCountBadge');

    if (!result.ok) {
        container.innerHTML = `<div class="principal-empty-state">
            <span>⚠️</span>
            <p>${escHtml(result.error)}</p>
        </div>`;
        return;
    }

    _allPendingCache = result.data || [];
    const filtered = applyFilters(_allPendingCache);

    if (badge) {
        badge.textContent = _allPendingCache.length;
        badge.style.display = _allPendingCache.length > 0 ? 'inline-flex' : 'none';
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="principal-empty-state">
            <span>🎉</span>
            <h3>All caught up!</h3>
            <p>No pending diary submissions match your filters.</p>
        </div>`;
        return;
    }

    let html = '<div class="submission-list">';
    for (const sub of filtered) {
        const dateDisplay = formatDate(sub.date);
        const submittedDisplay = sub.submittedAt
            ? new Date(sub.submittedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : '';
        const periodCount = sub.entries.length;
        const initials = (sub.teacherName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        html += `
        <div class="submission-card" onclick="openReviewModal('${escHtml(sub.teacherId)}', '${escHtml(sub.date)}', '${escHtml(sub.teacherName)}')">
            <div class="submission-avatar" onclick="event.stopPropagation(); openAnalyticsModal('${escHtml(sub.teacherId)}', '${escHtml(sub.teacherName)}')">${escHtml(initials)}</div>
            <div class="submission-info">
                <div class="submission-teacher" onclick="event.stopPropagation(); openAnalyticsModal('${escHtml(sub.teacherId)}', '${escHtml(sub.teacherName)}')">${escHtml(sub.teacherName)} <span style="font-size:12px; color:var(--primary); cursor:pointer;">(View Analytics)</span></div>
                <div class="submission-date">${dateDisplay}</div>
                <div class="submission-meta">${periodCount} period${periodCount !== 1 ? 's' : ''} · Submitted ${submittedDisplay}</div>
            </div>
            <div class="submission-action">
                <button class="btn btn-primary btn-sm">Review →</button>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

async function renderApprovedHistory(container) {
    const result = await fetchApprovedHistory(100);

    if (!result.ok) {
        container.innerHTML = `<div class="principal-empty-state">
            <span>⚠️</span><p>${escHtml(result.error)}</p>
        </div>`;
        return;
    }

    _allHistoryCache = result.data || [];
    const filtered = applyFilters(_allHistoryCache);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="principal-empty-state">
            <span>📋</span>
            <h3>No approved entries found</h3>
            <p>Adjust your filters or sign more diaries.</p>
        </div>`;
        return;
    }

    let html = '<div class="submission-list">';
    for (const item of filtered) {
        const dateDisplay = formatDate(item.date);
        const approvedDisplay = item.approvedAt
            ? new Date(item.approvedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : '';
        const initials = (item.teacherName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        html += `
        <div class="submission-card approved">
            <div class="submission-avatar approved" onclick="event.stopPropagation(); openAnalyticsModal('${escHtml(item.teacherId)}', '${escHtml(item.teacherName)}')">${escHtml(initials)}</div>
            <div class="submission-info">
                <div class="submission-teacher" onclick="event.stopPropagation(); openAnalyticsModal('${escHtml(item.teacherId)}', '${escHtml(item.teacherName)}')">${escHtml(item.teacherName)}</div>
                <div class="submission-date">${dateDisplay}</div>
                <div class="submission-meta">✅ Approved ${approvedDisplay}</div>
            </div>
            <span class="status-pill status-approved">Approved</span>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ----------------------------------------------------------------
//  Sub-tab switching
// ----------------------------------------------------------------
function switchPrincipalSubtab(btn, mode) {
    _principalCurrentMode = mode;
    document.querySelectorAll('.principal-subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPrincipalDashboard();
}

// ----------------------------------------------------------------
//  Review Modal
// ----------------------------------------------------------------
async function openReviewModal(teacherId, dateStr, teacherName) {
    const overlay = document.getElementById('review-modal-overlay');
    const titleEl = document.getElementById('reviewModalTitle');
    const subtitleEl = document.getElementById('reviewModalSubtitle');
    const periodsEl = document.getElementById('reviewModalPeriods');
    const revNoteInput = document.getElementById('revisionNoteInput');
    const revNoteTextarea = document.getElementById('principalRevisionNote');

    if (!overlay) return;

    // Reset state
    if (revNoteInput) revNoteInput.classList.add('hidden');
    if (revNoteTextarea) revNoteTextarea.value = '';
    
    const reqBtn = document.getElementById('requestRevisionBtn');
    if (reqBtn) reqBtn.textContent = '🔄 Request Revision';

    titleEl.textContent = `📋 ${teacherName}`;
    subtitleEl.textContent = `${formatDate(dateStr)}`;
    periodsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">Loading...</p>';
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Fetch full entries for this teacher+date
    const client = getSupabaseClient();
    if (!client) {
        periodsEl.innerHTML = '<p style="color:#ef4444;">Not connected to Supabase.</p>';
        return;
    }

    const { data: entries, error } = await client
        .from('daily_entries')
        .select(`
            id, period_number, class_section, subject, classwork, homework, status, revision_number,
            attachments(id, file_name, file_url, file_type)
        `)
        .eq('teacher_id', teacherId)
        .eq('date', dateStr)
        .eq('status', 'submitted')
        .order('period_number', { ascending: true });

    if (error || !entries || entries.length === 0) {
        periodsEl.innerHTML = '<p style="color:#ef4444;">Could not load entries. They may have already been reviewed.</p>';
        return;
    }

    // Deduplicate: latest revision per period
    const latestByPeriod = {};
    for (const e of entries) {
        if (!latestByPeriod[e.period_number] || e.revision_number > latestByPeriod[e.period_number].revision_number) {
            latestByPeriod[e.period_number] = e;
        }
    }
    const latest = Object.values(latestByPeriod).sort((a, b) => a.period_number - b.period_number);

    // Store for action handlers
    _reviewModalData = {
        teacherId,
        date: dateStr,
        dateStr,
        teacherName,
        entryIds: latest.map(e => e.id)
    };

    // Render period rows
    let html = '';
    for (const entry of latest) {
        const files = (entry.attachments || []).map(f =>
            `<a href="${escHtml(f.file_url)}" target="_blank" class="file-pill" title="${escHtml(f.file_name)}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg> <span>${escHtml(f.file_name)}</span></a>`
        ).join('');

        html += `
        <div class="review-period-row">
            <div class="review-period-num">
                <span class="p-num">P${entry.period_number}</span>
            </div>
            <div class="review-period-details">
                <div class="review-field"><span class="review-field-label">Class</span> <span class="badge-class">${escHtml(entry.class_section) || '—'}</span></div>
                <div class="review-field"><span class="review-field-label">Subject</span> ${escHtml(entry.subject) || '—'}</div>
                <div class="review-field"><span class="review-field-label">📖 Classwork</span> ${escHtml(entry.classwork) || '—'}</div>
                <div class="review-field"><span class="review-field-label">📝 Homework</span> ${escHtml(entry.homework) || '—'}</div>
                ${files ? `<div class="review-field"><span class="review-field-label">Files</span> ${files}</div>` : ''}
            </div>
        </div>`;
    }
    periodsEl.innerHTML = html;
}

function openPrincipalHistory() {
    if (_reviewModalData && _reviewModalData.teacherId && _reviewModalData.dateStr) {
        openHistoryModal(_reviewModalData.dateStr, _reviewModalData.teacherId);
    }
}

function closeReviewModal() {
    const overlay = document.getElementById('review-modal-overlay');
    const revNoteInput = document.getElementById('revisionNoteInput');
    if (overlay) overlay.style.display = 'none';
    if (revNoteInput) revNoteInput.classList.add('hidden');
    document.body.style.overflow = '';
    _reviewModalData = null;
}

async function handleApproveEntry() {
    if (!_reviewModalData) return;

    const btn = document.getElementById('approveEntryBtn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing...';

    const result = await approveDayEntry(_reviewModalData.entryIds, ''); // from approval.js

    btn.disabled = false;
    btn.innerHTML = origText;

    if (!result.ok) {
        showToast(`❌ Approval failed: \${result.error}`, 'error');
        return;
    }

    // Phase 6: Notification
    if (window.sendNotification) {
        await window.sendNotification(
            _reviewModalData.teacherId,
            'approved',
            '✅ Diary Approved',
            `Your diary for ${_reviewModalData.date} has been approved by the principal.`,
            _reviewModalData.date,
            _reviewModalData.entryIds
        );
    }

    showToast(`✅ Diary approved and signed for ${_reviewModalData.teacherName}`, 'success');
    closeReviewModal();
    renderPrincipalDashboard();
}

async function handleRejectEntry() {
    if (!_reviewModalData) return;
    
    // We treat rejection as a forced reversion to draft with a generic reject note.
    const note = "Entry rejected by Principal. Please revise and resubmit.";
    
    const btn = document.getElementById('rejectEntryBtn');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Rejecting...';

    const result = await requestRevision(_reviewModalData.entryIds, note);

    btn.disabled = false;
    btn.innerHTML = origText;

    if (!result.ok) {
        showToast(`❌ Rejection failed: ${result.error}`, 'error');
        return;
    }

    // Phase 6: Notification
    if (window.sendNotification) {
        await window.sendNotification(
            _reviewModalData.teacherId,
            'rejected',
            '❌ Diary Rejected',
            `Your diary for ${_reviewModalData.date} was rejected.`,
            _reviewModalData.date,
            _reviewModalData.entryIds
        );
    }

    showToast(`❌ Diary rejected for ${_reviewModalData.teacherName}`, 'info');
    closeReviewModal();
    renderPrincipalDashboard();
}

async function handleDiscardEntry() {
    if (!_reviewModalData) return;
    if (!confirm(`Discard this submission for ${_reviewModalData.teacherName}? It will be removed from the pending list.`)) return;

    const btn = document.getElementById('discardEntryBtn');
    const origText = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Discarding...'; }

    const client = getSupabaseClient();
    if (!client) {
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
        return;
    }

    try {
        const { data: { session } } = await client.auth.getSession();

        // 1. Try direct hard delete
        const { data: delData, error: delErr } = await client
            .from('daily_entries')
            .delete()
            .in('id', _reviewModalData.entryIds)
            .select('id');

        if (delErr || !delData || delData.length === 0) {
            // 2. Fallback: revert status to draft and clear submitted_at
            const { error: updErr } = await client
                .from('daily_entries')
                .update({
                    status: 'draft',
                    submitted_at: null,
                    updated_at: new Date().toISOString()
                })
                .in('id', _reviewModalData.entryIds);

            if (updErr) throw updErr;
        }

        if (session && window.writeAuditLog) {
            await writeAuditLog(client, session.user.id, 'principal', 'DISCARD_SUBMISSION', 'daily_entries', _reviewModalData.entryIds.join(','), null, { date: _reviewModalData.date });
        }

        showToast(`🗑 Submission discarded for ${_reviewModalData.teacherName}`, 'info');
        closeReviewModal();
        renderPrincipalDashboard();
    } catch (err) {
        console.error('Error discarding submission:', err);
        showToast(`❌ Error: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origText; }
    }
}

function handleRequestRevision() {
    const revNoteInput = document.getElementById('revisionNoteInput');
    const textarea = document.getElementById('principalRevisionNote');
    
    // First click: reveal text area
    if (revNoteInput && revNoteInput.classList.contains('hidden')) {
        revNoteInput.classList.remove('hidden');
        if (textarea) textarea.focus();
        document.getElementById('requestRevisionBtn').textContent = '📤 Send Revision Request';
        return;
    }

    // Second click: submit
    submitRevisionRequest();
}

async function submitRevisionRequest() {
    if (!_reviewModalData) return;
    const textarea = document.getElementById('principalRevisionNote');
    const note = textarea ? textarea.value.trim() : '';

    if (!note) {
        showToast('Please enter a revision note for the teacher.', 'warning');
        return;
    }

    const btn = document.getElementById('requestRevisionBtn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const result = await requestRevision(_reviewModalData.entryIds, note);

    btn.disabled = false;
    btn.textContent = origText;

    if (!result.ok) {
        showToast(`❌ Failed: ${result.error}`, 'error');
        return;
    }

    // Phase 6: Notification
    if (window.sendNotification) {
        await window.sendNotification(
            _reviewModalData.teacherId,
            'revision_requested',
            '🔄 Revision Requested',
            `Revision requested for your diary on ${_reviewModalData.date}: "${note}"`,
            _reviewModalData.date,
            _reviewModalData.entryIds
        );
    }

    showToast(`🔄 Revision requested for ${_reviewModalData.teacherName}`, 'info');
    closeReviewModal();
    renderPrincipalDashboard();
}

// ----------------------------------------------------------------
//  Teacher Analytics Modal
// ----------------------------------------------------------------
async function openAnalyticsModal(teacherId, teacherName) {
    const overlay = document.getElementById('teacher-analytics-modal');
    if (!overlay) return;
    
    document.getElementById('analyticsModalTitle').textContent = `📊 Analytics: ${teacherName}`;
    document.getElementById('analyticsCompletionRate').textContent = 'Loading...';
    document.getElementById('analyticsRevisionCount').textContent = 'Loading...';
    document.getElementById('analyticsAverageTime').textContent = 'Loading...';
    document.getElementById('analyticsSignedCount').textContent = 'Loading...';

    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const client = getSupabaseClient();
    if (!client) return;

    // Fetch last 30 days of daily entries for this teacher
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStrFilter = thirtyDaysAgo.toISOString().split('T')[0];

    try {
        const { data: entries } = await client
            .from('daily_entries')
            .select('date, status, revision_number, submitted_at, approved_at')
            .eq('teacher_id', teacherId)
            .gte('date', dateStrFilter);
            
        let daysSubmitted = new Set();
        let daysApproved = new Set();
        let totalRevisions = 0;
        let submitTimes = [];

        for (const e of (entries || [])) {
            if (e.status !== 'draft') daysSubmitted.add(e.date);
            if (e.status === 'approved') daysApproved.add(e.date);
            if (e.revision_number > 1) totalRevisions += (e.revision_number - 1);
            
            if (e.submitted_at) {
                const submitDate = new Date(e.submitted_at);
                const hour = submitDate.getHours() + (submitDate.getMinutes() / 60);
                submitTimes.push(hour);
            }
        }

        // Approx 22 working days in 30 days
        document.getElementById('analyticsCompletionRate').textContent = `${daysSubmitted.size} / 22`;
        document.getElementById('analyticsRevisionCount').textContent = totalRevisions;
        document.getElementById('analyticsSignedCount').textContent = daysApproved.size;
        
        if (submitTimes.length > 0) {
            const avgHour = submitTimes.reduce((a, b) => a + b, 0) / submitTimes.length;
            const pm = avgHour >= 12;
            const h = Math.floor(avgHour > 12 ? avgHour - 12 : (avgHour === 0 ? 12 : avgHour));
            const m = Math.floor((avgHour % 1) * 60).toString().padStart(2, '0');
            document.getElementById('analyticsAverageTime').textContent = `${h}:${m} ${pm ? 'PM' : 'AM'}`;
        } else {
            document.getElementById('analyticsAverageTime').textContent = `--`;
        }

        // Render Bar Chart
        const chartContainer = document.getElementById('analyticsBarChart');
        if (chartContainer) {
            chartContainer.innerHTML = '';
            const maxPeriods = 8; // Assuming 8 periods max for scale
            
            // Generate last 30 dates
            for (let i = 29; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dStr = d.toISOString().split('T')[0];
                const dayLabel = d.getDate(); // Just the day number
                
                const dayEntries = (entries || []).filter(e => e.date === dStr && e.status !== 'draft');
                const count = dayEntries.length;
                let statusClass = 'status-missing';
                
                if (count > 0) {
                    if (dayEntries.some(e => e.status === 'revision_requested')) statusClass = 'status-revision';
                    else if (dayEntries.some(e => e.status === 'submitted')) statusClass = 'status-submitted';
                    else if (dayEntries.some(e => e.status === 'approved')) statusClass = 'status-approved';
                }
                
                // Calculate height percentage (min 4px for 0, max 100%)
                const heightPct = count === 0 ? '4px' : `${Math.min(100, (count / maxPeriods) * 100)}%`;
                
                const barHtml = `
                    <div class="analytics-bar-group" title="${dStr}: ${count} entries">
                        <div class="analytics-bar ${statusClass}" style="height: ${heightPct};"></div>
                        <div class="analytics-bar-label">${i % 5 === 0 || i === 29 || i === 0 ? dayLabel : ''}</div>
                    </div>
                `;
                chartContainer.insertAdjacentHTML('beforeend', barHtml);
            }
        }

    } catch (e) {
        console.error("Failed to fetch analytics:", e);
    }
}

function closeAnalyticsModal() {
    const overlay = document.getElementById('teacher-analytics-modal');
    if (overlay) overlay.style.display = 'none';
    document.body.style.overflow = '';
}

// ----------------------------------------------------------------
//  Settings
// ----------------------------------------------------------------
function saveLateCutoff() {
    const el = document.getElementById('settingsLateCutoff');
    if (el && el.value) {
        localStorage.setItem('late_submission_cutoff', el.value);
        showToast('Late submission cutoff time saved!', 'success');
        if (_principalCurrentMode === 'pending') {
            renderPrincipalDashboard();
        }
    }
}

function loadLateCutoffSetting() {
    const el = document.getElementById('settingsLateCutoff');
    if (el) {
        el.value = localStorage.getItem('late_submission_cutoff') || '16:00';
    }
}

// Ensure settings are loaded when tab is clicked or script loads
document.addEventListener('DOMContentLoaded', loadLateCutoffSetting);

// Expose globally
window.renderPrincipalDashboard = renderPrincipalDashboard;
window.switchPrincipalSubtab = switchPrincipalSubtab;
window.openReviewModal = openReviewModal;
window.closeReviewModal = closeReviewModal;
window.handleApproveEntry = handleApproveEntry;
window.handleRequestRevision = handleRequestRevision;
window.handleRejectEntry = handleRejectEntry;
window.handleDiscardEntry = handleDiscardEntry;
window.openAnalyticsModal = openAnalyticsModal;
window.closeAnalyticsModal = closeAnalyticsModal;
window.saveLateCutoff = saveLateCutoff;
