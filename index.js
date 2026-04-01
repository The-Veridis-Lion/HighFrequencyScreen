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

// 🛡️ 核心黑科技 1：全频段 DOM 净化器 (修复 querySelectorAll 的“灯下黑”盲区)
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;

    // 1. 净化文本和注释节点 (解决 问题)
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
            // 放过主输入框，防止打字断触
            if (parent.id === 'send_textarea' || (parent.classList && parent.classList.contains('edit_textarea'))) continue;
            // 如果你正点在这个格子里，暂时放过它，防止光标乱跳
            if (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))) continue;
        }

        const original = node.nodeValue || '';
        const cleaned = original.replace(regex, '');
        if (original !== cleaned) {
            node.nodeValue = cleaned;
        }
    }

    // 2. 净化输入框 (Input/Textarea) 的 value
    if (rootNode.nodeType === 1) {
        let inputs = [];
        
        // 关键修复：如果表格插件塞进来的元素【自己本身】就是 input，老代码会把它漏掉！
        if (rootNode.matches && rootNode.matches('input, textarea')) {
            inputs.push(rootNode);
        }
        // 再搜查它的子孙节点
        if (rootNode.querySelectorAll) {
            inputs.push(...Array.from(rootNode.querySelectorAll('input, textarea')));
        }

        inputs.forEach(input => {
            if (input.id === 'send_textarea' || input.classList.contains('edit_textarea')) return;
            if (document.activeElement === input) return; 
            
            // 检查 value 属性
            const originalVal = input.value || '';
            const cleanedVal = originalVal.replace(regex, '');
            if (originalVal !== cleanedVal) {
                input.value = cleanedVal;
            }

            // 检查隐藏的 HTML 属性 (某些表格插件会把数据备份在 attribute 里)
            const attrVal = input.getAttribute('value') || '';
            const cleanedAttr = attrVal.replace(regex, '');
            if (attrVal !== cleanedAttr) {
                input.setAttribute('value', cleanedAttr);
            }
        });
    }
}

// 日常内存清理
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

// 🛡️ 核心黑科技 2：增强版实时防空系统
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        
        mutations.forEach(m => {
            // 拦截新增节点
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    const original = node.nodeValue || '';
                    const cleaned = original.replace(regex, '');
                    if (original !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    purifyDOM(node, regex);
                }
            });
            
            // 拦截文本流式跳动
            if (m.type === 'characterData') {
                const original = m.target.nodeValue || '';
                const cleaned = original.replace(regex, '');
                if (original !== cleaned) m.target.nodeValue = cleaned;
            }

            // 【关键修复 2】：拦截表格插件用 JS 悄悄修改 input 的 value
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
        // 增加 attributes 监控，专抓表格插件的属性暗改
        chatObserver.observe(chatEl, { 
            childList: true, 
            subtree: true, 
            characterData: true,
            attributes: true,
            attributeFilter: ['value', 'innerHTML']
        });
    }

    // 打字拦截
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

// 构建 UI (纯净原版)
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
        initRealtimeInterceptor(); 
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
