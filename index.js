import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata, chat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [], presets: {}, activePreset: "" };

let cachedPurifiers = [];
let isPurifiersDirty = true; 
let currentEditingIndex = -1; 
let currentEditingSubrules = []; 

// 按模式解析输入内容
function parseInputByMode(text, isRegex) {
    if (!text) return [];
    if (isRegex) {
        // 正则模式：严格按换行符分割，保留任何符号
        return text.split('\n').map(w => w.trim()).filter(w => w);
    } else {
        // 文本模式：过滤引号，按逗号、空格换行分割
        const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
        return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
    }
}

// 构建多级净化拦截器 (保留文本模式的长词优先，引入正则模式的精准按序打击)
function getPurifiers() {
    if (!isPurifiersDirty) return cachedPurifiers;
    const rules = extension_settings[extensionName]?.rules || [];
    cachedPurifiers = [];

    rules.forEach(rule => {
        if (rule.enabled === false) return; 
        
        rule.subRules.forEach(sub => {
            const isReg = sub.isRegex || false;
            if (isReg) {
                // 正则模式：保留顺序，逐条转化为正则规则
                sub.targets.forEach(t => {
                    if (!t) return;
                    try {
                        cachedPurifiers.push({
                            type: 'regex',
                            regex: new RegExp(t, 'gmu'),
                            reps: sub.replacements
                        });
                    } catch (e) {
                        console.warn("[Ultimate Purifier] 无效的正则表达式拦截:", t);
                    }
                });
            } else {
                // 普通文本模式：此子规则内部合并执行长词优先
                const targets = sub.targets.filter(t => t);
                if (targets.length === 0) return;
                const sorted = [...targets].sort((a, b) => b.length - a.length);
                const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                const map = {};
                targets.forEach(t => { map[t] = sub.replacements; });
                
                cachedPurifiers.push({
                    type: 'text',
                    regex: new RegExp(`(${escaped.join('|')})`, 'gmu'),
                    map: map
                });
            }
        });
    });

    isPurifiersDirty = false;
    return cachedPurifiers;
}

// 核心多态替换器
function applyPurifiers(str) {
    if (typeof str !== 'string' || !str) return str;
    let result = str;
    const purifiers = getPurifiers();
    if (purifiers.length === 0) return result;

    for (const p of purifiers) {
        if (p.type === 'text') {
            result = result.replace(p.regex, (match) => {
                const reps = p.map[match];
                if (!reps || reps.length === 0) return ''; 
                return reps[Math.floor(Math.random() * reps.length)];
            });
        } else if (p.type === 'regex') {
            result = result.replace(p.regex, (...args) => {
                const reps = p.reps;
                if (!reps || reps.length === 0) return '';
                let randRep = reps[Math.floor(Math.random() * reps.length)];
                
                // 支持正则捕获组的高级映射 (如 $1, $2)
                if (randRep.includes('$')) {
                    const numGroups = args.length - 3; // 刨去 match, offset, full_string
                    for (let i = 1; i <= numGroups; i++) {
                        randRep = randRep.replaceAll(`$${i}`, args[i] || '');
                    }
                }
                return randRep;
            });
        }
    }
    return result;
}

function isProtectedNode(node) {
    if (!node || !node.closest) return false;
    if (node.id === 'send_textarea' || node.classList.contains('edit_textarea')) return true;
    if (node.closest('#bl-purifier-popup, #bl-batch-popup, #bl-confirm-modal, #bl-rule-edit-modal')) return true;
    if (node.closest('#right-nav-panel, .right_menu, .drawer-content, .popup, .shadow_popup, .character-modal, #top-bar')) return true;
    return false;
}

function safeDeepScrub(rootObj, isGlobalSettings = false) {
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
                        const cleaned = applyPurifiers(val);
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

function purifyDOM(rootNode) {
    if (!rootNode) return;
    const purifiers = getPurifiers();
    if (purifiers.length === 0) return;

    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, null, false);
    
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        if (parent && (isProtectedNode(parent) || (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))))) {
            continue;
        }
        const original = node.nodeValue || '';
        const cleaned = applyPurifiers(original);
        if (original !== cleaned) node.nodeValue = cleaned;
    }

    if (rootNode.nodeType === 1) {
        let inputs = [];
        if (rootNode.matches && rootNode.matches('input, textarea')) inputs.push(rootNode);
        if (rootNode.querySelectorAll) inputs.push(...Array.from(rootNode.querySelectorAll('input, textarea')));

        inputs.forEach(input => {
            if (isProtectedNode(input) || document.activeElement === input) return;
            const originalVal = input.value || '';
            const cleanedVal = applyPurifiers(originalVal);
            if (originalVal !== cleanedVal) input.value = cleanedVal;
        });
    }
}

