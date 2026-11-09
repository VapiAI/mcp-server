import { VapiClient } from '@vapi-ai/server-sdk';

// An API key, or a function returning a current OAuth access token. The SDK
// calls the function for every request, so the token can refresh mid-session.
export type VapiToken = string | (() => Promise<string>);

export const createVapiClient = (token: VapiToken): VapiClient => {
  if (!token) {
    throw new Error('No Vapi token available');
  }
  return new VapiClient({ token });
};
