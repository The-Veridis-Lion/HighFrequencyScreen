import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { bannedWords: [] };

// 1. 获取正则对象：采用长词优先排序，防止短词干扰
function getPurifyRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// 2. 物理净化：同时切除内存、存档和当前显示
function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;

    let chatChanged = false;
    // 切除内存数据 (让小铅笔编辑时也没词)
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                chatChanged = true;
            }
        });
    }
    // 强制存档，切断 AI 记忆抓取的后路
    if (chatChanged) saveChat();

    // 净化当前页面上可见的文字
    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) $(this).html(html.replace(regex, ''));
    });
}

// 3. 强力监控：捕获编辑框 (小铅笔) 弹出的瞬间并立即清洗
function initEditInterceptor() {
    // 监控 DOM 变化：当编辑框出现时立即处理内容
    const observer = new MutationObserver(() => {
        const regex = getPurifyRegex();
        if (!regex) return;
        // 针对酒馆编辑器的文本区域进行实时清洗
        $('.edit_textarea').each(function() {
            if (regex.test(this.value)) {
                this.value = this.value.replace(regex, '');
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 监听实时输入 (防止用户手动输入被屏蔽词)
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
        $('#data_bank_wand_container').append(`<div id="bl-wand-btn" title="净化器" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer;"><i class="fa-solid fa-eraser"></i><span>净化</span></div>`);
    }
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`<div id="bl-purifier-popup"><div class="bl-header"><h3 class="bl-title">屏蔽词净化</h3><button id="bl-close-btn" class="bl-close">&times;</button></div><div class="bl-input-group"><input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词..."><button id="bl-add-btn" class="bl-add-btn">净化</button></div><div id="bl-tags-container"></div></div>`);
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
    $(document).on('click', '.bl-tag span', function() {
        extension_settings[extensionName].bannedWords.splice($(this).data('index'), 1);
        saveSettingsDebounced();
        renderTags();
        location.reload(); 
    });
    // 事件驱动：消息结束或切换时清洗
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
        initEditInterceptor(); // 核心：启动编辑框实时拦截
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
