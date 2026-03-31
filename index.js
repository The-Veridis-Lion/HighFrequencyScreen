import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { bannedWords: [] };

// 1. 获取正则对象：长词优先逻辑
function getPurifyRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// 2. 物理净化：内存数据同步切除
function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;

    let chatChanged = false;
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                chatChanged = true;
            }
        });
    }
    if (chatChanged) saveChat(); 

    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) $(this).html(html.replace(regex, ''));
    });
}

// 3. 拦截编辑框 (小铅笔) 弹窗残留
function initEditInterceptor() {
    const observer = new MutationObserver(() => {
        const regex = getPurifyRegex();
        if (!regex) return;
        $('.edit_textarea').each(function() {
            if (regex.test(this.value)) this.value = this.value.replace(regex, '');
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            if (regex.test(e.target.value)) {
                const pos = e.target.selectionStart;
                e.target.value = e.target.value.replace(regex, '');
                e.target.selectionStart = e.target.selectionEnd = pos;
            }
        }
    }, true);
}

function setupUI() {
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词汇">
                <i class="fa-solid fa-eraser fa-fw"></i><span>屏蔽词汇</span>
            </div>`);
    }
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header"><h3 class="bl-title">屏蔽词汇管理</h3><button id="bl-close-btn" class="bl-close">&times;</button></div>
                <div class="bl-input-group"><input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词..."><button id="bl-add-btn" class="bl-add-btn">添加</button></div>
                <div id="bl-tags-container"></div>
            </div>`);
    }
}

function bindEvents() {
    $(document).on('click', '#bl-wand-btn', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    
    $(document).on('click', '#bl-add-btn', () => {
        const val = $('#bl-input-field').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input-field').val('');
            saveSettingsDebounced();
            renderTags();
            performGlobalCleanse(); 
        }
    });

    // --- 核心修复：移除 location.reload()，实现不刷新删除 ---
    $(document).on('click', '.bl-tag span', function() {
        const index = $(this).data('index');
        // 从数组中删除
        extension_settings[extensionName].bannedWords.splice(index, 1);
        // 保存并立即刷新弹窗内的标签列表
        saveSettingsDebounced();
        renderTags();
        // 注意：由于之前的文字已经物理抹除，已消失的字在不刷新的情况下不会立刻回来，
        // 但此后的新消息和新操作将不再受该屏蔽词影响。
    });

    eventSource.on(event_types.GENERATION_ENDED, performGlobalCleanse);
    eventSource.on(event_types.CHAT_CHANGED, performGlobalCleanse);
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
        initEditInterceptor();
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
