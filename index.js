import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [] };

let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 
let pollingTimer = null;

// 处理输入文本并转换为词组数组
function parseInputToWords(text) {
    if (!text) return [];
    const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
    return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
}

// 构造正则表达式及词汇映射表
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
        const sorted = [...allTargets].sort((a, b) => b.length - a.length);
        const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        cachedRegex = new RegExp(`(${escaped.join('|')})`, 'gmu');
    }
    isRegexDirty = false;
    return cachedRegex;
}

// 随机选择替换词的回调函数
function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    if (!reps || reps.length === 0) return '';
    return reps[Math.floor(Math.random() * reps.length)];
}

// 递归遍历并修改对象内所有字符串属性
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
                        if (val !== cleaned) { current[key] = cleaned; changes++; }
                    } else if (val !== null && typeof val === 'object') {
                        stack.push(val); 
                    }
                }
            }
        } catch(e) { }
    }
    return changes;
}

// 劫持并改写系统存盘函数 (防御方案一)
function patchSaveChat() {
    if (typeof window.saveChat === 'function' && !window.saveChat.isPatched) {
        const originalSaveChat = window.saveChat;
        window.saveChat = function(...args) {
            performGlobalCleanse(false);
            return originalSaveChat.apply(this, args);
        };
        window.saveChat.isPatched = true;
    }
}

// 定时执行末尾数据扫描 (防御方案二)
function initPollingCleanse() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => {
        const regex = getPurifyRegex();
        if (!regex || !window.chat || !Array.isArray(window.chat)) return;
        let chatChanged = false;
        const startIndex = Math.max(0, window.chat.length - 3);
        for (let i = startIndex; i < window.chat.length; i++) {
            if (safeDeepScrub(window.chat[i], regex, false) > 0) chatChanged = true;
        }
        if (chatChanged) saveChat();
    }, 3000);
}

// 遍历修改 DOM 节点文本
function purifyDOM(rootNode, regex) {
    if (!rootNode) return false;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        if (parent && (parent.id === 'send_textarea' || parent.classList.contains('edit_textarea'))) continue;
        const original = node.nodeValue || '';
        const cleaned = original.replace(regex, dynamicReplacer);
        if (original !== cleaned) node.nodeValue = cleaned;
    }
}

// 全量数据清理及 UI 强刷
function performGlobalCleanse(triggerSave = true) {
    const regex = getPurifyRegex();
    if (!regex) return;
    let chatChanged = false;
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach((msg, index) => {
            if (safeDeepScrub(msg, regex, false) > 0) {
                chatChanged = true;
                try { if (typeof updateMessageBlock === 'function') updateMessageBlock(index, msg); } catch(e) {}
            }
        });
    }
    if (chatChanged && triggerSave) saveChat();
    purifyDOM(document.getElementById('chat'), regex);
}

