import { extension_settings } from "../../../extensions.js";
// 引入 chat_metadata 用于清理表格私密金库
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { bannedWords: [] };

function getPurifyRegex() {
    const words = extension_settings[extensionName]?.bannedWords || [];
    if (!words.length) return null;
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${escaped.join('|')})`, 'gmu');
}

// 🛡️ 核心黑科技 1：全频段 DOM 净化器
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;

    const walker = document.createTreeWalker(
        rootNode, 
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, 
        null, 
        false
    );
    
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        if (parent) {
            if (parent.id === 'send_textarea' || (parent.classList && parent.classList.contains('edit_textarea'))) continue;
            if (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))) continue;
        }

        const original = node.nodeValue || '';
        const cleaned = original.replace(regex, '');
        if (original !== cleaned) {
            node.nodeValue = cleaned;
        }
    }

    if (rootNode.nodeType === 1) {
        let inputs = [];
        if (rootNode.matches && rootNode.matches('input, textarea')) inputs.push(rootNode);
        if (rootNode.querySelectorAll) inputs.push(...Array.from(rootNode.querySelectorAll('input, textarea')));

        inputs.forEach(input => {
            if (input.id === 'send_textarea' || input.classList.contains('edit_textarea')) return;
            if (document.activeElement === input) return; 
            
            const originalVal = input.value || '';
            const cleanedVal = originalVal.replace(regex, '');
            if (originalVal !== cleanedVal) input.value = cleanedVal;

            const attrVal = input.getAttribute('value') || '';
            const cleanedAttr = attrVal.replace(regex, '');
            if (attrVal !== cleanedAttr) input.setAttribute('value', cleanedAttr);
        });
    }
}

// 日常内存及全屏清理
function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;

    let chatChanged = false;
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            if (msg.mes) {
                const cleaned = msg.mes.replace(regex, '');
                if (msg.mes !== cleaned) {
                    msg.mes = cleaned;
                    chatChanged = true;
                }
            }
        });
    }
    if (chatChanged) saveChat(); 

    purifyDOM(document.getElementById('chat'), regex);
}

// 💥 【新增】深度屏蔽功能 (三相弹扫除法)
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.9);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:24px;">☢️ 正在执行深度屏蔽...</h2>
            <p style="color:#ff6b6b;font-weight:bold;">正在强制摧毁主聊天、元数据及扩展缓存中的屏蔽词，请勿操作！</p>
        </div>
    `);

    await new Promise(r => setTimeout(r, 100));

    try {
        let chatString = JSON.stringify(window.chat || []);
        let metaString = JSON.stringify(chat_metadata || {});
        let extString = JSON.stringify(extension_settings || {});

        const totalLengthBefore = chatString.length + metaString.length + extString.length;

        chatString = chatString.replace(regex, '');
        metaString = metaString.replace(regex, '');
        extString = extString.replace(regex, '');

        const totalLengthAfter = chatString.length + metaString.length + extString.length;

        if (totalLengthBefore !== totalLengthAfter) {
            window.chat.splice(0, window.chat.length, ...JSON.parse(chatString));
            
            const parsedMeta = JSON.parse(metaString);
            for (let key in parsedMeta) { chat_metadata[key] = parsedMeta[key]; }
            
            const parsedExt = JSON.parse(extString);
            for (let key in parsedExt) { extension_settings[key] = parsedExt[key]; }

            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            
            await new Promise(r => setTimeout(r, 2000));
            
            $('#bl-loading-overlay').remove();
            const diff = totalLengthBefore - totalLengthAfter;
            alert(`✅ 深度屏蔽成功！\n\n已强制蒸发了 ${diff} 个屏蔽字符（含隐藏表格数据）。\n\n点击确定后网页将刷新。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("三大数据库均已干净，未发现屏蔽词！");
        }
    } catch (e) {
        console.error("深度屏蔽失败:", e);
        $('#bl-loading-overlay').remove();
        alert("操作失败！请按 F12 检查控制台。");
    }
}

// 🛡️ 核心黑科技 2：实时防空系统
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    const original = node.nodeValue || '';
                    const cleaned = original.replace(regex, '');
                    if (original !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    purifyDOM(node, regex);
                }
            });
            
            if (m.type === 'characterData') {
                const original = m.target.nodeValue || '';
                const cleaned = original.replace(regex, '');
                if (original !== cleaned) m.target.nodeValue = cleaned;
            }

            if (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'innerHTML')) {
                const el = m.target;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    if (document.activeElement !== el) {
                        const original = el.value || '';
                        const cleaned = original.replace(regex, '');
                        if (original !== cleaned) el.value = cleaned;
                    }
                }
            }
        });
    });

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        chatObserver.observe(chatEl, { 
            childList: true, 
            subtree: true, 
            characterData: true,
            attributes: true,
            attributeFilter: ['value', 'innerHTML']
        });
    }

    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            let val = e.target.value;
            if (val === undefined) val = e.target.innerText;
            
            if (val) {
                const cleaned = val.replace(regex, '');
                if (val !== cleaned) {
                    if (e.target.value !== undefined) {
                        const pos = e.target.selectionStart;
                        e.target.value = cleaned;
                        try { e.target.selectionStart = e.target.selectionEnd = pos; } catch(err){}
                    } else {
                        e.target.innerText = cleaned;
                    }
                }
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
                        <i class="fa-solid fa-shield-halved"></i> 深度屏蔽
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

    // 绑定深度屏蔽点击事件
    $(document).on('click', '#bl-deep-clean-btn', () => {
        if(confirm("警告：此操作将重构聊天库、元数据以及扩展全局缓存！\n专治各种顽固表格插件，确定执行吗？")) {
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
        initRealtimeInterceptor(); 
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
