/**
 * Phase 29 media service: IPC surface, local selection, and the private
 * streaming protocol.
 *
 * Trust model. The renderer is treated as hostile: every argument is
 * re-validated here regardless of what preload did, every sender is checked
 * against the window we actually created, and no reply ever carries a path, a
 * token, or a provider error string. What the renderer gets back is an opaque
 * handle and an opaque URL.
 */

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BrowserWindow, dialog, ipcMain, protocol, type IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import {
  SUPPORTED_MEDIA_EXTENSIONS,
  isMediaFingerprint,
  mediaFail,
  mediaOk,
  normalizeMediaTitle,
  parseMediaSourceDescriptor,
  type HtmlMediaSourceDescriptor,
  type MediaCapabilities,
  type MediaResult,
  type MediaSourceDescriptor,
  type SupportedHtmlMediaMime,
} from '@shared/media';
import {
  MEDIA_STREAM_SCHEME,
  disconnectedDriveState,
  isLeaseId,
  parsePlaybackUrl,
  type DriveConnectionState,
  type PlaybackLease,
  type SelectedMedia,
} from '@shared/mediaBridge';
import { logger } from '../logger';
import { maxMediaSizeBytes, resolveCapabilities } from './capabilities';
import { LeaseRegistry, parseByteRange } from './leases';
import {
  MappingStore,
  fingerprintFile,
  isMappingStillValid,
  readFileIdentity,
  type LocalMediaMapping,
} from './mappingStore';

