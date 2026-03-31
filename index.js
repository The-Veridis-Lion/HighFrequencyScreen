import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "ultimate_data_purifier";
const defaultSettings = { bannedWords: ["极度", "极其", "病态"] };

// --- 移植自你的逻辑：正则清洗核心 ---
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPurifiedText(text) {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length || typeof text !== 'string') return text;

    // 长词优先排序，确保“他妈的”优先于“他妈”
    const sortedWords = [...words].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(sortedWords.map(escapeRegExp).join('|'), 'gmu');
    
    // 全部替换为空字符串
    return text.replace(pattern, '');
}

/**
 * 核心：物理切除 window.chat 里的记忆
 */
async function performDeepCleanse() {
    if (!window.chat || !Array.isArray(window.chat)) return;
    
    let changed = false;
    window.chat.forEach(msg => {
        if (msg.mes) {
            const original = msg.mes;
            const fixed = getPurifiedText(original);
            if (original !== fixed) {
                msg.mes = fixed;
                changed = true;
            }
        }
    });

    if (changed) {
        // 修改内存后，立即同步到界面显示
        $('.mes_text').each(function() {
            const mesId = $(this).closest('.mes').attr('mesid');
            if (window.chat[mesId]) {
                $(this).html(window.chat[mesId].mes);
            }
        });
        // 物理保存聊天 JSON，切断 AI 记忆并清理“小铅笔”
        await saveChat();
    }
}

// --- UI 部分 (确保悬浮) ---
function setupUI() {
    // 注入魔法棒
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词净化" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
                <i class="fa-solid fa-soap"></i><span>净化词</span>
            </div>`);
    }

    // 注入扩展菜单
    if (!$('#bl-drawer-item').length) {
        $("#extensions_settings").append(`
        <div id="bl-drawer-item" class="hide-helper-container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header interactable">
                    <b>🚫 屏蔽词全自动净化</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding:10px; display:none;">
                    <button id="bl-open-modal" class="menu_button" style="width:100%;">管理词库</button>
                </div>
            </div>
        </div>`);
    }

    // 注入弹窗到 body 底部，确保 fixed 定位不顶栏
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header">
                    <h3 class="bl-title">词库深度管理</h3>
                    <button id="bl-close-btn" class="bl-close">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-input-field" class="bl-input" placeholder="输入你想消失的词...">
                    <button id="bl-add-btn" class="bl-add-btn">添加</button>
                </div>
                <div id="bl-tags-container"></div>
                <p style="font-size:12px; color:#4ade80; text-align:center; margin-top:15px; font-weight:bold;">
                    <i class="fa-solid fa-check-double"></i> 长词优先匹配，物理切除数据层。
                </p>
            </div>`);
    }
}

// 事件绑定
function bindEvents() {
    $(document).on('click', '#bl-wand-btn, #bl-open-modal', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).on('click', '#bl-drawer-item .inline-drawer-toggle', function() {
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
            performDeepCleanse(); // 添加词后立即全量清洗
        }
    });

    $(document).on('click', '.bl-tag span', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderTags();
        if(confirm('删除规则建议刷新页面以还原。')) location.reload();
    });

    // --- 核心：移植你的事件监听逻辑 ---
    // 1. AI 说话结束时：清洗刚生成的这一条
    eventSource.on(event_types.GENERATION_ENDED, performDeepCleanse);
    // 2. 消息被编辑并保存后：立即再次清洗，防止编辑框里存入屏蔽词
    eventSource.on(event_types.MESSAGE_EDITED, performDeepCleanse);
    // 3. 聊天切换时
    eventSource.on(event_types.CHAT_CHANGED, performDeepCleanse);
}

function renderTags() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-tags-container').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '词库为空');
}

jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const init = () => {
        setupUI();
        bindEvents();
        performDeepCleanse();
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
        if (document.getElementById('send_textarea')) init();
    }
});
