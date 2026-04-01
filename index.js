import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { bannedWords: [] };

function getPurifyRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // gmu: 全局、多行、Unicode 匹配
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// ☢️ 核心黑科技：全维度递归洗刷
// 不管表格插件把数据藏在正文(mes)、滑动分支(swipes)还是扩展私密口袋(extra)里，全部揪出来洗掉
function deepScrub(obj, regex) {
    let changes = 0;
    if (obj === null || typeof obj !== 'object') return changes;

    for (let key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            if (typeof obj[key] === 'string') {
                const original = obj[key];
                // 直接替换，避开 test() 的全局索引陷阱
                const cleaned = original.replace(regex, '');
                if (original !== cleaned) {
                    obj[key] = cleaned;
                    changes++;
                }
            } else if (typeof obj[key] === 'object') {
                changes += deepScrub(obj[key], regex);
            }
        }
    }
    return changes;
}

// 日常轻量级清理 (防卡顿，只扫最近50条和当前屏幕)
function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;

    let chatChanged = false;
    if (window.chat && Array.isArray(window.chat)) {
        // 只扫描最近的 50 条消息，保证日常打字丝滑
        const startIdx = Math.max(0, window.chat.length - 50);
        for (let i = startIdx; i < window.chat.length; i++) {
            if (deepScrub(window.chat[i], regex) > 0) {
                chatChanged = true;
            }
        }
    }
    if (chatChanged) saveChat(); 

    // 清理屏幕上的渲染文本
    $('.mes_text').each(function() {
        const html = $(this).html();
        const cleaned = html.replace(regex, '');
        if (html !== cleaned) $(this).html(cleaned);
    });
}

// 💥 一键核弹清理 (手动触发，洗刷几千条历史与所有插件缓存)
function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    let scrubbedItems = 0;
    let chatChanged = false;

    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            const changes = deepScrub(msg, regex);
            if (changes > 0) {
                scrubbedItems += changes;
                chatChanged = true;
            }
        });
    }

    if (chatChanged) {
        saveChat(); // 强制存入硬盘，彻底斩断复读根源
        alert(`✅ 核弹级净化完成！\n\n深度剥离了正文、备选分支及【表格插件隐藏缓存区】，共清剿了 ${scrubbedItems} 处八股词残留。\n\n网页即将自动刷新，彻底消灭表格画面。`);
        // 核心修复：强制刷新页面，让表格插件重新读取已经被洗干净的数据
        location.reload(); 
    } else {
        alert("底层记录很干净，没有发现屏蔽词！\n(如果屏幕上还有，可能是你在其他例如‘总结’或‘数据库’插件里单独手打的，去那边删一下即可)");
    }
}

// 拦截小铅笔编辑框
function initEditInterceptor() {
    const observer = new MutationObserver(() => {
        const regex = getPurifyRegex();
        if (!regex) return;
        $('.edit_textarea').each(function() {
            const val = this.value;
            const cleaned = val.replace(regex, '');
            if (val !== cleaned) this.value = cleaned;
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            const val = e.target.value;
            const cleaned = val.replace(regex, '');
            if (val !== cleaned) {
                const pos = e.target.selectionStart;
                e.target.value = cleaned;
                e.target.selectionStart = e.target.selectionEnd = pos;
            }
        }
    }, true);
}

// 构建 UI
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

// 绑定事件
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

    // 绑定核弹清理按钮
    $(document).on('click', '#bl-deep-clean-btn', () => {
        if(confirm("将扫描并抹除整个聊天记录（包含所有插件隐藏数据包）中的屏蔽词。\n清理完毕后网页会自动刷新，确定执行吗？")) {
            performDeepCleanse();
        }
    });

    eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performGlobalCleanse, 100));
    eventSource.on(event_types.GENERATION_ENDED, performGlobalCleanse);
    eventSource.on(event_types.CHAT_CHANGED, performGlobalCleanse);
}

// 渲染标签
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
