import { extension_settings } from "../../../extensions.js";
// 引入 chat_metadata 用于清理表格插件的私有金库
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

// ☢️ 核心黑科技 1：防崩溃深度洗刷 (带插件白名单保护)
function safeDeepScrub(rootObj, regex, isGlobalSettings = false) {
    let changes = 0;
    if (!rootObj || typeof rootObj !== 'object') return changes;
    
    const stack = [rootObj];
    const seen = new Set(); 

    while (stack.length > 0) {
        const current = stack.pop();
        
        if (seen.has(current)) continue;
        seen.add(current);

        try {
            for (let key in current) {
                if (Object.prototype.hasOwnProperty.call(current, key)) {
                    // 【核心修复】：如果是全局设置，且当前正在扫描我们插件自己的配置块，直接跳过！
                    // 这样就不会发生“屏蔽词列表把自己删掉”的尴尬情况了
                    if (isGlobalSettings && key === extensionName) continue;

                    const val = current[key];
                    if (typeof val === 'string') {
                        const cleaned = val.replace(regex, '');
                        if (val !== cleaned) {
                            current[key] = cleaned;
                            changes++;
                        }
                    } else if (val !== null && typeof val === 'object') {
                        stack.push(val); 
                    }
                }
            }
        } catch(e) { }
    }
    return changes;
}

// 🛡️ 核心黑科技 2：全频段 DOM 净化器 (文本 + 注释 + 输入框)
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
        });
    }
}

// 日常打字防复读
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

// 💥 【深度屏蔽】手动触发：全量清剿 + 自动刷新
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:24px;">☢️ 正在执行深度屏蔽...</h2>
            <p style="color:#ff6b6b;font-weight:bold;">正在穿透数据库，已自动避开屏蔽词列表，请稍候...</p>
        </div>
    `);

    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;

        // 1. 洗刷聊天记录
        if (window.chat && Array.isArray(window.chat)) {
            scrubbedItems += safeDeepScrub(window.chat, regex, false);
        }
        // 2. 洗刷表格插件元数据
        if (typeof chat_metadata === 'object' && chat_metadata !== null) {
            scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        }
        // 3. 洗刷扩展设置 (启用白名单模式，不删自己)
        if (typeof extension_settings === 'object' && extension_settings !== null) {
            scrubbedItems += safeDeepScrub(extension_settings, regex, true);
        }

        if (scrubbedItems > 0) {
            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            
            // 等待硬盘写入，然后刷新
            await new Promise(r => setTimeout(r, 2000)); 
            
            $('#bl-loading-overlay').remove();
            alert(`✅ 深度屏蔽成功！\n\n共清剿了 ${scrubbedItems} 处残留。\n屏蔽词列表已受保护。网页即将刷新以更新表格画面。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("三大数据库均已干净，未发现屏蔽词！");
        }
    } catch (e) {
        console.error("深度屏蔽失败:", e);
        $('#bl-loading-overlay').remove();
        alert("操作失败，请按 F12 检查控制台。");
    }
}

// 🛡️ 实时防空系统
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
        });
    });

    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

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

function bindEvents() {
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).off('click', '#bl-add-btn').on('click', '#bl-add-btn', () => {
        const val = $('#bl-input-field').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input-field').val('');
            saveSettingsDebounced();
            renderTags();
            performGlobalCleanse(); 
        }
    });
    $(document).off('click', '.bl-tag span').on('click', '.bl-tag span', function() {
        extension_settings[extensionName].bannedWords.splice($(this).data('index'), 1);
        saveSettingsDebounced();
        renderTags();
    });
    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', () => {
        if(confirm("警告：将重写数据库（含元数据及扩展缓存）！屏蔽词列表已受保护。确定执行吗？")) {
            performDeepCleanse();
        }
    });

    eventSource.removeListener(event_types.MESSAGE_EDITED, performGlobalCleanse);
    eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performGlobalCleanse, 100));
    eventSource.on(event_types.GENERATION_ENDED, performGlobalCleanse);
}

function renderTags() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-tags-container').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px;">空</div>');
}

let isBooted = false;
jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        if (isBooted) return;
        isBooted = true;
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
