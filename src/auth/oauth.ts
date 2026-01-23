import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * OAuth configuration
 */
const OAUTH_CONFIG = {
  // Remote MCP server OAuth endpoint
  authorizeUrl: process.env.VAPI_OAUTH_URL || 'https://mcp.vapi.ai/authorize',
  tokenInfoUrl: process.env.VAPI_TOKEN_INFO_URL || 'https://mcp.vapi.ai/oauth/token-info',
  pollInterval: 5000, // 5 seconds
  pollTimeout: 120000, // 2 minutes
};

/**
 * OAuth token storage location
 */
const CONFIG_DIR = path.join(os.homedir(), '.vapi');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp-config.json');

/**
 * Interface for stored OAuth credentials
 */
interface OAuthCredentials {
  apiKey: string;
  orgId: string;
  userId: string;
  email: string;
  timestamp: number;
}

/**
 * Check if OAuth credentials are stored
 */
export function hasStoredCredentials(): boolean {
  try {
    return fs.existsSync(CONFIG_FILE);
  } catch (error) {
    return false;
  }
}

/**
 * Load stored OAuth credentials
 */
export function loadStoredCredentials(): OAuthCredentials | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }

    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load OAuth credentials:', error);
    return null;
  }
}

/**
 * Save OAuth credentials to disk
 */
export function saveCredentials(credentials: OAuthCredentials): void {
  try {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(credentials, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save OAuth credentials:', error);
    throw error;
  }
}

/**
 * Generate OAuth authorization URL
 */
export function generateOAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'vapi-mcp-client',
    redirect_uri: 'http://localhost:3000/callback', // Will be handled by remote server
    scope: 'read_profile read_data write_data',
  });

  return `${OAUTH_CONFIG.authorizeUrl}?${params.toString()}`;
}

/**
 * Poll for OAuth completion and retrieve API key
 *
 * This function is called after the user completes OAuth in their browser.
 * It polls the token-info endpoint to check if the OAuth flow is complete.
 *
 * @param accessToken - OAuth access token from the authorization flow
 * @returns OAuth credentials including API key
 */
export async function pollForOAuthCompletion(accessToken: string): Promise<OAuthCredentials> {
  const startTime = Date.now();

  while (Date.now() - startTime < OAUTH_CONFIG.pollTimeout) {
    try {
      const response = await fetch(OAUTH_CONFIG.tokenInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();

        if (data.apiKey) {
          const credentials: OAuthCredentials = {
            apiKey: data.apiKey,
            orgId: data.orgId,
            userId: data.userId,
            email: data.email,
            timestamp: Date.now(),
          };

          // Save credentials
          saveCredentials(credentials);

          return credentials;
        }
      }
    } catch (error) {
      // Continue polling on error
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, OAUTH_CONFIG.pollInterval));
  }

  throw new Error('OAuth flow timed out. Please try again.');
}

/**
 * Trigger OAuth flow
 *
 * This function is called when a tool is invoked without authentication.
 * It throws an error with the OAuth URL, which Claude Desktop will display to the user.
 */
export function triggerOAuthFlow(): never {
  const oauthUrl = generateOAuthUrl();

  throw new Error(
    `Authentication required. Please complete OAuth authorization:\n\n${oauthUrl}\n\n` +
    'After completing authorization, retry your request.'
  );
}

/**
 * Get API key from stored credentials or trigger OAuth
 */
export function getApiKeyOrTriggerOAuth(): string {
  const credentials = loadStoredCredentials();

  if (credentials && credentials.apiKey) {
    return credentials.apiKey;
  }

  // No credentials found - trigger OAuth flow
  triggerOAuthFlow();
}
