// 严格按照 hide 扩展的方式导入官方模块
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "blacklist_regex";
const defaultSettings = {
    bannedWords: ["极度", "极其", "病态"]
};

// 弹窗居中函数 (直接拷贝自 hide 扩展)
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
    console.log(`[${extensionName}] Loading settings...`);
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName]
    });
}

// 创建 UI 面板
function createUI() {
    console.log(`[${extensionName}] Entering createUI.`);
    
    // 1. 注入扩展列表 (#extensions_settings)
    const settingsHtml = `
    <div id="bl-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>屏蔽词正则助手</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding: 10px;">
                <button id="bl-drawer-open-btn" class="menu_button" style="width:100%;">
                    <i class="fa-solid fa-ban"></i> 打开屏蔽词管理面板
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

function createInputWandButton() {
    $('#bl-helper-wand-button').remove();
    const buttonHtml = `
        <div id="bl-helper-wand-button" title="打开屏蔽词生成器">
            <i class="fa-solid fa-ban"></i>
            <span>屏蔽词</span>
        </div>`;
    $('#data_bank_wand_container').append(buttonHtml);
}

function createPopup() {
    const popupHtml = `
        <div id="bl-helper-popup" class="bl-helper-popup">
            <button id="bl-popup-close-icon" class="bl-popup-close-icon">&times;</button>
            <div class="bl-popup-title">
                <i class="fa-solid fa-ban"></i> 屏蔽词管理与正则
            </div>
            
            <div class="bl-input-group">
                <input type="text" id="bl-new-word" placeholder="输入不想看到的词 (如: 极度)">
                <button id="bl-add-word-btn">添加</button>
            </div>

            <div style="font-size:12px; opacity:0.8;">当前黑名单词汇：</div>
            <div id="bl-words-container"></div>
            
            <div style="font-size:12px; opacity:0.8;">自动生成的正则预览：</div>
            <textarea id="bl-regex-output" readonly></textarea>
            
            <button id="bl-copy-btn"><i class="fa-solid fa-copy"></i> 复制正则表达式</button>
        </div>`;
    $('body').append(popupHtml);
}

// 核心逻辑：渲染词汇和生成正则
function renderWords() {
    const words = extension_settings[extensionName].bannedWords;
    const container = $('#bl-words-container');
    const regexOutput = $('#bl-regex-output');

    if (words.length === 0) {
        container.html('<div style="opacity:0.5; font-size:12px; width:100%; text-align:center;">还没有添加任何屏蔽词</div>');
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

// 绑定事件 (和 hide 扩展的绑定方式一模一样)
function setupEventListeners() {
    // 打开弹窗 (从魔法棒 或 扩展抽屉)
    $('#bl-helper-wand-button, #bl-drawer-open-btn').on('click', function() {
        renderWords();
        const $popup = $('#bl-helper-popup');
        $popup.show();
        centerPopup($popup);
        $(window).off('resize.blHelper').on('resize.blHelper', () => centerPopup($popup));
    });

    // 关闭弹窗
    $('#bl-popup-close-icon').on('click', function() {
        $('#bl-helper-popup').hide();
        $(window).off('resize.blHelper');
    });

    // 添加词汇
    $('#bl-add-word-btn').on('click', function() {
        const input = document.getElementById('bl-new-word');
        const word = input.value.trim();
        const wordsList = extension_settings[extensionName].bannedWords;
        
        if (word && !wordsList.includes(word)) {
            wordsList.push(word);
            input.value = '';
            // 使用官方 API 存档
            saveSettingsDebounced();
            renderWords();
        } else if (wordsList.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已经在黑名单中了！');
        }
    });

    // 回车添加
    $('#bl-new-word').on('keypress', function(e) {
        if (e.which === 13) $('#bl-add-word-btn').click();
    });

    // 删除词汇 (委托绑定)
    $('#bl-words-container').on('click', '.del-btn', function() {
        const index = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(index, 1);
        saveSettingsDebounced(); // 官方存档 API
        renderWords();
    });

    // 复制正则
    $('#bl-copy-btn').on('click', function() {
        const ta = document.getElementById('bl-regex-output');
        if (!ta.value) return;
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('复制成功！快去替换工具里粘贴吧。');
    });
}

// --- 扩展入口 (完全复刻 hide 扩展的初始化流程) ---
jQuery(async () => {
    console.log(`[${extensionName}] Initializing extension...`);

    let isInitialized = false;
    const initializeExtension = () => {
        if (isInitialized) return;
        isInitialized = true;
        
        loadSettings();
        createUI();
    };

    // 严谨的官方事件总线监听
    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, initializeExtension);
    } else {
        setTimeout(initializeExtension, 2000);
    }
});
