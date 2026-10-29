/**
 * Terminal Theme Main JavaScript
 */

(function () {
  'use strict';

  // Lazyload: add loading="lazy" to all images
  function initLazyload() {
    var images = document.querySelectorAll('img:not([loading])');
    images.forEach(function (img) {
      img.setAttribute('loading', 'lazy');
      img.classList.add('terminal-lazy');
    });
  }

  // Simulate command execution effect on menu hover
  function initMenuHover() {
    var menuLinks = document.querySelectorAll('.terminal-menu__link');
    menuLinks.forEach(function (link) {
      var cmdSpan = link.querySelector('.terminal-cmd');
      if (!cmdSpan) return;

      var originalText = cmdSpan.textContent;
      var hoverText = originalText + '_';

      link.addEventListener('mouseenter', function () {
        cmdSpan.textContent = hoverText;
      });
      link.addEventListener('mouseleave', function () {
        cmdSpan.textContent = originalText;
      });
    });
  }

  // Add blinking cursor to active prompts
  function initCursors() {
    var prompts = document.querySelectorAll('.terminal-post-item__read-more, .terminal-footer');
    prompts.forEach(function (el) {
      if (!el.querySelector('.terminal-cursor')) {
        var cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        el.appendChild(cursor);
      }
    });
  }

  // Keyboard shortcuts
  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'h' && !isInputActive()) {
        var homeLink = document.querySelector('a[href="/"]');
        if (homeLink && !e.ctrlKey && !e.metaKey && !e.altKey) {
          window.location.href = homeLink.href;
        }
      }
      if (e.key === 'a' && !isInputActive()) {
        var archiveLink = document.querySelector('a[href="/archives"]');
        if (archiveLink && !e.ctrlKey && !e.metaKey && !e.altKey) {
          window.location.href = archiveLink.href;
        }
      }
    });

    function isInputActive() {
      var tag = document.activeElement.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    }
  }

  // Add copy button + language label to code blocks
  function initCodeCopy() {
    var langMap = {
      js: 'JavaScript',
      javascript: 'JavaScript',
      ts: 'TypeScript',
      typescript: 'TypeScript',
      html: 'HTML',
      css: 'CSS',
      stylus: 'Stylus',
      scss: 'SCSS',
      less: 'Less',
      json: 'JSON',
      yml: 'YAML',
      yaml: 'YAML',
      md: 'Markdown',
      markdown: 'Markdown',
      python: 'Python',
      py: 'Python',
      bash: 'Bash',
      sh: 'Shell',
      shell: 'Shell',
      go: 'Go',
      golang: 'Go',
      rust: 'Rust',
      rs: 'Rust',
      java: 'Java',
      c: 'C',
      cpp: 'C++',
      'c++': 'C++',
      cs: 'C#',
      csharp: 'C#',
      php: 'PHP',
      ruby: 'Ruby',
      rb: 'Ruby',
      swift: 'Swift',
      kotlin: 'Kotlin',
      kt: 'Kotlin',
      sql: 'SQL',
      xml: 'XML',
      vue: 'Vue',
      svelte: 'Svelte',
      dockerfile: 'Dockerfile',
      makefile: 'Makefile',
      diff: 'Diff',
      plain: 'Plain Text',
      text: 'Plain Text'
    };

    var figures = document.querySelectorAll('figure.highlight, div.highlight');
    figures.forEach(function (figure) {
      var lang = '';
      var classList = figure.className.split(/\s+/);
      for (var i = 0; i < classList.length; i++) {
        var cls = classList[i];
        if (cls === 'highlight') continue;
        if (langMap[cls]) {
          lang = langMap[cls];
          break;
        }
        if (cls && cls.length < 10 && /^[a-z+]+$/.test(cls)) {
          lang = cls.toUpperCase();
          break;
        }
      }

      if (lang) {
        var label = document.createElement('span');
        label.className = 'terminal-code-lang';
        label.textContent = lang;
        figure.appendChild(label);
      }

      var btn = document.createElement('button');
      btn.className = 'terminal-copy-btn';
      btn.textContent = '[copy]';
      btn.setAttribute('aria-label', 'Copy code');

      btn.addEventListener('click', function () {
        var code = figure.querySelector('code') || figure.querySelector('pre');
        if (!code) return;

        var text = code.textContent || '';
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = '[ok]';
            setTimeout(function () {
              btn.textContent = '[copy]';
            }, 1500);
          });
        } else {
          var textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            btn.textContent = '[ok]';
            setTimeout(function () {
              btn.textContent = '[copy]';
            }, 1500);
          } catch (err) {
            // ignore
          }
          document.body.removeChild(textarea);
        }
      });

      figure.style.position = 'relative';
      figure.appendChild(btn);
    });
  }

  // Footnote: scroll smoothly to footnote definition
  function initFootnote() {
    document.querySelectorAll('a.footnote-ref, sup.footnote-ref a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = link.getAttribute('href') || '';
        if (id.startsWith('#')) {
          var target = document.querySelector(id);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('footnote-highlight');
            setTimeout(function () {
              target.classList.remove('footnote-highlight');
            }, 1500);
          }
        }
      });
    });

    // Back-link to footnote reference
    document.querySelectorAll('a.footnote-backref').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  // Scanline animation toggle (double-click background)
  function initScanlineToggle() {
    document.addEventListener('dblclick', function (e) {
      if (e.target === document.body || e.target.classList.contains('terminal-container')) {
        document.documentElement.classList.toggle('no-scanline');
      }
    });
  }

  // Clock - 24-hour format [HH:MM:SS]
  function initClock() {
    var clockEl = document.getElementById('terminal-clock');
    if (!clockEl) return;

    function updateClock() {
      var now = new Date();
      var h = String(now.getHours()).padStart(2, '0');
      var m = String(now.getMinutes()).padStart(2, '0');
      var s = String(now.getSeconds()).padStart(2, '0');
      clockEl.textContent = '[' + h + ':' + m + ':' + s + ']';
    }

    updateClock();
    setInterval(updateClock, 1000);
  }

  // Back to top button
  function initBackToTop() {
    var btn = document.getElementById('back-to-top');
    if (!btn) return;

    function toggleVisibility() {
      if (window.scrollY > 300) {
        btn.classList.add('is-visible');
      } else {
        btn.classList.remove('is-visible');
      }
    }

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', toggleVisibility, { passive: true });
    toggleVisibility();
  }

  // Keep the --header-height CSS variable in sync with the sticky top bar so the
  // floating TOC and in-page anchor targets stay clear of it.
  function syncHeaderHeight() {
    var header = document.querySelector('.terminal-header');
    if (!header) return;
    var height = Math.ceil(header.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--header-height', height + 'px');
    }
  }

  // Viewport distance visually covered by the sticky header (plus a small gap).
  function headerOffset() {
    var height = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--header-height')
    );
    return (isNaN(height) ? 0 : height) + 16;
  }

  function initHeaderOffset() {
    syncHeaderHeight();

    var header = document.querySelector('.terminal-header');
    if (header && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncHeaderHeight).observe(header);
    }
    window.addEventListener('resize', syncHeaderHeight);

    // Web fonts swap in after DOMContentLoaded and can change the header height.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncHeaderHeight);
    }

    // A deep link is resolved before the header height is known; re-align it now.
    if (location.hash.length > 1) {
      var id;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch (e) {
        id = location.hash.slice(1);
      }
      var target = document.getElementById(id);
      if (target) target.scrollIntoView();
    }
  }

  // TOC: collapsible + scroll spy
  function initToc() {
    var toc = document.getElementById('terminal-toc');
    if (!toc) return;

    // Toggle collapse/expand
    var toggle = document.getElementById('toc-toggle');
    if (toggle) {
      // Restore saved state
      var saved = localStorage.getItem('toc-collapsed') === 'true';
      if (saved) {
        toc.setAttribute('data-collapsed', 'true');
        toggle.textContent = '[+]';
      }

      toggle.addEventListener('click', function () {
        var collapsed = toc.getAttribute('data-collapsed') === 'true';
        toc.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
        toggle.textContent = collapsed ? '[-]' : '[+]';
        localStorage.setItem('toc-collapsed', !collapsed);
      });
    }

    // Scroll spy: highlight current heading
    var headings = document.querySelectorAll('.terminal-post-content h2, .terminal-post-content h3');
    if (!headings.length) return;

    var tocLinks = toc.querySelectorAll('a');
    var linkMap = {};
    tocLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        linkMap[decodeURIComponent(href.slice(1))] = link;
      }
    });

    function updateActiveToc() {
      // A heading counts as current once it has scrolled up behind the sticky header.
      // The small tolerance keeps the heading you just jumped to active: the browser
      // rounds the scroll position and scroll-margin-top to different subpixels.
      var threshold = headerOffset() + 2;
      var current = null;
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].getBoundingClientRect().top <= threshold) {
          current = headings[i];
        } else {
          break;
        }
      }
      tocLinks.forEach(function (l) { l.classList.remove('is-active'); });
      if (current && linkMap[current.id]) {
        linkMap[current.id].classList.add('is-active');
      }
    }

    window.addEventListener('scroll', updateActiveToc, { passive: true });
    updateActiveToc();
  }

  // Global typewriter: scramble random ASCII chars, then reveal real text
  function initTypewriter() {
    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var skipSelector = 'pre, code, script, style, noscript, textarea, svg, ' +
      '.katex, .MathJax, mjx-container, .mermaid, .terminal-comments, ' +
      '.gt-container, [data-no-typewriter]';
    var mathRe = /\$\$|\$[^$\n]+\$|\\\(|\\\[|\\begin\{/;

    var nodes = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      if (mathRe.test(node.nodeValue)) continue;
      var parent = node.parentElement;
      if (!parent || parent.closest(skipSelector)) continue;
      nodes.push(node);
    }
    if (!nodes.length || reduceMotion) return;

    var POOL = '!<>-_\\/[]{}=+*^?#%&@$~';
    var items = nodes.map(function (textNode, index) {
      var text = textNode.nodeValue;
      var span = document.createElement('span');
      span.setAttribute('data-typewriter', '');
      span.textContent = text;
      textNode.parentNode.replaceChild(span, textNode);
      return {
        el: span,
        text: text,
        delay: Math.min(index * 12, 1200),
        started: false,
        done: false
      };
    });

    var start = null;
    function frame(now) {
      if (start === null) start = now;
      var elapsed = now - start;
      var pending = false;

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.done) continue;
        if (elapsed < it.delay) {
          pending = true;
          continue;
        }
        if (!it.started) {
          it.started = true;
          it.el.setAttribute('data-typed', '');
        }
        var revealed = Math.floor((elapsed - it.delay) / 10);
        if (revealed >= it.text.length) {
          it.el.textContent = it.text;
          it.done = true;
          continue;
        }
        var out = it.text.slice(0, revealed);
        for (var j = revealed; j < it.text.length; j++) {
          out += it.text[j] === ' ' ? ' ' : POOL[(Math.random() * POOL.length) | 0];
        }
        it.el.textContent = out;
        pending = true;
      }

      if (pending) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Colour-scheme switcher: the theme ships eight terminal palettes; the
  // button cycles through them and remembers the choice for the next visit.
  function initThemeSwitcher() {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;

    var schemes = ['green', 'amber', 'white', 'blue', 'purple', 'red', 'orange', 'teal'];
    var root = document.documentElement;

    function current() {
      var name = (root.getAttribute('data-theme') || 'green').toLowerCase();
      return schemes.indexOf(name) === -1 ? 'green' : name;
    }

    function paint() {
      btn.textContent = '[theme]';
      btn.title = '配色方案：' + current() + '（点击切换）';
    }

    btn.addEventListener('click', function () {
      var next = schemes[(schemes.indexOf(current()) + 1) % schemes.length];
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('terminal-theme', next);
      } catch (e) { /* private mode */ }
      paint();
    });

    paint();
  }

  // Terminal CJK grid ------------------------------------------------------
  // Source Code Pro advances 0.6em per Latin cell, while a CJK/fullwidth glyph
  // is 1em wide — i.e. 1.67 cells, which breaks the column grid as soon as a
  // line mixes Chinese and Latin. Wrapping every CJK run in <span class="cjk">
  // makes each wide glyph advance exactly 1.2em = 2 cells (see the .cjk rule
  // in _base.styl), matching how a terminal lays out East Asian text.
  // Runs after the deferred KaTeX scripts have rendered (DOMContentLoaded).
  var CJK_WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
  var CJK_RUN = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]+/g;
  var CJK_SKIP = 'script, style, noscript, textarea, input, select, option, svg, ' +
    'canvas, .katex, .MathJax, mjx-container, #gitalk-container, .gt-container';

  function wrapCjk(root) {
    if (!root || !document.createTreeWalker) return;

    function isInsideSkipped(node) {
      var parent = node.parentElement;
      return !!(parent && parent.closest && parent.closest(CJK_SKIP));
    }

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !CJK_WIDE.test(node.nodeValue)) continue;
      if (isInsideSkipped(node)) continue;
      nodes.push(node);
    }

    nodes.forEach(function (textNode) {
      var text = textNode.nodeValue;
      var frag = document.createDocumentFragment();
      var cursor = 0;
      var match;
      CJK_RUN.lastIndex = 0;
      while ((match = CJK_RUN.exec(text))) {
        if (match.index > cursor) {
          frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }
        var span = document.createElement('span');
        span.className = 'cjk';
        span.textContent = match[0];
        frag.appendChild(span);
        cursor = match.index + match[0].length;
      }
      if (!cursor) return;
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function initCjkGrid() {
    if (document.documentElement.getAttribute('data-cjk-grid') !== 'true') return;
    if (!document.body) return;
    wrapCjk(document.body);
    // Let theme-owned dynamic content (search results) reuse the same wrap.
    window.__cjkGridWrap = wrapCjk;
  }

  // Initialize all
  document.addEventListener('DOMContentLoaded', function () {
    initCjkGrid();
    initLazyload();
    initMenuHover();
    initCursors();
    initKeyboard();
    initCodeCopy();
    initFootnote();
    initScanlineToggle();
    initClock();
    initBackToTop();
    initHeaderOffset();
    initToc();
    initThemeSwitcher();
    initTypewriter();
  });
})();
