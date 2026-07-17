/**
 * Local Search Script for Terminal Theme
 */

(function () {
  'use strict';

  var searchBtn = document.getElementById('search-btn');
  var searchPanel = document.getElementById('terminal-search');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');
  var searchClose = document.getElementById('search-close');

  if (!searchBtn || !searchPanel || !searchInput || !searchResults) return;

  var searchPath = '/search.xml';
  var searchCache = null;
  var isSearching = false;

  // Open search
  function openSearch() {
    searchPanel.classList.add('is-visible');
    searchPanel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    searchInput.focus();
  }

  // Close search
  function closeSearch() {
    searchPanel.classList.remove('is-visible');
    searchPanel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    searchInput.value = '';
    searchResults.innerHTML = '<p class="terminal-search__empty">type keywords to search...</p>';
  }

  // Load search data
  function loadSearchData(callback) {
    if (searchCache) {
      callback(searchCache);
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', searchPath, true);
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 400) {
        var parser = new DOMParser();
        var xmlDoc = parser.parseFromString(xhr.responseText, 'text/xml');
        var entries = xmlDoc.getElementsByTagName('entry');
        var data = [];

        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var title = entry.getElementsByTagName('title')[0]?.textContent || '';
          var url = entry.getElementsByTagName('url')[0]?.textContent || '';
          var content = entry.getElementsByTagName('content')[0]?.textContent || '';

          data.push({
            title: title,
            url: url,
            content: content.replace(/\s+/g, ' ').trim()
          });
        }

        searchCache = data;
        callback(data);
      }
    };
    xhr.send();
  }

  // Perform search
  function performSearch(keyword) {
    keyword = keyword.trim().toLowerCase();

    if (!keyword) {
      searchResults.innerHTML = '<p class="terminal-search__empty">type keywords to search...</p>';
      return;
    }

    loadSearchData(function (data) {
      var results = [];
      var keywords = keyword.split(/\s+/).filter(Boolean);

      data.forEach(function (item) {
        var title = item.title.toLowerCase();
        var content = item.content.toLowerCase();

        var matched = keywords.every(function (kw) {
          return title.includes(kw) || content.includes(kw);
        });

        if (matched) {
          results.push(item);
        }
      });

      renderResults(results, keywords);
    });
  }

  // Highlight keywords
  function highlight(text, keywords) {
    var result = text;
    keywords.forEach(function (kw) {
      var regex = new RegExp('(' + escapeRegex(kw) + ')', 'gi');
      result = result.replace(regex, '<mark>$1</mark>');
    });
    return result;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Render results
  function renderResults(results, keywords) {
    if (!results.length) {
      searchResults.innerHTML = '<p class="terminal-search__empty">no results found.</p>';
      return;
    }

    var html = '<ul class="terminal-search__list">';

    results.slice(0, 15).forEach(function (item) {
      var title = highlight(escapeHtml(item.title), keywords);
      var excerpt = item.content.substring(0, 120);
      excerpt = highlight(escapeHtml(excerpt), keywords);

      html += '<li class="terminal-search__item">';
      html += '<a href="' + escapeHtml(item.url) + '">';
      html += '<span class="terminal-search__item-title">[' + title + ']</span>';
      html += '<span class="terminal-search__item-excerpt">' + excerpt + '...</span>';
      html += '</a>';
      html += '</li>';
    });

    html += '</ul>';
    searchResults.innerHTML = html;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Event listeners
  searchBtn.addEventListener('click', openSearch);

  searchClose.addEventListener('click', closeSearch);

  searchPanel.addEventListener('click', function (e) {
    if (e.target === searchPanel) {
      closeSearch();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeSearch();
    }
    // Ctrl/Cmd + K to open search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  // Input with debounce
  var debounceTimer = null;
  searchInput.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      performSearch(searchInput.value);
    }, 200);
  });
})();