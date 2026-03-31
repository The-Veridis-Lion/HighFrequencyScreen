import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "purifier_logic";
const defaultSettings = { bannedWords: [] };

// 生成正则：长词优先算法
function getRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// 核心净化：物理切除内存数据与 DOM
function performCleanse() {
    const regex = getRegex();
    if (!regex) return;

    let changed = false;

    // 1. 切除内存数据 (解决编辑框残留，切断 AI 记忆)
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                changed = true;
            }
        });
    }

    if (changed) saveChat(); // 物理保存到 JSON 存档

    // 2. 净化屏幕显示
    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) $(this).html(html.replace(regex, ''));
    });
}

// 实时监听：物理切除编辑框输入
function initInputInterceptor() {
    document.addEventListener('input', (e) => {
        const regex = getRegex();
        if (!regex) return;
        const el = e.target;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            if (regex.test(el.value)) {
                const pos = el.selectionStart;
                el.value = el.value.replace(regex, '');
                el.selectionStart = el.selectionEnd = pos;
            }
        }
    }, true);
}

function setupUI() {
    // 注入快捷按钮
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`<div id="bl-wand-btn" title="净化器" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);"><i class="fa-solid fa-eraser"></i><span>净化</span></div>`);
    }
    // 注入菜单入口
    if (!$('#bl-menu-item').length) {
        $("#extensions_settings").append(`<div id="bl-menu-item" class="hide-helper-container"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header interactable"><b>🚫 屏蔽词净化</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="padding:10px; display:none;"><button id="bl-open-popup" class="menu_button" style="width:100%;">管理词库</button></div></div></div>`);
    }
    // 注入悬浮窗
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`<div id="bl-purifier-popup"><div class="bl-header"><h3 class="bl-title">净化管理</h3><button id="bl-close-btn" class="bl-close">&times;</button></div><div class="bl-input-group"><input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词..."><button id="bl-add-btn" class="bl-add-btn">添加</button></div><div id="bl-tags-container"></div></div>`);
    }
}

function bindEvents() {
    const popup = $('#bl-purifier-popup');
    $(document).on('click', '#bl-wand-btn, #bl-open-popup', () => { renderTags(); popup.fadeIn(200); });
    $(document).on('click', '#bl-close-btn', () => popup.fadeOut(200));
    $(document).on('click', '#bl-menu-item .inline-drawer-toggle', function() {
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
            performCleanse(); 
        }
    });

    $(document).on('click', '.bl-tag span', function() {
        extension_settings[extensionName].bannedWords.splice($(this).data('index'), 1);
        saveSettingsDebounced();
        renderTags();
        location.reload(); 
    });

    // 事件驱动打击
    eventSource.on(event_types.GENERATION_ENDED, performCleanse);
    eventSource.on(event_types.CHAT_CHANGED, performCleanse);
    eventSource.on(event_types.MESSAGE_EDITED, performCleanse);
}

function renderTags() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-tags-container').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px;">空</div>');
}

jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        setupUI();
        bindEvents();
        initInputInterceptor();
        performCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
