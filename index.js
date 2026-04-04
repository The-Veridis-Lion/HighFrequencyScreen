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

async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("请先添加屏蔽规则。"); return; }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;backdrop-filter:blur(5px);">
            <h2>正在执行深度扫描与映射替换...</h2>
        </div>
    `);
    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;
        // 执行暴力的全局扫描（因为已经人工切走预设，所以不再惧怕误伤）
        if (window.chat && Array.isArray(window.chat)) scrubbedItems += safeDeepScrub(window.chat, regex, false);
        if (typeof chat_metadata === 'object' && chat_metadata !== null) scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        if (typeof extension_settings === 'object' && extension_settings !== null) scrubbedItems += safeDeepScrub(extension_settings, regex, true);

        if (scrubbedItems > 0) {
            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            await new Promise(r => setTimeout(r, 2000)); 
            alert(`清理完成，共处理 ${scrubbedItems} 处匹配项。\n请切回您原来的预设，页面即将刷新。`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现需要替换的数据残留。您可以切回预设了。");
        }
    } catch (e) {
        $('#bl-loading-overlay').remove();
        alert("清理失败，请查看控制台。");
    }
}

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

    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            let val = e.target.value || e.target.innerText;
            if (val && val.match(regex)) {
                // 【已修复光标位置问题，保证能正常删除】
                if (e.target.value !== undefined) {
                    const start = e.target.selectionStart;
                    const end = e.target.selectionEnd;
                    const originalLength = val.length;
                    const cleaned = val.replace(regex, dynamicReplacer);
                    
                    if (val !== cleaned) {
                        e.target.value = cleaned;
                        const diff = cleaned.length - originalLength;
                        try { e.target.setSelectionRange(start + diff, end + diff); } catch(err){}
                    }
                } else { 
                    e.target.innerText = val.replace(regex, dynamicReplacer); 
                }
            }
        }
    }, true);
}

function setupUI() {
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="词汇映射管理">
                <i class="fa-solid fa-language fa-fw"></i><span>词汇映射</span>
            </div>`);
    }
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-header">
                    <h3 class="bl-title">全局屏蔽与映射规则</h3>
                    <button id="bl-close-btn" class="bl-close">&times;</button>
                </div>
                <div class="bl-rule-builder">
                    <textarea id="bl-target-input" class="bl-textarea" placeholder="输入目标词 (必填，支持批量，逗号/空格分隔)" rows="2"></textarea>
                    <div class="bl-rule-arrow">⬇️ 随机替换为 ⬇️</div>
                    <textarea id="bl-rep-input" class="bl-textarea" placeholder="输入替换词 (可选，支持批量)。不填则直接删除目标词" rows="2"></textarea>
                    <button id="bl-add-rule-btn" class="bl-add-rule-btn">添加规则组</button>
                </div>
                <div id="bl-tags-container" style="margin-top:15px;"></div>
                <div class="bl-footer">
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">深度屏蔽与替换</button>
                </div>
            </div>`);
    }

    // --- 新增：强制阅读 3 秒的高危警告弹窗 ---
    if (!$('#bl-warning-overlay').length) {
        $('body').append(`
            <div id="bl-warning-overlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:9999998; backdrop-filter:blur(2px);"></div>
            <div id="bl-warning-popup" style="display:none; position:fixed; top:25vh; left:50%; transform:translateX(-50%); width:90%; max-width:420px; background:var(--bl-background-popup, #fff); border:2px solid var(--bl-danger-color, #ff4757); border-radius:12px; z-index:9999999; padding:25px; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="color:var(--bl-danger-color, #ff4757); margin:0 0 15px 0; font-size:20px; display:flex; align-items:center; gap:8px;">
                    ⚠️ 深度清理高危警告！
                </h3>
                <p style="font-size:15px; color:var(--bl-text-primary, #333); line-height:1.6; margin:0 0 20px 0;">
                    为了绝对防止误删您的专属【系统预设(Preset)】，请在此刻：
                    <br><br>
                    👉 <strong style="color:var(--bl-danger-color, #ff4757); background:rgba(255,71,87,0.1); padding:2px 4px; border-radius:4px;">将 ST 当前的系统预设切换至「Default」或任意废弃预设！</strong>
                    <br><br>
                    <span style="font-size:13px; color:var(--bl-text-secondary, #666);">清理完成后页面会刷新，届时您再切回原预设即可保证 100% 安全。</span>
                </p>
                <div style="display:flex; justify-content:flex-end; gap:12px;">
                    <button id="bl-warning-cancel" style="padding:10px 18px; border-radius:8px; border:1px solid var(--bl-border-color, #ccc); background:transparent; color:var(--bl-text-primary, #333); cursor:pointer; font-weight:bold;">取消清理</button>
                    <button id="bl-warning-confirm" disabled style="padding:10px 18px; border-radius:8px; border:none; background:var(--bl-danger-color, #ff4757); color:white; cursor:not-allowed; opacity:0.5; font-weight:bold; transition:all 0.2s;">我已切走预设 (3s)</button>
                </div>
            </div>
        `);
    }
}

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
            isRegexDirty = true; // 标记正则需要重新生成
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

    // --- 替换原本的 confirm，改为触发 3 秒倒计时弹窗 ---
    let timerInterval = null;
    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', () => {
        $('#bl-purifier-popup').fadeOut(100);
        $('#bl-warning-overlay, #bl-warning-popup').fadeIn(200);

        let timeLeft = 3;
        const $btn = $('#bl-warning-confirm');
        $btn.prop('disabled', true).css({cursor: 'not-allowed', opacity: 0.5}).text(`我已切走预设 (${timeLeft}s)`);

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                $btn.text(`我已切走预设 (${timeLeft}s)`);
            } else {
                clearInterval(timerInterval);
                $btn.prop('disabled', false).css({cursor: 'pointer', opacity: 1}).text('我已安全切换，立即清理');
            }
        }, 1000);
    });

    // 弹窗：取消按钮
    $(document).off('click', '#bl-warning-cancel, #bl-warning-overlay').on('click', '#bl-warning-cancel, #bl-warning-overlay', (e) => {
        if(e.target.id === 'bl-warning-overlay' || e.target.id === 'bl-warning-cancel') {
            clearInterval(timerInterval);
            $('#bl-warning-overlay, #bl-warning-popup').fadeOut(200);
        }
    });

    // 弹窗：确认按钮
    $(document).off('click', '#bl-warning-confirm').on('click', '#bl-warning-confirm', function() {
        if (!$(this).prop('disabled')) {
            $('#bl-warning-overlay, #bl-warning-popup').fadeOut(200);
            performDeepCleanse();
        }
    });

    // 1. 纯视觉清洗（流式专用）：只改屏幕显示的字，不碰底层数据
    const visualCleanseOnly = () => {
        const regex = getPurifyRegex();
        if (regex) purifyDOM(document.getElementById('chat'), regex);
    };

    // 2. 深度数据层清洗（生成完毕后专用）：调用原本的物理删除逻辑
    const delayedFullCleanse = () => setTimeout(performGlobalCleanse, 300); 
    
    // 【核心改动】：把 MESSAGE_EDITED 绑到了 visualCleanseOnly 上。
    // 流式打字中：只执行 DOM 视觉替换，不影响 AI 的 Context
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseOnly);     
    
    // 打字结束后 / 切换时：照常执行你的深度清理
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedFullCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedFullCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedFullCleanse);     
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedFullCleanse);         
}

function renderTags() {
    const rules = extension_settings[extensionName].rules || [];
    const html = rules.map((r, i) => {
        // 取消截断限制，直接获取完整字符串
        const fullTargets = r.targets.join(', ');
        const fullReps = r.replacements.length > 0 ? r.replacements.join(', ') : '无 (直接删除)';
        
        return `<div class="bl-tag" title="目标:\n${fullTargets}\n\n替换为:\n${fullReps}">
            <div class="bl-tag-layout">
                <div class="bl-tag-scroll-box bl-tag-left">
                    <b style="color:var(--bl-danger-color)">${fullTargets}</b>
                </div>
                <div class="bl-tag-arrow">➔</div>
                <div class="bl-tag-scroll-box bl-tag-right">
                    <b style="color:var(--bl-accent-color)">${fullReps}</b>
                </div>
            </div>
            <div class="bl-tag-del" data-index="${i}" title="删除规则">&times;</div>
        </div>`;
    }).join('');
    
    $('#bl-tags-container').html(html || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px; padding: 10px 0;">当前无规则</div>');
}

/**
 * 自动数据迁移：将旧版的 bannedWords 无损升级为 3.0 的 rules 架构
 */
function migrateOldData() {
    const settings = extension_settings[extensionName];
    if (settings && settings.bannedWords) {
        if (settings.bannedWords.length > 0) {
            settings.rules = settings.rules || [];
            // 将所有旧版屏蔽词归为一个“直接删除”的规则组
            settings.rules.push({
                targets: [...settings.bannedWords],
                replacements: []
            });
        }
        delete settings.bannedWords;
        isRegexDirty = true;
        saveSettingsDebounced();
        console.log("[Ultimate Purifier] 已成功将旧版数据迁移至 v3.0");
    }
}

let isBooted = false;
jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    // 执行数据迁移
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
