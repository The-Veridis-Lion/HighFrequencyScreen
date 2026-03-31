(function () {
    const extensionName = "freq_regex_helper";

    // --- 1. 核心分析逻辑 (Intl 原生分词) ---
    function analyzeFrequency() {
        const chat = window.chat || (typeof SillyTavern !== 'undefined' && SillyTavern.getContext ? SillyTavern.getContext().chat : []);
        // 过滤：非系统消息、未隐藏
        const visibleText = chat.filter(m => !m.hidden && !m.is_system && m.mes).map(m => m.mes).join('\n');
        
        const container = document.getElementById('freq-words-container');
        if (!visibleText) {
            container.innerHTML = '<div style="text-align:center; color:var(--freq-text-secondary); padding:10px;">当前可见对话没有足够的文本...</div>';
            return;
        }

        const freqMap = {};
        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
            for (const { segment, isWordLike } of segmenter.segment(visibleText)) {
                // 确保是词语、长度 >= 2、且不是纯数字
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
            container.innerHTML = '<div style="text-align:center; color:var(--freq-text-secondary); padding:10px;">未提取到有效的高频词。</div>';
            return;
        }

        container.innerHTML = sortedFreq.map(([w, c]) => `
            <div class="freq-word-tag" onclick="const ta = document.getElementById('freq-regex-input'); ta.value += '|${w}';">
                ${w}<span>${c}</span>
            </div>
        `).join('');
    }

    // --- 2. 弹窗居中函数 (直接借用隐藏助手的逻辑) ---
    function centerPopup($popup) {
        if (!$popup || $popup.length === 0 || $popup.is(':hidden')) return;
        const top = Math.max(10, ($(window).height() - $popup.outerHeight()) / 2);
        const left = Math.max(10, ($(window).width() - $popup.outerWidth()) / 2);
        $popup.css({ top: `${top}px`, left: `${left}px`, transform: 'none' });
    }

    // --- 3. UI 初始化与注入 ---
    function createUI() {
        // A. 注入到魔法棒容器 (像隐藏助手一样)
        if ($('#data_bank_wand_container').length && !$('#freq-helper-wand-button').length) {
            const wandBtn = `
                <div id="freq-helper-wand-button" title="打开词频与正则助手">
                    <i class="fa-solid fa-chart-line"></i>
                    <span>词频助手</span>
                </div>`;
            $('#data_bank_wand_container').append(wandBtn);
        }

        // B. 注入到侧边扩展栏
        const targetMenu = $('#extensions_settings .list-group, .extensions-menu').first();
        if (targetMenu.length > 0 && !$('#freq-native-list-btn').length) {
            const listBtn = `
                <div id="freq-native-list-btn" class="list-group-item interactable" title="分析对话词频">
                    <i class="fa-solid fa-chart-line" style="margin-right: 8px; width: 20px; text-align: center;"></i>
                    <span class="drawer-item-text">词频助手</span>
                </div>`;
            targetMenu.prepend(listBtn);
        }

        // C. 生成弹窗 HTML (使用从隐藏助手复刻的 CSS 类)
        if (!$('#freq-helper-popup').length) {
            const popupHtml = `
            <div id="freq-helper-popup" class="freq-helper-popup">
                <button id="freq-helper-popup-close-icon" class="freq-popup-close-icon">&times;</button>
                <div class="freq-popup-title">
                    <i class="fa-solid fa-broom"></i> 词频分析与正则
                </div>
                
                <div class="freq-helper-section">
                    <p class="freq-helper-label">点击下方高频词，快速加入正则规则：</p>
                    <div id="freq-words-container">加载中...</div>
                </div>

                <div class="freq-helper-section">
                    <p class="freq-helper-label">正则预览区 (可手动修改)：</p>
                    <textarea id="freq-regex-input">/(极度|极其</textarea>
                </div>

                <div class="freq-helper-popup-footer">
                    <button id="freq-copy-regex" class="freq-helper-btn">
                        <i class="fa-solid fa-copy"></i> 复制正则表达式
                    </button>
                </div>
            </div>`;
            $('body').append(popupHtml);
        }
    }

    // --- 4. 事件绑定 ---
    function bindEvents() {
        // 点击入口按钮打开弹窗
        $(document).off('click', '#freq-helper-wand-button, #freq-native-list-btn').on('click', '#freq-helper-wand-button, #freq-native-list-btn', function(e) {
            e.stopPropagation();
            analyzeFrequency();
            const $popup = $('#freq-helper-popup');
            $popup.show(); // 使用 show 配合 CSS 的 fadeIn 动画
            centerPopup($popup);
            $(window).off('resize.freqHelper').on('resize.freqHelper', () => centerPopup($popup));
        });

        // 关闭弹窗
        $(document).off('click', '#freq-helper-popup-close-icon').on('click', '#freq-helper-popup-close-icon', function() {
            $('#freq-helper-popup').hide();
            $(window).off('resize.freqHelper');
        });

        // 复制正则
        $(document).off('click', '#freq-copy-regex').on('click', '#freq-copy-regex', function() {
            const ta = document.getElementById('freq-regex-input');
            if (!ta.value.endsWith(')')) ta.value += ')/g';
            ta.select();
            document.execCommand('copy');
            if (typeof toastr !== 'undefined') toastr.success('正则复制成功！');
        });
    }

    // --- 5. 启动总线 ---
    function initExtension() {
        createUI();
        bindEvents();
        // 轮询保护：防止侧边栏重绘导致按钮消失
        setInterval(createUI, 1000); 
    }

    // 监听原生 appReady 事件
    jQuery(async () => {
        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
            eventSource.on(event_types.APP_READY, initExtension);
            if (document.getElementById('send_textarea')) initExtension();
        } else {
            setTimeout(initExtension, 2000);
        }
    });

})();
