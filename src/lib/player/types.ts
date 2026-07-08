/** Normalized playback states, mapped from the IFrame API's numeric codes. */
export type PlayerState =
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued';

export function toPlayerState(ytState: number): PlayerState {
  switch (ytState) {
    case 0:
      return 'ended';
    case 1:
      return 'playing';
    case 2:
      return 'paused';
    case 3:
      return 'buffering';
    case 5:
      return 'cued';
    default:
      return 'unstarted';
  }
}

/** Human-readable messages for IFrame API error codes. */
export function playerErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'Invalid video id.';
    case 5:
      return 'This video cannot be played in the embedded player.';
    case 100:
      return 'Video not found (removed or private).';
    case 101:
    case 150:
      return 'The video owner does not allow embedding.';
    default:
      return `Playback error (code ${code}).`;
  }
}

export interface PlayerEvents {
  onReady?(): void;
  onStateChange?(state: PlayerState): void;
  onError?(message: string): void;
}
