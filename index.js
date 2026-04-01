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

// ☢️ 核心黑科技：非递归深度洗刷 (绝对不放过 tableEdit 藏在 extra 里的任何嵌套数据)
function deepScrub(obj, regex) {
    let changes = 0;
    if (obj === null || typeof obj !== 'object') return changes;

    const stack = [obj];
    const seen = new Set(); // 防止复杂数据结构导致死循环

    while(stack.length > 0) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);

        for (let key in current) {
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                const val = current[key];
                if (typeof val === 'string') {
                    const cleaned = val.replace(regex, '');
                    if (cleaned !== val) {
                        current[key] = cleaned;
                        changes++;
                    }
                } else if (val !== null && typeof val === 'object') {
                    stack.push(val);
                }
            }
        }
    }
    return changes;
}

// 日常打字防复读 (轻量级)
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

// 💥 终极锁死大扫除 (手动触发)
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先在上方添加需要屏蔽的词汇！");
        return;
    }

    // 1. 弹出强力遮罩，锁死 UI 操作，防止表格插件在此时抢占写入
    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:24px;">🔪 正在执行底层代码级清剿...</h2>
            <p style="color:#ff6b6b;font-weight:bold;">正在强制锁定硬盘写入，请勿关闭或刷新页面！</p>
        </div>
    `);

    let scrubbedItems = 0;
    let chatChanged = false;

    // 2. 深度洗刷所有聊天记录
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
        try {
            // 3. 强制异步保存
            const savePromise = saveChat();
            if (savePromise instanceof Promise) {
                await savePromise;
            }
            
            // 4. 关键：额外硬核等待 2 秒钟
            // 确保 Node.js 彻底将 .jsonl 写入固态硬盘，防止 F5 刷新杀掉进程
            await new Promise(r => setTimeout(r, 2000));
            
            $('#bl-loading-overlay').remove();
            alert(`✅ 连根拔起！\n\n已刺穿表格代码及隐藏数据库，共清剿了 ${scrubbedItems} 处八股词死角。\n\n点击确定后将刷新页面。`);
            location.reload(); 
        } catch (e) {
            console.error("数据写入失败:", e);
            $('#bl-loading-overlay').remove();
            alert("写入硬盘失败，请按 F12 检查控制台报错。");
        }
    } else {
        $('#bl-loading-overlay').remove();
        alert("底层记录极度干净！所有角落都没找到屏蔽词！\n(如果屏幕上还有，请检查你的世界书或角色设定是否自带了该词)");
    }
}

// 小铅笔编辑框监听
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

    // 绑定核弹按钮
    $(document).on('click', '#bl-deep-clean-btn', () => {
        if(confirm("将使用深度剥离算法清理整个聊天记录及所有插件的暗藏数据包。\n此操作将锁定屏幕数秒，确定执行吗？")) {
            performDeepCleanse();
        }
    });

    eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performGlobalCleanse, 100));
    eventSource.on(event_types.GENERATION_ENDED, performGlobalCleanse);
    eventSource.on(event_types.CHAT_CHANGED, performGlobalCleanse);
}

// 渲染UI标签
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
