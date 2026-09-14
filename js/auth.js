// ================================================================
//  AUTH SERVICE (Supabase only - no local storage)
// ================================================================

function isSupabaseConfigValid() {
    return !!(window.App && window.App.supabase);
}

// ================================================================
//  AUTH UI LOGIC
// ================================================================
let isBypassedAuth = localStorage.getItem('offlineMode') === 'true';
let currentAuthTab = 'login';
let authListenerBound = false;
let currentBoundClientConfig = '';
let initialSessionResolved = false; // guards against premature null-session events

function showAuthAlert(message, type = 'error') {
    const alertEl = document.getElementById('auth-alert');
    if (!alertEl) return;
    alertEl.className = 'auth-alert ' + type;
    alertEl.innerHTML = message;
    alertEl.style.display = 'block';
}

function clearAuthAlert() {
    const alertEl = document.getElementById('auth-alert');
    if (alertEl) alertEl.style.display = 'none';
}

function switchAuthTab(tab) {
    currentAuthTab = tab;
    const loginBtn = document.getElementById('tab-login-btn');
    const signupBtn = document.getElementById('tab-signup-btn');
    const submitBtn = document.getElementById('auth-submit-btn');
    const subtitle = document.querySelector('.auth-subtitle');
    const nameGroup = document.getElementById('register-name-group');
    const subjectGroup = document.getElementById('register-subject-group');
    const nameInput = document.getElementById('auth-name');
    
    if (tab === 'login') {
        loginBtn.classList.add('active');
        signupBtn.classList.remove('active');
        submitBtn.textContent = 'Sign In';
        subtitle.textContent = 'Sign in to your Teacher Planner account';
        if (nameGroup) nameGroup.style.display = 'none';
        if (subjectGroup) subjectGroup.style.display = 'none';
        if (nameInput) nameInput.removeAttribute('required');
    } else {
        loginBtn.classList.remove('active');
        signupBtn.classList.add('active');
        submitBtn.textContent = 'Register Account';
        subtitle.textContent = 'Create your Teacher Planner account';
        if (nameGroup) nameGroup.style.display = 'block';
        if (subjectGroup) subjectGroup.style.display = 'block';
        if (nameInput) nameInput.setAttribute('required', '');
    }
    clearAuthAlert();
}

async function handleAuthSubmit(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('auth-submit-btn');
    
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Working...';
    
    try {
        clearAuthAlert();
        if (!isSupabaseConfigValid()) {
            showAuthAlert('⚠️ Supabase is not configured. Please set up Supabase URL and Key in Settings.');
            return;
        }

        const client = getSupabaseClient();
        if (!client) {
            showAuthAlert('⚠️ Could not connect to Supabase. Please check your settings.');
            return;
        }
        
        if (currentAuthTab === 'login') {
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) {
                if (error.message.includes('Email not confirmed')) {
                    showAuthAlert('Your email is not confirmed. Please check your inbox and confirm your email.', 'error');
                    return;
                }
                throw error;
            }
            localStorage.setItem('lastLoggedInEmail', email);
            window.location.href = 'dashboard.html';
        } else {
            const name = document.getElementById('auth-name').value.trim();
            const subject = document.getElementById('auth-subject').value.trim();
            
            const signUpOptions = {
                email,
                password,
                options: {
                    data: {
                        full_name: name || '',
                        subject: subject || ''
                    }
                }
            };
            const { data, error } = await client.auth.signUp(signUpOptions);
            if (error) throw error;
            if (data.session) {
                window.location.href = 'dashboard.html';
            } else {
                showAuthAlert('📧 Verification email sent! Please check your inbox and verify your email before logging in.', 'success');
                switchAuthTab('login');
            }
        }
    } catch (err) {
        showAuthAlert(err.message || 'Authentication failed. Please try again.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = currentAuthTab === 'login' ? 'Sign In' : 'Register Account';
    }
}

