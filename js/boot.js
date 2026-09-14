window.App = {
    supabase: null,
    school: null
};

window.isAppReady = false;
window.appReadyDetail = null;

function triggerAppReady(detail) {
    window.isAppReady = true;
    window.appReadyDetail = detail;
    window.dispatchEvent(new CustomEvent('appReady', { detail }));
}

window.onAppReady = function(callback) {
    if (typeof callback !== 'function') return;
    if (window.isAppReady) {
        callback(new CustomEvent('appReady', { detail: window.appReadyDetail }));
    } else {
        window.addEventListener('appReady', callback);
    }
};

async function boot() {
    const isOfflineMode = localStorage.getItem('offlineMode') === 'true';
    if (isOfflineMode) {
        // If offline mode is enabled, we skip the school connect flow
        // and just dispatch appReady so the rest of the app can load
        triggerAppReady({ mode: 'offline' });
        return;
    }

    // Detect OAuth callback: Supabase returns access_token in URL hash
    // In this case, let Supabase SDK handle token exchange - do NOT redirect away
    const hash = window.location.hash || '';
    const isOAuthCallback = hash.includes('access_token=') || hash.includes('error=');
    if (isOAuthCallback) {
        // We are on dashboard.html after Google OAuth redirect.
        // Supabase SDK will auto-detect the token from the hash.
        // We need a school context - try to restore it from localStorage,
        // or if none is stored, we allow the session but won't have school info.
        const schoolDataRaw = localStorage.getItem('teacherDiary.school');
        if (schoolDataRaw) {
            try {
                const storedSchool = JSON.parse(schoolDataRaw);
                if (storedSchool && storedSchool.schoolCode) {
                    await verifyAndConnectSchool(storedSchool.schoolCode);
                    return;
                }
            } catch (e) { /* ignore */ }
        }
        // No school stored but we have an OAuth callback: 
        // dispatch already anyway so auth listener can handle the token
        triggerAppReady({ mode: 'oauth-callback' });

        // we can't consume the token without knowing the school's Supabase URL.
        // Redirect back to index.html to start over.
        if (window.location.pathname.endsWith('dashboard.html')) {
            window.location.href = 'index.html';
        }
        return;
    }

    const schoolDataRaw = localStorage.getItem('teacherDiary.school');
    let storedSchool = null;
    
    if (schoolDataRaw) {
        try {
            storedSchool = JSON.parse(schoolDataRaw);
        } catch (e) {
            console.warn("Invalid school data in localStorage.");
        }
    }

    if (storedSchool && storedSchool.schoolCode) {
        // Verify with remote json
        await verifyAndConnectSchool(storedSchool.schoolCode);
    } else {
        // Check if we are on dashboard or slow_learner without a school, if so, redirect to index
        if (window.location.pathname.endsWith('dashboard.html') || window.location.pathname.endsWith('slow_learner.html')) {
             window.location.href = 'index.html';
             return;
        }
        // Dispatch appReady so the landing page can finish loading normally
        triggerAppReady(null);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

async function verifyAndConnectSchool(code) {
    const overlay = document.getElementById('school-code-overlay');
    const errorMsg = document.getElementById('school-code-error');
    const submitBtn = document.getElementById('school-code-submit-btn');
    
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connecting...';
    }
    if (errorMsg) errorMsg.style.display = 'none';

    try {
        const response = await fetch('config/schools.v1.json');
        if (!response.ok) throw new Error('Failed to fetch school configuration');
        
        const schools = await response.json();
        const schoolConfig = schools[code];

        if (!schoolConfig) {
            if (errorMsg) {
                errorMsg.innerHTML = "School not found.<br>Please verify the code provided by your school administrator.";
                errorMsg.style.display = 'block';
            }
            if (overlay) overlay.classList.add('active');
            localStorage.removeItem('teacherDiary.school'); // clear invalid state
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Connect';
            }
            return;
        }

        if (schoolConfig.status !== 'active') {
            if (errorMsg) {
                errorMsg.innerHTML = "This school is currently unavailable.<br>Contact your administrator.";
                errorMsg.style.display = 'block';
            }
            if (overlay) overlay.classList.add('active');
            localStorage.removeItem('teacherDiary.school'); // clear invalid state
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Connect';
            }
            return;
        }

        // Initialize Supabase
        if (window.supabase) {
            window.App.supabase = window.supabase.createClient(schoolConfig.supabaseUrl, schoolConfig.anonKey);
        }

        // Store active school state
        window.App.school = {
            schoolCode: code,
            schoolName: schoolConfig.schoolName,
            connectedAt: new Date().toISOString(),
            version: 1
        };

        localStorage.setItem('teacherDiary.school', JSON.stringify(window.App.school));

        if (overlay) overlay.classList.remove('active');
        
        // Notify rest of the app
        triggerAppReady({ 
            schoolCode: code, 
            schoolName: schoolConfig.schoolName 
        });

        // Update the school name in the Auth Overlay
        const authSchoolName = document.getElementById('auth-school-name');
        if (authSchoolName) {
            authSchoolName.textContent = schoolConfig.schoolName;
        }

        if (window._pendingAuthTab) {
            const authOverlay = document.getElementById('auth-overlay');
            if (authOverlay) authOverlay.classList.add('active');
            if (typeof window.switchAuthTab === 'function') window.switchAuthTab(window._pendingAuthTab);
            window._pendingAuthTab = null;
        }

    } catch (err) {
        console.error("Error connecting to school:", err);
        if (errorMsg) {
            errorMsg.innerHTML = "An error occurred while connecting. Please check your internet and try again.";
            errorMsg.style.display = 'block';
        }
        if (overlay) overlay.classList.add('active');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Connect';
        }
    }
}

