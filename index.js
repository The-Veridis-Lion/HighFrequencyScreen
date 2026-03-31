import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "event_driven_purifier";
const defaultSettings = { bannedWords: [] };

/**
 * 深度清洗：不仅让你看不见，更要让 AI 扫不到
 */
function performDeepCleanse() {
    const words = extension_settings[extensionName]?.bannedWords;
    if (!words || words.length === 0) return;

    const regex = new RegExp(`(${words.join('|')})`, 'g');
    let needsSaving = false;

    // 1. 数据层切除：修改内存中的聊天对象 (解决铅笔编辑框残留)
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach((msg) => {
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                needsSaving = true;
            }
        });
    }

    // 2. 持久化到服务器：切断 AI 回溯记忆的后路
    if (needsSaving) {
        saveChat();
    }

    // 3. 显示层清洗：实时抹除 DOM
    $('.mes_text').each(function() {
        const text = $(this).html();
        if (regex.test(text)) {
            $(this).html(text.replace(regex, ''));
        }
    });
}

function setupUI() {
    // 注入入口按钮
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词净化" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
                <i class="fa-solid fa-eraser"></i><span>净化</span>
            </div>`);
    }

    // 注入侧边栏入口
    if (!$('#bl-menu-item').length) {
        $("#extensions_settings").append(`
        <div id="bl-menu-item" class="hide-helper-container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header interactable">
                    <b>🚫 屏蔽词深度净化</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding:10px; display:none;">
                    <button id="bl-open-popup" class="menu_button" style="width:100%;">管理词库</button>
                </div>
            </div>
        </div>`);
    }

    // 注入弹窗到 BODY
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header"><h3 class="bl-title">净化词库管理</h3><button id="bl-close-btn" class="bl-close">&times;</button></div>
                <div class="bl-input-group"><input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词..."><button id="bl-add-btn" class="bl-add-btn">净化</button></div>
                <div id="bl-tags-container"></div>
                <p style="font-size:12px; color:#4ade80; text-align:center; margin-top:15px; font-weight:bold;">已开启事件联动：新消息生成时自动切除记忆。</p>
            </div>`);
    }
}

function bindEvents() {
    $(document).on('click', '#bl-wand-btn, #bl-open-popup', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).on('click', '#bl-purifier-drawer .inline-drawer-toggle', function() {
        $(this).next('.inline-drawer-content').slideToggle(200);
        $(this).find('.inline-drawer-icon').toggleClass('down up');
    });

    $(document).on('click', '#bl-add-btn', () => {
        const val = $('#bl-input-field').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input-field').val('');
            saveSettingsDebounced();
            renderTags();
            performDeepCleanse(); // 添加新词后立即全局净化
        }
    });

    $(document).on('click', '.bl-tag span', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderTags();
        location.reload(); 
    });

    // --- 核心性能优化：事件监听 ---
    // 1. AI 停止说话时，立即清洗 (解决打字结束后词语跳出)
    eventSource.on(event_types.GENERATION_ENDED, () => {
        console.log(`[${extensionName}] 生成结束，执行同步净化。`);
        performDeepCleanse();
    });

    // 2. 切换角色/加载聊天时，执行一次全量清洗
    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log(`[${extensionName}] 聊天切换，执行全量净化。`);
        performDeepCleanse();
    });
}

function renderTags() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-tags-container').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '<div style="opacity:0.5; width:100%; text-align:center;">净化库为空</div>');
}

jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        setupUI();
        bindEvents();
        performDeepCleanse(); // 启动时清洗一次
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