function performGlobalCleanse() {
    if (getPurifiers().length === 0) return;
    let chatChanged = false;
    
    if (chat && Array.isArray(chat)) {
        chat.forEach((msg, index) => {
            let msgChanged = false; 
            
            if (typeof msg.mes === 'string') {
                const cleaned = applyPurifiers(msg.mes);
                if (msg.mes !== cleaned) { msg.mes = cleaned; msgChanged = true; }
            }
            
            if (msg.swipes && Array.isArray(msg.swipes)) {
                for (let i = 0; i < msg.swipes.length; i++) {
                    if (typeof msg.swipes[i] === 'string') {
                        const cleanedSwipe = applyPurifiers(msg.swipes[i]);
                        if (msg.swipes[i] !== cleanedSwipe) { msg.swipes[i] = cleanedSwipe; msgChanged = true; }
                    } else if (typeof msg.swipes[i] === 'object' && msg.swipes[i] !== null && typeof msg.swipes[i].mes === 'string') {
                        const cleanedSwipe = applyPurifiers(msg.swipes[i].mes);
                        if (msg.swipes[i].mes !== cleanedSwipe) { msg.swipes[i].mes = cleanedSwipe; msgChanged = true; }
                    }
                }
            }

            if (msgChanged) {
                chatChanged = true;
                try { if (typeof updateMessageBlock === 'function') setTimeout(() => updateMessageBlock(index, chat[index]), 50); } catch(e) {}
            }
        });
    }
    
    if (chatChanged) {
        try { if (typeof saveChat === 'function') saveChat(); } catch(e) {}
    }
    purifyDOM(document.getElementById('chat'));
}

async function performDeepCleanse() {
    if (getPurifiers().length === 0) { alert("没有开启的屏蔽规则，无需清理。"); return; }
    // 弹窗与之前保持一致，为节约字数省略无关提示 HTML
    $('body').append(`<div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;"><h2 style="margin-bottom:20px;">正在深度扫描...</h2></div>`);
    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;
        if (chat && Array.isArray(chat)) scrubbedItems += safeDeepScrub(chat, false);
        if (typeof chat_metadata === 'object' && chat_metadata !== null) scrubbedItems += safeDeepScrub(chat_metadata, false);
        if (typeof extension_settings === 'object' && extension_settings !== null) scrubbedItems += safeDeepScrub(extension_settings, true);

        if (scrubbedItems > 0) {
            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            alert(`清理完成，处理了 ${scrubbedItems} 处映射。\n刷新后请切回原预设！`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现需要替换的数据残留。");
        }
    } catch (e) {
        $('#bl-loading-overlay').remove();
    }
}

function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        if (getPurifiers().length === 0) return;
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    if (node.parentNode && isProtectedNode(node.parentNode)) return;
                    const cleaned = applyPurifiers(node.nodeValue);
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    purifyDOM(node);
                }
            });
            if (m.type === 'characterData') {
                if (m.target.parentNode && isProtectedNode(m.target.parentNode)) return;
                const cleaned = applyPurifiers(m.target.nodeValue);
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });
    
    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

    document.addEventListener('input', (e) => {
        if (getPurifiers().length === 0 || isProtectedNode(e.target)) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            let val = e.target.value || e.target.innerText;
            if (val) {
                const cleaned = applyPurifiers(val);
                if (val !== cleaned) {
                    if (e.target.value !== undefined) {
                        const pos = e.target.selectionStart;
                        e.target.value = cleaned;
                        try { e.target.selectionStart = e.target.selectionEnd = pos; } catch(err){}
                    } else { e.target.innerText = cleaned; }
                }
            }
        }
    }, true);
}