// Global functions for the UI
window.handleSchoolCodeSubmit = function(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('school-code-input');
    const code = input.value.trim().toUpperCase();
    
    if (!code) {
        const errorMsg = document.getElementById('school-code-error');
        if (errorMsg) {
            errorMsg.textContent = 'Please enter a school code.';
            errorMsg.style.display = 'block';
        }
        return;
    }
    
    verifyAndConnectSchool(code);
};

window.changeSchool = async function() {
    if (window.App && window.App.supabase) {
        try {
            await window.App.supabase.auth.signOut();
        } catch (e) {
            console.warn("Error signing out during changeSchool", e);
        }
    }

    localStorage.removeItem('teacherDiary.school');
    localStorage.removeItem('userRole');
    localStorage.removeItem('cachedProfile');
    localStorage.removeItem('offlineMode');
    localStorage.removeItem('demoUser');
    localStorage.removeItem('teacherDiary.cache');
    localStorage.removeItem('teacherDiary.activities');
    localStorage.removeItem('teacherDiary.timetable');

    window.location.href = 'index.html';
};

window.openLoginFlow = async function(tab = 'login') {
    const schoolDataRaw = localStorage.getItem('teacherDiary.school');
    if (!schoolDataRaw) {
        window._pendingAuthTab = tab;
        const schoolOverlay = document.getElementById('school-code-overlay');
        if (schoolOverlay) schoolOverlay.classList.add('active');
        return;
    }

    try {
        const school = JSON.parse(schoolDataRaw);
        window._pendingAuthTab = tab;
        await verifyAndConnectSchool(school.schoolCode);
        const authOverlay = document.getElementById('auth-overlay');
        if (authOverlay && window.App.supabase) {
            authOverlay.classList.add('active');
            if (typeof window.switchAuthTab === 'function') window.switchAuthTab(tab);
        }
    } catch (error) {
        localStorage.removeItem('teacherDiary.school');
        window._pendingAuthTab = tab;
        const schoolOverlay = document.getElementById('school-code-overlay');
        if (schoolOverlay) schoolOverlay.classList.add('active');
    }
};
