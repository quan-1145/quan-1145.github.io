(function () {
    'use strict';

    // ==================== 回到顶部 ====================
    function initBackToTop() {
        var btn = document.getElementById('back-to-top');
        if (!btn) return;

        var showFlag = false;
        window.addEventListener('scroll', function () {
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if (scrollTop > 300 && !showFlag) {
                btn.classList.add('show');
                showFlag = true;
            } else if (scrollTop <= 300 && showFlag) {
                btn.classList.remove('show');
                showFlag = false;
            }
        });

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ==================== 主题切换 (Light/Dark) ====================
    function initThemeToggle() {
        var btn = document.getElementById('theme-toggle');
        var html = document.documentElement;
        var STORAGE_KEY = 'theme-mode';

        // 读取本地存储的主题
        var stored = '';
        try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) {}

        // 确定初始主题
        var theme = stored || html.getAttribute('data-theme') || 'light';
        if (theme === 'auto') {
            theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
        }
        html.setAttribute('data-theme', theme);

        // 切换按钮
        if (btn) {
            btn.addEventListener('click', function () {
                var current = html.getAttribute('data-theme');
                var newTheme = current === 'dark' ? 'light' : 'dark';
                html.setAttribute('data-theme', newTheme);
                try { localStorage.setItem(STORAGE_KEY, newTheme); } catch (e) {}
            });
        }

        // 监听系统主题变化 (仅当用户未手动选择时)
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
                try {
                    if (!localStorage.getItem(STORAGE_KEY)) {
                        html.setAttribute('data-theme', e.matches ? 'dark' : 'light');
                    }
                } catch (err) {}
            });
        }
    }

    // ==================== 移动端菜单切换 ====================
    function initMobileMenu() {
        var toggle = document.getElementById('menu-toggle');
        var nav = document.getElementById('header-nav');
        if (!toggle || !nav) return;

        toggle.addEventListener('click', function () {
            var open = nav.classList.toggle('open');
            toggle.classList.toggle('active');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        // 点击菜单项后关闭移动端菜单
        nav.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                if (window.innerWidth <= 768) {
                    nav.classList.remove('open');
                    toggle.classList.remove('active');
                }
            });
        });
    }

    // ==================== More 下拉菜单 ====================
    function initDropdown() {
        var more = document.getElementById('nav-more');
        if (!more) return;

        var trigger = more.querySelector('.nav-dropdown-trigger');
        if (!trigger) return;

        // 点击触发
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            more.classList.toggle('open');
        });

        // 点击外部关闭
        document.addEventListener('click', function (e) {
            if (!more.contains(e.target)) {
                more.classList.remove('open');
            }
        });
    }

    // ==================== 图片懒加载 ====================
    function initLazyLoad() {
        var images = document.querySelectorAll('.post-single-body img');
        if (!images.length) return;

        images.forEach(function (img) {
            var src = img.getAttribute('data-src') || img.getAttribute('src');
            if (!src) return;

            // 包装容器
            if (!img.parentElement || !img.parentElement.classList.contains('img-wrapper')) {
                var wrapper = document.createElement('div');
                wrapper.className = 'img-wrapper';
                img.parentNode.insertBefore(wrapper, img);
                wrapper.appendChild(img);
            }

            // 使用浏览器原生 loading="lazy"
            if (!img.getAttribute('loading')) {
                img.setAttribute('loading', 'lazy');
            }

            // 加载动画
            img.classList.add('img-loading');
            img.addEventListener('load', function () {
                img.classList.remove('img-loading');
                img.classList.add('img-loaded');
            });

            // 使用 IntersectionObserver 进行懒加载
            if ('IntersectionObserver' in window && img.getAttribute('data-src')) {
                var observer = new IntersectionObserver(function (entries, obs) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting) {
                            var target = entry.target;
                            target.src = target.getAttribute('data-src');
                            obs.unobserve(target);
                        }
                    });
                }, { rootMargin: '200px 0px' });
                observer.observe(img);
            }
        });
    }

    // ==================== 代码块复制 (图标按钮) + 语言标签 ====================
    function initCodeCopy() {
        var copyIcon = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
        var copiedIcon = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

        var figures = document.querySelectorAll('figure.highlight');
        figures.forEach(function (figure) {
            // 判断代码类型 - 改进检测逻辑
            var lang = '';
            var classes = figure.className.split(/\s+/);
            
            // 检查多种格式: lang-xxx, highlight xxx, language-xxx
            for (var i = 0; i < classes.length; i++) {
                var cls = classes[i];
                if (cls.indexOf('lang-') === 0) {
                    lang = cls.replace('lang-', '');
                    break;
                }
                if (cls.indexOf('language-') === 0) {
                    lang = cls.replace('language-', '');
                    break;
                }
                // highlight 后面的 class 可能是语言名
                if (cls !== 'highlight' && cls !== 'hljs') {
                    lang = cls;
                }
            }
            
            // 再检查 code 元素的 class
            if (!lang) {
                var codeEl = figure.querySelector('code');
                if (codeEl) {
                    var codeClasses = codeEl.className.split(/\s+/);
                    for (var j = 0; j < codeClasses.length; j++) {
                        var ccls = codeClasses[j];
                        if (ccls.indexOf('language-') === 0) {
                            lang = ccls.replace('language-', '');
                            break;
                        }
                        if (ccls !== 'hljs') {
                            lang = ccls;
                        }
                    }
                }
            }
            
            if (!lang) lang = 'CODE';
            lang = lang.toUpperCase();

            // 创建语言标签容器（放在 figure 内，但不在 gutter 内）
            var tag = document.createElement('div');
            tag.className = 'code-lang-label';
            tag.textContent = lang;
            figure.appendChild(tag);

            // 添加复制按钮
            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.setAttribute('aria-label', 'Copy code');
            btn.innerHTML = copyIcon;
            figure.appendChild(btn);

            btn.addEventListener('click', function () {
                var codeEl = figure.querySelector('.code') || figure.querySelector('pre') || figure.querySelector('code');
                var text = codeEl ? codeEl.innerText || codeEl.textContent : '';
                if (!text) text = figure.innerText;

                var copySuccess = function () {
                    btn.innerHTML = copiedIcon;
                    btn.classList.add('copied');
                    setTimeout(function () {
                        btn.innerHTML = copyIcon;
                        btn.classList.remove('copied');
                    }, 1500);
                };

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(copySuccess).catch(function () {
                        fallbackCopyText(text, btn, copySuccess);
                    });
                } else {
                    fallbackCopyText(text, btn, copySuccess);
                }
            });
        });

        // 独立 pre 也支持
        var pres = document.querySelectorAll('pre:not(figure.highlight pre):not(.hljs)');
        pres.forEach(function (pre) {
            // 检测语言
            var lang = 'CODE';
            var codeEl = pre.querySelector('code');
            if (codeEl) {
                var codeClasses = codeEl.className.split(/\s+/);
                for (var k = 0; k < codeClasses.length; k++) {
                    var cc = codeClasses[k];
                    if (cc.indexOf('language-') === 0) {
                        lang = cc.replace('language-', '').toUpperCase();
                        break;
                    }
                    if (cc !== 'hljs') {
                        lang = cc.toUpperCase();
                    }
                }
            }

            var wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            var tag = document.createElement('div');
            tag.className = 'code-lang-label';
            tag.textContent = lang;
            wrapper.appendChild(tag);

            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.setAttribute('aria-label', 'Copy code');
            btn.innerHTML = copyIcon;
            wrapper.appendChild(btn);

            btn.addEventListener('click', function () {
                var text = pre.innerText || pre.textContent;
                var copySuccess = function () {
                    btn.innerHTML = copiedIcon;
                    btn.classList.add('copied');
                    setTimeout(function () {
                        btn.innerHTML = copyIcon;
                        btn.classList.remove('copied');
                    }, 1500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(copySuccess);
                } else {
                    fallbackCopyText(text, btn, copySuccess);
                }
            });
        });
    }

    function fallbackCopyText(text, btn, cb) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (cb) cb();
        } catch (err) {}
    }

    // ==================== 搜索面板 ====================
    var searchDataCache = null;
    
    function initSearch() {
        var panel = document.getElementById('search-panel');
        var toggle = document.getElementById('search-toggle');
        var closeBtn = document.getElementById('search-close');
        var input = document.getElementById('search-input');
        var results = document.getElementById('search-results');
        if (!panel || !input || !results) return;

        // 打开 / 关闭
        function openPanel() {
            panel.classList.add('open');
            setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
            document.body.style.overflow = 'hidden';
            // 加载搜索数据
            loadSearchData();
        }
        function closePanel() {
            panel.classList.remove('open');
            input.value = '';
            results.innerHTML = '<div class="search-empty">开始输入搜索文章...</div>';
            document.body.style.overflow = '';
        }

        if (toggle) toggle.addEventListener('click', openPanel);
        if (closeBtn) closeBtn.addEventListener('click', closePanel);

        // 点击面板背景关闭
        panel.addEventListener('click', function (e) {
            if (e.target === panel) closePanel();
        });

        // Esc 关闭
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
        });

        // 加载搜索数据
        function loadSearchData() {
            if (searchDataCache) return;
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/search.json', true);
            xhr.onload = function () {
                if (xhr.status === 200) {
                    try {
                        searchDataCache = JSON.parse(xhr.responseText);
                    } catch (e) {
                        searchDataCache = [];
                    }
                }
            };
            xhr.send();
        }

        input.addEventListener('input', function () {
            var q = input.value.trim().toLowerCase();
            if (!q) {
                results.innerHTML = '<div class="search-empty">开始输入搜索文章...</div>';
                return;
            }
            
            if (!searchDataCache) {
                results.innerHTML = '<div class="search-empty">正在加载搜索数据...</div>';
                return;
            }
            
            var matches = searchDataCache.filter(function (item) {
                return item.title.toLowerCase().indexOf(q) !== -1 ||
                       (item.content && item.content.toLowerCase().indexOf(q) !== -1) ||
                       (item.tags && item.tags.some(function(t) { return t.toLowerCase().indexOf(q) !== -1; }));
            });
            
            if (matches.length === 0) {
                results.innerHTML = '<div class="search-empty">没有找到相关内容</div>';
            } else {
                var html = '<div class="search-result-list">';
                matches.slice(0, 20).forEach(function (item) {
                    html += '<a href="' + item.url + '" class="search-result-item">' +
                        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>' +
                        '<span>' + item.title + '</span></a>';
                });
                html += '</div>';
                results.innerHTML = html;
            }
        });
    }

    // ==================== Waline 评论初始化 ====================
    function initWaline() {
        if (!window.__WALINE_CONFIG__ || typeof Waline === 'undefined') return;
        var el = document.getElementById('waline-comments');
        if (!el) return;
        try {
            Waline.init({
                el: '#waline-comments',
                serverURL: window.__WALINE_CONFIG__.serverURL,
                placeholder: window.__WALINE_CONFIG__.placeholder,
                avatar: window.__WALINE_CONFIG__.avatar,
                pageSize: window.__WALINE_CONFIG__.pageSize,
                wordLimit: window.__WALINE_CONFIG__.wordLimit,
                login: window.__WALINE_CONFIG__.login
            });
        } catch (err) {}
    }

    // ==================== Mermaid 渲染 ====================
    function initMermaid() {
        if (!window.__MERMAID_ENABLED__ || typeof mermaid === 'undefined') return;
        var blocks = document.querySelectorAll('pre.mermaid, .post-single-body pre code.language-mermaid, code.language-mermaid');
        blocks.forEach(function (block, idx) {
            var code = block.textContent || block.innerText;
            var container = document.createElement('div');
            container.className = 'mermaid-container';
            container.id = 'mermaid-' + idx;
            block.parentNode.replaceChild(container, block);
            try {
                var svg = mermaid.render('mermaid-graph-' + idx, code);
                container.innerHTML = svg;
            } catch (e) {
                container.innerHTML = '<pre class="mermaid-error">Mermaid render error</pre>';
            }
        });
    }

    // ==================== 初始化 ====================
    function init() {
        initBackToTop();
        initThemeToggle();
        initMobileMenu();
        initDropdown();
        initLazyLoad();
        initCodeCopy();
        initSearch();
        initWaline();
        initMermaid();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
