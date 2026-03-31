// 严格保留官方模块导入
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "direct_content_filter";

const defaultSettings = {
    bannedWords: ["极度", "极其", "病态"]
};

// 弹窗居中函数 (复刻 hide 扩展逻辑)
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

// 核心功能：对单条消息进行文本清洗
function cleanMessageElement(mesElement) {
    if (!mesElement) return;
    const words = extension_settings[extensionName].bannedWords;
    if (!words || words.length === 0) return;

    // 构造临时正则（仅用于本次内存查找）
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedWords.join('|')})`, 'g');

    // 深度遍历消息内的所有文本节点
    const walker = document.createTreeWalker(mesElement, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (regex.test(node.nodeValue)) {
            // 直接在内存中替换掉，不留痕迹
            node.nodeValue = node.nodeValue.replace(regex, "");
        }
    }
}

// 全量扫描当前聊天框
function cleanAllVisibleMessages() {
    console.log(`[${extensionName}] 正在全量清洗消息...`);
    const messages = document.querySelectorAll('.mes_text');
    messages.forEach(mes => cleanMessageElement(mes));
}

// UI 注入代码
function createUI() {
    if ($('#bl-helper-settings').length > 0) return;

    const settingsHtml = `
    <div id="bl-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header interactable">
                <b>🚫 屏蔽词过滤 (实时生效版)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <button id="bl-drawer-open-btn" class="menu_button" style="width:100%;">
                    打开词库管理面板
                </button>
            </div>
        </div>
    </div>`;
    $("#extensions_settings").append(settingsHtml);

    // 注入魔法棒按钮
    $('#bl-helper-wand-button').remove();
    $('#data_bank_wand_container').append(`
        <div id="bl-helper-wand-button" title="屏蔽词管理" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer;">
            <i class="fa-solid fa-ban"></i>
            <span>屏蔽词</span>
        </div>`);

    // 创建弹窗
    if (!$('#bl-helper-popup').length) {
        $('body').append(`
            <div id="bl-helper-popup" class="bl-helper-popup">
                <button id="bl-popup-close-icon" class="bl-popup-close-icon">&times;</button>
                <h3 class="bl-helper-popup-title">屏蔽词实时过滤</h3>
                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <input type="text" id="bl-new-word" class="bl-input" placeholder="输入屏蔽词...">
                    <button id="bl-add-word-btn" class="bl-helper-btn">添加</button>
                </div>
                <div id="bl-words-container" class="bl-words-list"></div>
                <div style="color:#4ade80; font-size:12px; text-align:center; margin-top:10px;">
                    <i class="fa-solid fa-bolt"></i> 无需正则，添加后实时从界面抹除
                </div>
            </div>`);
    }

    // 绑定事件
    $('#bl-helper-wand-button, #bl-drawer-open-btn').on('click', function() {
        renderWords();
        $('#bl-helper-popup').show();
        centerPopup($('#bl-helper-popup'));
    });

    $('#bl-popup-close-icon').on('click', () => $('#bl-helper-popup').hide());

    $('#bl-add-word-btn').on('click', function() {
        const word = $('#bl-new-word').val().trim();
        if (word && !extension_settings[extensionName].bannedWords.includes(word)) {
            extension_settings[extensionName].bannedWords.push(word);
            $('#bl-new-word').val('');
            saveSettingsDebounced();
            renderWords();
            cleanAllVisibleMessages(); // 添加词后立即清洗全场
        }
    });

    $('#bl-words-container').on('click', '.del-btn', function() {
        const index = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(index, 1);
        saveSettingsDebounced();
        renderWords();
        // 删除词后，酒馆会自动重绘消息，所以不用特殊处理
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-words-container').html(words.map((w, i) => `
        <div class="bl-word-tag">${w}<span class="del-btn" data-index="${i}">&times;</span></div>
    `).join('') || '词库为空');
}

// --- 初始化与监听 ---
jQuery(async () => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    const init = () => {
        createUI();
        cleanAllVisibleMessages();
        
        // 核心：监听每条消息的生成事件
        eventSource.on(event_types.MESSAGE_RECEIVED, () => {
            setTimeout(cleanAllVisibleMessages, 50); // AI开始说话时清洗
        });
        
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
            // 当某条消息渲染完成时，针对性清洗
            const mesElem = document.querySelector(`.mes[mesid="${mesId}"] .mes_text`);
            cleanMessageElement(mesElem);
        });
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
        if (document.getElementById('send_textarea')) init();
    }
});
