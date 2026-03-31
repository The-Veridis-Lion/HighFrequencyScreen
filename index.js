// 引入酒馆的全局变量
const extensionName = "freq-regex-helper";
const extensionFolderPath = `scripts/extensions/${extensionName}`;

// --- 核心逻辑 ---
function analyzeFrequency() {
    const chat = window.chat || [];
    // 过滤：非系统消息、未隐藏
    const visibleText = chat.filter(m => !m.hidden && !m.is_system && m.mes).map(m => m.mes).join('\n');
    
    const container = document.getElementById('freq-words-container');
    if (!visibleText) {
        container.innerHTML = '<div style="opacity:0.6; text-align:center; padding:10px;">当前可见对话没有足够的文本...</div>';
        return;
    }

    const freqMap = {};
    
    // 使用现代浏览器原生的 NLP 分词引擎 (Intl.Segmenter)
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
        const segments = segmenter.segment(visibleText);
        
        for (const { segment, isWordLike } of segments) {
            // 【核心修改点】：必须是词语（排除纯标点符号），且长度大于等于 2
            if (isWordLike && segment.length >= 2) {
                // 排除纯数字
                if (!/^\d+$/.test(segment)) {
                    freqMap[segment] = (freqMap[segment] || 0) + 1;
                }
            }
        }
    } else {
        // 兜底方案：如果浏览器太老不支持原生分词，使用增强版正则（2个字以上的中英文）
        const words = visibleText.match(/[a-zA-Z\u4e00-\u9fa5]{2,}/g) || [];
        words.forEach(w => freqMap[w] = (freqMap[w] || 0) + 1);
    }
    
    // 排序并取前 30 个高频词
    const sortedFreq = Object.entries(freqMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);
    
    if (sortedFreq.length === 0) {
        container.innerHTML = '<div style="opacity:0.6; text-align:center; padding:10px;">未提取到2个字及以上的有效词汇。</div>';
        return;
    }

    // 渲染词汇
    container.innerHTML = sortedFreq.map(([w, c]) => `
        <div class="freq-word-tag" onclick="const ta = document.getElementById('freq-regex-input'); ta.value += '|${w}';">
            ${w}<span>${c}</span>
        </div>
    `).join('');
}

// --- UI 注入与事件绑定 ---
function setupUI() {
    // 1. 加载样式文件
    if (!$(`link[href="${extensionFolderPath}/style.css"]`).length) {
        $('head').append(`<link rel="stylesheet" href="${extensionFolderPath}/style.css">`);
    }

    // 2. 注入弹窗 HTML
    if (!$('#freq-helper-popup').length) {
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
    }

    // 3. 往左侧菜单注入按钮
    const menuContainer = $('#extensions_settings .list-group, .extensions-menu');
    if (menuContainer.length && !$('#freq-native-btn').length) {
        const btnHtml = `
        <div id="freq-native-btn" class="list-group-item interactable" title="分析对话词频">
            <i class="fa-solid fa-chart-line" style="margin-right: 8px; width: 20px; text-align: center;"></i>
            <span>词频助手</span>
        </div>`;
        menuContainer.prepend(btnHtml);
    }

    // 4. 绑定事件
    $('#freq-native-btn').on('click', function() {
        analyzeFrequency();
        $('#freq-helper-popup').fadeIn(150);
        if (typeof closeLeftDrawer === 'function') closeLeftDrawer();
    });

    $('#freq-close-btn').on('click', () => {
        $('#freq-helper-popup').fadeOut(150);
    });

    $('#freq-copy-regex').on('click', () => {
        const ta = document.getElementById('freq-regex-input');
        if (!ta.value.endsWith(')')) ta.value += ')/g';
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('正则复制成功！');
    });
}

// --- 扩展入口 ---
jQuery(document).ready(function() {
    if (typeof eventSource !== 'undefined' && event_types && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            console.log(`[${extensionName}] 原生扩展已加载。`);
            setupUI();
        });
    } else {
        setTimeout(setupUI, 2000);
    }
});