// 执行深度清理及强制刷新
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("无规则"); return; }
    $('body').append('<div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;justify-content:center;align-items:center;color:white;"><h2>执行深度清理并同步磁盘...</h2></div>');
    await new Promise(r => setTimeout(r, 500));
    try {
        let scrubbedItems = 0;
        scrubbedItems += safeDeepScrub(window.chat, regex, false);
        scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        scrubbedItems += safeDeepScrub(extension_settings, regex, true);
        if (scrubbedItems > 0) {
            await saveChat();
            saveSettingsDebounced(); 
            alert(`清理完成，共处理 ${scrubbedItems} 处。请务必将预设切回常用状态。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现残留。");
        }
    } catch (e) { $('#bl-loading-overlay').remove(); }
}

// 构造控制面板与确认弹窗
function setupUI() {
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append('<div id="bl-wand-btn" title="词汇映射"><i class="fa-solid fa-language fa-fw"></i><span>词汇映射</span></div>');
    }
    if (!$('#bl-purifier-popup').length) {
        $('body').append('<div id="bl-purifier-popup"><div class="bl-header"><h3 class="bl-title">映射规则</h3><button id="bl-close-btn" class="bl-close">&times;</button></div><div class="bl-rule-builder"><textarea id="bl-target-input" class="bl-textarea" placeholder="目标词"></textarea><textarea id="bl-rep-input" class="bl-textarea" placeholder="替换词(空则删除)"></textarea><button id="bl-add-rule-btn" class="bl-add-rule-btn">添加规则组</button></div><div id="bl-tags-container"></div><div class="bl-footer"><button id="bl-deep-clean-btn" class="bl-deep-clean-btn">深度清理(慎点)</button></div></div>');
    }
    if (!$('#bl-confirm-modal').length) {
        $('body').append('<div id="bl-confirm-modal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);z-index:9999999;flex-direction:column;justify-content:center;align-items:center;color:white;"><div style="background:#222;padding:30px;border-radius:10px;text-align:center;border:1px solid #ff4757;"><h3>⚠️ 深度清理安全确认</h3><p>请确认已切换至<b>「Default」</b>预设以免误伤！</p><div style="display:flex;gap:15px;margin-top:20px;"><button id="bl-modal-cancel" style="padding:10px 20px;background:#555;">取消</button><button id="bl-modal-confirm" disabled style="padding:10px 20px;background:#660000;color:#aaa;">确认清理 (3s)</button></div></div></div>');
    }
}

// 展示确认弹窗并执行倒计时机制
function showConfirmModal() {
    const $modal = $('#bl-confirm-modal');
    const $btn = $('#bl-modal-confirm');
    $modal.css('display', 'flex');
    $btn.prop('disabled', true);
    let timeLeft = 3;
    const timer = setInterval(() => {
        $btn.text(`确认清理 (${--timeLeft}s)`);
        if (timeLeft <= 0) { clearInterval(timer); $btn.prop('disabled', false).text('确认清理').css({background:'#d32f2f', color:'white'}); }
    }, 1000);
    $('#bl-modal-cancel').off('click').on('click', () => { clearInterval(timer); $modal.hide(); });
    $btn.off('click').on('click', () => { $modal.hide(); performDeepCleanse(); });
}

// 绑定系统事件与交互逻辑 (防御方案三)
function bindEvents() {
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).off('click', '#bl-add-rule-btn').on('click', '#bl-add-rule-btn', () => {
        const targets = parseInputToWords($('#bl-target-input').val());
        const replacements = parseInputToWords($('#bl-rep-input').val());
        if (targets.length > 0) {
            extension_settings[extensionName].rules.push({ targets, replacements });
            isRegexDirty = true; saveSettingsDebounced(); renderTags(); performGlobalCleanse(); 
        }
    });
    // 监听小铅笔点击动作 (防御方案三)
    $(document).on('click', '.mes_edit', function() {
        const regex = getPurifyRegex();
        if (!regex) return;
        const id = $(this).closest('.mes').attr('mesid');
        if (id !== undefined && window.chat[id]) {
            if (safeDeepScrub(window.chat[id], regex, false) > 0) saveChat();
        }
    });
    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', showConfirmModal);
    eventSource.on(event_types.GENERATION_ENDED, () => setTimeout(performGlobalCleanse, 500));
}

function renderTags() {
    const rules = extension_settings[extensionName].rules || [];
    $('#bl-tags-container').html(rules.map((r, i) => `<div class="bl-tag">${r.targets[0]}... ➔ ${r.replacements[0] || '删'}</div>`).join('') || '无规则');
}

// 初始化 DOM 观察器执行视觉屏蔽
function initRealtimeInterceptor() {
    const observer = new MutationObserver(() => {
        const regex = getPurifyRegex();
        if (regex) purifyDOM(document.getElementById('chat'), regex);
    });
    const chatEl = document.getElementById('chat');
    if (chatEl) observer.observe(chatEl, { childList: true, subtree: true, characterData: true });
}

// 插件入口
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    setupUI();
    bindEvents();
    initRealtimeInterceptor(); 
    patchSaveChat(); 
    initPollingCleanse();
    performGlobalCleanse(); 
});
