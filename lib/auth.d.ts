export declare const CLIENT_ID = "1031625952748946";
export declare const DEVICE_URL = "https://auth.meta.com/oidc/device/authorization/";
export declare const TOKEN_URL = "https://auth.meta.com/oidc/device/token/";
export declare const KEY_URL = "https://api.meta.ai/muse-code/key";
export declare const API_VERSION = "1.0.0";
export declare const AUTH_CONTRACT_VERSION = 1;
export interface DeviceAuthorization {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    interval: number;
    expires_in: number;
}
export interface MintedCredential {
    apiKey: string;
    accountId: string;
    email?: string;
}
export declare function deviceAuthorize(signal?: AbortSignal): Promise<DeviceAuthorization>;
export declare function pollToken(deviceCode: string, intervalS: number, expiresInS: number, signal?: AbortSignal): Promise<string>;
export declare function mintKey(accessToken: string, signal?: AbortSignal): Promise<MintedCredential>;
