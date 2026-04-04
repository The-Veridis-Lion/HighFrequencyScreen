import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [] };

// 声明变量
let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 

// 处理文本分词
function parseInputToWords(text) {
    if (!text) return [];
    const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
    return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
}

// 构建正则表达式与映射
function getPurifyRegex() {
    if (!isRegexDirty) return cachedRegex;

    const rules = extension_settings[extensionName]?.rules || [];
    wordToRuleMap = {};
    let allTargets = [];

    rules.forEach(rule => {
        rule.targets.forEach(t => {
            if (t) {
                allTargets.push(t);
                wordToRuleMap[t] = rule.replacements;
            }
        });
    });

    if (!allTargets.length) {
        cachedRegex = null;
    } else {
        // 执行长度降序排列
        const sorted = [...allTargets].sort((a, b) => b.length - a.length);
        const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        cachedRegex = new RegExp(`(${escaped.join('|')})`, 'gmu');
    }
    
    isRegexDirty = false;
    return cachedRegex;
}

// 执行替换映射
function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    if (!reps || reps.length === 0) return ''; 
    const randIndex = Math.floor(Math.random() * reps.length); 
    return reps[randIndex];
}

// 遍历对象属性
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
                    if (isGlobalSettings && key === extensionName) continue; 
                    const val = current[key];
                    if (typeof val === 'string') {
                        const cleaned = val.replace(regex, dynamicReplacer);
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

// 处理 DOM 节点
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, null, false);
    
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        if (parent) {
            if (parent.id === 'send_textarea' || (parent.classList && parent.classList.contains('edit_textarea'))) continue;
            if (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))) continue;
        }
        const original = node.nodeValue || '';
        const cleaned = original.replace(regex, dynamicReplacer);
        if (original !== cleaned) node.nodeValue = cleaned;
    }

    if (rootNode.nodeType === 1) {
        let inputs = [];
        if (rootNode.matches && rootNode.matches('input, textarea')) inputs.push(rootNode);
        if (rootNode.querySelectorAll) inputs.push(...Array.from(rootNode.querySelectorAll('input, textarea')));

        inputs.forEach(input => {
            if (input.id === 'send_textarea' || input.classList.contains('edit_textarea') || document.activeElement === input) return;
            const originalVal = input.value || '';
            const cleanedVal = originalVal.replace(regex, dynamicReplacer);
            if (originalVal !== cleanedVal) input.value = cleanedVal;
        });
    }
}

// 更新数据层
function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;
    let chatChanged = false;
    
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach((msg, index) => {
            let msgChanged = false; 
            
            // 更新 msg.mes
            if (typeof msg.mes === 'string') {
                const cleaned = msg.mes.replace(regex, dynamicReplacer);
                if (msg.mes !== cleaned) { 
                    msg.mes = cleaned; 
                    msgChanged = true; 
                }
            }
            
            // 更新 msg.swipes
            if (msg.swipes && Array.isArray(msg.swipes)) {
                for (let i = 0; i < msg.swipes.length; i++) {
                    if (typeof msg.swipes[i] === 'string') {
                        const cleanedSwipe = msg.swipes[i].replace(regex, dynamicReplacer);
                        if (msg.swipes[i] !== cleanedSwipe) {
                            msg.swipes[i] = cleanedSwipe;
                            msgChanged = true;
                        }
                    } else if (typeof msg.swipes[i] === 'object' && msg.swipes[i] !== null && typeof msg.swipes[i].mes === 'string') {
                        const cleanedSwipe = msg.swipes[i].mes.replace(regex, dynamicReplacer);
                        if (msg.swipes[i].mes !== cleanedSwipe) {
                            msg.swipes[i].mes = cleanedSwipe;
                            msgChanged = true;
                        }
                    }
                }
            }

            // 调用视图刷新
            if (msgChanged) {
                chatChanged = true;
                try {
                    if (typeof updateMessageBlock === 'function') {
                        setTimeout(() => updateMessageBlock(index, window.chat[index]), 50);
                    }
                } catch(e) {}
            }
        });
    }
    
    // 执行文件保存
    if (chatChanged) {
        try {
            if (typeof saveChat === 'function') saveChat();
        } catch(e) {
            console.error("存盘失败", e);
        }
    }
    
    // 清理当前 DOM
    purifyDOM(document.getElementById('chat'), regex);
}

