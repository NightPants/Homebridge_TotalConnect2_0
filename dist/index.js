import { TotalConnectPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';
/** Homebridge entry point. */
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, TotalConnectPlatform);
};
//# sourceMappingURL=index.js.map