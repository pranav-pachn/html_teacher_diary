// ================================================================
//  SUPABASE SERVICE
// ================================================================
let supabaseClient = null;
let supabaseClientConfig = '';

function getSupabaseClient() {
    // 1. Primary path: dynamic multi-school boot
    if (window.App && window.App.supabase) {
        return window.App.supabase;
    }

    // 2. Legacy fallback path: local dev via env.js
    if (!window.ENV || !window.ENV.SUPABASE_URL || !window.ENV.SUPABASE_KEY) return null;
    
    let url = window.ENV.SUPABASE_URL.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    if (url.endsWith('/rest/v1')) url = url.slice(0, -8);
    if (url.endsWith('/')) url = url.slice(0, -1);

    const configKey = url + '|' + window.ENV.SUPABASE_KEY;
    if (supabaseClient && supabaseClientConfig !== configKey) {
        supabaseClient = null;
    }

    if (!supabaseClient) {
        try {
            supabaseClient = window.supabase.createClient(url, window.ENV.SUPABASE_KEY);
            supabaseClientConfig = configKey;
        } catch {
            return null;
        }
    }
    return supabaseClient;
}

async function testSupabaseConnection() {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured' };
    try {
        const { error } = await client.from(getSettings().supabaseTable || 'daily_activities').select('count', {
            count: 'exact', head: true
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pushToSupabase() {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured. Go to Settings and enter your Supabase URL and API Key.' };

    let userId = null;
    try {
        const { data: { session } } = await client.auth.getSession();
        userId = session?.user?.id;
    } catch (e) {
        console.warn('Could not get Supabase session:', e.message);
    }

    if (!userId) return { ok: false, error: 'No active session. Please sign in first via the login page.' };

    const table = getSettings().supabaseTable || 'daily_activities';
    const activities = getActivities();

    let updatedActivitiesLocal = false;
    const rows = [];

    for (const day of activities) {
        for (const p of day.periods) {
            let photoUrl = p.photoUrl || '';
            if (photoUrl.startsWith('data:image/')) {
                try {
                    const fileBlob = dataURLtoBlob(photoUrl);
                    const fileName = `activities/${day.date}_p${p.periodNumber}.jpg`;

                    const { data, error } = await client.storage
                        .from('activity_photos')
                        .upload(fileName, fileBlob, {
                            contentType: 'image/jpeg',
                            upsert: true
                        });

                    if (!error) {
                        const { data: urlData } = client.storage
                            .from('activity_photos')
                            .getPublicUrl(fileName);
                        photoUrl = urlData.publicUrl;
                        p.photoUrl = photoUrl;
                        updatedActivitiesLocal = true;
                    }
                } catch (err) {
                    console.error('Failed to upload local image on push:', err);
                }
            }

            rows.push({
                user_id: userId,
                date: day.date,
                period_number: p.periodNumber,
                class_section: p.classSection || '',
                subject_topics: p.subjectTopics || '',
                classwork: p.classwork || '',
                homework: p.homework || '',
                photo_url: photoUrl
            });
        }
    }

    if (updatedActivitiesLocal) {
        saveActivities(activities);
    }

    if (rows.length === 0) return { ok: true, message: 'No data to push.' };

    try {
        const { error } = await client
            .from(table)
            .upsert(rows, { onConflict: 'user_id,date,period_number' });
        if (error) return { ok: false, error: error.message };
        return { ok: true, message: `Pushed ${rows.length} period entries.` };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function pullFromSupabase() {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured' };
    const table = getSettings().supabaseTable || 'daily_activities';
    try {
        const { data, error } = await client
            .from(table)
            .select('*')
            .order('date', { ascending: true });
        if (error) return { ok: false, error: error.message };
        if (!data || data.length === 0) return { ok: true, message: 'No data found in Supabase.', data: [] };

        const grouped = {};
        for (const row of data) {
            if (!grouped[row.date]) grouped[row.date] = [];
            grouped[row.date].push({
                periodNumber: row.period_number,
                classSection: row.class_section || '',
                subjectTopics: row.subject_topics || '',
                classwork: row.classwork || '',
                homework: row.homework || '',
                photoUrl: row.photo_url || ''
            });
        }
        const activities = Object.keys(grouped).map(date => ({
            id: generateId(),
            date: date,
            periods: grouped[date].sort((a, b) => a.periodNumber - b.periodNumber)
        }));
        return { ok: true, message: `Pulled ${data.length} period entries (${activities.length} days).`, data: activities };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ================================================================
//  PHASE 1 MIGRATION: CENTRAL DB AND REVISIONS
// ================================================================

async function writeAuditLog(client, userId, role, action, tableName, recordId, beforeVal, afterVal) {
    if (!client) return;
    try {
        await client.from('audit_logs').insert({
            user_id: userId,
            role: role,
            action: action,
            table_name: tableName,
            record_id: recordId,
            before_value: beforeVal ? JSON.stringify(beforeVal) : null,
            after_value: afterVal ? JSON.stringify(afterVal) : null
        });
    } catch (e) {
        console.warn('Failed to write audit log:', e);
    }
}

async function saveEntryToSupabase(dateStr, periods, options = {}) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase client not available' };
    
    try {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return { ok: false, error: 'No active session' };
        
        // Fast-path user role check: use memory / localStorage to avoid remote query
        let userRole = window.currentUserRole || localStorage.getItem('userRole');
        if (!userRole) {
            const cachedProfile = JSON.parse(localStorage.getItem('cachedProfile') || 'null');
            userRole = cachedProfile?.role || session.user.user_metadata?.role;
        }
        if (!userRole) {
            const { data: profile } = await client.from('users').select('role').eq('id', session.user.id).maybeSingle();
            userRole = profile?.role || 'teacher';
            localStorage.setItem('userRole', userRole);
        }
        
        const targetStatus = options.targetStatus || 'draft';
        const isSubmitting = targetStatus === 'submitted';
        const nowIso = new Date().toISOString();

        // 1. Fetch all existing entries for this teacher + date in ONE batch query
        const { data: existingEntries, error: fetchErr } = await client
            .from('daily_entries')
            .select('id, period_number, revision_number, status, class_section, subject, classwork, homework')
            .eq('teacher_id', session.user.id)
            .eq('date', dateStr)
            .order('revision_number', { ascending: false });

        if (fetchErr) {
            console.warn('Sync warning: could not fetch existing revisions:', fetchErr);
            return { ok: false, error: fetchErr.message };
        }

        // Map latest revision entry per period
        const latestByPeriod = {};
        for (const entry of (existingEntries || [])) {
            if (!latestByPeriod[entry.period_number] || entry.revision_number > latestByPeriod[entry.period_number].revision_number) {
                latestByPeriod[entry.period_number] = entry;
            }
        }

        const toInsert = [];
        const toUpdate = [];
        const periodEntriesMap = {}; // periodNumber -> { id, revision_number, isNew }

        for (const p of periods) {
            const latest = latestByPeriod[p.periodNumber];

            if (latest && latest.status === 'draft') {
                // In-place update of current unsubmitted draft
                toUpdate.push({
                    id: latest.id,
                    periodNumber: p.periodNumber,
                    rev: latest.revision_number,
                    payload: {
                        class_section: p.classSection || '',
                        subject: p.subject || '',
                        classwork: p.classwork || '',
                        homework: p.homework || '',
                        status: targetStatus,
                        submitted_at: isSubmitting ? nowIso : null,
                        revision_note: isSubmitting ? null : undefined,
                        updated_at: nowIso
                    }
                });
                periodEntriesMap[p.periodNumber] = { id: latest.id, revision_number: latest.revision_number, isNew: false };
            } else {
                // Insert a new revision:
                // If revision_requested or approved, rev = latest.rev + 1. If brand new, rev = 1.
                const nextRev = latest ? (latest.revision_number + 1) : 1;
                toInsert.push({
                    teacher_id: session.user.id,
                    date: dateStr,
                    period_number: p.periodNumber,
                    class_section: p.classSection || '',
                    subject: p.subject || '',
                    classwork: p.classwork || '',
                    homework: p.homework || '',
                    status: targetStatus,
                    revision_number: nextRev,
                    submitted_at: isSubmitting ? nowIso : null,
                    created_at: nowIso,
                    updated_at: nowIso
                });
            }
        }

        // 2. Execute batch insert and parallel updates concurrently
        const [insertResult] = await Promise.all([
            toInsert.length > 0
                ? client.from('daily_entries').insert(toInsert).select('id, period_number, revision_number')
                : Promise.resolve({ data: [], error: null }),
            toUpdate.length > 0
                ? Promise.all(toUpdate.map(u => client.from('daily_entries').update(u.payload).eq('id', u.id)))
                : Promise.resolve([])
        ]);

        if (insertResult.error) {
            console.error('Batch insert error:', insertResult.error);
            return { ok: false, error: insertResult.error.message };
        }

        (insertResult.data || []).forEach(row => {
            periodEntriesMap[row.period_number] = { id: row.id, revision_number: row.revision_number, isNew: true };
        });

        // 3. Link existing files to newly inserted revisions in one batch
        const copyAttachments = [];
        (insertResult.data || []).forEach(row => {
            const p = periods.find(x => x.periodNumber === row.period_number);
            if (p && p.files && p.files.length > 0) {
                p.files.forEach(f => {
                    copyAttachments.push({
                        entry_id: row.id,
                        teacher_id: session.user.id,
                        file_name: f.name,
                        file_url: f.path || f.url,
                        file_type: f.type,
                        file_size: f.size
                    });
                });
            }
        });
        if (copyAttachments.length > 0) {
            await client.from('attachments').insert(copyAttachments);
        }

        // 4. Upload and link new pending files concurrently
        const pendingUploadPromises = [];
        for (const p of periods) {
            if (p.pendingFiles && p.pendingFiles.length > 0 && window.FileUploadService) {
                const entryInfo = periodEntriesMap[p.periodNumber];
                if (!entryInfo) continue;
                for (const pending of p.pendingFiles) {
                    pendingUploadPromises.push((async () => {
                        try {
                            const storagePath = await window.FileUploadService.uploadPeriodFile(
                                pending, session.user.id, dateStr, p.periodNumber
                            );
                            const { data: attData } = await client.from('attachments').insert({
                                entry_id: entryInfo.id,
                                teacher_id: session.user.id,
                                file_name: pending.name,
                                file_url: storagePath,
                                file_type: pending.type || 'application/octet-stream',
                                file_size: pending.size
                            }).select('id').single();

                            p.files.push({
                                id: attData?.id,
                                name: pending.name,
                                type: pending.type,
                                size: pending.size,
                                path: storagePath,
                                url: await window.FileUploadService.getSignedUrl(storagePath),
                                isExisting: true
                            });
                        } catch (err) {
                            console.error('Failed to upload pending file:', err);
                            if (!window.isAutoSaving) showToast(`⚠️ File upload failed: ${pending.name}`, 'warning');
                        }
                    })());
                }
                p.pendingFiles = [];
            }
        }
        if (pendingUploadPromises.length > 0) {
            await Promise.all(pendingUploadPromises);
        }

        // 5. Batch audit log write (non-blocking)
        const auditRows = [];
        (insertResult.data || []).forEach(row => {
            auditRows.push({
                user_id: session.user.id,
                role: userRole,
                action: isSubmitting ? 'SUBMIT_FOR_APPROVAL' : 'CREATE_REVISION',
                table_name: 'daily_entries',
                record_id: row.id,
                before_value: null,
                after_value: JSON.stringify({ date: dateStr, period: row.period_number, rev: row.revision_number })
            });
        });
        toUpdate.forEach(u => {
            auditRows.push({
                user_id: session.user.id,
                role: userRole,
                action: isSubmitting ? 'SUBMIT_FOR_APPROVAL' : 'UPDATE_ENTRY',
                table_name: 'daily_entries',
                record_id: u.id,
                before_value: null,
                after_value: JSON.stringify({ date: dateStr, period: u.periodNumber, rev: u.rev })
            });
        });
        if (auditRows.length > 0) {
            client.from('audit_logs').insert(auditRows).then(({ error }) => {
                if (error) console.warn('Audit log write warning:', error);
            });
        }

        // 6. If submitting, dispatch notification to principals (non-blocking)
        const entryIds = Object.values(periodEntriesMap).map(e => e.id);
        if (isSubmitting && window.sendNotificationToAllPrincipals) {
            const teacherName = session.user.user_metadata?.full_name || session.user.email || 'A teacher';
            window.sendNotificationToAllPrincipals(
                'submission',
                `📋 New Diary Submitted`,
                `${teacherName} submitted their diary for ${dateStr}.`,
                dateStr,
                entryIds
            ).catch(err => console.warn('Notification warning:', err));
        }

        // 7. Save updated state to localStorage
        saveDayEntry(dateStr, periods);

        return {
            ok: true,
            count: periods.length,
            entryIds: entryIds,
            submittedAt: isSubmitting ? nowIso : null
        };
    } catch (e) {
        console.error('Error saving entry to Supabase:', e);
        return { ok: false, error: e.message };
    }
}

async function deleteEntryFromSupabase(dateStr) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured' };

    try {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return { ok: false, error: 'No active session' };

        // 1. Try to hard DELETE the rows and check how many rows were actually removed
        const { data: deletedRows, error: delError } = await client
            .from('daily_entries')
            .delete()
            .eq('teacher_id', session.user.id)
            .eq('date', dateStr)
            .select('id');

        // If hard delete removed at least one row, we are completely done!
        if (!delError && deletedRows && deletedRows.length > 0) {
            return { ok: true, count: deletedRows.length };
        }

        // 2. If delError or 0 rows were deleted (due to RLS DELETE policy restriction in PostgreSQL),
        // execute resilient FALLBACK: update status to 'draft' and clear contents.
        // Teachers already have UPDATE permissions, so this succeeds immediately and
        // immediately removes the entry from the Principal Dashboard (which only selects 'submitted').
        console.warn('Direct DELETE returned 0 rows or error. Executing fallback status update to draft:', delError);

        const nowIso = new Date().toISOString();
        const { data: updatedRows, error: updateError } = await client
            .from('daily_entries')
            .update({
                status: 'draft',
                class_section: '',
                subject: '',
                classwork: '',
                homework: '',
                submitted_at: null,
                updated_at: nowIso
            })
            .eq('teacher_id', session.user.id)
            .eq('date', dateStr)
            .select('id');

        if (updateError) {
            console.error('Fallback update failed:', updateError);
            return { ok: false, error: delError?.message || updateError.message };
        }

        return { ok: true, count: updatedRows?.length || 0, fallback: true };
    } catch (e) {
        console.error('Error deleting entry from Supabase:', e);
        return { ok: false, error: e.message };
    }
}

// ================================================================
//  SLOW LEARNER PROGRESS SYNC
// ================================================================

async function syncSlowLearnerToSupabase(entries, targetDate) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured' };

    try {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return { ok: false, error: 'No active session' };

        // If targetDate specified, clean-sync that date so deleted rows are pruned
        if (targetDate) {
            const { error: delError } = await client
                .from('slow_learner_entries')
                .delete()
                .eq('teacher_id', session.user.id)
                .eq('date', targetDate);

            if (delError) console.warn('Warning clearing slow learner entries for date:', delError);
        }

        const validEntries = entries.filter(e => e.studentName && e.studentName.trim());
        const rows = validEntries.map(e => ({
            id: e.id,
            teacher_id: session.user.id,
            date: e.date || targetDate,
            class_name: e.className || '',
            section: e.section || '',
            student_id: e.studentId || '',
            student_name: e.studentName.trim(),
            subject: e.subject || '',
            learning_gap: e.learningGap || '',
            strategy: e.strategy || '',
            progress: e.progress || '',
            next_step: e.nextStep || ''
        }));

        if (rows.length === 0) return { ok: true };

        const { error } = await client
            .from('slow_learner_entries')
            .upsert(rows, { onConflict: 'id' });

        if (error) return { ok: false, error: error.message };
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function fetchSlowLearnerFromSupabase(targetDate) {
    const client = getSupabaseClient();
    if (!client) return { ok: false, error: 'Supabase not configured' };

    try {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return { ok: false, error: 'No active session' };

        let query = client
            .from('slow_learner_entries')
            .select('*')
            .eq('teacher_id', session.user.id);

        if (targetDate) {
            query = query.eq('date', targetDate);
        }

        const { data, error } = await query.order('date', { ascending: false });

        if (error) return { ok: false, error: error.message };

        const entries = data.map(row => ({
            id: row.id,
            date: row.date,
            className: row.class_name,
            section: row.section,
            studentId: row.student_id,
            studentName: row.student_name,
            subject: row.subject,
            learningGap: row.learning_gap,
            strategy: row.strategy,
            progress: row.progress,
            nextStep: row.next_step
        }));

        return { ok: true, data: entries };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// Expose these via window if they are needed globally, although app.js generally handles sync
window.getSupabaseClient = getSupabaseClient;
window.saveEntryToSupabase = saveEntryToSupabase;
window.deleteEntryFromSupabase = deleteEntryFromSupabase;
window.syncSlowLearnerToSupabase = syncSlowLearnerToSupabase;
window.fetchSlowLearnerFromSupabase = fetchSlowLearnerFromSupabase;