// 执行深度扫描
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("请添加规则。"); return; }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:20px;">执行数据替换</h2>
            <p>等待磁盘同步。</p>
        </div>
    `);
    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;
        if (window.chat && Array.isArray(window.chat)) scrubbedItems += safeDeepScrub(window.chat, regex, false);
        if (typeof chat_metadata === 'object' && chat_metadata !== null) scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        if (typeof extension_settings === 'object' && extension_settings !== null) scrubbedItems += safeDeepScrub(extension_settings, regex, true);

        if (scrubbedItems > 0) {
            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            await new Promise(r => setTimeout(r, 2000)); 
            $('#bl-loading-overlay').remove();
            
            alert(`共处理 ${scrubbedItems} 项。\n\n刷新后请恢复预设。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现匹配数据。\n\n可恢复预设。");
        }
    } catch (e) {
        $('#bl-loading-overlay').remove();
        alert("清理异常，请检查控制台。");
    }
}

// 绑定 DOM 监听
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    const cleaned = node.nodeValue.replace(regex, dynamicReplacer);
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    purifyDOM(node, regex);
                }
            });
            if (m.type === 'characterData') {
                const cleaned = m.target.nodeValue.replace(regex, dynamicReplacer);
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });
    
    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

    // 绑定输入框监听
    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            let val = e.target.value || e.target.innerText;
            if (val && val.match(regex)) {
                const cleaned = val.replace(regex, dynamicReplacer);
                if (e.target.value !== undefined) {
                    const pos = e.target.selectionStart;
                    e.target.value = cleaned;
                    try { e.target.selectionStart = e.target.selectionEnd = pos; } catch(err){}
                } else { e.target.innerText = cleaned; }
            }
        }
    }, true);
}

// 插入界面节点
function setupUI() {
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="规则管理">
                <i class="fa-solid fa-language fa-fw"></i><span>规则管理</span>
            </div>`);
    }
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header">
                    <h3 class="bl-title">全局规则</h3>
                    <button id="bl-close-btn" class="bl-close">&times;</button>
                </div>
                <div class="bl-rule-builder">
                    <textarea id="bl-target-input" class="bl-textarea" placeholder="输入目标词 (逗号/空格分隔)" rows="2"></textarea>
                    <div class="bl-rule-arrow">⬇️ 随机替换 ⬇️</div>
                    <textarea id="bl-rep-input" class="bl-textarea" placeholder="输入替换词 (留空为删除)" rows="2"></textarea>
                    <button id="bl-add-rule-btn" class="bl-add-rule-btn">添加规则</button>
                </div>
                <div id="bl-tags-container" style="margin-top:15px;"></div>
                <div class="bl-footer">
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">执行深度替换</button>
                </div>
            </div>`);
    }

    // 插入确认弹窗
    if (!$('#bl-confirm-modal').length) {
        $('body').append(`
            <div id="bl-confirm-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.75); z-index:9999999; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif; backdrop-filter:blur(3px);">
                <div style="background:#222; padding:30px; border-radius:10px; max-width:450px; text-align:center; border: 1px solid #555;">
                    <h3 style="color:#ff4d4d; margin-top:0; font-size: 22px;">清理确认</h3>
                    
                    <p style="font-size:15px; color:#ddd; line-height:1.6; margin:0 0 25px 0; text-align:left;">
                        请确认状态：
                        <br><br>
                        👉 <strong style="color:#ff4757; background:rgba(255,71,87,0.15); padding:4px 6px; border-radius:4px; display:inline-block; margin-bottom:10px;">将系统预设切换至「Default」或废弃项</strong>
                        <br>
                        <span style="font-size:13px; color:#aaa;">完成后页面将刷新，可恢复预设。</span>
                    </p>

                    <div style="display:flex; justify-content:space-between; gap:15px;">
                        <button id="bl-modal-cancel" style="flex:1; padding:12px; border:none; border-radius:6px; background:#555; color:white; cursor:pointer;">取消</button>
                        <button id="bl-modal-confirm" disabled style="flex:1; padding:12px; border:none; border-radius:6px; background:#660000; color:#aaa; cursor:not-allowed;">确认执行 (3s)</button>
                    </div>
                </div>
            </div>
        `);
        
        $('#bl-modal-cancel').hover(function(){ $(this).css('background', '#777') }, function(){ $(this).css('background', '#555') });
    }
}