function setupUI() {
    $('#bl-purifier-popup, #bl-rule-edit-modal, #bl-confirm-modal').remove();

    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽与映射管理">
                <i class="fa-solid fa-wand-magic-sparkles fa-fw"></i><span>屏蔽净化</span>
            </div>`);
    }
    
    // 主 UI: 引入 FontAwesome 图标
    $('body').append(`
        <div id="bl-purifier-popup" style="display:none;">
            <div class="bl-header">
                <h3 class="bl-title">全局屏蔽与映射规则</h3>
                <button id="bl-close-btn" class="bl-close">&times;</button>
            </div>

            <div class="bl-tools-bar" style="display:flex; flex-direction:column; gap:8px; margin:10px 0 15px 0; border-bottom:1px solid var(--bl-border-color); padding-bottom:12px;">
                <div style="display:flex; gap:8px; align-items:center;">
                    <select id="bl-preset-select" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--bl-border-color); background:var(--bl-input-bg); color:var(--bl-text-primary); outline:none; font-family:inherit;"></select>
                    <button id="bl-preset-rename" title="重命名" class="bl-icon-btn"><i class="fa-solid fa-pen"></i></button>
                    <button id="bl-preset-delete" title="删除" class="bl-icon-btn" style="color:var(--bl-danger-color);"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="bl-tool-btn" id="bl-preset-new"><i class="fa-solid fa-plus"></i> 新建</button>
                    <button class="bl-tool-btn" id="bl-preset-save"><i class="fa-solid fa-floppy-disk"></i> 保存</button>
                    <button class="bl-tool-btn" id="bl-preset-import"><i class="fa-solid fa-file-import"></i> 导入</button>
                    <button class="bl-tool-btn" id="bl-preset-export"><i class="fa-solid fa-file-export"></i> 导出</button>
                </div>
            </div>

            <button id="bl-open-new-rule-btn" class="bl-add-rule-btn" style="width:100%; margin-bottom:10px;"><i class="fa-solid fa-plus"></i> 新增规则组 (合集)</button>
            <div id="bl-tags-container" style="max-height:220px; overflow-y:auto; padding-right:5px;"></div>
            <div class="bl-footer"><button id="bl-deep-clean-btn" class="bl-deep-clean-btn">深度屏蔽与替换</button></div>
        </div>`);

    // 编辑弹窗
    $('body').append(`
        <div id="bl-rule-edit-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.65); z-index:9999999; flex-direction:column; justify-content:center; align-items:center; backdrop-filter:blur(4px);">
            <div style="background:var(--bl-background-popup); padding:20px 25px; border-radius:12px; width:90%; max-width:480px; max-height:85vh; display:flex; flex-direction:column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid var(--bl-border-color); box-sizing:border-box;">
                <h3 id="bl-edit-modal-title" style="margin:0 0 12px 0; font-size:18px; color:var(--bl-text-primary); flex-shrink:0;">编辑规则合集</h3>
                <input type="text" id="bl-edit-name" class="bl-input" placeholder="输入合集名称" style="margin-bottom:12px; flex-shrink:0;">
                
                <div id="bl-edit-subrules-container" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:5px; margin-bottom:10px;"></div>
                
                <button id="bl-add-subrule-btn" style="flex-shrink:0; padding:10px; border-radius:8px; background:var(--bl-background-secondary); border:1px dashed var(--bl-border-color); color:var(--bl-text-primary); cursor:pointer; font-weight:bold; margin-bottom:12px;"><i class="fa-solid fa-plus"></i> 添加映射规则 / 正则表达式</button>
                
                <div style="display:flex; justify-content:space-between; gap:10px; flex-shrink:0;">
                    <button id="bl-edit-cancel" style="flex:1; padding:10px; border-radius:8px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); color:var(--bl-text-primary); cursor:pointer; font-weight:bold;">取消</button>
                    <button id="bl-edit-save" style="flex:1; padding:10px; border-radius:8px; background:var(--bl-accent-color); border:none; color:white; font-weight:bold; cursor:pointer;">保存合集</button>
                </div>
            </div>
        </div>
    `);
    
    // (为了排版简洁，这里省略 #bl-confirm-modal 警告弹窗的重写代码，保留原本警告框即可)
}

function updateToolbarUI() {
    const settings = extension_settings[extensionName];
    const select = $('#bl-preset-select');
    select.empty();
    select.append('<option value="">-- 临时规则 (未绑定存档) --</option>');
    if (settings.presets) for (let name in settings.presets) select.append($('<option>', { value: name, text: name }));
    select.val(settings.activePreset || "");
}

function renderTags() {
    const rules = extension_settings[extensionName]?.rules || [];
    const html = rules.map((r, i) => {
        const name = r.name || `未命名合集 ${i + 1}`;
        const allTargets = (r.subRules || []).flatMap(s => s.targets);
        let targetPreview = allTargets.join(', ').substring(0, 20) || "无目标";
        const checkedAttr = r.enabled !== false ? 'checked' : '';
        const cardClass = r.enabled !== false ? 'bl-rule-card' : 'bl-rule-card bl-rule-disabled';

        return `
        <div class="${cardClass}">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1;">
                <label class="bl-toggle-switch"><input type="checkbox" class="bl-rule-toggle" data-index="${i}" ${checkedAttr}><span class="bl-toggle-slider"></span></label>
                <div class="bl-rule-info">
                    <div class="bl-rule-name">${name}</div>
                    <div class="bl-rule-preview">过滤: ${targetPreview}...</div>
                </div>
            </div>
            
            <div class="bl-rule-actions">
                <button class="bl-icon-btn bl-rule-up" data-index="${i}" title="提升优先级"><i class="fa-solid fa-chevron-up"></i></button>
                <button class="bl-icon-btn bl-rule-down" data-index="${i}" title="降低优先级"><i class="fa-solid fa-chevron-down"></i></button>
                <button class="bl-rule-edit" data-index="${i}" title="编辑"><i class="fa-solid fa-pen"></i></button>
                <button class="bl-rule-del" data-index="${i}" title="删除"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
    }).join('');
    $('#bl-tags-container').html(html || '<div style="opacity:0.5; width:100%; text-align:center; font-size:13px; padding: 20px 0;">当前无规则，请新增</div>');
}

