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

// 🛡️ 核心黑科技 1：全频段 DOM 净化器 (文本 + 注释 + 表格控件)
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;

    // 1. 扫描所有的文本节点(3) 和 HTML注释节点(8) -> 解决 藏毒问题
    const walker = document.createTreeWalker(
        rootNode, 
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, 
        null, 
        false
    );
    
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeType === 3) { // 文本节点
            const parent = node.parentNode;
            
            // 【取消一刀切的免死金牌】
            if (parent) {
                // 永远放过主聊天输入框和酒馆默认编辑框
                if (parent.id === 'send_textarea' || (parent.classList && parent.classList.contains('edit_textarea'))) continue;
                // 只有当用户正在“激活/聚焦”这个单元格时才放过它，防止光标乱跳
                if (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))) continue;
            }

            const original = node.nodeValue;
            const cleaned = original.replace(regex, '');
            if (original !== cleaned) node.nodeValue = cleaned;
            
        } else if (node.nodeType === 8) { // 注释节点 const original = node.nodeValue;
            const cleaned = original.replace(regex, '');
            if (original !== cleaned) node.nodeValue = cleaned;
        }
    }

    // 2. 如果表格用的是真正的 <input> 框，直接洗刷 value
    if (rootNode.nodeType === 1 && rootNode.querySelectorAll) {
        const inputs = rootNode.querySelectorAll('input, textarea');
        inputs.forEach(input => {
            if (input.id === 'send_textarea' || input.classList.contains('edit_textarea')) return;
            if (document.activeElement === input) return; // 正在输入则跳过
            
            if (input.value && input.value.match(regex)) {
                input.value = input.value.replace(regex, '');
            }
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
            if (msg.mes && msg.mes.match(regex)) {
                msg.mes = msg.mes.replace(regex, '');
                chatChanged = true;
            }
        });
    }
    if (chatChanged) saveChat(); 

    // 将净化范围扩大到整个 DOM (包含表格和思维链)
    purifyDOM(document.getElementById('chat'), regex);
}

// 🛡️ 核心黑科技 2：实时防空系统
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { // 拦截刚生成的文本和注释
                    const cleaned = node.nodeValue.replace(regex, '');
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { // 拦截刚生成的表格/思维链元素
                    purifyDOM(node, regex);
                }
            });
            // 拦截流式输出过程中的变动
            if (m.type === 'characterData') {
                const cleaned = m.target.nodeValue.replace(regex, '');
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true });
    }

    // 监听键盘打字输入 (用于清剿你试图在表格里打出来的脏字)
    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            let val = e.target.value || e.target.innerText;
            if (val && val.match(regex)) {
                const cleaned = val.replace(regex, '');
                if (e.target.value !== undefined) {
                    const pos = e.target.selectionStart;
                    e.target.value = cleaned;
                    try { e.target.selectionStart = e.target.selectionEnd = pos; } catch(err){}
                } else {
                    e.target.innerText = cleaned;
                }
            }
        }
    }, true);
}

// 构建 UI (保持原样)
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
        initRealtimeInterceptor(); // 开启增强版实时防空导弹
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
