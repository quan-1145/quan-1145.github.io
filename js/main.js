(function () {
    'use strict';

    // 回到顶部
    function initBackToTop() {
        var btn = document.getElementById('back-to-top');
        if (!btn) return;

        var showFlag = false;
        window.addEventListener('scroll', function () {
            var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if (scrollTop > 200 && !showFlag) {
                btn.classList.add('show');
                showFlag = true;
            } else if (scrollTop <= 200 && showFlag) {
                btn.classList.remove('show');
                showFlag = false;
            }
        });

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // 移动端菜单切换
    function initMobileMenu() {
        var toggle = document.getElementById('menu-toggle');
        var nav = document.getElementById('header-nav');
        if (!toggle || !nav) return;

        toggle.addEventListener('click', function () {
            var open = nav.classList.toggle('open');
            toggle.classList.toggle('active');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    // 图片懒加载 & 点击放大
    function initPostImages() {
        var images = document.querySelectorAll('.post-single-body img');
        images.forEach(function (img) {
            if (!img.getAttribute('alt')) {
                img.setAttribute('alt', img.getAttribute('src') || '');
            }
        });
    }

    // 代码块复制按钮和语言标签
    function initCodeCopy() {
        // 处理 figure.highlight
        var figures = document.querySelectorAll('figure.highlight');
        figures.forEach(function (figure) {
            // 提取语言类型
            var classes = figure.className.split(' ');
            var lang = '';
            for (var i = 0; i < classes.length; i++) {
                if (classes[i].indexOf('lang-') === 0) {
                    lang = classes[i].replace('lang-', '').toUpperCase();
                    break;
                }
            }

            // 添加语言标签
            if (lang) {
                var caption = document.createElement('figcaption');
                caption.textContent = lang;
                figure.insertBefore(caption, figure.firstChild);
            }

            // 添加复制按钮
            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.innerHTML = '复制';
            btn.setAttribute('aria-label', 'Copy code');
            figure.appendChild(btn);

            btn.addEventListener('click', function () {
                var codeEl = figure.querySelector('.code') || figure.querySelector('pre');
                var text = codeEl ? codeEl.innerText : '';
                if (!text) text = figure.innerText.replace(btn.innerText, '');
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        btn.innerHTML = '已复制';
                        setTimeout(function () { btn.innerHTML = '复制'; }, 1500);
                    }).catch(function () {
                        fallbackCopy(text, btn);
                    });
                } else {
                    fallbackCopy(text, btn);
                }
            });
        });

        // 处理独立的 pre（非 figure.highlight 内）
        var pres = document.querySelectorAll('pre:not(figure.highlight pre)');
        pres.forEach(function (pre) {
            var wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.innerHTML = '复制';
            btn.setAttribute('aria-label', 'Copy code');
            wrapper.appendChild(btn);

            btn.addEventListener('click', function () {
                var text = pre.innerText || pre.textContent;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(function () {
                        btn.innerHTML = '已复制';
                        setTimeout(function () { btn.innerHTML = '复制'; }, 1500);
                    }).catch(function () {
                        fallbackCopy(text, btn);
                    });
                } else {
                    fallbackCopy(text, btn);
                }
            });
        });
    }

    function fallbackCopy(text, btn) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            btn.innerHTML = '已复制';
            setTimeout(function () { btn.innerHTML = '复制'; }, 1500);
        } catch (err) {
            btn.innerHTML = '复制失败';
        }
    }

    // 初始化
    function init() {
        initBackToTop();
        initMobileMenu();
        initPostImages();
        initCodeCopy();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