// 渲染子规则 (手风琴UI)
function renderSubrulesToModal() {
    const container = $('#bl-edit-subrules-container');
    container.empty();
    
    if (currentEditingSubrules.length === 0) {
        container.html('<div style="text-align:center; color:var(--bl-text-secondary); font-size:12px; padding:10px;">当前合集为空，请添加。</div>');
        return;
    }
    
    currentEditingSubrules.forEach((sub, i) => {
        const isReg = sub.isRegex || false;
        const isExp = sub._expanded !== false; // 默认展开

        if (!isExp) {
            // 折叠预览态
            const tStr = sub.targets.join(', ').substring(0, 30) || '无内容';
            const rStr = sub.replacements.join(', ').substring(0, 15) || '删除';
            const modeLabel = isReg ? `<span style="color:var(--bl-danger-color); font-weight:bold; font-size:12px;">[正则]</span>` : `<span style="color:var(--bl-text-secondary); font-size:12px;">[文本]</span>`;
            
            container.append(`
                <div class="bl-subrule-row collapsed" data-index="${i}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); border-radius:8px;">
                    <div style="flex:1; overflow:hidden; font-size:13px; white-space:nowrap; text-overflow:ellipsis; color:var(--bl-text-primary);">
                        ${modeLabel} ${tStr} <i class="fa-solid fa-arrow-right" style="color:var(--bl-text-secondary); font-size:10px; margin:0 4px;"></i> ${rStr}
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="bl-icon-btn bl-move-up-sub" data-index="${i}"><i class="fa-solid fa-arrow-up"></i></button>
                        <button class="bl-icon-btn bl-move-down-sub" data-index="${i}"><i class="fa-solid fa-arrow-down"></i></button>
                        <button class="bl-icon-btn bl-edit-sub" data-index="${i}" title="展开编辑"><i class="fa-solid fa-pen"></i></button>
                        <button class="bl-icon-btn bl-del-sub" data-index="${i}" style="color:var(--bl-danger-color);"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `);
        } else {
            // 展开编辑态
            const tStr = sub.targets.join(isReg ? '\n' : ', ');
            const rStr = sub.replacements.join(', ');
            
            container.append(`
                <div class="bl-subrule-row expanded" data-index="${i}" style="display:flex; flex-direction:column; gap:8px; padding:12px; background:var(--bl-background-popup); border:1px solid var(--bl-accent-color); border-radius:8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <select class="bl-sub-mode bl-input" style="padding:6px; font-size:12px; width:auto;">
                            <option value="text" ${!isReg ? 'selected' : ''}>文本模式 (自动长词优先)</option>
                            <option value="regex" ${isReg ? 'selected' : ''}>正则模式 (支持 $1 捕获替换)</option>
                        </select>
                        <button class="bl-icon-btn bl-save-sub" data-index="${i}" title="确认并收起" style="background:var(--bl-accent-color); color:white; border:none;"><i class="fa-solid fa-check"></i></button>
                    </div>
                    <textarea class="bl-sub-target bl-textarea" rows="2" placeholder="${isReg ? '每行输入一个正则表达式\n例如: /(宛若|如同)(神明|恶魔)/gmu' : '被替换词 (逗号/空格分隔)\n例如: 嘴角勾起, 并不存在'}">${tStr}</textarea>
                    <div style="text-align:center; font-size:12px; color:var(--bl-text-secondary);"><i class="fa-solid fa-arrow-down"></i> 替换为</div>
                    <textarea class="bl-sub-rep bl-textarea" rows="2" placeholder="替换后词汇 (留空则直接删除)\n例如: 浅笑了一下">${rStr}</textarea>
                </div>
            `);
        }
    });
}

