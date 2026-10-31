import type { API } from 'homebridge';

import { TotalConnectPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/** Homebridge entry point. */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, TotalConnectPlatform);
};

