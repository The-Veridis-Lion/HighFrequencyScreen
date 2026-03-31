// 严格保留官方模块导入
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "auto_blacklist_helper";
const REGEX_RULE_NAME = "🚫 自动屏蔽词管家"; // 我们在正则库里的专属名称

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
// 【核心修复】：直接写入酒馆真正的全局正则数组 (regex_scripts)
// -------------------------------------------------------------
function syncToNativeRegex() {
    try {
        const words = extension_settings[extensionName].bannedWords;
        
        // 检查酒馆真正的全局正则变量是否存在
        if (!Array.isArray(window.regex_scripts)) {
            console.warn(`[${extensionName}] 找不到全局正则引擎变量 window.regex_scripts！`);
            return;
        }

        // 查找是否已经存在我们的专属规则
        let ruleIndex = window.regex_scripts.findIndex(r => r.scriptName === REGEX_RULE_NAME);
        
        if (words.length === 0) {
            // 如果黑名单为空，但规则存在，则禁用它
            if (ruleIndex !== -1) {
                window.regex_scripts[ruleIndex].disabled = true;
                if (typeof window.saveRegex === 'function') window.saveRegex();
            }
        } else {
            // 转义符号并生成真正的正则语法
            const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const regexStr = `/(${escapedWords.join('|')})/g`;

            const ruleObj = {
                id: ruleIndex !== -1 ? window.regex_scripts[ruleIndex].id : "bl_" + Date.now(), // 保持原ID或新建
                scriptName: REGEX_RULE_NAME,
                regex: regexStr,
                replacementStr: "", // 替换为空字符串（直接删除该词）
                placement: [1, 2], // 1:处理用户发送的，2:处理AI发送的
                disabled: false,
                markdownOnly: false,
                promptOnly: false,
                runOnEdit: true,
                minDepth: null,
                maxDepth: null
            };

            if (ruleIndex !== -1) {
                // 覆盖更新现有规则
                window.regex_scripts[ruleIndex] = ruleObj;
            } else {
                // 插入新规则
                window.regex_scripts.push(ruleObj);
            }

            // 调用酒馆官方的“保存正则”接口，将其写入后端的 regex.json
            if (typeof window.saveRegex === 'function') {
                window.saveRegex();
            }
        }
    } catch (e) {
        console.error(`[${extensionName}] 同步正则失败:`, e);
    }
}

// UI 注入代码
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

// 弹窗UI
function createPopup() {
    const popupHtml = `
        <div id="bl-helper-popup" class="bl-helper-popup">
            <button id="bl-helper-popup-close-icon" class="bl-helper-popup-close-icon">&times;</button>
            
            <h3 class="bl-helper-popup-title"><i class="fa-solid fa-ban"></i> 自动屏蔽词管家</h3>
            
            <div class="bl-helper-section">
                <label class="bl-helper-label">添加你想屏蔽的词语 (AI说到此词将被直接删除)：</label>
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
                <i class="fa-solid fa-check-double"></i> 屏蔽规则已与系统全局正则实时同步
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
            saveSettingsDebounced(); // 插件自身设置存档
            syncToNativeRegex();     // 【触发核心】：更新全局正则引擎！
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
        saveSettingsDebounced(); // 插件自身设置存档
        syncToNativeRegex();     // 【触发核心】：更新全局正则引擎！
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
        // 启动时自动同步一次规则，防止断层失效
        setTimeout(syncToNativeRegex, 1000); 
    };

    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, initializeExtension);
    } else {
        setTimeout(initializeExtension, 2000);
    }
});
