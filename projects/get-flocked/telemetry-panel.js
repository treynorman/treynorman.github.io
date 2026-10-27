/**
 * telemetry-panel.js — the on-screen readout.
 *
 * The first line is fixed and bold: how long the capture took. The lines
 * under it scroll slowly upward inside a window.
 *
 * The window is sized by the stylesheet, which gives the block the space
 * the design calls for: on a phone held upright the top half of the screen
 * and the left third of the width, and on a wide screen the top fifth and
 * the full width.
 *
 * The text is the same red as the face circle and the pupil markers, in a
 * sans-serif face, sized in rem so it scales with the browser's font
 * setting.
 *
 * The scrolling never stops and never jumps. The text is repeated enough
 * times to fill the window, and when one copy has scrolled past, the copy
 * behind it is in exactly the same place -- so the first line comes round
 * again, and then the second, and so on, without a seam.
 */

import { buildTelemetry } from './telemetry-text.js';
import { TELEMETRY } from './config.js';

export class TelemetryPanel {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root  the element to build the readout in
   * @param {number} [options.scrollSpeed]  pixels per second
   */
  constructor({ root, scrollSpeed = TELEMETRY.scrollSpeed } = {}) {
    this.root = root;
    this.scrollSpeed = scrollSpeed;
    this.timer = null;
    this.onResize = null;
  }

  /**
   * Show the capture.
   *
   * @param {object} capture  the result of captureFingerprint()
   */
  show(capture) {
    const { header, lines } = buildTelemetry(capture);

    this.root.innerHTML = '';
    this.root.classList.add('telemetry');

    const heading = document.createElement('div');
    heading.className = 'telemetry-header';
    heading.textContent = header;
    this.root.appendChild(heading);

    // The window the text scrolls in.
    const viewport = document.createElement('div');
    viewport.className = 'telemetry-viewport';

    // The text itself, which moves.
    const content = document.createElement('div');
    content.className = 'telemetry-content';

    // One copy of the lines. It is repeated below, so the scroll can run
    // forever without ever showing a gap.
    const block = document.createElement('div');
    block.className = 'telemetry-block';
    for (const line of lines) {
      const label = document.createElement('div');
      label.className = 'telemetry-label';
      label.textContent = `${line.label}:`;
      const value = document.createElement('div');
      value.className = 'telemetry-value';
      value.textContent = line.value;
      block.appendChild(label);
      block.appendChild(value);
    }
    content.appendChild(block);

    viewport.appendChild(content);
    this.root.appendChild(viewport);

    this.fill(content, block, viewport);
    this.startScrolling(content, block, viewport);

    // The window can change size -- a phone turned on its side, say -- and
    // then more copies may be needed to fill it.
    this.onResize = () => this.fill(content, block, viewport);
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Make sure there is enough text to scroll through.
   *
   * The copies have to cover the window plus one more copy's worth, so
   * that the moment the first copy leaves the top, the second is already
   * where the first was.
   *
   * @param {HTMLElement} content
   * @param {HTMLElement} block  one copy of the lines
   * @param {HTMLElement} viewport
   */
  fill(content, block, viewport) {
    const blockHeight = block.offsetHeight;
    if (!blockHeight) return;

    const needed = Math.ceil(viewport.offsetHeight / blockHeight) + 1;
    const have = content.childElementCount;

    for (let i = have; i < needed; i++) {
      content.appendChild(block.cloneNode(true));
    }
    for (let i = content.childElementCount - 1; i >= needed; i--) {
      content.removeChild(content.lastElementChild);
    }
  }

  /**
   * Scroll the text upward, slowly and without a seam.
   *
   * The text is moved with a transform on a timer rather than a CSS
   * animation, so the speed stays the same however long the content is.
   *
   * The offset grows for ever, but the text is only ever moved by one
   * copy's height. After that the offset is taken back by one copy's
   * height, which puts the text exactly where it was -- because the copy
   * that follows is the same text again.
   *
   * @param {HTMLElement} content
   * @param {HTMLElement} block  one copy of the lines
   * @param {HTMLElement} viewport
   */
  startScrolling(content, block, viewport) {
    this.stopScrolling();

    const blockHeight = block.offsetHeight;
    if (!blockHeight) return;

    let offset = 0;
    this.timer = setInterval(() => {
      offset += this.scrollSpeed / 10; // the timer runs every 100ms

      // Once the first copy has gone past, start again at the top of the
      // copy. The copy underneath is the same text, so the text lands
      // exactly where it was, with no seam and no jump.
      offset %= blockHeight;

      content.style.transform = `translateY(${-offset}px)`;
    }, 100);
  }

  /** Stop the scrolling. */
  stopScrolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.onResize) {
      window.removeEventListener('resize', this.onResize);
      this.onResize = null;
    }
  }
}
