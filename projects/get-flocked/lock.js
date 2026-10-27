/**
 * lock.js — the face-lock state machine.
 *
 * Face lock is the state where the detector sees a face. It is *lost* when a
 * face that was being seen stops being seen; the loss is what schedules a
 * lock file into the playlist.
 *
 * Three rules shape the behaviour, all of them from the spec:
 *
 *  - The first loss queues lock1.wav, the second and third queue lock2.wav.
 *    The file is picked by the loss count, so the counter and the queue
 *    cannot drift apart.
 *  - Losses are debounced: at most one injection per debounce window. A
 *    face that flickers in and out of frame would otherwise queue every
 *    lock file at once. A debounced loss is dropped entirely -- it neither
 *    injects nor counts, so the three available injections stay available.
 *  - The fallback track forces an injection if nothing was lost yet, and
 *    counts as one loss so the next real loss still produces the second
 *    lock file.
 */

export class FaceLock {
  /**
   * @param {object} options
   * @param {string[]} options.lockFiles  file names by loss count
   * @param {number} options.debounceMs   dead time after an injection
   * @param {() => number} [options.now]  clock, injectable for tests
   */
  constructor({ lockFiles, debounceMs, now = () => Date.now() }) {
    this.lockFiles = lockFiles;
    this.debounceMs = debounceMs;
    this.now = now;
    this.locked = false;
    this.losses = 0;
    this.lastInjectionAt = -Infinity;
  }

  /**
   * Feed the detector's current state.
   *
   * @param {boolean} isLocked  whether a face is being seen right now
   * @returns {string|null} the file to queue, or null if nothing happened
   */
  update(isLocked) {
    if (isLocked) {
      this.locked = true;
      return null;
    }
    // Not locked and not previously locked: the face was never seen, so
    // there is no lock to lose.
    if (!this.locked) return null;
    this.locked = false;
    return this.registerLoss();
  }

  /**
   * Count a loss and pick its lock file.
   *
   * @returns {string|null} the file to queue, or null if it was debounced
   */
  registerLoss() {
    const at = this.now();
    if (at - this.lastInjectionAt < this.debounceMs) return null;
    this.losses += 1;
    const file = this.lockFiles[this.losses - 1];
    if (!file) return null; // out of lock files: the loss still counted
    this.lastInjectionAt = at;
    return file;
  }

  /**
   * The fallback: force an injection when the fallback track comes up and
   * the face has never been lost.
   *
   * @returns {string|null} the file to queue, or null if not applicable
   */
  fallback() {
    if (this.losses > 0) return null;
    this.losses = 1;
    this.lastInjectionAt = this.now();
    return this.lockFiles[0] ?? null;
  }
}
