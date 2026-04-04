import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata, updateMessageBlock } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [] };

// 性能优化：缓存正则与映射字典
let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 

/**
 * 智能分词处理器
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

/**
 * 核心替换回调：随机抽取替换词
 */
function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    if (!reps || reps.length === 0) return ''; 
    const randIndex = Math.floor(Math.random() * reps.length); 
    return reps[randIndex];
}

/**
 * 递归洗刷对象 (深度清理的灵魂)
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
                    // 【唯一保留的白名单】保护本插件自身
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

let isCleansing = false; // 防止递归死循环的锁

/**
 * 【极速轻量版】仅针对刚刚生成的“最新一条消息”进行清理
 * 在 GENERATION_STOPPED 等事件后调用，不遍历全局，极大降低内存/CPU负担
 */
async function cleanseLatestMessage() {
    if (isCleansing) return;
    const regex = getPurifyRegex();
    // 确保有规则，且聊天记录存在
    if (!regex || !window.chat || window.chat.length === 0) return;
    
    isCleansing = true;
    
    // 定位最后一条消息
    const lastIndex = window.chat.length - 1;
    const lastMsg = window.chat[lastIndex];
    
    // 只深度清洗最后一条消息的数据
    let changes = safeDeepScrub(lastMsg, regex, false);
    
    if (changes > 0) {
        await saveChat(); // 发生改变才保存
        
        // 只锁定最后一条消息的 DOM 节点进行视觉更新 (极大地减少页面 Reflow)
        const lastMesEl = document.querySelector(`.mes[mesid="${lastIndex}"]`) || document.querySelector('.mes:last-child');
        if (lastMesEl) purifyDOM(lastMesEl, regex);
    }
    
    isCleansing = false;
}

/**
 * 【全家桶高危版】历史聊天+元数据+系统设置，全部清洗
 * 专门留给点击红色【深度清理】按钮时使用
 */
async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("请先添加屏蔽规则。"); return; }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;backdrop-filter:blur(5px);">
            <h2>正在执行全局深度扫描 (包含历史记录与系统设置)...</h2>
        </div>
    `);
    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;
        
        // 扫全局聊天记录
        if (window.chat && Array.isArray(window.chat)) scrubbedItems += safeDeepScrub(window.chat, regex, false);
        // 扫聊天元数据
        if (typeof chat_metadata === 'object' && chat_metadata !== null) scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        // 扫系统设置
        if (typeof extension_settings === 'object' && extension_settings !== null) scrubbedItems += safeDeepScrub(extension_settings, regex, true);

        if (scrubbedItems > 0) {
            await saveChat(); // 存聊天
            saveSettingsDebounced(); // 存设置
            await new Promise(r => setTimeout(r, 2000)); 
            alert(`全局清理完成，共处理 ${scrubbedItems} 处匹配项。\n请切回您原来的预设，页面即将刷新。`);
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
    // 监听聊天框内容变化的 MutationObserver，保留原样（用于拦截旧消息渲染等突发情况）
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

    // 用户手动输入框的实时屏蔽
    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (regex && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
            let val = e.target.value || e.target.innerText;
            if (val && val.match(regex)) {
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
                    <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">全局深度清理 (高危)</button>
                </div>
            </div>`);
    }

    if (!$('#bl-warning-overlay').length) {
        $('body').append(`
            <div id="bl-warning-overlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.5); z-index:9999998; backdrop-filter:blur(2px);"></div>
            <div id="bl-warning-popup" style="display:none; position:fixed; top:25vh; left:50%; transform:translateX(-50%); width:90%; max-width:420px; background:var(--bl-background-popup, #fff); border:2px solid var(--bl-danger-color, #ff4757); border-radius:12px; z-index:9999999; padding:25px; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="color:var(--bl-danger-color, #ff4757); margin:0 0 15px 0; font-size:20px; display:flex; align-items:center; gap:8px;">
                    ⚠️ 全局深度清理警告！
                </h3>
                <p style="font-size:15px; color:var(--bl-text-primary, #333); line-height:1.6; margin:0 0 20px 0;">
                    日常聊天插件会自动处理最新消息。此按钮将扫描并清洗<strong>所有历史聊天、元数据及扩展预设。</strong><br><br>
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
            isRegexDirty = true; 
            saveSettingsDebounced();
            renderTags();
            // 添加规则后顺便洗一下最后一条，方便确认效果
            cleanseLatestMessage(); 
        }
    });

    $(document).off('click', '.bl-tag-del').on('click', '.bl-tag-del', function() {
        extension_settings[extensionName].rules.splice($(this).data('index'), 1);
        isRegexDirty = true;
        saveSettingsDebounced();
        renderTags();
    });

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

    $(document).off('click', '#bl-warning-cancel, #bl-warning-overlay').on('click', '#bl-warning-cancel, #bl-warning-overlay', (e) => {
        if(e.target.id === 'bl-warning-overlay' || e.target.id === 'bl-warning-cancel') {
            clearInterval(timerInterval);
            $('#bl-warning-overlay, #bl-warning-popup').fadeOut(200);
        }
    });

    $(document).off('click', '#bl-warning-confirm').on('click', '#bl-warning-confirm', function() {
        if (!$(this).prop('disabled')) {
            $('#bl-warning-overlay, #bl-warning-popup').fadeOut(200);
            performDeepCleanse(); 
        }
    });

    // 【新增：极速流式视觉屏蔽】只锁死最后一条气泡的 DOM，不碰后台数据
    let streamThrottle = false;
    const visualCleanseLatestOnly = () => {
        // 增加节流阀（Throttle），限制每 150 毫秒最多执行一次，拯救手机 CPU
        if (streamThrottle) return;
        streamThrottle = true;
        setTimeout(() => { streamThrottle = false; }, 150);

        const regex = getPurifyRegex();
        if (!regex) return;
        
        // 绝对不扫全局，只精准定位当前正在生成的最后一条消息
        const lastMesEl = document.querySelector('.mes:last-child');
        if (lastMesEl) purifyDOM(lastMesEl, regex);
    };

    // 流式打字中：触发极速前端视觉屏蔽（加了节流阀，且只扫最后一个气泡）
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseLatestOnly);     
    
    // 生成完毕 / 切换状态时：直接深度洗底层数据
    const delayedLightCleanse = () => setTimeout(cleanseLatestMessage, 300); 
    
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedLightCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedLightCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedLightCleanse);     
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedLightCleanse);    
}

function renderTags() {
    const rules = extension_settings[extensionName].rules || [];
    const html = rules.map((r, i) => {
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
 * 自动数据迁移
 */
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
        console.log("[Ultimate Purifier] 已成功将旧版数据迁移至 v3.0");
    }
}

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
        cleanseLatestMessage(); // 初始载入时清理一次最新进度
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
