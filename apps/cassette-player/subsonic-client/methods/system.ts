/**
 * Subsonic API — System methods
 * ping, getLicense, getScanStatus, startScan
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { subsonicFetch } from '../index';
import type { SubsonicCredentials, License, ScanStatus } from '../types';

export function system(creds: SubsonicCredentials) {
  return {
    /**
     * Tests connectivity with the server.
     * Returns server metadata (type, version, OpenSubsonic support).
     * Use this as a health check before making other API calls.
     *
     * https://subsonic.org/pages/api.jsp#ping
     */
    async ping(): Promise<{ status: string; version: string; type?: string; serverVersion?: string; openSubsonic?: boolean }> {
      const data = await subsonicFetch<{ status: string; version: string; type?: string; serverVersion?: string; openSubsonic?: boolean }>(
        creds,
        'ping'
      );
      return data;
    },

    /**
     * Returns information about the server's license.
     * For open source Navidrome this always returns valid: true.
     *
     * https://subsonic.org/pages/api.jsp#getLicense
     */
    async getLicense(): Promise<License> {
      const data = await subsonicFetch<{ license: License }>(creds, 'getLicense');
      return data.license;
    },

    /**
     * Returns the current scan status.
     * Useful to poll after triggering a scan to know when it completes.
     *
     * https://www.subsonic.org/pages/api.jsp#getScanStatus
     * (Navidrome extension, not in original Subsonic spec)
     */
    async getScanStatus(): Promise<ScanStatus> {
      const data = await subsonicFetch<{ scanStatus: ScanStatus }>(creds, 'getScanStatus');
      return data.scanStatus;
    },

    /**
     * Triggers a library rescan.
     * Call this after delivering a purchased track to R2 so it appears
     * in the user's library without waiting for the scheduled scan.
     *
     * https://www.subsonic.org/pages/api.jsp#startScan
     * (Navidrome extension)
     */
    async startScan(): Promise<ScanStatus> {
      const data = await subsonicFetch<{ scanStatus: ScanStatus }>(creds, 'startScan');
      return data.scanStatus;
    },
  };
}
