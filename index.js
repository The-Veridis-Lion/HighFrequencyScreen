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

// 🛡️ 核心黑科技 1：全域文本节点净化器 (无视任何 HTML 容器，专杀思维链和表格)
function purifyTextNodes(rootNode, regex) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        // 避开输入框，防止打字时被强行删词导致光标乱跳
        if (parent && (parent.tagName === 'TEXTAREA' || parent.tagName === 'INPUT' || parent.isContentEditable)) continue;
        
        const original = node.nodeValue;
        const cleaned = original.replace(regex, '');
        if (original !== cleaned) {
            node.nodeValue = cleaned; // 直接在渲染底层抹杀
        }
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

    // 对整个聊天区进行文本节点洗刷 (包含思维链、表格、正文)
    purifyTextNodes(document.getElementById('chat'), regex);
}

// 💥 降维打击大扫除 (保留上一版的核弹级序列化功能)
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.9);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:24px;">🚀 正在执行降维打击...</h2>
            <p style="color:#ff6b6b;font-weight:bold;">正在将整个数据库压扁并抹杀屏蔽词，请勿关闭页面！</p>
        </div>
    `);

    await new Promise(r => setTimeout(r, 100));

    try {
        let chatString = JSON.stringify(window.chat);
        const originalLength = chatString.length;
        
        chatString = chatString.replace(regex, '');

        if (chatString.length !== originalLength) {
            const parsed = JSON.parse(chatString);
            window.chat.splice(0, window.chat.length, ...parsed);
            
            const savePromise = saveChat();
            if (savePromise instanceof Promise) {
                await savePromise;
            }
            
            await new Promise(r => setTimeout(r, 2000)); // 等待硬盘写入
            
            $('#bl-loading-overlay').remove();
            
            const diff = originalLength - chatString.length;
            alert(`✅ 降维打击成功！\n\n以纯文本形式强制蒸发了 ${diff} 个屏蔽字符。\n\n点击确定后网页将刷新。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("降维扫描完毕，聊天记录（包括隐藏代码）中已不存在屏蔽词！");
        }
    } catch (e) {
        console.error("降维打击失败:", e);
        $('#bl-loading-overlay').remove();
        alert("操作失败！JSON解析出错，请按 F12 检查控制台。");
    }
}

// 🛡️ 核心黑科技 2：实时防空系统 (实时拦截 AI 的流式打字过程)
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        
        mutations.forEach(m => {
            // 拦截所有新加入的节点 (包含刚蹦出来的思维链文字)
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3) { // 纯文字节点
                    const cleaned = node.nodeValue.replace(regex, '');
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { // 元素节点
                    purifyTextNodes(node, regex);
                }
            });
            // 拦截文字内容的修改 (流式输出的更新过程)
            if (m.type === 'characterData') {
                const cleaned = m.target.nodeValue.replace(regex, '');
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        // 开启最高级别的监控：监控子节点增删、树状结构变化、以及文字数据的实时跳动
        chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true });
    }

    // 依然保留对输入框小铅笔的拦截
    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            if (e.target.value.match(regex)) {
                const pos = e.target.selectionStart;
                e.target.value = e.target.value.replace(regex, '');
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
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn" style="margin-top:15px; width:100%; padding:10px; background:#ff4757; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">
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

    $(document).on('click', '#bl-deep-clean-btn', () => {
        if(confirm("警告：此操作将使用序列化手段彻底重构聊天数据库！\n过程不可逆，屏幕将会锁死几秒钟，确定执行吗？")) {
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
        initRealtimeInterceptor(); // 开启实时防空导弹
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
