import type { MediaResult, MediaSourceDescriptor } from '@shared/media';
import type {
  DriveFileAccessState,
} from '@shared/ipc';
import type { DriveConnectionState, DriveWorkspaceInfo, SelectedMedia } from '@shared/mediaBridge';

/**
 * Remaining-features handoff, Priority 3 — the typed HOST flow for Google
 * Drive shared viewing, as one explicit state machine the frontend renders
 * step by step:
 *
 *   1. connect        — Drive OAuth (system browser, drive.file only)
 *   2. workspace      — open/create the app-tagged "NightWatch Shared" folder
 *   3. add-file       — the user uploads/moves an MP4/WebM INTO that folder
 *                       (in Drive itself; NightWatch never uploads)
 *   4. share-access   — the host opens Google's own sharing controls
 *                       (workspace webViewLink) and grants each viewer there;
 *                       NightWatch NEVER grants access silently
 *   5. pick-file      — Picker selection produces the fingerprinted descriptor
 *   6. publish        — the descriptor (opaque fileId + sha-256 fingerprint)
 *                       is handed to the room-media publisher
 *
 * Every viewer then proves their OWN access via probeViewerAccess — one
 * host grant is never assumed to cover anyone else.
 *
 * The bridge surface is injected so the flow is unit-testable and identical
 * across desktop (window.nightwatch.media) and tests.
 */

export interface DriveShareBridge {
  getDriveConnection(): Promise<DriveConnectionState>;
  connectDrive(): Promise<MediaResult<DriveConnectionState>>;
  ensureDriveWorkspace(): Promise<MediaResult<DriveWorkspaceInfo>>;
  pickDriveFile(): Promise<MediaResult<SelectedMedia>>;
  getDriveFileAccess(fileId: string): Promise<DriveFileAccessState>;
  /** Open the workspace in the SYSTEM browser for Google's sharing UI. */
  openExternal(url: string): void;
}

export type DriveShareStep =
  | 'connect'
  | 'workspace'
  | 'add-file'
  | 'share-access'
  | 'pick-file'
  | 'publish'
  | 'done';

export interface DriveShareState {
  step: DriveShareStep;
  connection: DriveConnectionState | null;
  workspace: DriveWorkspaceInfo | null;
  selection: SelectedMedia | null;
  /** Typed, user-actionable failure from the LAST attempted step. */
  error: { code: string; message: string; retryable: boolean } | null;
}

export class DriveShareFlow {
  private state: DriveShareState = {
    step: 'connect',
    connection: null,
    workspace: null,
    selection: null,
    error: null,
  };

  public constructor(
    private readonly bridge: DriveShareBridge,
    private readonly onChange: (state: DriveShareState) => void,
  ) {}

  public getState(): DriveShareState {
    return { ...this.state };
  }

  /** Resume: skip already-satisfied steps (connection persists on-device). */
  public async initialize(): Promise<void> {
    const connection = await this.bridge.getDriveConnection();
    this.patch({ connection });
    if (connection.connected) {
      this.patch({ step: 'workspace', error: null });
    }
  }

  /** Step 1 — Drive OAuth. */
  public async connect(): Promise<boolean> {
    const result = await this.bridge.connectDrive();
    if (!result.ok) {
      this.patch({ error: result.error });
      return false;
    }
    this.patch({ connection: result.value, step: 'workspace', error: null });
    return true;
  }

  /** Step 2 — find-or-create the shared workspace folder. */
  public async openWorkspace(): Promise<boolean> {
    const result = await this.bridge.ensureDriveWorkspace();
    if (!result.ok) {
      // auth-expired sends the host back to step 1 with a reason.
      if (result.error.code === 'auth-expired' || result.error.code === 'auth-required') {
        this.patch({ step: 'connect', error: result.error });
      } else {
        this.patch({ error: result.error });
      }
      return false;
    }
    this.patch({ workspace: result.value, step: 'add-file', error: null });
    return true;
  }

  /** Step 3 — the user adds their file in Drive itself. */
  public openWorkspaceInDrive(): void {
    if (this.state.workspace !== null && this.state.workspace.webViewLink.length > 0) {
      this.bridge.openExternal(this.state.workspace.webViewLink);
    }
  }

  /** The user confirms the file is in the folder → sharing step. */
  public confirmFileAdded(): void {
    if (this.state.step === 'add-file') {
      this.patch({ step: 'share-access', error: null });
    }
  }

  /** Step 4 — open Google's sharing controls; grants happen THERE. */
  public openSharingControls(): void {
    this.openWorkspaceInDrive();
  }

  /** The host confirms viewers were granted access → picking step. */
  public confirmAccessShared(): void {
    if (this.state.step === 'share-access') {
      this.patch({ step: 'pick-file', error: null });
    }
  }

  /** Step 5 — Picker selection (validated + fingerprinted in main). */
  public async pickFile(): Promise<boolean> {
    const result = await this.bridge.pickDriveFile();
    if (!result.ok) {
      if (result.error.code === 'auth-expired' || result.error.code === 'auth-required') {
        this.patch({ step: 'connect', error: result.error });
      } else {
        this.patch({ error: result.error });
      }
      return false;
    }
    this.patch({ selection: result.value, step: 'publish', error: null });
    return true;
  }

  /**
   * Step 6 — hand the descriptor to the caller for room publication (the
   * room-media publisher owns revisions/leases). Marks the flow done.
   */
  public takeDescriptorForPublish(): MediaSourceDescriptor | null {
    if (this.state.step !== 'publish' || this.state.selection === null) {
      return null;
    }
    const descriptor = this.state.selection.descriptor;
    this.patch({ step: 'done', error: null });
    return descriptor;
  }

  private patch(partial: Partial<DriveShareState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange(this.getState());
  }
}

/**
 * VIEWER side — every participant independently proves access to the host's
 * file. Returns the typed access state the readiness roster reports:
 * 'accessible' → report `ready` (after codec check); 'permission-required' /
 * 'revoked' → `permission-required`; 'offline' → `offline`;
 * 'not-found' → `missing-file`.
 */
export async function probeViewerAccess(
  bridge: Pick<DriveShareBridge, 'getDriveFileAccess'>,
  fileId: string,
): Promise<DriveFileAccessState> {
  return bridge.getDriveFileAccess(fileId);
}
