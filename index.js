import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [] };

// 性能优化：缓存正则与映射字典，避免高频 DOM 变动时重复计算
let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 

/**
 * 智能分词处理器：剥离引号并按中英符号分割
 */
function parseInputToWords(text) {
    if (!text) return [];
    const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
    return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
}

/**
 * 构建多对多超级正则及映射字典
 */
function getPurifyRegex() {
    if (!isRegexDirty) return cachedRegex;

    const rules = extension_settings[extensionName]?.rules || [];
    wordToRuleMap = {};
    let allTargets = [];

    rules.forEach(rule => {
        rule.targets.forEach(t => {
            if (t) {
                allTargets.push(t);
                wordToRuleMap[t] = rule.replacements; // 将目标词映射到它的替换词数组
            }
        });
    });

    if (!allTargets.length) {
        cachedRegex = null;
    } else {
        // 按长度倒序排列，防止短词截断长词（如优先匹配“极其”，后匹配“极”）
        const sorted = [...allTargets].sort((a, b) => b.length - a.length);
        const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        cachedRegex = new RegExp(`(${escaped.join('|')})`, 'gmu');
    }
    
    isRegexDirty = false;
    return cachedRegex;
}

/**
 * 核心替换回调：随机抽取替换词
 */
function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    if (!reps || reps.length === 0) return ''; // 没有替换词，直接删除
    const randIndex = Math.floor(Math.random() * reps.length); // 随机抽取
    return reps[randIndex];
}

/**
 * 递归洗刷对象
 */
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
                    // 【唯一保留的白名单】保护本插件自身的规则配置不被误删
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

/**
 * 扫描并清理指定 DOM
 */
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

function performGlobalCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;
    let chatChanged = false;
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach(msg => {
            if (msg.mes) {
                const cleaned = msg.mes.replace(regex, dynamicReplacer);
                if (msg.mes !== cleaned) { msg.mes = cleaned; chatChanged = true; }
            }
        });
    }
    if (chatChanged) saveChat(); 
    purifyDOM(document.getElementById('chat'), regex);
}

/**
 * 深度清理函数：遍历所有数据库、元数据及扩展缓存，完成后刷新页面
 */
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) {
        alert("请先添加屏蔽词。");
        return;
    }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;font-family:sans-serif;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:20px;">正在执行深度扫描与清理...</h2>
            <p>正在同步数据到磁盘，请稍候。</p>
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
            
            // ================= 新增成功后的切回预设提醒 =================
            alert(`清理完成，共移除 ${scrubbedItems} 处匹配项。\n\n页面即将刷新，【请记得在刷新后将系统预设切换回您的常用预设】以恢复工作状态！`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现匹配残留。\n\n您可以安全地将系统预设切换回您的常用预设了。");
        }
    } catch (e) {
        console.error("Deep cleanse failed:", e);
        $('#bl-loading-overlay').remove();
        alert("清理过程中发生错误，请查看控制台。");
    }
}

/**
 * UI 设置：追加控制面板及 3秒倒计时安全弹窗
 */
function setupUI() {
    // 侧边栏按钮
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词管理">
                <i class="fa-solid fa-eraser fa-fw"></i><span>屏蔽词管理</span>
            </div>`);
    }
    // 屏蔽词管理主面板
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header">
                    <h3 class="bl-title">屏蔽词设置</h3>
                    <button id="bl-close-btn" class="bl-close">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-input-field" class="bl-input" placeholder="输入屏蔽词...">
                    <button id="bl-add-btn" class="bl-add-btn">添加</button>
                </div>
                <div id="bl-tags-container"></div>
                <div class="bl-footer">
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">深度屏蔽</button>
                </div>
            </div>`);
    }
    // 深度清理二次确认弹窗 (带3秒倒计时与你的专属提示)
    if (!$('#bl-confirm-modal').length) {
        $('body').append(`
            <div id="bl-confirm-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.75); z-index:9999999; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif; backdrop-filter:blur(3px);">
                <div style="background:#222; padding:30px; border-radius:10px; max-width:450px; text-align:center; box-shadow: 0 4px 20px rgba(0,0,0,0.8); border: 1px solid #555;">
                    <h3 style="color:#ff4d4d; margin-top:0; font-size: 22px;">⚠️ 深度清理警告</h3>
                    
                    <p style="font-size:15px; color:#ddd; line-height:1.6; margin:0 0 25px 0; text-align:left;">
                        为了绝对防止深度清理修改您的常用系统预设(Preset)，请在此刻：
                        <br><br>
                        👉 <strong style="color:#ff4757; background:rgba(255,71,87,0.15); padding:4px 6px; border-radius:4px; display:inline-block; margin-bottom:10px;">将SillyTavern当前的系统预设切换至「Default」或任意废弃预设！</strong>
                        <br>
                        <span style="font-size:13px; color:#aaa;">清理完成后页面会刷新，届时您再切回原预设即可保证您的安全。</span>
                    </p>

                    <div style="display:flex; justify-content:space-between; gap:15px;">
                        <button id="bl-modal-cancel" style="flex:1; padding:12px; border:none; border-radius:6px; background:#555; color:white; cursor:pointer; font-weight:bold; transition: 0.2s;">取消返回</button>
                        <button id="bl-modal-confirm" disabled style="flex:1; padding:12px; border:none; border-radius:6px; background:#660000; color:#aaa; cursor:not-allowed; font-weight:bold; transition: 0.2s;">确认清理 (3s)</button>
                    </div>
                </div>
            </div>
        `);
        
        // 鼠标悬停效果
        $('#bl-modal-cancel').hover(function(){ $(this).css('background', '#777') }, function(){ $(this).css('background', '#555') });
    }
}

