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

  // Global typewriter: scramble random ASCII chars, then reveal real text
  function initTypewriter() {
    var reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var skipSelector = 'pre, code, script, style, noscript, textarea, svg, ' +
      '.katex, .MathJax, mjx-container, .mermaid, [data-no-typewriter]';
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

  // Initialize all
  document.addEventListener('DOMContentLoaded', function () {
    initLazyload();
    initMenuHover();
    initCursors();
    initKeyboard();
    initCodeCopy();
    initFootnote();
    initScanlineToggle();
    initClock();
    initBackToTop();
    initTypewriter();
  });
})();