async function handleGoogleSignIn(event) {
    if (event) event.preventDefault();
    
    if (!isSupabaseConfigValid()) {
        showToast('⚠️ Supabase is not configured. Please set up Supabase URL and Key in Settings.', 'error');
        return;
    }
    
    const googleBtn = document.getElementById('auth-google-btn');
    const submitBtn = document.getElementById('auth-submit-btn');
    
    const originalText = googleBtn.innerHTML;
    googleBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    googleBtn.innerHTML = '<span class="spinner"></span> Connecting...';
    
    try {
        const client = getSupabaseClient();
        if (!client) {
            showToast('⚠️ Could not connect to Supabase. Please check your settings.', 'error');
            return;
        }
        
        // Build redirect URL: always land on dashboard.html after Google OAuth
        const basePath = window.location.pathname.replace(/\/[^/]*$/, '/');
        const redirectTo = window.location.origin + basePath + 'dashboard.html';

        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo,
                queryParams: {
                    prompt: 'select_account'
                }
            }
        });
        
        if (error) throw error;
    } catch (err) {
        showAuthAlert(err.message || 'Google Authentication failed. Please try again.', 'error');
        googleBtn.disabled = false;
        googleBtn.innerHTML = originalText;
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function demoLogin(role) {
    const demoUser = {
        id: `demo-${role}`,
        email: `${role}@demo.local`,
        name: role === "principal" ? "Demo Principal" : "Demo Teacher",
        role: role
    };
    localStorage.setItem("demoUser", JSON.stringify(demoUser));
    localStorage.setItem("offlineMode", "true");
    localStorage.setItem("cachedProfile", JSON.stringify({
        name: demoUser.name,
        email: demoUser.email,
        avatar: "",
        role: demoUser.role,
        school: "Demo School"
    }));
    window.location.href = "dashboard.html";
}
async function handleSignOut() {
    const client = getSupabaseClient();
    if (client) {
        await client.auth.signOut();
    }
    localStorage.removeItem('offlineMode');
    localStorage.removeItem('userRole');
    localStorage.removeItem('lastLoggedInEmail');
    localStorage.removeItem('cachedProfile');
    localStorage.removeItem('demoUser');
    window.location.href = 'index.html';
}

function bypassAuthToLocal() {
    localStorage.setItem('offlineMode', 'true');
    isBypassedAuth = true;
    window.location.href = 'dashboard.html';
}

async function setupAuthListener() {
    if (isSupabaseConfigValid()) {
        const client = getSupabaseClient();
        if (client) {
            try {
                const { data: { session } } = await client.auth.getSession();
                initialSessionResolved = true;
                if (session) {
                    handleAuthState(session);
                } else {
                    const demoUser = localStorage.getItem('demoUser');
                    if (!demoUser && !localStorage.getItem('offlineMode')) {
                        // Confirmed: genuinely no session — clear cache and handle accordingly
                        localStorage.removeItem('cachedProfile');
                        localStorage.removeItem('userRole');
                        handleAuthState(null);
                    } else if (demoUser) {
                        try {
                            const parsed = JSON.parse(demoUser);
                            window.currentUserRole = parsed.role || 'teacher';
                            applyRoleBasedUI(window.currentUserRole);
                        } catch (e) {}
                    }
                }
            } catch (e) {
                initialSessionResolved = true;
                console.warn('Error fetching initial session:', e);
            }

            const configKey = window.App && window.App.school && window.App.school.schoolCode ? window.App.school.schoolCode : 'default';
            if (!authListenerBound || currentBoundClientConfig !== configKey) {
                client.auth.onAuthStateChange((event, session) => {
                    // Ignore null-session events that fire before the initial check resolves
                    // (Supabase v2 fires SIGNED_OUT briefly before INITIAL_SESSION)
                    if (!initialSessionResolved && !session) return;
                    handleAuthState(session);
                });
                authListenerBound = true;
                currentBoundClientConfig = configKey;
            }
            return;
        }
    }
    
    const overlay = document.getElementById('auth-overlay');
    // We do NOT auto-show the auth overlay now, so the user can see the landing page.
    const lastEmail = localStorage.getItem('lastLoggedInEmail');
    const emailInput = document.getElementById('auth-email');
    if (lastEmail && emailInput && !emailInput.value) {
        emailInput.value = lastEmail;
    }
}

async function upsertUserProfileAndFetchRole(session) {
    const cached = JSON.parse(localStorage.getItem('cachedProfile') || 'null');
    const fallbackRole = (cached && cached.role) || localStorage.getItem('userRole') || 'teacher';

    const client = getSupabaseClient();
    if (!client) return { role: fallbackRole, school_name: '' };
    
    const meta = session.user.user_metadata || {};
    const email = session.user.email;
    const name = meta.full_name || meta.name || '';
    const avatarUrl = meta.avatar_url || meta.picture || '';

    try {
        // 1. Fetch existing profile to check role
        const { data: profile, error: fetchErr } = await client
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();
            
        if (fetchErr) {
            console.warn('GET /users error (preserving existing role):', fetchErr);
            return { role: fallbackRole };
        }
            
        if (!profile) {
            // 2. If it doesn't exist in DB, create initial profile with fallbackRole (defaulting to teacher only if no role previously known)
            await client.from('users').upsert({
                id: session.user.id,
                email: email,
                name: name,
                avatar_url: avatarUrl,
                role: fallbackRole
            }, { onConflict: 'id' });
            return { role: fallbackRole };
        } else {
            // Update name, avatar while strictly preserving DB role
            const userRole = profile.role || fallbackRole;
            await client.from('users').upsert({
                id: session.user.id,
                email: email,
                name: name,
                avatar_url: avatarUrl,
                role: userRole,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
            
            return {
                role: userRole
            };
        }
    } catch (err) {
        console.warn('Error upserting user profile:', err);
        return { role: fallbackRole };
    }
}

async function handleAuthState(session) {
    const overlay = document.getElementById('auth-overlay');
    const userBanner = document.getElementById('headerUserBanner');
    const userEmail = document.getElementById('headerUserEmail');
    const userName = document.getElementById('headerUserName');
    const userRole = document.getElementById('headerUserRole');
    const userSchool = document.getElementById('headerUserSchool');

    const isLandingPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/') || window.location.pathname === '';
    const isDashboard = window.location.pathname.endsWith('dashboard.html');

    if (session && session.user) {
        localStorage.removeItem('offlineMode');
        isBypassedAuth = false;
        
        if (isLandingPage) {
            window.location.href = 'dashboard.html';
            return;
        }
        if (overlay) overlay.classList.remove('active');
        if (userBanner) userBanner.classList.remove('hidden');
        
        const meta = session.user.user_metadata || {};
        let displayName = meta.full_name || meta.name || session.user.email;
        if (userName) userName.textContent = displayName;
        if (userEmail) userEmail.textContent = session.user.email;
        
        // Resolve avatar URL, falling back to a generated initials avatar
        let avatarUrl = meta.avatar_url || meta.picture || '';
        if (!avatarUrl && displayName) {
            avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=4f46e5&color=fff&rounded=true&bold=true`;
        }
        const userAvatar = document.getElementById('headerUserAvatar');
        if (userAvatar) {
            userAvatar.src = avatarUrl;
            userAvatar.style.display = avatarUrl ? 'block' : 'none';
        }

        // Determine current saved role before remote fetch to avoid role flickering
        const cached = JSON.parse(localStorage.getItem('cachedProfile') || 'null');
        const currentSavedRole = (cached && cached.role) || localStorage.getItem('userRole') || window.currentUserRole || 'teacher';

        // Fetch role from DB safely without clobbering existing role on timeout
        let profileInfo = { role: currentSavedRole };
        try {
            profileInfo = await Promise.race([
                upsertUserProfileAndFetchRole(session),
                new Promise(resolve => setTimeout(() => resolve({ role: currentSavedRole }), 1500))
            ]);
        } catch (e) {
            console.warn('Profile fetch timeout/error, retaining role:', e);
        }
        window.currentUserRole = profileInfo.role || currentSavedRole;
        localStorage.setItem('userRole', window.currentUserRole);
        
        if (userRole) {
            const roleFormatted = window.currentUserRole.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            userRole.textContent = roleFormatted;
        }
        
        let schoolName = '';
        if (userSchool) {
            if (window.App && window.App.school && window.App.school.schoolName) {
                schoolName = window.App.school.schoolName;
                userSchool.textContent = schoolName;
                userSchool.style.display = '';
            } else {
                userSchool.style.display = 'none';
            }
        }

        // Persist profile data to localStorage so banner and role can be pre-filled on next refresh instantly
        localStorage.setItem('cachedProfile', JSON.stringify({
            name: displayName,
            email: session.user.email,
            avatar: avatarUrl,
            role: window.currentUserRole,
            school: schoolName
        }));
        
        if (meta.subject) {
            localStorage.setItem('userSubject', meta.subject);
        } else {
            const localSubj = localStorage.getItem('userSubject');
            if (!localSubj) localStorage.removeItem('userSubject');
        }
        
        // (Avatar is already set above — no duplicate block needed)
        
        if (session.user.email) {
            localStorage.setItem('lastLoggedInEmail', session.user.email);
        }

        // Clean up the URL hash fragment to prevent token leakage and keep URL clean
        if (window.location.hash && (window.location.hash.includes('access_token=') || window.location.hash.includes('type=recovery'))) {
            history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }

        // Apply Role-based routing (hide/show tabs)
        applyRoleBasedUI(window.currentUserRole);
        
        // Initialize Notifications
        if (window.subscribeToNotifications) {
            window.subscribeToNotifications();
        }

        // Auto-select 'daily' dashboard tab when signed in
        const dailyTabButton = document.querySelector('[data-tab="daily"]');
        if (dailyTabButton && !dailyTabButton.classList.contains('active')) {
            dailyTabButton.click();
        }
    } else {
        if (isDashboard && !isBypassedAuth) {
            window.location.href = 'index.html';
            return;
        }

        localStorage.removeItem('userSubject');
        if (userBanner) userBanner.classList.add('hidden');
        if (userEmail) userEmail.textContent = '';
        
        const avatarEl = document.getElementById('headerUserAvatar');
        if (avatarEl) {
            avatarEl.src = '';
            avatarEl.style.display = 'none';
        }
        
        if (!isBypassedAuth) {
            // Do not automatically show auth overlay, let the landing page button do it
            const lastEmail = localStorage.getItem('lastLoggedInEmail');
            const emailInput = document.getElementById('auth-email');
            if (lastEmail && emailInput && !emailInput.value) {
                emailInput.value = lastEmail;
            }
        } else {
            if (overlay) overlay.classList.remove('active');
        }
    }
}

// Ensure globally accessible
window.handleGoogleSignIn = handleGoogleSignIn;
window.handleSignOut = handleSignOut;
window.switchAuthTab = switchAuthTab;
window.handleAuthSubmit = handleAuthSubmit;
window.bypassAuthToLocal = bypassAuthToLocal;
