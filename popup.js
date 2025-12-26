// Toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    setTimeout(() => {
        toast.className = 'toast';
    }, 2000);
}

function formatNumber(num) {
    return num.toLocaleString('zh-CN');
}

// ==================== Cache Functions ====================

function loadCacheStats() {
    const domainsList = document.getElementById('cache-domains-list');
    domainsList.innerHTML = '<div class="empty-state">加载中...</div>';

    chrome.runtime.sendMessage({ action: "_getAllCacheStats" }, function (response) {
        if (chrome.runtime.lastError || !response) {
            domainsList.innerHTML = '<div class="empty-state">无法加载</div>';
            document.getElementById('cache-total-count').textContent = '0';
            return;
        }

        const stats = response.stats || [];
        const totalCount = stats.reduce((sum, item) => sum + item.count, 0);
        document.getElementById('cache-total-count').textContent = formatNumber(totalCount);

        if (stats.length === 0) {
            domainsList.innerHTML = '<div class="empty-state">暂无缓存</div>';
            return;
        }

        domainsList.innerHTML = stats.map(item => `
            <div class="cache-item" data-domain="${item.domain}">
                <span class="cache-domain" title="${item.domain}">${item.domain}</span>
                <span class="cache-count">${formatNumber(item.count)}</span>
                <button class="cache-delete" data-domain="${item.domain}" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `).join('');

        domainsList.querySelectorAll('.cache-delete').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                clearDomainCache(this.getAttribute('data-domain'));
            });
        });
    });
}

function clearDomainCache(domain) {
    chrome.runtime.sendMessage({ action: "_clearDomainCache", domain: domain }, function (response) {
        if (response && response.success) {
            showToast(`已清除 ${domain}`);
            loadCacheStats();
        } else {
            showToast('清除失败', 'error');
        }
    });
}

function clearAllCache() {
    if (!confirm('确定清空所有缓存？')) return;

    chrome.runtime.sendMessage({ action: "_clearAllCache" }, function (response) {
        if (response && response.success) {
            showToast('已清空');
            loadCacheStats();
        } else {
            showToast('清除失败', 'error');
        }
    });
}

// ==================== User Functions ====================

function showUserLoading() {
    document.getElementById('user-loading').classList.remove('hidden');
    document.getElementById('user-card').classList.add('hidden');
    document.getElementById('login-prompt').classList.add('hidden');
}

function showUserCard() {
    document.getElementById('user-loading').classList.add('hidden');
    document.getElementById('user-card').classList.remove('hidden');
    document.getElementById('login-prompt').classList.add('hidden');
}

function showLoginPrompt() {
    document.getElementById('user-loading').classList.add('hidden');
    document.getElementById('user-card').classList.add('hidden');
    document.getElementById('login-prompt').classList.remove('hidden');
}

function updateUserProfile(profile) {
    if (!profile) return;
    document.getElementById('user-avatar').src = profile.picture || '';
    document.getElementById('user-name').textContent = profile.name || '-';
}

function updateUserCredits(credits) {
    const percentEl = document.getElementById('credits-percent');
    if (!credits || !credits.credits_limit) {
        percentEl.textContent = '-';
        return;
    }
    const percent = Math.round((credits.credits_remaining / credits.credits_limit) * 100);
    percentEl.textContent = `${percent}%`;
}

function loadUserInfo() {
    showUserLoading();

    chrome.runtime.sendMessage({ action: "_checkLoginStatus" }, function (response) {
        if (chrome.runtime.lastError || !response || !response.loggedIn) {
            showLoginPrompt();
            return;
        }

        chrome.runtime.sendMessage({ action: "_getUserProfile" }, function (profileResponse) {
            if (profileResponse && profileResponse.profile) {
                updateUserProfile(profileResponse.profile);
                showUserCard();

                chrome.runtime.sendMessage({ action: "_getUserCredits" }, function (creditsResponse) {
                    if (creditsResponse && creditsResponse.credits) {
                        updateUserCredits(creditsResponse.credits);
                    }
                });
            } else {
                showLoginPrompt();
            }
        });
    });
}

function handleLogin() {
    chrome.runtime.sendMessage({ action: "_userLogin" }, function (response) {
        if (response && response.success) {
            showToast('正在跳转...');
            setTimeout(loadUserInfo, 1000);
        } else {
            showToast('登录失败', 'error');
        }
    });
}

function handleLogout() {
    if (!confirm('确定登出？')) return;

    chrome.runtime.sendMessage({ action: "_userLogout" }, function (response) {
        if (response && response.success) {
            showToast('已登出');
            showLoginPrompt();
        } else {
            showToast('登出失败', 'error');
        }
    });
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', function () {
    loadUserInfo();
    loadCacheStats();

    document.getElementById('refresh-cache-btn').addEventListener('click', loadCacheStats);
    document.getElementById('clear-all-cache-btn').addEventListener('click', clearAllCache);
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
});
