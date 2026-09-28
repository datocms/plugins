export type UnloadTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
>;

function preventUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  // Older browsers only prompt when `returnValue` is set.
  event.returnValue = '';
}

/**
 * Asks before the tab closes while records are being written. Navigating
 * inside the dashboard removes the iframe and can't be blocked, so the page
 * also says "Keep this page open".
 */
export class UnloadGuard {
  private guarded = false;

  constructor(private readonly target: UnloadTarget | null) {}

  set(on: boolean): void {
    if (!this.target || on === this.guarded) return;
    this.guarded = on;
    if (on) this.target.addEventListener('beforeunload', preventUnload);
    else this.target.removeEventListener('beforeunload', preventUnload);
  }
}
