// ================================================================
//  TAB SWITCHING
// ================================================================
function setupTabs() {
    document.querySelectorAll('.tab-nav button[data-tab]').forEach(btn => {
        btn.addEventListener('click', function () {
            const tab = this.dataset.tab;
            document.querySelectorAll('.tab-nav button[data-tab]').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(el => {
                el.classList.remove('active');
                el.style.display = 'none';
            });
            const tabContent = document.getElementById('tab-' + tab);
            if (tabContent) {
                tabContent.classList.add('active');
                tabContent.style.display = '';
            }
            // render content
            if (tab === 'daily') renderDailyTab();
            if (tab === 'view') renderViewTab();
            if (tab === 'settings') loadSettingsUI();
            if (tab === 'principal' && typeof renderPrincipalDashboard === 'function') renderPrincipalDashboard();
        });
    });
}

// ================================================================
//  INIT
// ================================================================
function init() {
    const isDashboard = window.location.pathname.endsWith('dashboard.html');
    if (isDashboard) {
        const isOffline = localStorage.getItem('offlineMode') === 'true';
        if (!isOffline) {
            const school = localStorage.getItem('teacherDiary.school');
            if (!school || !window.App || !window.App.supabase) {
                window.location.href = 'index.html';
                return;
            }
        }
    }

    // header date
    document.getElementById('headerDate').textContent = '📅 ' + formatDate(getTodayStr());

    // Pre-fill profile banner and role from cache so it shows instantly on refresh (before async auth resolves)
    try {
        const cached = JSON.parse(localStorage.getItem('cachedProfile') || 'null');
        const savedRole = (cached && cached.role) || localStorage.getItem('userRole');
        if (savedRole) {
            window.currentUserRole = savedRole;
            if (typeof applyRoleBasedUI === 'function') {
                applyRoleBasedUI(savedRole);
            }
        }
        if (cached && (cached.name || cached.role)) {
            const userBanner = document.getElementById('headerUserBanner');
            const userName = document.getElementById('headerUserName');
            const userEmail = document.getElementById('headerUserEmail');
            const userAvatar = document.getElementById('headerUserAvatar');
            const userRole = document.getElementById('headerUserRole');
            const userSchool = document.getElementById('headerUserSchool');
            if (userBanner) userBanner.classList.remove('hidden');
            if (userName && cached.name) userName.textContent = cached.name;
            if (userEmail) userEmail.textContent = cached.email || '';
            if (userAvatar && cached.avatar) {
                userAvatar.src = cached.avatar;
                userAvatar.style.display = 'block';
            }
            if (userRole && (cached.role || savedRole)) {
                const displayRole = (cached.role || savedRole);
                userRole.textContent = displayRole.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            }
            if (userSchool && cached.school) {
                userSchool.textContent = cached.school;
                userSchool.style.display = '';
            }
        }
    } catch (e) { /* ignore */ }

    // tabs
    setupTabs();

    // daily
    document.getElementById('dailyDate').addEventListener('change', renderDailyTab);
    const saveDailyBtn = document.getElementById('saveDailyBtn');
    if (saveDailyBtn) saveDailyBtn.addEventListener('click', saveDaily);
    
    const stickySaveBtn = document.getElementById('stickySaveBtn');
    if (stickySaveBtn) stickySaveBtn.addEventListener('click', saveDaily);

    const resetDailyBtn = document.getElementById('resetDailyBtn');
    if (resetDailyBtn) resetDailyBtn.addEventListener('click', resetDaily);
    
    const copyPrevBtn = document.getElementById('copyPrevBtn');
    if (copyPrevBtn) copyPrevBtn.addEventListener('click', copyPreviousDay);

    // Initial setup for autosave

    // view
    const viewSearch = document.getElementById('viewSearch');
    if (viewSearch) viewSearch.addEventListener('input', renderViewTab);
    document.getElementById('viewDateFrom').addEventListener('change', renderViewTab);
    document.getElementById('viewDateTo').addEventListener('change', renderViewTab);
    document.getElementById('viewSort').addEventListener('change', renderViewTab);
    const viewStatusFilter = document.getElementById('viewStatusFilter');
    if (viewStatusFilter) viewStatusFilter.addEventListener('change', renderViewTab);

    // submit for approval
    const submitForApprovalBtn = document.getElementById('submitForApprovalBtn');
    if (submitForApprovalBtn) submitForApprovalBtn.addEventListener('click', handleSubmitForApproval);

    // settings
    document.getElementById('settingsSavePeriods').addEventListener('click', savePeriodsSetting);
    document.getElementById('settingsSaveSubject').addEventListener('click', saveSubjectSetting);
    document.getElementById('settingsSaveCurriculumConfig').addEventListener('click', saveCurriculumConfigSetting);
    const clearCacheBtn = document.getElementById('settingsClearCacheBtn');
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', () => {
            clearApiCache();
            showToast('🧹 API Cache cleared!', 'success');
        });
    }
    document.getElementById('settingsRefreshCurriculum').addEventListener('click', () => {
        loadCurriculumCSV(true);
        showToast('Refreshing curriculum tags...', 'info');
    });
    const retryBtn = document.getElementById('curriculum-retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', () => loadCurriculumCSV(true));
    }

    const seedCurriculumBtn = document.getElementById('settingsSeedCurriculum');
    if (seedCurriculumBtn) {
        seedCurriculumBtn.addEventListener('click', seedDatabaseCurriculum);
    }
    document.getElementById('settingsExportCSV').addEventListener('click', exportCSV);
    document.getElementById('settingsImportCSV').addEventListener('click', () => document.getElementById('csvFileInput').click());
    document.getElementById('csvFileInput').addEventListener('change', function (e) {
        if (this.files && this.files[0]) {
            importCSV(this.files[0]);
            this.value = '';
        }
    });
    document.getElementById('settingsClearAll').addEventListener('click', clearAllData);

    // setup authentication checking & listeners
    setupAuthListener();

    // Initial fetch of curriculum from CSV database API
    loadCurriculumCSV();

    // initial render
    renderDailyTab();
    renderViewTab();
    loadSettingsUI();
    updateBadge();

    // auto-expand first day card on view
    setTimeout(() => {
        const firstCard = document.querySelector('.day-card');
        if (firstCard) firstCard.classList.add('expanded');
    }, 300);

    // Keyboard shortcut: Ctrl+S to save
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            const dailyTab = document.getElementById('tab-daily');
            if (dailyTab.classList.contains('active')) {
                e.preventDefault();
                saveDaily();
            }
        }
    });
}

// run safely via onAppReady helper
if (typeof window.onAppReady === 'function') {
    window.onAppReady(init);
} else {
    window.addEventListener('appReady', init);
}


// expose some functions globally for inline onclick
window.toggleDayCard = toggleDayCard;
window.editDay = editDay;
window.deleteDay = deleteDay;
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.switchAuthTab = switchAuthTab;
window.handleAuthSubmit = handleAuthSubmit;
window.handleSignOut = handleSignOut;
window.bypassAuthToLocal = bypassAuthToLocal;
window.saveSubjectSetting = saveSubjectSetting;
window.saveCurriculumConfigSetting = saveCurriculumConfigSetting;
window.loadCurriculumCSV = loadCurriculumCSV;
window.seedDatabaseCurriculum = seedDatabaseCurriculum;
window.showFetchConfigModal = showFetchConfigModal;
window.hideFetchConfigModal = hideFetchConfigModal;