function syncSubrulesFromDOM() {
    $('.bl-subrule-row.expanded').each(function() {
        const i = $(this).data('index');
        const isReg = $(this).find('.bl-sub-mode').val() === 'regex';
        const tStr = $(this).find('.bl-sub-target').val();
        const rStr = $(this).find('.bl-sub-rep').val();
        currentEditingSubrules[i].isRegex = isReg;
        currentEditingSubrules[i].targets = parseInputByMode(tStr, isReg);
        currentEditingSubrules[i].replacements = parseInputByMode(rStr, false); 
    });
}

function openEditModal(index = -1) {
    const settings = extension_settings[extensionName];
    currentEditingIndex = index;
    if (index === -1) {
        $('#bl-edit-modal-title').text('新增合集');
        $('#bl-edit-name').val('');
        currentEditingSubrules = [{ targets: [], replacements: [], isRegex: false, _expanded: true }]; 
    } else {
        const rule = settings.rules[index];
        $('#bl-edit-modal-title').text('编辑合集');
        $('#bl-edit-name').val(rule.name || '');
        // 确保打开时所有子规则默认为折叠状态 (摘要态)
        currentEditingSubrules = JSON.parse(JSON.stringify(rule.subRules || [])).map(s => ({...s, _expanded: false}));
    }
    renderSubrulesToModal();
    $('#bl-rule-edit-modal').css('display', 'flex');
}

