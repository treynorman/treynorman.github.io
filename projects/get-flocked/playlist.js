/**
 * playlist.js — the queue of tracks to play.
 *
 * The playlist is an ordered list. The cursor points at the track that was
 * taken last; an injected track goes in right after the one that is
 * playing, so the queue is "audio1, audio2, [lock1], audio3, ..." while
 * audio2 is playing.
 *
 * The insertion point is worked out from the track that is *playing*, not
 * from the cursor. The player takes the next track and then waits for its
 * buffer, and a lock file queued during that wait belongs after the track
 * that is playing, not after the one that has not started yet.
 *
 * Several injections during the same track keep their order: the second
 * one lands after the first, not before it.
 *
 * The queue ends with the playlist it was given. An injected track is meant
 * to be played between two clips, so an injection that would land past the
 * last clip is refused.
 */

export class Playlist {
  constructor() {
    this.items = [];
    this.cursor = -1;
    /** The track that is playing right now, or null. */
    this.playing = null;
  }

  /**
   * Replace the queue.
   *
   * @param {object[]} items  tracks, each `{name, buffer}`
   */
  set(items) {
    this.items = items.slice();
    this.cursor = -1;
    this.playing = null;
  }

  /** The track that is playing, or null. */
  get current() {
    return this.playing;
  }

  /** The tracks still to come, injected ones included. */
  get upcoming() {
    return this.items.slice(this.cursor + 1);
  }

  /**
   * Advance to the next track.
   *
   * @returns {object|null} the track to play, or null at the end
   */
  next() {
    if (this.cursor + 1 >= this.items.length) return null;
    this.cursor += 1;
    return this.items[this.cursor];
  }

  /**
   * Note that a track has started playing.
   */
  startPlaying(track) {
    this.playing = track;
  }

  /**
   * Note that a track has finished.
   */
  stopPlaying(track) {
    if (this.playing === track) this.playing = null;
  }

  /**
   * Where an injected track goes.
   *
   * Right after the track that is playing. When nothing is playing -- the
   * gap between one track ending and the next starting -- it goes after
   * the track that is about to play, so it is never left stranded at the
   * end of the queue.
   *
   * @returns {number} the index to insert at
   */
  insertionPoint() {
    if (this.playing) {
      const index = this.items.indexOf(this.playing);
      if (index !== -1) return index + 1;
    }
    return this.cursor + 1;
  }

  /**
   * The index of the last track that was in the original queue.
   *
   * Injected tracks do not count: they are meant to be played *between*
   * the original tracks, not after the end of them.
   *
   * @returns {number} the index, or -1 if the queue is empty
   */
  lastOriginalIndex() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].injected) return i;
    }
    return -1;
  }

  /**
   * Queue a track right after the one that is playing.
   *
   * The queue ends with the playlist it was given: nothing is put after
   * the last track, so an injected track never plays on its own at the end.
   *
   * @param {object} item  the track to insert
   * @returns {boolean}  true if it was queued, false if it was not
   */
  injectAfterCurrent(item) {
    let at = this.insertionPoint();
    // Keep injections in order: a second one lands after the first.
    while (at < this.items.length && this.items[at].injected) at++;

    // Refuse anything that would land past the last track of the queue.
    if (at > this.lastOriginalIndex()) return false;

    item.injected = true;
    this.items.splice(at, 0, item);
    return true;
  }
}
