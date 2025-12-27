/**
 * OIDC Authentication Module
 * Handles SCToolbox OIDC authentication flow for the browser extension
 */

const API_BASE_URL = "https://ecdn.translate-manager.scbox.xkeyc.cn/api/v1";

// Storage keys
const TOKEN_STORAGE_KEY = 'sctoolbox_access_token';
const TOKEN_EXPIRY_STORAGE_KEY = 'sctoolbox_token_expiry';
export const USER_PROFILE_STORAGE_KEY = 'sctoolbox_user_profile';

/**
 * OIDC Configuration Structure
 */
interface OIDCConfig {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    jwks_uri: string;
}

// Cache for OIDC configuration
let cachedOIDCConfig: OIDCConfig | null = null;

/**
 * User profile information
 */
export interface UserProfile {
    handle_name: string;
    name: string;
    picture: string;
    game_user_id: string;
    citizen_record: string;
    last_login_at: string;
    created_at: string;
}

/**
 * Credits information
 */
export interface UserCredits {
    date: string;
    credits_limit: number;
    credits_used: number;
    credits_remaining: number;
}

/**
 * Get OIDC Configuration from backend
 */
async function getOIDCConfig(): Promise<OIDCConfig | null> {
    if (cachedOIDCConfig) return cachedOIDCConfig;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/config`);
        if (!response.ok) {
            console.error('Failed to fetch auth config:', response.status);
            return null;
        }
        cachedOIDCConfig = await response.json();
        return cachedOIDCConfig;
    } catch (error) {
        console.error('Error fetching auth config:', error);
        return null;
    }
}

/**
 * Generate random string
 */
function generateRandomString(): string {
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
}

/**
 * Store token and expiry
 */
async function storeToken(accessToken: string, expiresIn: number): Promise<void> {
    const expiry = Date.now() + expiresIn * 1000;
    await chrome.storage.local.set({
        [TOKEN_STORAGE_KEY]: accessToken,
        [TOKEN_EXPIRY_STORAGE_KEY]: expiry
    });
}

/**
 * Get stored access token
 */
export async function getAccessToken(): Promise<string | null> {
    const result = await chrome.storage.local.get([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_STORAGE_KEY]);

    const token = result[TOKEN_STORAGE_KEY];
    const expiry = result[TOKEN_EXPIRY_STORAGE_KEY];

    if (!token || !expiry) {
        return null;
    }

    // Check if token is expired
    if (Date.now() >= expiry) {
        await clearAuth();
        return null;
    }

    return token;
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(): Promise<boolean> {
    const token = await getAccessToken();
    return token !== null;
}

/**
 * Clear authentication data
 */
export async function clearAuth(): Promise<void> {
    await chrome.storage.local.remove([
        TOKEN_STORAGE_KEY,
        TOKEN_EXPIRY_STORAGE_KEY,
        USER_PROFILE_STORAGE_KEY
    ]);
    cachedOIDCConfig = null;
}

/**
 * Initiate OIDC login flow
 * 
 * Opens the auth URL in a new tab with redirect_uri pointing to the server's callback page.
 * Flow:
 * 1. Extension opens auth URL with redirect_uri = http://localhost:8066/api/v1/auth/callback
 * 2. User authenticates in SCToolbox App
 * 3. SCToolbox redirects to http://localhost:8066/api/v1/auth/callback?code=...&state=...
 * 4. Server returns HTML page with hidden div#oidc-data containing code and state
 * 5. Content script (oidc-callback-content-script.ts) reads the data and sends to background
 * 6. Background script exchanges code for token
 */
export async function initiateLogin(): Promise<void> {
    const config = await getOIDCConfig();
    if (!config) {
        throw new Error("Could not load OIDC configuration");
    }

    const randomState = generateRandomString();
    const extensionId = chrome.runtime.id;
    // Format state as: random_string|extension_id to allow server to redirect back to us
    const state = `${randomState}|${extensionId}`;

    const nonce = generateRandomString();

    // Store state for verification
    await chrome.storage.session.set({ oauth_state: state });

    // HTTP Callback URL on localhost - server returns HTML page with OIDC data
    // Content script will extract the data and send to background script
    const redirectUri = `${API_BASE_URL}/auth/callback`;

    const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: 'sc_toolbox_browser_extension',
        redirect_uri: redirectUri,
        state: state,
        nonce: nonce,
        scope: 'openid profile custom_data'
    });

    const authUrl = `${config.authorization_endpoint}?${authParams}`;

    // Open in new tab
    chrome.tabs.create({ url: authUrl });
}

/**
 * Exchange Authorization Code for Token
 * Called by background script when callback.html receives code
 */
export async function handleAuthCode(code: string, state: string): Promise<boolean> {
    // Verify state
    const session = await chrome.storage.session.get(['oauth_state']);
    const savedState = session.oauth_state;

    if (state !== savedState) {
        console.error('State mismatch - possible CSRF attack', state, savedState);
        throw new Error('State mismatch');
    }

    // Clear state
    await chrome.storage.session.remove(['oauth_state']);

    const config = await getOIDCConfig();
    if (!config) {
        throw new Error("Missing OIDC configuration");
    }

    // Must use the SAME redirect_uri as initiateLogin for token exchange verification
    const redirectUri = `${API_BASE_URL}/auth/callback`;

    const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: 'sc_toolbox_browser_extension'
    });

    try {
        const response = await fetch(config.token_endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: tokenParams
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Token exchange failed: ${response.status} ${errText}`);
        }

        const tokens = await response.json();

        // Store token
        await storeToken(tokens.access_token, tokens.expires_in);

        // Fetch and store user profile
        await fetchAndStoreUserProfile();

        return true;
    } catch (error) {
        console.error('Token exchange error:', error);
        throw error;
    }
}

/**
 * Fetch user profile from API
 */
export async function fetchUserProfile(): Promise<UserProfile | null> {
    const token = await getAccessToken();
    const config = await getOIDCConfig();

    if (!token || !config) {
        return null;
    }

    try {
        const response = await fetch(config.userinfo_endpoint, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                await clearAuth();
            }
            return null;
        }

        const profile = await response.json();
        return profile;
    } catch (error) {
        console.error('Failed to fetch user profile:', error);
        return null;
    }
}

/**
 * Fetch user credits from API
 */
export async function fetchUserCredits(apiBaseUrl: string): Promise<UserCredits | null> {
    const token = await getAccessToken();

    if (!token) {
        return null;
    }

    try {
        const response = await fetch(`${apiBaseUrl}/user/credits`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                await clearAuth();
            }
            return null;
        }

        const credits = await response.json();
        return credits;
    } catch (error) {
        console.error('Failed to fetch user credits:', error);
        return null;
    }
}

/**
 * Fetch and store user profile
 */
async function fetchAndStoreUserProfile(): Promise<void> {
    const profile = await fetchUserProfile();

    if (profile) {
        await chrome.storage.local.set({
            [USER_PROFILE_STORAGE_KEY]: profile
        });
    }
}

/**
 * Get cached user profile
 */
export async function getCachedUserProfile(): Promise<UserProfile | null> {
    const result = await chrome.storage.local.get([USER_PROFILE_STORAGE_KEY]);
    return result[USER_PROFILE_STORAGE_KEY] || null;
}

/**
 * Logout user
 */
export async function logout(): Promise<void> {
    await clearAuth();
}
