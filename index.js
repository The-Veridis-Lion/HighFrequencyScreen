// 严格按照 hide 扩展的方式导入官方模块，不搞任何捷径
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "blacklist_helper";
const defaultSettings = {
    bannedWords: ["极度", "极其", "病态"]
};

// 弹窗居中函数 
function centerPopup($popup) {
    if (!$popup || $popup.length === 0 || $popup.is(':hidden')) return;
    const windowWidth = $(window).width();
    const windowHeight = $(window).height();
    const popupWidth = $popup.outerWidth();
    const popupHeight = $popup.outerHeight();
    const top = Math.max(10, (windowHeight - popupHeight) / 2);
    const left = Math.max(10, (windowWidth - popupWidth) / 2);
    $popup.css({ top: `${top}px`, left: `${left}px`, transform: 'none' });
}

// 初始化/加载扩展设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName]
    });
}

// 创建 UI 面板
function createUI() {
    // 1. 注入到扩展列表，使用标准的抽屉格式
    const settingsHtml = `
    <div id="bl-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>屏蔽词管家</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <button id="bl-drawer-open-btn" class="menu_button" style="width:100%;">
                    <i class="fa-solid fa-ban"></i> 打开屏蔽词设置
                </button>
            </div>
        </div>
    </div>`;
    $("#extensions_settings").append(settingsHtml);

    // 2. 创建输入区旁的魔法棒按钮
    createInputWandButton();
    // 3. 创建弹窗
    createPopup();
    // 4. 绑定所有事件
    setupEventListeners();
}

// 创建魔法棒快捷入口 (仿照 hide)
function createInputWandButton() {
    $('#bl-helper-wand-button').remove();
    const buttonHtml = `
        <div id="bl-helper-wand-button" title="打开屏蔽词管家" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
            <i class="fa-solid fa-ban"></i>
            <span>屏蔽词</span>
        </div>`;
    $('#data_bank_wand_container').append(buttonHtml);
    
    $('#bl-helper-wand-button').hover(
        function() { $(this).css('color', 'var(--text-primary)'); },
        function() { $(this).css('color', 'var(--text-secondary)'); }
    );
}

// 创建主弹窗 (不再依赖轮询注入)
function createPopup() {
    const popupHtml = `
        <div id="bl-helper-popup" class="bl-helper-popup">
            <button id="bl-helper-popup-close-icon" class="bl-helper-popup-close-icon">&times;</button>
            
            <h3 class="bl-helper-popup-title"><i class="fa-solid fa-ban"></i> 屏蔽词生成器</h3>
            
            <div class="bl-helper-section">
                <label class="bl-helper-label">添加你想屏蔽的词语：</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="bl-new-word" class="bl-input" placeholder="输入词语...">
                    <button id="bl-add-word-btn" class="bl-helper-btn" style="background:var(--SmartThemeQuoteColor); color:white;">添加</button>
                </div>
            </div>

            <div class="bl-helper-section">
                <label class="bl-helper-label">当前黑名单 (点击 × 删除)：</label>
                <div id="bl-words-container" class="bl-words-list"></div>
            </div>

            <div class="bl-helper-section">
                <label class="bl-helper-label">自动生成的正则 (直接复制)：</label>
                <textarea id="bl-regex-output" class="bl-textarea" readonly></textarea>
            </div>

            <div class="bl-helper-popup-footer">
                <button id="bl-copy-btn" class="bl-helper-btn" style="width:100%;">
                    <i class="fa-solid fa-copy"></i> 复制正则表达式
                </button>
            </div>
        </div>`;
    $('body').append(popupHtml);
}

// 渲染词汇
function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    const container = $('#bl-words-container');
    const regexOutput = $('#bl-regex-output');

    if (words.length === 0) {
        container.html('<div style="opacity:0.5; width:100%; text-align:center; font-size:12px; margin-top:10px;">暂无屏蔽词</div>');
        regexOutput.val('');
    } else {
        container.html(words.map((w, index) => `
            <div class="bl-word-tag">
                ${w} <span class="del-btn" data-index="${index}">&times;</span>
            </div>
        `).join(''));
        regexOutput.val(`/(${words.join('|')})/g`);
    }
}

// 绑定事件
function setupEventListeners() {
    $('#bl-helper-wand-button, #bl-drawer-open-btn').on('click', function() {
        renderWords();
        const $popup = $('#bl-helper-popup');
        $popup.show();
        centerPopup($popup);
        $(window).off('resize.blHelper').on('resize.blHelper', () => centerPopup($popup));
    });

    $('#bl-helper-popup-close-icon').on('click', function() {
        $('#bl-helper-popup').hide();
        $(window).off('resize.blHelper');
    });

    $('#bl-add-word-btn').on('click', function() {
        const word = $('#bl-new-word').val().trim();
        const wordsList = extension_settings[extensionName].bannedWords;
        if (word && !wordsList.includes(word)) {
            wordsList.push(word);
            $('#bl-new-word').val('');
            saveSettingsDebounced(); // 调用官方接口保存
            renderWords();
        } else if (wordsList.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已存在！');
        }
    });

    $('#bl-new-word').on('keypress', function(e) {
        if (e.which === 13) $('#bl-add-word-btn').click();
    });

    $('#bl-words-container').on('click', '.del-btn', function() {
        const index = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(index, 1);
        saveSettingsDebounced(); // 调用官方接口保存
        renderWords();
    });

    $('#bl-copy-btn').on('click', function() {
        const ta = document.getElementById('bl-regex-output');
        if (!ta.value) return;
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('复制成功！');
    });
}

// --- 扩展入口 ---
jQuery(async () => {
    let isInitialized = false;
    const initializeExtension = () => {
        if (isInitialized) return;
        isInitialized = true;
        
        loadSettings();
        createUI();
    };

    // 官方事件总线监听
    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, initializeExtension);
    } else {
        setTimeout(initializeExtension, 2000);
    }
});