function bindEvents() {
    // 主界面召唤
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { updateToolbarUI(); renderTags(); $('#bl-purifier-popup').css('display', 'flex').hide().fadeIn(200); });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).off('click', '#bl-open-new-rule-btn').on('click', '#bl-open-new-rule-btn', () => openEditModal(-1));
    $(document).off('click', '.bl-rule-edit').on('click', '.bl-rule-edit', function() { openEditModal($(this).data('index')); });
    
    // 主规则：排序与开关
    $(document).off('change', '.bl-rule-toggle').on('change', '.bl-rule-toggle', function() {
        extension_settings[extensionName].rules[$(this).data('index')].enabled = $(this).prop('checked');
        isPurifiersDirty = true; saveSettingsDebounced(); performGlobalCleanse();
    });
    $(document).off('click', '.bl-rule-del').on('click', '.bl-rule-del', function() {
        extension_settings[extensionName].rules.splice($(this).data('index'), 1);
        isPurifiersDirty = true; saveSettingsDebounced(); renderTags(); performGlobalCleanse();
    });
    $(document).off('click', '.bl-rule-up').on('click', '.bl-rule-up', function() {
        const i = $(this).data('index');
        if (i > 0) {
            const rules = extension_settings[extensionName].rules;
            [rules[i-1], rules[i]] = [rules[i], rules[i-1]];
            isPurifiersDirty = true; saveSettingsDebounced(); renderTags(); performGlobalCleanse();
        }
    });
    $(document).off('click', '.bl-rule-down').on('click', '.bl-rule-down', function() {
        const i = $(this).data('index');
        const rules = extension_settings[extensionName].rules;
        if (i < rules.length - 1) {
            [rules[i+1], rules[i]] = [rules[i], rules[i+1]];
            isPurifiersDirty = true; saveSettingsDebounced(); renderTags(); performGlobalCleanse();
        }
    });

    // 弹窗内：手风琴展开与收起
    $(document).off('click', '.bl-edit-sub').on('click', '.bl-edit-sub', function() {
        syncSubrulesFromDOM();
        currentEditingSubrules[$(this).data('index')]._expanded = true;
        renderSubrulesToModal();
    });
    $(document).off('click', '.bl-save-sub').on('click', '.bl-save-sub', function() {
        syncSubrulesFromDOM();
        currentEditingSubrules[$(this).data('index')]._expanded = false;
        renderSubrulesToModal();
    });
    $(document).off('change', '.bl-sub-mode').on('change', '.bl-sub-mode', function() {
        const isReg = $(this).val() === 'regex';
        $(this).closest('.bl-subrule-row').find('.bl-sub-target').attr('placeholder', isReg ? '每行输入一个正则表达式\n例如: (宛若|如同)(神明|恶魔)' : '被替换词汇 (逗号/空格分隔)\n例如: 嘴角勾起, 并不存在');
    });

    // 弹窗内：添加与删除、排序
    $(document).off('click', '#bl-add-subrule-btn').on('click', '#bl-add-subrule-btn', () => {
        syncSubrulesFromDOM();
        currentEditingSubrules.push({ targets: [], replacements: [], isRegex: false, _expanded: true });
        renderSubrulesToModal();
        const container = $('#bl-edit-subrules-container');
        container.scrollTop(container[0].scrollHeight);
    });
    $(document).off('click', '.bl-del-subrule-btn, .bl-del-sub').on('click', '.bl-del-subrule-btn, .bl-del-sub', function() {
        syncSubrulesFromDOM();
        currentEditingSubrules.splice($(this).data('index'), 1);
        renderSubrulesToModal();
    });
    $(document).off('click', '.bl-move-up-sub').on('click', '.bl-move-up-sub', function() {
        syncSubrulesFromDOM();
        const i = $(this).data('index');
        if (i > 0) {
            [currentEditingSubrules[i-1], currentEditingSubrules[i]] = [currentEditingSubrules[i], currentEditingSubrules[i-1]];
            renderSubrulesToModal();
        }
    });
    $(document).off('click', '.bl-move-down-sub').on('click', '.bl-move-down-sub', function() {
        syncSubrulesFromDOM();
        const i = $(this).data('index');
        if (i < currentEditingSubrules.length - 1) {
            [currentEditingSubrules[i+1], currentEditingSubrules[i]] = [currentEditingSubrules[i], currentEditingSubrules[i+1]];
            renderSubrulesToModal();
        }
    });

    $(document).off('click', '#bl-edit-cancel').on('click', '#bl-edit-cancel', () => $('#bl-rule-edit-modal').hide());
    $(document).off('click', '#bl-edit-save').on('click', '#bl-edit-save', () => {
        syncSubrulesFromDOM();
        const validSubrules = currentEditingSubrules.filter(sub => sub.targets.length > 0);
        // 清理 UI 辅助状态，防止污染 JSON
        validSubrules.forEach(s => delete s._expanded);

        const newRule = {
            name: $('#bl-edit-name').val().trim() || `合集 ${extension_settings[extensionName].rules.length + 1}`,
            subRules: validSubrules,
            enabled: currentEditingIndex !== -1 ? (extension_settings[extensionName].rules[currentEditingIndex].enabled !== false) : true
        };

        if (currentEditingIndex === -1) extension_settings[extensionName].rules.push(newRule);
        else extension_settings[extensionName].rules[currentEditingIndex] = newRule;

        isPurifiersDirty = true; 
        saveSettingsDebounced(); renderTags(); performGlobalCleanse();
        $('#bl-rule-edit-modal').hide();
    });

    // 预设相关代码保持功能相同... 
    //（省略了完全未变的预设增删改查事件，可沿用您现有的 bl-preset 系列事件代码）

    const visualCleanseOnly = () => purifyDOM(document.getElementById('chat'));
    const delayedFullCleanse = () => setTimeout(performGlobalCleanse, 1000); 
    
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseOnly);      
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, delayedFullCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedFullCleanse); 
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedFullCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedFullCleanse);      
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedFullCleanse);          
}

function migrateOldData() {
    const settings = extension_settings[extensionName];
    if (settings) {
        if (!settings.presets) settings.presets = {};
        if (settings.rules && settings.rules.length > 0) {
            settings.rules.forEach((r, i) => {
                if (!r.name) r.name = `合集 ${i+1}`; 
                if (r.subRules) {
                    r.subRules.forEach(sub => {
                        if (sub.isRegex === undefined) sub.isRegex = false; // 默认给旧规则打上 Text 模式标记
                    });
                }
            });
        }
        isPurifiersDirty = true;
        saveSettingsDebounced();
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
        updateToolbarUI();
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