/**
 * Register the private scheme. Must run before `app.ready`.
 *
 * `stream: true` is what makes ranged <video> playback work. `bypassCSP` is
 * deliberately absent: the renderer's CSP gets a narrow `media-src
 * nightwatch-media:` allowance instead, so this scheme buys exactly the one
 * privilege it needs and no general escape from the policy.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_STREAM_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: false },
    },
  ]);
}

const MIME_BY_EXTENSION: Record<string, SupportedHtmlMediaMime> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

interface FingerprintOperation {
  controller: AbortController;
  windowId: number;
}

export class MediaService {
  private readonly store: MappingStore;
  private readonly operations = new Map<string, FingerprintOperation>();
  /** One outstanding native dialog per window; a second is a UI bug or an attack. */
  private readonly pickingWindows = new Set<number>();

  constructor(
    userDataDir: string,
    private readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
    /** Injected so the streaming handler can be exercised without a window. */
    private readonly leases: LeaseRegistry = new LeaseRegistry(),
  ) {
    this.store = new MappingStore(userDataDir);
  }

  async init(): Promise<void> {
    await this.store.load();
    this.registerProtocolHandler();
    this.registerIpcHandlers();
  }

  /** App exit / sign-out: every lease dies. */
  shutdown(): void {
    this.leases.releaseAll();
    for (const operation of this.operations.values()) {
      operation.controller.abort();
    }
    this.operations.clear();
  }

  /** A window going away takes its leases and its in-flight hashing with it. */
  handleWindowDestroyed(windowId: number): void {
    this.leases.releaseForWindow(windowId);
    for (const [operationId, operation] of this.operations) {
      if (operation.windowId === windowId) {
        operation.controller.abort();
        this.operations.delete(operationId);
      }
    }
    this.pickingWindows.delete(windowId);
  }

  // -------------------------------------------------------------------------
  // IPC
  // -------------------------------------------------------------------------

  private registerIpcHandlers(): void {
    /**
     * Every handler goes through here. An untrusted sender gets a typed
     * failure and a log line — not a thrown exception, which would surface as
     * an unhandled rejection in whatever called it.
     */
    const guard = <TArgs extends unknown[], TResult>(
      handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
      onUntrusted: () => TResult,
    ) => {
      return async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<TResult> => {
        if (!this.isTrustedSender(event)) {
          logger.write('warn', 'media', 'Rejected media IPC from an unexpected sender');
          return onUntrusted();
        }
        return handler(event, ...(args as TArgs));
      };
    };

    const denied = <T>(): MediaResult<T> =>
      mediaFail('invalid-request', 'This request was refused.') as MediaResult<T>;

    ipcMain.handle(
      IpcChannel.MediaGetCapabilities,
      guard<[], MediaCapabilities>(
        () => resolveCapabilities(),
        // An untrusted sender is told nothing is available, which is true for it.
        () => ({
          youtube: true,
          htmlMedia: false,
          localFiles: false,
          googleDrive: false,
          library: false,
          mediaProtocolVersions: [],
          reasons: {
            htmlMedia: 'unsupported-platform',
            localFiles: 'unsupported-platform',
            googleDrive: 'unsupported-platform',
            library: 'unsupported-platform',
          },
        }),
      ),
    );

    ipcMain.handle(
      IpcChannel.MediaPickLocalFile,
      guard<[], MediaResult<SelectedMedia>>(
        (event) => this.pickLocalFile(event),
        () => denied<SelectedMedia>(),
      ),
    );

    ipcMain.handle(
      IpcChannel.MediaResolveLocalMatch,
      guard<[unknown], MediaResult<SelectedMedia>>(
        (_event, descriptor) => this.resolveLocalMatch(descriptor),
        () => denied<SelectedMedia>(),
      ),
    );

    ipcMain.handle(
      IpcChannel.MediaCancelFingerprint,
      guard<[unknown], void>(
        (_event, operationId) => {
          if (typeof operationId === 'string') {
            this.operations.get(operationId)?.controller.abort();
          }
        },
        () => undefined,
      ),
    );

    ipcMain.handle(
      IpcChannel.MediaCreateLease,
      guard<[unknown], MediaResult<PlaybackLease>>(
        (event, descriptor) => this.createPlaybackLease(event, descriptor),
        () => denied<PlaybackLease>(),
      ),
    );

    ipcMain.handle(
      IpcChannel.MediaReleaseLease,
      guard<[unknown], void>(
        (_event, leaseId) => {
          if (isLeaseId(leaseId)) {
            this.leases.release(leaseId);
          }
        },
        () => undefined,
      ),
    );

    // Drive: the contract surface exists so the renderer and the tests can
    // depend on it, but the implementation is gated behind the security review
    // in the Phase 29 handoff. Every call returns a typed, honest failure.
    ipcMain.handle(
      IpcChannel.MediaGetDriveConnection,
      guard<[], DriveConnectionState>(
        () => disconnectedDriveState('not-configured'),
        () => disconnectedDriveState('not-configured'),
      ),
    );

    const driveUnavailable = <T>(): MediaResult<T> =>
      mediaFail(
        'capability-disabled',
        'Google Drive is not available in this build yet.',
      ) as MediaResult<T>;

    ipcMain.handle(
      IpcChannel.MediaConnectDrive,
      guard<[], MediaResult<DriveConnectionState>>(
        () => driveUnavailable<DriveConnectionState>(),
        () => driveUnavailable<DriveConnectionState>(),
      ),
    );
    ipcMain.handle(
      IpcChannel.MediaPickDriveFile,
      guard<[], MediaResult<SelectedMedia>>(
        () => driveUnavailable<SelectedMedia>(),
        () => driveUnavailable<SelectedMedia>(),
      ),
    );
    ipcMain.handle(
      IpcChannel.MediaDisconnectDrive,
      guard<[], MediaResult<void>>(
        () => driveUnavailable<void>(),
        () => driveUnavailable<void>(),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Local selection
  // -------------------------------------------------------------------------

  private async pickLocalFile(event: IpcMainInvokeEvent): Promise<MediaResult<SelectedMedia>> {
    if (!resolveCapabilities().localFiles) {
      return mediaFail('capability-disabled', 'Local file playback is not enabled in this build.');
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      return mediaFail('invalid-request', 'This request was refused.');
    }
    if (this.pickingWindows.has(window.id)) {
      return mediaFail('invalid-request', 'A file picker is already open.');
    }
    this.pickingWindows.add(window.id);

    try {
      // openFile only: no directories, no multi-select, no wildcard URL. The
      // dialog is the only way a path enters this process.
      const selection = await dialog.showOpenDialog(window, {
        title: 'Choose a video you own',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: 'Video', extensions: [...SUPPORTED_MEDIA_EXTENSIONS] }],
      });

      const selected = selection.filePaths[0];
      if (selection.canceled || selected === undefined) {
        // Cancelling is an ordinary outcome, not an exception.
        return mediaFail('cancelled', 'No file was selected.');
      }

      return await this.ingestLocalPath(selected, window.id);
    } catch {
      return mediaFail('internal', 'The file could not be opened.');
    } finally {
      this.pickingWindows.delete(window.id);
    }
  }

  /** Validate, fingerprint, and map an explicitly selected path. */
  private async ingestLocalPath(
    selectedPath: string,
    windowId: number,
  ): Promise<MediaResult<SelectedMedia>> {
    const resolved = path.resolve(selectedPath);
    const extension = path.extname(resolved).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (mimeType === undefined) {
      return mediaFail('unsupported-format', 'Only MP4 and WebM video files are supported.');
    }

    const title = normalizeMediaTitle(path.basename(resolved, extension));
    if (title === null) {
      return mediaFail('invalid-selection', 'That file name cannot be used as a title.');
    }

    const identity = await readFileIdentity(resolved);
    if (identity === null) {
      return mediaFail('file-missing', 'That file could not be read.');
    }
    if (identity.size === 0) {
      return mediaFail('invalid-selection', 'That file is empty.');
    }
    if (identity.size > maxMediaSizeBytes()) {
      // Refused outright: a truncated video is a corrupt video.
      return mediaFail('invalid-selection', 'That file is larger than this app supports.');
    }

    // Open it to prove it is readable — and never execute it.
    try {
      const handle = await open(resolved, 'r');
      await handle.close();
    } catch {
      return mediaFail('file-missing', 'That file could not be read.');
    }

    // A cached fingerprint is reusable only when path, size, and mtime all
    // still match. Anything else and we re-hash.
    const cached = this.store.findByPath(resolved);
    if (cached !== null && isMappingStillValid(cached, identity)) {
      return mediaOk(toSelectedMedia(cached));
    }

    const operationId = randomBytes(16).toString('hex');
    const controller = new AbortController();
    this.operations.set(operationId, { controller, windowId });

    try {
      const outcome = await fingerprintFile(resolved, identity.size, {
        signal: controller.signal,
        onProgress: (bytesHashed, totalBytes) => {
          const window = BrowserWindow.fromId(windowId);
          if (window !== null && !window.isDestroyed()) {
            window.webContents.send(IpcChannel.MediaFingerprintProgress, {
              operationId,
              bytesHashed,
              totalBytes,
            });
          }
        },
      });

      if (outcome.status === 'cancelled') {
        return mediaFail('cancelled', 'Preparing the file was cancelled.');
      }
      if (outcome.status === 'failed') {
        return mediaFail('fingerprint-failed', 'That file could not be prepared for playback.');
      }

      // Re-read identity: a file that changed while we hashed it has a
      // fingerprint that describes bytes nobody has.
      const after = await readFileIdentity(resolved);
      if (after === null) {
        return mediaFail('file-missing', 'That file could not be read.');
      }
      if (after.size !== identity.size || after.modifiedAtMs !== identity.modifiedAtMs) {
        return mediaFail('file-changed', 'That file changed while it was being prepared.');
      }

      const mapping: LocalMediaMapping = {
        localHandle: cached?.localHandle ?? randomBytes(16).toString('hex'),
        fingerprint: outcome.fingerprint,
        title,
        mimeType,
        size: identity.size,
        modifiedAtMs: identity.modifiedAtMs,
        path: resolved,
      };
      await this.store.put(mapping);
      return mediaOk(toSelectedMedia(mapping));
    } finally {
      this.operations.delete(operationId);
    }
  }

  /**
   * Find this device's own copy of a source someone else loaded.
   *
   * Fingerprint match only, then revalidate the file on disk. A stale mapping
   * pointing at changed bytes is invalidated rather than played.
   */
  private async resolveLocalMatch(value: unknown): Promise<MediaResult<SelectedMedia>> {
    if (!resolveCapabilities().localFiles) {
      return mediaFail('capability-disabled', 'Local file playback is not enabled in this build.');
    }
    const parsed = parseMediaSourceDescriptor(value, { maxSizeBytes: maxMediaSizeBytes() });
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.value.kind !== 'local') {
      return mediaFail('invalid-request', 'Only a local source can be matched on this device.');
    }
    const descriptor = parsed.value;

    const mapping = this.store.findByFingerprint(descriptor.fingerprint);
    if (mapping === null) {
      // Not an error: this participant simply has not chosen their copy yet.
      return mediaFail('file-missing', 'Choose your own copy of this video to watch along.');
    }

    const identity = await readFileIdentity(mapping.path);
    if (identity === null) {
      await this.store.remove(mapping.localHandle);
      return mediaFail('file-missing', 'Your copy of this video has moved or been removed.');
    }
    if (!isMappingStillValid(mapping, identity)) {
      await this.store.remove(mapping.localHandle);
      return mediaFail('file-changed', 'Your copy of this video has changed. Choose it again.');
    }
    if (mapping.size !== descriptor.size) {
      return mediaFail('source-mismatch', 'Your copy of this video does not match the host’s.');
    }

    return mediaOk(toSelectedMedia(mapping));
  }

  // -------------------------------------------------------------------------
  // Leases
  // -------------------------------------------------------------------------

  private async createPlaybackLease(
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<MediaResult<PlaybackLease>> {
    const capabilities = resolveCapabilities();
    if (!capabilities.htmlMedia) {
      return mediaFail('capability-disabled', 'Custom media playback is not enabled in this build.');
    }

    const parsed = parseMediaSourceDescriptor(value, { maxSizeBytes: maxMediaSizeBytes() });
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.value.kind === 'youtube') {
      return mediaFail('invalid-request', 'YouTube does not use a playback lease.');
    }
    const descriptor: HtmlMediaSourceDescriptor = parsed.value;

    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      return mediaFail('invalid-request', 'This request was refused.');
    }

    if (descriptor.kind === 'drive') {
      if (!capabilities.googleDrive) {
        return mediaFail('capability-disabled', 'Google Drive is not available in this build yet.');
      }
      // Unreachable while googleDrive is gated off; kept so the branch is
      // explicit rather than an accidental fallthrough into local handling.
      return mediaFail('capability-disabled', 'Google Drive is not available in this build yet.');
    }

    const mapping = this.store.findByFingerprint(descriptor.fingerprint);
    if (mapping === null) {
      return mediaFail('file-missing', 'Choose your own copy of this video to watch along.');
    }
    const identity = await readFileIdentity(mapping.path);
    if (identity === null) {
      await this.store.remove(mapping.localHandle);
      return mediaFail('file-missing', 'Your copy of this video has moved or been removed.');
    }
    if (!isMappingStillValid(mapping, identity)) {
      await this.store.remove(mapping.localHandle);
      return mediaFail('file-changed', 'Your copy of this video has changed. Choose it again.');
    }

    const lease = this.leases.create(descriptor, window.id, { localPath: mapping.path });
    // Never log the lease id or the URL — the id is the capability.
    logger.write('info', 'media', 'Issued a local playback lease');
    return mediaOk(lease);
  }

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  private registerProtocolHandler(): void {
    protocol.handle(MEDIA_STREAM_SCHEME, async (request) => this.handleStreamRequest(request));
  }

  /**
   * Serve one ranged read of one leased file.
   *
   * Everything about this handler is deliberately narrow: two methods, one URL
   * shape, no query string, one range. It is reachable from renderer content,
   * so anything it is willing to be talked into, it will eventually be talked
   * into.
   */
  async handleStreamRequest(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const leaseId = parsePlaybackUrl(request.url);
    if (leaseId === null) {
      return new Response(null, { status: 404 });
    }

    const record = this.leases.resolve(leaseId);
    if (record === null) {
      // Expired and unknown are the same answer: a probe learns nothing.
      return new Response(null, { status: 404 });
    }

    if (record.localPath === null) {
      return new Response(null, { status: 404 });
    }

    // Revalidate before every stream: the file may have changed since the
    // lease was issued, and a lease is not a promise that bytes stood still.
    const identity = await readFileIdentity(record.localPath);
    if (identity === null) {
      this.leases.release(leaseId);
      return new Response(null, { status: 404 });
    }
    // The bytes moved under the lease: the fingerprint the room agreed on no
    // longer describes this file, so it must not be served.
    if (identity.size !== record.descriptor.size) {
      this.leases.release(leaseId);
      return new Response(null, { status: 404 });
    }

    const size = identity.size;
    const mimeType = record.descriptor.mimeType;
    const parsedRange = parseByteRange(request.headers.get('range'), size);

    if (parsedRange.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${String(size)}`, 'Accept-Ranges': 'bytes' },
      });
    }

    if (parsedRange.kind === 'none') {
      const headers = {
        'Content-Type': mimeType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      };
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(streamFileRange(record.localPath, 0, size - 1), { status: 200, headers });
    }

    const { start, end } = parsedRange.range;
    const length = end - start + 1;
    const headers = {
      'Content-Type': mimeType,
      'Content-Length': String(length),
      'Content-Range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers });
    }
    return new Response(streamFileRange(record.localPath, start, end), { status: 206, headers });
  }
}

function toSelectedMedia(mapping: LocalMediaMapping): SelectedMedia {
  // Note what is not here: mapping.path. This is the shape the renderer sees.
  return {
    descriptor: {
      schemaVersion: 1,
      kind: 'local',
      fingerprint: mapping.fingerprint,
      title: mapping.title,
      mimeType: mapping.mimeType,
      size: mapping.size,
    },
    localHandle: mapping.localHandle,
  };
}

/**
 * A bounded stream over exactly the requested window of the file.
 *
 * `start`/`end` go to createReadStream rather than being sliced afterwards, so
 * a seek into the middle of a 20 GB film reads a few megabytes, not 20 GB.
 */
function streamFileRange(filePath: string, start: number, end: number): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath, { start, end });
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

/** Guard used by main: the sender must be a window we created. */
export function makeSenderValidator(
  isKnownWindow: (webContentsId: number) => boolean,
): (event: IpcMainInvokeEvent) => boolean {
  return (event) => {
    // A frame that navigated somewhere else is not our renderer any more.
    const url = event.senderFrame?.url ?? '';
    const isAppOrigin =
      url.startsWith('app://nightwatch/') ||
      url.startsWith('http://localhost:') ||
      url.startsWith('http://127.0.0.1:');
    return isKnownWindow(event.sender.id) && isAppOrigin;
  };
}

export type { MediaSourceDescriptor };
export { isMediaFingerprint };
