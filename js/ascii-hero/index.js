/**
 * index.js — entry point for the ASCII hero.
 *
 * Idempotent and side-effect free on pages without the hero. Sets
 * window.__ASCII_HERO__ (the controller), window.__ASCII_HERO_READY__, and
 * dispatches 'ascii-hero:ready' on the root for the e2e harness.
 */

import { mountAsciiHero } from './app.js';

function mount() {
  if (window.__ASCII_HERO__) return; // already mounted
  const root = document.querySelector('[data-ascii-hero]');
  if (!root) return; // not on this page: nothing to do

  let options = {};
  try {
    const raw = window.__ASCII_HERO_OPTIONS__;
    if (raw && typeof raw === 'object') options = raw;
  } catch {
    options = {};
  }

  let controller = null;
  try {
    controller = mountAsciiHero(root, options);
  } catch {
    const status = root.querySelector('[data-ascii-status]');
    if (status) status.textContent = 'The ASCII hero could not start.';
    root.classList.add('is-error');
  }

  if (controller) window.__ASCII_HERO__ = controller;
  window.__ASCII_HERO_READY__ = true;
  try {
    root.dispatchEvent(new CustomEvent('ascii-hero:ready'));
  } catch {
    /* CustomEvent is available everywhere we support; ignore exotic failures */
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