// 调度确认弹窗
function showConfirmModal() {
    const $modal = $('#bl-confirm-modal');
    const $confirmBtn = $('#bl-modal-confirm');
    const $cancelBtn = $('#bl-modal-cancel');
    
    $modal.css('display', 'flex');
    $confirmBtn.prop('disabled', true).css({ background: '#660000', color: '#aaa', cursor: 'not-allowed' });
    
    let timeLeft = 3;
    $confirmBtn.text(`确认执行 (${timeLeft}s)`);
    
    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            $confirmBtn.text(`确认执行 (${timeLeft}s)`);
        } else {
            clearInterval(timer);
            $confirmBtn.prop('disabled', false)
                       .css({ background: '#d32f2f', color: 'white', cursor: 'pointer' })
                       .text('确认执行');
            $confirmBtn.hover(function(){ $(this).css('background', '#f44336') }, function(){ $(this).css('background', '#d32f2f') });
        }
    }, 1000);

    $cancelBtn.off('click').on('click', () => {
        clearInterval(timer);
        $modal.hide();
    });

    $confirmBtn.off('click').on('click', () => {
        if (!timeLeft) {
            clearInterval(timer);
            $modal.hide();
            performDeepCleanse();
        }
    });
}

// 声明事件逻辑
function bindEvents() {
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    
    $(document).off('click', '#bl-add-rule-btn').on('click', '#bl-add-rule-btn', () => {
        const targets = parseInputToWords($('#bl-target-input').val());
        const replacements = parseInputToWords($('#bl-rep-input').val());

        if (targets.length > 0) {
            extension_settings[extensionName].rules.push({ targets, replacements });
            $('#bl-target-input').val('');
            $('#bl-rep-input').val('');
            isRegexDirty = true; 
            saveSettingsDebounced();
            renderTags();
            performGlobalCleanse(); 
        }
    });

    $(document).off('click', '.bl-tag-del').on('click', '.bl-tag-del', function() {
        extension_settings[extensionName].rules.splice($(this).data('index'), 1);
        isRegexDirty = true;
        saveSettingsDebounced();
        renderTags();
    });

    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', () => {
        showConfirmModal();
    });

    // 声明处理函数
    const visualCleanseOnly = () => {
        const regex = getPurifyRegex();
        if (regex) purifyDOM(document.getElementById('chat'), regex);
    };

    const delayedFullCleanse = () => setTimeout(performGlobalCleanse, 1000); 
    
    // 注册系统事件
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseOnly);      
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, delayedFullCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedFullCleanse); 
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedFullCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedFullCleanse);      
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedFullCleanse);          
}

// 更新规则视图
function renderTags() {
    const rules = extension_settings[extensionName].rules || [];
    const html = rules.map((r, i) => {
        const fullTargets = r.targets.join(', ');
        const fullReps = r.replacements.length > 0 ? r.replacements.join(', ') : '删除';
        
        return `<div class="bl-tag" title="目标:\n${fullTargets}\n\n替换:\n${fullReps}">
            <div class="bl-tag-layout">
                <div class="bl-tag-scroll-box bl-tag-left">
                    <b style="color:var(--bl-danger-color)">${fullTargets}</b>
                </div>
                <div class="bl-tag-arrow">➔</div>
                <div class="bl-tag-scroll-box bl-tag-right">
                    <b style="color:var(--bl-accent-color)">${fullReps}</b>
                </div>
            </div>
            <div class="bl-tag-del" data-index="${i}" title="移除规则">&times;</div>
        </div>`;
    }).join('');
    
    $('#bl-tags-container').html(html || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px; padding: 10px 0;">无规则</div>');
}

// 处理版本迁移
function migrateOldData() {
    const settings = extension_settings[extensionName];
    if (settings && settings.bannedWords) {
        if (settings.bannedWords.length > 0) {
            settings.rules = settings.rules || [];
            settings.rules.push({
                targets: [...settings.bannedWords],
                replacements: []
            });
        }
        delete settings.bannedWords;
        isRegexDirty = true;
        saveSettingsDebounced();
    }
}

// 模块初始化
let isBooted = false;
jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    migrateOldData();
    if (!extension_settings[extensionName].rules) extension_settings[extensionName].rules = [];

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
