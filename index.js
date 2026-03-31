(function () {
    const extensionName = "freq-regex-helper";

    // --- 1. 注入内联样式 (彻底解决路径问题) ---
    function injectCSS() {
        if (document.getElementById('freq-helper-styles')) return;
        const style = document.createElement('style');
        style.id = 'freq-helper-styles';
        style.innerHTML = `
            #freq-helper-popup { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:380px; background:var(--SmartThemeBlurTintColor, var(--bg-color, rgba(20,20,20,0.95))); border:1px solid var(--SmartThemeBorderColor, var(--border-color, #555)); border-radius:10px; z-index:999999; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,0.8); display:none; backdrop-filter:blur(10px); color:var(--text-color, #eee); }
            .freq-popup-header { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color, #555); padding-bottom:10px; margin-bottom:10px; }
            .freq-popup-title { margin:0; font-size:16px; font-weight:bold; }
            .freq-close-btn { background:none; border:none; color:var(--text-color); font-size:20px; cursor:pointer; }
            .freq-close-btn:hover { color:#ff6b6b; }
            #freq-words-container { max-height:160px; overflow-y:auto; padding:10px; background:rgba(0,0,0,0.2); border-radius:6px; border:1px solid var(--border-color, #444); margin-bottom:10px; }
            .freq-word-tag { display:inline-block; margin:3px; padding:4px 10px; background:var(--SmartThemeButtonBackgroundColor, #333); border:1px solid var(--SmartThemeBorderColor, #555); border-radius:6px; cursor:pointer; transition:0.2s; font-size:13px; }
            .freq-word-tag:hover { border-color:cyan; background:#444; color:white; }
            .freq-word-tag span { font-size:11px; opacity:0.6; margin-left:5px; }
            .freq-textarea { width:100%; height:60px; background:rgba(0,0,0,0.4); color:#4ade80; border:1px solid var(--border-color, #555); border-radius:6px; font-family:monospace; padding:8px; box-sizing:border-box; }
            .freq-copy-btn { width:100%; padding:10px; margin-top:10px; background:var(--SmartThemeButtonBackgroundColor, #444); color:var(--text-color); border:none; border-radius:6px; cursor:pointer; font-weight:bold; }
            .freq-copy-btn:hover { background:#555; }
        `;
        document.head.appendChild(style);
    }

    // --- 2. 核心分析逻辑 (Intl 原生分词) ---
    function analyzeFrequency() {
        const chat = window.chat || [];
        const visibleText = chat.filter(m => !m.hidden && !m.is_system && m.mes).map(m => m.mes).join('\n');
        const container = document.getElementById('freq-words-container');
        
        if (!visibleText) {
            container.innerHTML = '<div style="opacity:0.6; text-align:center;">当前可见对话没有足够的文本...</div>';
            return;
        }

        const freqMap = {};
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
            for (const { segment, isWordLike } of segmenter.segment(visibleText)) {
                if (isWordLike && segment.length >= 2 && !/^\d+$/.test(segment)) {
                    freqMap[segment] = (freqMap[segment] || 0) + 1;
                }
            }
        } else {
            const words = visibleText.match(/[a-zA-Z\u4e00-\u9fa5]{2,}/g) || [];
            words.forEach(w => freqMap[w] = (freqMap[w] || 0) + 1);
        }
        
        const sortedFreq = Object.entries(freqMap).sort((a, b) => b[1] - a[1]).slice(0, 30);
        
        if (sortedFreq.length === 0) {
            container.innerHTML = '<div style="opacity:0.6; text-align:center;">未提取到有效的高频词。</div>';
            return;
        }

        container.innerHTML = sortedFreq.map(([w, c]) => `
            <div class="freq-word-tag" onclick="const ta = document.getElementById('freq-regex-input'); ta.value += '|${w}';">
                ${w}<span>${c}</span>
            </div>
        `).join('');
    }

    // --- 3. 初始化弹窗 DOM ---
    function initModal() {
        if ($('#freq-helper-popup').length) return;
        const popupHtml = `
        <div id="freq-helper-popup">
            <div class="freq-popup-header">
                <div class="freq-popup-title"><i class="fa-solid fa-broom"></i> 词频与正则助手</div>
                <button id="freq-close-btn" class="freq-close-btn">&times;</button>
            </div>
            <div style="font-size:12px; opacity:0.8; margin-bottom:5px;">点击下方高频词添加到正则：</div>
            <div id="freq-words-container">加载中...</div>
            <div style="font-size:12px; margin-bottom:5px;">正则预览区：</div>
            <textarea id="freq-regex-input" class="freq-textarea">/(极度|极其</textarea>
            <button id="freq-copy-regex" class="freq-copy-btn"><i class="fa-solid fa-copy"></i> 复制正则表达式</button>
        </div>`;
        $('body').append(popupHtml);

        $('#freq-close-btn').on('click', () => $('#freq-helper-popup').fadeOut(150));
        $('#freq-copy-regex').on('click', () => {
            const ta = document.getElementById('freq-regex-input');
            if (!ta.value.endsWith(')')) ta.value += ')/g';
            ta.select();
            document.execCommand('copy');
            if (typeof toastr !== 'undefined') toastr.success('正则复制成功！');
        });
    }

    // --- 4. 强力注入菜单入口 (防重绘) ---
    function keepMenuButtonAlive() {
        // 监控截图里的那个菜单
        const targetMenu = $('#extensions_settings .list-group, .extensions-menu').first();
        
        if (targetMenu.length > 0 && !$('#freq-native-btn').length) {
            const btnHtml = `
            <div id="freq-native-btn" class="list-group-item interactable" title="分析对话词频">
                <i class="fa-solid fa-chart-line" style="margin-right: 8px; width: 20px; text-align: center;"></i>
                <span class="drawer-item-text">词频助手</span>
            </div>`;
            
            // 把它插在菜单的最上面
            targetMenu.prepend(btnHtml);
            
            // 绑定点击事件
            $('#freq-native-btn').off('click').on('click', function(e) {
                e.stopPropagation(); // 阻止菜单默认关闭
                analyzeFrequency();
                $('#freq-helper-popup').fadeIn(150);
            });
        }
    }

    // --- 5. 启动流程 ---
    function bootStrap() {
        console.log(`[${extensionName}] 启动！`);
        injectCSS();
        initModal();
        
        // 核心改动：每 500 毫秒检查一次。就算酒馆把菜单删了重画，它也会在半秒内重新长出来！
        setInterval(keepMenuButtonAlive, 500);
    }

    // 监听酒馆核心启动事件
    if (typeof eventSource !== 'undefined' && event_types && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, bootStrap);
        if (document.getElementById('send_textarea')) bootStrap(); // 如果已经启动，直接运行
    } else {
        setTimeout(bootStrap, 2000);
    }
})();
