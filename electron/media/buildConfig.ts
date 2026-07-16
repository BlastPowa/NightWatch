/**
 * Public Phase 29 media configuration.
 *
 * Desktop OAuth client ids, Picker app ids, and restricted Picker API keys are
 * public application identifiers. Vite may embed them into Electron's main
 * bundle so packaged builds can connect without asking users to configure
 * environment variables. Refresh/access tokens and the optional client secret
 * are deliberately excluded and remain main-process/OS storage only.
 */

declare const __NIGHTWATCH_ENABLE_LOCAL_FILES__: string | undefined;
declare const __NIGHTWATCH_ENABLE_DRIVE__: string | undefined;
declare const __NIGHTWATCH_ENABLE_LIBRARY__: string | undefined;
declare const __NIGHTWATCH_GOOGLE_CLIENT_ID__: string | undefined;
declare const __NIGHTWATCH_GOOGLE_PICKER_API_KEY__: string | undefined;
declare const __NIGHTWATCH_GOOGLE_APP_ID__: string | undefined;
declare const __NIGHTWATCH_MAX_MEDIA_BYTES__: string | undefined;

type PublicMediaConfigName =
  | 'NIGHTWATCH_ENABLE_LOCAL_FILES'
  | 'NIGHTWATCH_ENABLE_DRIVE'
  | 'NIGHTWATCH_ENABLE_LIBRARY'
  | 'NIGHTWATCH_GOOGLE_CLIENT_ID'
  | 'NIGHTWATCH_GOOGLE_PICKER_API_KEY'
  | 'NIGHTWATCH_GOOGLE_APP_ID'
  | 'NIGHTWATCH_MAX_MEDIA_BYTES';

const EMBEDDED: Record<PublicMediaConfigName, string | undefined> = {
  NIGHTWATCH_ENABLE_LOCAL_FILES:
    typeof __NIGHTWATCH_ENABLE_LOCAL_FILES__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_ENABLE_LOCAL_FILES__,
  NIGHTWATCH_ENABLE_DRIVE:
    typeof __NIGHTWATCH_ENABLE_DRIVE__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_ENABLE_DRIVE__,
  NIGHTWATCH_ENABLE_LIBRARY:
    typeof __NIGHTWATCH_ENABLE_LIBRARY__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_ENABLE_LIBRARY__,
  NIGHTWATCH_GOOGLE_CLIENT_ID:
    typeof __NIGHTWATCH_GOOGLE_CLIENT_ID__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_GOOGLE_CLIENT_ID__,
  NIGHTWATCH_GOOGLE_PICKER_API_KEY:
    typeof __NIGHTWATCH_GOOGLE_PICKER_API_KEY__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_GOOGLE_PICKER_API_KEY__,
  NIGHTWATCH_GOOGLE_APP_ID:
    typeof __NIGHTWATCH_GOOGLE_APP_ID__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_GOOGLE_APP_ID__,
  NIGHTWATCH_MAX_MEDIA_BYTES:
    typeof __NIGHTWATCH_MAX_MEDIA_BYTES__ === 'undefined'
      ? undefined
      : __NIGHTWATCH_MAX_MEDIA_BYTES__,
};

export function publicMediaConfigValue(name: PublicMediaConfigName): string | undefined {
  const embedded = EMBEDDED[name];
  return embedded !== undefined && embedded.length > 0 ? embedded : process.env[name];
}

export interface DrivePublicConfiguration {
  clientId: string;
  pickerApiKey: string;
  appId: string;
}

export function drivePublicConfiguration(): DrivePublicConfiguration {
  return {
    clientId: publicMediaConfigValue('NIGHTWATCH_GOOGLE_CLIENT_ID') ?? '',
    pickerApiKey: publicMediaConfigValue('NIGHTWATCH_GOOGLE_PICKER_API_KEY') ?? '',
    appId: publicMediaConfigValue('NIGHTWATCH_GOOGLE_APP_ID') ?? '',
  };
}
