import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { bannedWords: [] };

function getPurifyRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// 轻量级清理：日常 AI 说话或编辑时触发，不深挖历史隐藏分支，节省内存
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

// 💥 新增核心：深度历史与隐藏分支大扫除 (手动触发)
function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    let cleanedMessages = 0;
    let cleanedSwipes = 0;
    let chatChanged = false;

    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            // 1. 清理主消息 (包含几千条未加载的历史)
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                chatChanged = true;
                cleanedMessages++;
            }
            // 2. 清理背后隐藏的备选滑动分支 (Swipes)
            if (msg.swipes && Array.isArray(msg.swipes)) {
                msg.swipes.forEach((swipe, index) => {
                    if (swipe && regex.test(swipe)) {
                        msg.swipes[index] = swipe.replace(regex, '');
                        chatChanged = true;
                        cleanedSwipes++;
                    }
                });
            }
        });
    }

    if (chatChanged) {
        saveChat(); // 强制存入硬盘，彻底斩断复读根源
        // 顺便清理当前屏幕
        $('.mes_text').each(function() {
            const html = $(this).html();
            if (regex.test(html)) $(this).html(html.replace(regex, ''));
        });
        alert(`✅ 深度净化完成！\n共抹除了 ${cleanedMessages} 条主消息 和 ${cleanedSwipes} 个隐藏备选回复中的八股词。`);
    } else {
        alert("历史记录很干净，没有发现屏蔽词！");
    }
}

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
                <div class="bl-header">
                    <h3 class="bl-title">屏蔽词汇管理</h3>
                    <button id="bl-close-btn" class="bl-close">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词...">
                    <button id="bl-add-btn" class="bl-add-btn">添加</button>
                </div>
                <div id="bl-tags-container"></div>
                <div class="bl-footer">
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">
                        <i class="fa-solid fa-skull-crossbones"></i> 一键净化全量历史
                    </button>
                </div>
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

    $(document).on('click', '.bl-tag span', function() {
        extension_settings[extensionName].bannedWords.splice($(this).data('index'), 1);
        saveSettingsDebounced();
        renderTags();
    });

    // 绑定深度清理按钮
    $(document).on('click', '#bl-deep-clean-btn', () => {
        if(confirm("将扫描并抹除整个聊天记录（含备选分支）中的屏蔽词。这可能需要一两秒钟，确定执行吗？")) {
            performDeepCleanse();
        }
    });

    eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performGlobalCleanse, 100));
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