/**
 * 触发带倒计时的确认弹窗
 */
function showConfirmModal() {
    const $modal = $('#bl-confirm-modal');
    const $confirmBtn = $('#bl-modal-confirm');
    const $cancelBtn = $('#bl-modal-cancel');
    
    // 显示弹窗并初始化按钮状态
    $modal.css('display', 'flex');
    $confirmBtn.prop('disabled', true).css({ background: '#660000', color: '#aaa', cursor: 'not-allowed' });
    
    let timeLeft = 3;
    $confirmBtn.text(`确认清理 (${timeLeft}s)`);
    
    // 3秒倒计时
    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            $confirmBtn.text(`确认清理 (${timeLeft}s)`);
        } else {
            clearInterval(timer);
            // 倒计时结束，激活按钮
            $confirmBtn.prop('disabled', false)
                       .css({ background: '#d32f2f', color: 'white', cursor: 'pointer' })
                       .text('我已切换，确认清理！');
            $confirmBtn.hover(function(){ $(this).css('background', '#f44336') }, function(){ $(this).css('background', '#d32f2f') });
        }
    }, 1000);

    // 取消按钮逻辑
    $cancelBtn.off('click').on('click', () => {
        clearInterval(timer);
        $modal.hide();
    });

    // 确认按钮逻辑
    $confirmBtn.off('click').on('click', () => {
        if (!timeLeft) {
            clearInterval(timer);
            $modal.hide();
            performDeepCleanse();
        }
    });
}

/**
 * 步骤一：表面隐藏（纯视觉屏蔽，流式输出时调用）
 */
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    const cleaned = node.nodeValue.replace(regex, '');
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    purifyDOM(node, regex);
                }
            });
            if (m.type === 'characterData') {
                const cleaned = m.target.nodeValue.replace(regex, '');
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });
    
    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true });

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
                } else { e.target.innerText = cleaned; }
            }
        }
    }, true);
}

/**
 * 步骤二：事件绑定与彻底底层删除
 */
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
    
    // 绑定新的安全弹窗
    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', () => {
        showConfirmModal();
    });

    // === 核心清洗逻辑（延迟500ms确保酒馆写入完成） ===
    eventSource.removeListener(event_types.GENERATION_ENDED, performGlobalCleanse);
    eventSource.on(event_types.GENERATION_ENDED, () => setTimeout(performGlobalCleanse, 500));
    
    if (eventSource.listeners && typeof eventSource.listeners === 'function' && eventSource.listeners(event_types.MESSAGE_RECEIVED)) {
        eventSource.removeListener(event_types.MESSAGE_RECEIVED, performGlobalCleanse);
        eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(performGlobalCleanse, 500));
    } else {
        try {
            eventSource.removeListener(event_types.MESSAGE_RECEIVED, performGlobalCleanse);
            eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(performGlobalCleanse, 500));
        } catch(e) {}
    }
    
    eventSource.removeListener(event_types.MESSAGE_EDITED, performGlobalCleanse);
    eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performGlobalCleanse, 500));
}

function renderTags() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-tags-container').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px;">无数据</div>');
}

/**
 * 步骤三：初始化
 */
let isBooted = false;
jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        if (isBooted) return;
        isBooted = true;
        setupUI();
        bindEvents();
        
        // 开启实时表面隐藏（不碰数据库）
        initRealtimeInterceptor(); 

        // 初次加载时执行一次全局清洗
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
