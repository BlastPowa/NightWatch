# Phase 37 Drive Workspace Backend Checkpoint

Date: 2026-07-28  
Branch: `backend/phase-37-drive-workspace`

## Delivered

- Main-process-only `DriveWorkspaceService` for listing the app-created
  **NightWatch Shared** folder, navigating folders returned by that workspace,
  creating tagged child folders, and running resumable MP4/WebM uploads.
- Explicit folder authorization via a fresh, sandboxed Google Picker window.
  There is no free-form folder id API and no whole-Drive browser.
- Named IPC/preload/platform bridge methods for list, create, authorize,
  upload, cancel, and upload-progress. OAuth tokens, raw provider responses,
  native paths, resumable session URLs, and file bytes never reach the
  renderer or Supabase.
- Folder/item metadata is normalized through `shared/driveWorkspaceContracts`.
  Traversal to arbitrary Drive ids is refused unless the folder was returned
  under the authorized workspace in the current session or explicitly selected
  through Picker.
- Uploads use the connected user's own Google Drive storage and quota. They
  are cancellable and only report opaque upload ids plus byte counts.

## Required owner setup

No Supabase migration or Edge Function deployment is required for this desktop
checkpoint. Configure Google Cloud for the same Desktop OAuth client used by
Drive connection:

- Enable **Google Drive API** and **Google Picker API**.
- Set `NIGHTWATCH_ENABLE_DRIVE=1`, `NIGHTWATCH_GOOGLE_CLIENT_ID`,
  `NIGHTWATCH_GOOGLE_PICKER_API_KEY`, and `NIGHTWATCH_GOOGLE_APP_ID`.
- Keep the narrow `https://www.googleapis.com/auth/drive.file` scope. Do not
  add `drive.readonly` or any whole-Drive scope.
- Each viewer must be granted Google Drive permission to the same file/folder;
  a NightWatch room or copied folder link never bypasses Google sharing.

## Remaining Phase 37 work

The backend bridge is ready, but the renderer still needs a Library workspace
screen wired to these methods: breadcrumbs, grid/list, refresh, create folder,
Picker authorization, upload progress/cancel, sorting, and error states.
Owner-private collections/progress metadata remains a later persistence phase.

## Validation

- `npm run typecheck` — passed.
- Focused Drive tests — 68 passed:
  `driveAuth`, `driveManager`, `driveWorkspace`,
  `driveWorkspaceService`, and `driveWorkspaceContracts`.

## Security boundaries retained

- No full-Drive browsing, raw path/token IPC, media relay, YouTube download,
  DRM bypass, or silent sharing grants.
- Room events still carry descriptors/state only; every participant streams
  directly from their own authorized Drive access.
