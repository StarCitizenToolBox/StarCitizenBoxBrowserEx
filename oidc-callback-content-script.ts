/**
 * OIDC Callback Content Script
 * 
 * This script runs on the server's callback page (http://localhost:8066/api/v1/auth/callback)
 * to extract the OIDC code and state from the page, then sends them to the background script.
 * 
 * The server returns an HTML page with a hidden div containing the OIDC data:
 * <div id="oidc-data" data-code="..." data-state="..."></div>
 */

(function () {
    // Find the OIDC data element
    const dataDiv = document.getElementById('oidc-data');

    if (dataDiv) {
        const code = dataDiv.getAttribute('data-code');
        const state = dataDiv.getAttribute('data-state');
        const error = dataDiv.getAttribute('data-error');

        // Check if there's an error
        if (error) {
            console.error('[SCToolbox Extension] Auth error:', error);
            // Optionally update the page to show the error was received
            const statusDiv = document.getElementById('status');
            if (statusDiv) {
                statusDiv.textContent = '扩展程序已接收到错误信息';
            }
            return;
        }

        if (code) {
            console.log('[SCToolbox Extension] Found OIDC code, sending to background...');

            // Send message to background script to handle the auth code
            chrome.runtime.sendMessage({
                type: 'OIDC_CALLBACK',
                code: code,
                state: state
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[SCToolbox Extension] Failed to send message:', chrome.runtime.lastError);
                    return;
                }

                if (response && response.success) {
                    console.log('[SCToolbox Extension] Authentication successful!');

                    // Update page status
                    const statusDiv = document.getElementById('status');
                    if (statusDiv) {
                        statusDiv.innerHTML = '<span style="color: #22c55e;">✓ 认证成功！正在关闭窗口...</span>';
                    }

                    // Close the tab after success
                    setTimeout(() => {
                        window.close();
                    }, 1500);
                } else {
                    console.error('[SCToolbox Extension] Authentication failed:', response?.error);

                    // Update page status
                    const statusDiv = document.getElementById('status');
                    if (statusDiv) {
                        statusDiv.innerHTML = `<span style="color: #ef4444;">✗ 认证失败: ${response?.error || '未知错误'}</span>`;
                    }
                }
            });
        } else {
            console.log('[SCToolbox Extension] No OIDC code found on page');
        }
    } else {
        console.log('[SCToolbox Extension] No oidc-data element found');
    }
})();
