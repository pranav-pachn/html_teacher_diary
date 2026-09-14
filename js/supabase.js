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

async function saveEntryToSupabase(dateStr, periods) {
    const client = getSupabaseClient();
    if (!client) return { ok: false };
    
    try {
        const { data: { session } } = await client.auth.getSession();
        if (!session) return { ok: false };
        
        const { data: profile, error: profileErr } = await client.from('users').select('role').eq('id', session.user.id).single();
        if (profileErr) {
            console.warn('Sync failed: could not fetch user profile (RLS issue?):', profileErr);
            return { ok: false };
        }
        
        let successCount = 0;
        
        for (const p of periods) {
            // Find current max revision
            const { data: revData } = await client.from('daily_entries')
                .select('revision_number')
                .eq('teacher_id', session.user.id)
                .eq('date', dateStr)
                .eq('period_number', p.periodNumber)
                .order('revision_number', { ascending: false })
                .limit(1);
                
            let nextRev = 1;
            if (revData && revData.length > 0) {
                nextRev = revData[0].revision_number + 1;
            }
            
            // Insert new revision
            const { data: inserted, error } = await client.from('daily_entries').insert({
                teacher_id: session.user.id,
                date: dateStr,
                period_number: p.periodNumber,
                class_section: p.classSection || '',
                subject: p.subject || '',
                classwork: p.classwork || '',
                homework: p.homework || '',
                status: 'draft',
                revision_number: nextRev
            }).select('id').single();
            
            if (!error && inserted) {
                successCount++;
                
                // Write audit log
                await writeAuditLog(client, session.user.id, profile.role, 'CREATE_REVISION', 'daily_entries', inserted.id, null, {
                    date: dateStr, period: p.periodNumber, rev: nextRev
                });
                
                // Link existing files to the new revision
                if (p.files && p.files.length > 0) {
                    const existingAttachments = p.files.map(f => ({
                        entry_id: inserted.id,
                        teacher_id: session.user.id,
                        file_name: f.name,
                        file_url: f.path || f.url,
                        file_type: f.type,
                        file_size: f.size
                    }));
                    await client.from('attachments').insert(existingAttachments);
                }

                // Upload and link new pending files
                if (p.pendingFiles && p.pendingFiles.length > 0 && window.FileUploadService) {
                    for (const pending of p.pendingFiles) {
                        try {
                            const storagePath = await window.FileUploadService.uploadPeriodFile(
                                pending, session.user.id, dateStr, p.periodNumber
                            );
                            
                            // Insert attachment record
                            const { data: attData } = await client.from('attachments').insert({
                                entry_id: inserted.id,
                                teacher_id: session.user.id,
                                file_name: pending.name,
                                file_url: storagePath,
                                file_type: pending.type || 'application/octet-stream',
                                file_size: pending.size
                            }).select('id').single();
                            
                            // Add to local existing files array so UI knows it's uploaded
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
                    }
                    // Clear pending files
                    p.pendingFiles = [];
                }
            }
        }
        
        // Save to localStorage with updated files state
        saveDayEntry(dateStr, periods);
        
        return { ok: true, count: successCount };
    } catch (e) {
        console.error('Error saving entry to Supabase:', e);
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
window.syncSlowLearnerToSupabase = syncSlowLearnerToSupabase;
window.fetchSlowLearnerFromSupabase = fetchSlowLearnerFromSupabase;
