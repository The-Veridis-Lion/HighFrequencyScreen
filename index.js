// 严格保留官方模块导入
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "auto_blacklist_helper";
const REGEX_RULE_ID = "auto_blacklist_generated_rule"; // 我们在正则库里的专属ID

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

// 加载设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName]
    });
}

// -------------------------------------------------------------
// 【核心大招】：将屏蔽词全自动写入酒馆底层的正则表达式引擎
// -------------------------------------------------------------
function syncToNativeRegex() {
    const words = extension_settings[extensionName].bannedWords;
    
    if (!extension_settings.regex) {
        extension_settings.regex = [];
    }

    let ruleIndex = extension_settings.regex.findIndex(r => r.id === REGEX_RULE_ID);
    
    if (words.length === 0) {
        // 如果黑名单为空，自动停用该正则
        if (ruleIndex !== -1) extension_settings.regex[ruleIndex].disabled = true;
    } else {
        // 转义符号并生成正则
        const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regexStr = `/(${escapedWords.join('|')})/g`;

        const ruleObj = {
            id: REGEX_RULE_ID,
            scriptName: "🚫 自动屏蔽词拦截 (由插件管理)",
            regex: regexStr,
            replacementStr: "***", // 全自动替换为 ***
            placement: [1, 2], // 1:处理你发的，2:处理AI发的
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: true,
            minDepth: null,
            maxDepth: null
        };

        if (ruleIndex !== -1) {
            extension_settings.regex[ruleIndex] = ruleObj;
        } else {
            extension_settings.regex.push(ruleObj);
        }
    }

    saveSettingsDebounced();
    // 强制酒馆正则引擎热重载，让规则立刻生效！
    if (typeof window.loadRegex === 'function') {
        window.loadRegex();
    }
}

// UI 注入代码 (完全保留 hide 的注入模式)
function createUI() {
    const settingsHtml = `
    <div id="bl-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>自动屏蔽词管家</b>
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

    createInputWandButton();
    createPopup();
    setupEventListeners();
}

function createInputWandButton() {
    $('#bl-helper-wand-button').remove();
    const buttonHtml = `
        <div id="bl-helper-wand-button" title="打开自动屏蔽词" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
            <i class="fa-solid fa-ban"></i>
            <span>屏蔽词</span>
        </div>`;
    $('#data_bank_wand_container').append(buttonHtml);
    
    $('#bl-helper-wand-button').hover(
        function() { $(this).css('color', 'var(--text-primary)'); },
        function() { $(this).css('color', 'var(--text-secondary)'); }
    );
}

// 弹窗去掉了“复制按钮”和“代码框”
function createPopup() {
    const popupHtml = `
        <div id="bl-helper-popup" class="bl-helper-popup">
            <button id="bl-helper-popup-close-icon" class="bl-helper-popup-close-icon">&times;</button>
            
            <h3 class="bl-helper-popup-title"><i class="fa-solid fa-ban"></i> 自动屏蔽词管家</h3>
            
            <div class="bl-helper-section">
                <label class="bl-helper-label">添加你想屏蔽的词语 (AI说到此词将被自动替换为***)：</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="bl-new-word" class="bl-input" placeholder="输入词语...">
                    <button id="bl-add-word-btn" class="bl-helper-btn" style="background:var(--SmartThemeQuoteColor); color:white;">添加</button>
                </div>
            </div>

            <div class="bl-helper-section">
                <label class="bl-helper-label">当前黑名单 (点击 × 删除)：</label>
                <div id="bl-words-container" class="bl-words-list"></div>
            </div>

            <div class="bl-sync-text">
                <i class="fa-solid fa-bolt"></i> 屏蔽规则已与系统正则全自动实时同步
            </div>
        </div>`;
    $('body').append(popupHtml);
}

// 渲染词汇
function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    const container = $('#bl-words-container');

    if (words.length === 0) {
        container.html('<div style="opacity:0.5; width:100%; text-align:center; font-size:12px; margin-top:10px;">黑名单为空，已暂停拦截</div>');
    } else {
        container.html(words.map((w, index) => `
            <div class="bl-word-tag">
                ${w} <span class="del-btn" data-index="${index}">&times;</span>
            </div>
        `).join(''));
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
            saveSettingsDebounced(); // 存档
            syncToNativeRegex();     // 同步到正则引擎
            renderWords();           // 刷新UI
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
        saveSettingsDebounced(); // 存档
        syncToNativeRegex();     // 同步到正则引擎
        renderWords();           // 刷新UI
    });
}

// 严谨的官方初始化加载
jQuery(async () => {
    let isInitialized = false;
    const initializeExtension = () => {
        if (isInitialized) return;
        isInitialized = true;
        
        loadSettings();
        createUI();
        syncToNativeRegex(); // 启动时自动同步一次规则，防止失效
    };

    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, initializeExtension);
    } else {
        setTimeout(initializeExtension, 2000);
    }
});
