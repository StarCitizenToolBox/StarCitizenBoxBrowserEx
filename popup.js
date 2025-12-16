// Cache management functions
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

function loadCacheStats() {
    const domainsList = document.getElementById('cache-domains-list');
    domainsList.innerHTML = '<div class="loading"><div class="loading-spinner"></div>加载中...</div>';

    chrome.runtime.sendMessage({ action: "_getAllCacheStats" }, function (response) {
        console.log('Cache stats response:', response);

        if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            domainsList.innerHTML = '<div class="empty-state">无法加载缓存信息</div>';
            document.getElementById('cache-total-count').textContent = '0';
            return;
        }

        if (!response) {
            console.error('Response is undefined');
            domainsList.innerHTML = '<div class="empty-state">无法加载缓存信息</div>';
            document.getElementById('cache-total-count').textContent = '0';
            return;
        }

        const stats = response.stats || [];
        const totalCount = stats.reduce((sum, item) => sum + item.count, 0);

        document.getElementById('cache-total-count').textContent = formatNumber(totalCount);

        if (stats.length === 0) {
            domainsList.innerHTML = '<div class="empty-state">暂无翻译缓存</div>';
            return;
        }

        domainsList.innerHTML = stats.map(item => `
            <div class="cache-domain-item" data-domain="${item.domain}">
                <span class="cache-domain-name" title="${item.domain}">${item.domain}</span>
                <span class="cache-domain-count">${formatNumber(item.count)} 条</span>
                <button class="cache-domain-clear" title="清除此域名缓存" data-domain="${item.domain}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
            </div>
        `).join('');

        // Add click handlers for individual domain clear buttons
        domainsList.querySelectorAll('.cache-domain-clear').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                const domain = this.getAttribute('data-domain');
                clearDomainCache(domain);
            });
        });
    });
}

function clearDomainCache(domain) {
    chrome.runtime.sendMessage({ action: "_clearDomainCache", domain: domain }, function (response) {
        if (response && response.success) {
            showToast(`已清除 ${domain} 的缓存`);
            loadCacheStats();
        } else {
            showToast('清除失败', 'error');
        }
    });
}

function clearAllCache() {
    if (!confirm('确定要清空所有翻译缓存吗？')) {
        return;
    }

    chrome.runtime.sendMessage({ action: "_clearAllCache" }, function (response) {
        if (response && response.success) {
            showToast('已清空所有缓存');
            loadCacheStats();
        } else {
            showToast('清除失败', 'error');
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', function () {
    loadCacheStats();

    document.getElementById('refresh-cache-btn').addEventListener('click', loadCacheStats);
    document.getElementById('clear-all-cache-btn').addEventListener('click', clearAllCache);
});
