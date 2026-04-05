import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata, chat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [], presets: {}, activePreset: "" };

let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 
let currentEditingIndex = -1; 
let currentEditingSubrules = []; 

function parseInputToWords(text) {
    if (!text) return [];
    const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
    return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
}

function getPurifyRegex() {
    if (!isRegexDirty) return cachedRegex;
    const rules = extension_settings[extensionName]?.rules || [];
    wordToRuleMap = {};
    let allTargets = [];

    rules.forEach(rule => {
        if (rule.enabled === false) return; 
        
        const subRulesToProcess = rule.subRules || [];
        subRulesToProcess.forEach(sub => {
            sub.targets.forEach(t => {
                if (t) {
                    allTargets.push(t);
                    wordToRuleMap[t] = sub.replacements; 
                }
            });
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

function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    // 留空则直接返回空字符串，实现物理删除
    if (!reps || reps.length === 0) return ''; 
    const randIndex = Math.floor(Math.random() * reps.length); 
    return reps[randIndex];
}

// 绝对保护名单：防止错删预设面板或打字框
function isProtectedNode(node) {
    if (!node || !node.closest) return false;
    if (node.id === 'send_textarea' || node.classList.contains('edit_textarea')) return true;
    if (node.closest('#bl-purifier-popup, #bl-batch-popup, #bl-confirm-modal, #bl-rule-edit-modal')) return true;
    if (node.closest('#right-nav-panel, .right_menu, .drawer-content, .popup, .shadow_popup, .character-modal, #top-bar')) {
        return true;
    }
    return false;
}

// 深度对象洗刷器
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

// 恢复轻量级DOM清洗器：专用于对付被复杂标签包裹的思维链
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, null, false);
    
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        if (parent && (isProtectedNode(parent) || (document.activeElement && (document.activeElement === parent || parent.contains(document.activeElement))))) {
            continue;
        }
        
        const original = node.nodeValue || '';
        const cleaned = original.replace(regex, dynamicReplacer);
        if (original !== cleaned) node.nodeValue = cleaned;
    }
}

// ==========================================
// 核心逻辑 1：静态物理屏蔽 (清洗整个 msg 对象，不论思维链藏在哪)
// ==========================================
function performDataCleanse() {
    const regex = getPurifyRegex();
    if (!regex) return;
    let chatChanged = false;
    
    if (chat && Array.isArray(chat)) {
        chat.forEach((msg, index) => {
            // 对整个消息对象进行深度核打击，不管ST是存为 msg.mes 还是 msg.thought
            const scrubbedCount = safeDeepScrub(msg, regex, false);
            
            if (scrubbedCount > 0) {
                chatChanged = true;
                try {
                    if (typeof updateMessageBlock === 'function') {
                        setTimeout(() => updateMessageBlock(index, chat[index]), 50);
                    }
                } catch(e) {}
            }
        });
    }
    
    if (chatChanged) {
        try {
            if (typeof saveChat === 'function') saveChat();
        } catch(e) {
            console.error("[Ultimate Purifier] 存盘失败", e);
        }
    }
    
    // 生成结束后，给聊天区域来一次最终画面扫描，确保思维链 Markdown 渲染后无残留
    purifyDOM(document.getElementById('chat'), regex);
}

// ==========================================
// 核心逻辑 2：动态视觉屏蔽 (依然轻量，但加入了对思维链 UI 的拦截)
// ==========================================
function initRealtimeInterceptor() {
    const chatObserver = new MutationObserver((mutations) => {
        const regex = getPurifyRegex();
        if (!regex) return;
        
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 3 || node.nodeType === 8) { 
                    if (node.parentNode && isProtectedNode(node.parentNode)) return;
                    const cleaned = node.nodeValue.replace(regex, dynamicReplacer);
                    if (node.nodeValue !== cleaned) node.nodeValue = cleaned;
                } else if (node.nodeType === 1) { 
                    // 这里恢复 purifyDOM 处理新添加的元素框，完美兼容思维链
                    purifyDOM(node, regex);
                }
            });
            
            if (m.type === 'characterData') {
                if (m.target.parentNode && isProtectedNode(m.target.parentNode)) return;
                const cleaned = m.target.nodeValue.replace(regex, dynamicReplacer);
                if (m.target.nodeValue !== cleaned) m.target.nodeValue = cleaned;
            }
        });
    });
    
    // 只监听聊天区域，不碰预设面板
    const chatEl = document.getElementById('chat');
    if (chatEl) {
        chatObserver.observe(chatEl, { 
            childList: true, 
            subtree: true, 
            characterData: true 
        });
    }
}

async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("没有开启的屏蔽规则，无需清理。"); return; }

    $('body').append(`
        <div id="bl-loading-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:9999999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;backdrop-filter:blur(5px);">
            <h2 style="margin-bottom:20px;font-size:20px;">正在执行深度扫描与映射替换...</h2>
            <p>正在同步数据到磁盘，请稍候。</p>
        </div>
    `);
    await new Promise(r => setTimeout(r, 100));

    try {
        let scrubbedItems = 0;
        if (chat && Array.isArray(chat)) scrubbedItems += safeDeepScrub(chat, regex, false);
        if (typeof chat_metadata === 'object' && chat_metadata !== null) scrubbedItems += safeDeepScrub(chat_metadata, regex, false);
        if (typeof extension_settings === 'object' && extension_settings !== null) scrubbedItems += safeDeepScrub(extension_settings, regex, true);

        if (scrubbedItems > 0) {
            const saveChatPromise = saveChat();
            if (saveChatPromise instanceof Promise) await saveChatPromise;
            saveSettingsDebounced(); 
            await new Promise(r => setTimeout(r, 2000)); 
            $('#bl-loading-overlay').remove();
            
            alert(`清理完成，共处理 ${scrubbedItems} 处匹配项。\n\n页面即将刷新，【请记得在刷新后将系统预设切换回常用预设】以恢复工作状态！`);
            location.reload(); 
        } else {
            $('#bl-loading-overlay').remove();
            alert("未发现需要替换的数据残留。\n\n可以安全地将系统预设切换回您的常用预设了。");
        }
    } catch (e) {
        $('#bl-loading-overlay').remove();
        alert("清理失败，请查看控制台。");
    }
}

function setupUI() {
    $('#bl-purifier-popup, #bl-rule-edit-modal, #bl-confirm-modal').remove();

    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="词汇映射管理">
                <i class="fa-solid fa-language fa-fw"></i><span>词汇映射</span>
            </div>`);
    }
    
    $('body').append(`
        <div id="bl-purifier-popup" style="display:none;">
            <div class="bl-header">
                <h3 class="bl-title">全局屏蔽与映射规则</h3>
                <button id="bl-close-btn" class="bl-close">&times;</button>
            </div>

            <div class="bl-tools-bar" style="display:flex; flex-direction:column; gap:8px; margin:10px 0 15px 0; border-bottom:1px solid var(--bl-border-color); padding-bottom:12px;">
                <div style="display:flex; gap:8px; align-items:center;">
                    <select id="bl-preset-select" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--bl-border-color); background:var(--bl-input-bg); color:var(--bl-text-primary); outline:none; font-family:inherit;"></select>
                    <button id="bl-preset-rename" title="重命名" class="bl-icon-btn">✏️</button>
                    <button id="bl-preset-delete" title="删除" class="bl-icon-btn" style="color:var(--bl-danger-color);">💀</button>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="bl-tool-btn" id="bl-preset-new">新建</button>
                    <button class="bl-tool-btn" id="bl-preset-save">保存</button>
                    <button class="bl-tool-btn" id="bl-preset-import">导入</button>
                    <button class="bl-tool-btn" id="bl-preset-export">导出</button>
                </div>
            </div>

            <button id="bl-open-new-rule-btn" class="bl-add-rule-btn" style="width:100%; margin-bottom:10px;">➕ 新增规则组 (合集)</button>

            <div id="bl-tags-container" style="max-height:220px; overflow-y:auto; padding-right:5px;"></div>
            
            <div class="bl-footer">
                <button id="bl-deep-clean-btn" class="bl-deep-clean-btn">深度屏蔽与替换</button>
            </div>
        </div>`);

    $('body').append(`
        <div id="bl-rule-edit-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.65); z-index:9999999; flex-direction:column; justify-content:center; align-items:center; font-family:inherit; backdrop-filter:blur(4px);">
            <div style="background:var(--bl-background-popup); padding:20px 25px; border-radius:12px; width:90%; max-width:440px; max-height:85vh; display:flex; flex-direction:column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid var(--bl-border-color); box-sizing:border-box;">
                
                <h3 id="bl-edit-modal-title" style="margin:0 0 12px 0; font-size:18px; color:var(--bl-text-primary); flex-shrink:0;">编辑规则合集</h3>
                
                <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:12px; flex-shrink:0;">
                    <label style="font-size:13px; color:var(--bl-text-secondary);">规则组合集名称</label>
                    <input type="text" id="bl-edit-name" class="bl-input" placeholder="例如：程度副词与认知失能净化">
                </div>
                
                <label style="font-size:13px; color:var(--bl-text-secondary); margin-bottom:6px; flex-shrink:0;">子规则列表 (可包含无限多对映射)</label>
                
                <div id="bl-edit-subrules-container" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:5px; margin-bottom:10px;">
                    </div>
                
                <button id="bl-add-subrule-btn" style="flex-shrink:0; padding:10px; border-radius:8px; background:var(--bl-background-secondary); border:1px dashed var(--bl-border-color); color:var(--bl-text-primary); cursor:pointer; font-size:13px; font-weight:bold; transition: opacity 0.2s; margin-bottom:12px;">➕ 添加一组新映射</button>
                
                <div style="display:flex; justify-content:space-between; gap:10px; flex-shrink:0;">
                    <button id="bl-edit-cancel" style="flex:1; padding:10px; border-radius:8px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); color:var(--bl-text-primary); cursor:pointer; font-weight:bold;">取消</button>
                    <button id="bl-edit-save" style="flex:1; padding:10px; border-radius:8px; background:var(--bl-accent-color); border:none; color:white; font-weight:bold; cursor:pointer;">保存合集</button>
                </div>
            </div>
        </div>
    `);

    $('body').append(`
        <div id="bl-confirm-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.65); z-index:9999999; flex-direction:column; justify-content:center; align-items:center; font-family:inherit; backdrop-filter:blur(4px);">
            <div style="background:var(--bl-background-popup); padding:30px; border-radius:12px; max-width:450px; text-align:center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid var(--bl-border-color);">
                <h3 style="color:var(--bl-danger-color); margin-top:0; font-size: 22px;">⚠️ 深度清理警告</h3>
                <p style="font-size:15px; color:var(--bl-text-primary); line-height:1.6; margin:0 0 25px 0; text-align:left;">
                    为了防止深度清理修改您的常用预设(Preset)，请在此刻：
                    <br><br>
                    👉 <strong style="color:var(--bl-danger-color); background:var(--bl-background-secondary); padding:6px 10px; border-radius:6px; display:inline-block; margin-bottom:10px; border: 1px solid var(--bl-border-color);">将SillyTavern当前的预设切换至「Default」或任意废弃预设！</strong>
                    <br>
                    <span style="font-size:13px; color:var(--bl-text-secondary);">清理完成后页面会刷新，届时可切回原预设即可保证预设安全。</span>
                </p>
                <div style="display:flex; justify-content:space-between; gap:15px;">
                    <button id="bl-modal-cancel" style="flex:1; padding:12px; border:1px solid var(--bl-border-color); border-radius:8px; background:var(--bl-background-secondary); color:var(--bl-text-primary); cursor:pointer; font-weight:bold; transition: opacity 0.2s;">取消返回</button>
                    <button id="bl-modal-confirm" disabled style="flex:1; padding:12px; border:none; border-radius:8px; background:var(--bl-background-secondary); color:var(--bl-text-secondary); cursor:not-allowed; font-weight:bold; transition: opacity 0.2s; opacity: 0.6;">我已阅读警告，已完成切换预设 (3s)</button>
                </div>
            </div>
        </div>
    `);
}

function showConfirmModal() {
    const $modal = $('#bl-confirm-modal');
    const $confirmBtn = $('#bl-modal-confirm');
    const $cancelBtn = $('#bl-modal-cancel');
    
    $modal.css('display', 'flex');
    $confirmBtn.prop('disabled', true).css({ background: '#660000', color: '#aaa', cursor: 'not-allowed' });
    
    let timeLeft = 3;
    $confirmBtn.text(`确认清理 (${timeLeft}s)`);
    
    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            $confirmBtn.text(`确认清理 (${timeLeft}s)`);
        } else {
            clearInterval(timer);
            $confirmBtn.prop('disabled', false)
                       .css({ background: '#d32f2f', color: 'white', cursor: 'pointer' })
                       .text('我已切换，确认清理！');
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

function updateToolbarUI() {
    const settings = extension_settings[extensionName];
    const select = $('#bl-preset-select');
    select.empty();
    select.append('<option value="">-- 临时规则 (未绑定存档) --</option>');
    
    if (settings.presets) {
        for (let name in settings.presets) {
            select.append($('<option>', { value: name, text: name }));
        }
    }
    select.val(settings.activePreset || "");
}

function renderTags() {
    const rules = extension_settings[extensionName]?.rules || [];
    const html = rules.map((r, i) => {
        const name = r.name || `未命名合集 ${i + 1}`;
        const allTargets = (r.subRules || []).flatMap(s => s.targets);
        let targetPreview = allTargets.join(', ');
        if (targetPreview.length > 20) targetPreview = targetPreview.substring(0, 20) + '...';
        if (targetPreview.length === 0) targetPreview = "无有效规则";
        
        const isEnabled = r.enabled !== false; 
        const checkedAttr = isEnabled ? 'checked' : '';
        const cardClass = isEnabled ? 'bl-rule-card' : 'bl-rule-card bl-rule-disabled';

        return `
        <div class="${cardClass}">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1;">
                <label class="bl-toggle-switch" title="启用/禁用此合集">
                    <input type="checkbox" class="bl-rule-toggle" data-index="${i}" ${checkedAttr}>
                    <span class="bl-toggle-slider"></span>
                </label>
                
                <div class="bl-rule-info">
                    <div class="bl-rule-name">${name} <span style="font-size:11px; font-weight:normal; opacity:0.7;">(含 ${(r.subRules||[]).length} 组映射)</span></div>
                    <div class="bl-rule-preview">过滤: ${targetPreview}</div>
                </div>
            </div>
            
            <div class="bl-rule-actions">
                <button class="bl-rule-edit" data-index="${i}" title="编辑合集">✏️</button>
                <button class="bl-rule-del" data-index="${i}" title="删除合集">&times;</button>
            </div>
        </div>`;
    }).join('');
    
    $('#bl-tags-container').html(html || '<div style="opacity:0.5; width:100%; text-align:center; font-size:13px; padding: 20px 0;">当前无规则，请点击上方按钮新增</div>');
}

function renderSubrulesToModal() {
    const container = $('#bl-edit-subrules-container');
    container.empty();
    
    if (currentEditingSubrules.length === 0) {
        container.html('<div style="text-align:center; color:var(--bl-text-secondary); font-size:12px; padding:10px;">当前合集没有映射规则，请点击下方按钮添加。</div>');
        return;
    }
    
    currentEditingSubrules.forEach((sub, i) => {
        const tStr = sub.targets.join(', ');
        const rStr = sub.replacements.join(', ');
        container.append(`
            <div class="bl-subrule-row" style="display:flex; gap:8px; align-items:center; padding:10px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); border-radius:8px; position:relative;">
                <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                    <textarea class="bl-sub-target bl-textarea" rows="2" placeholder="被替换词汇 (逗号/空格分隔)\n例如：嘴角勾起, 并不存在">${tStr}</textarea>
                    <div style="text-align:center; font-size:12px; color:var(--bl-text-secondary); line-height:1;">⬇️ 替换为 ⬇️</div>
                    <textarea class="bl-sub-rep bl-textarea" rows="2" placeholder="替换后词汇 (留空则直接删除)\n例如：浅笑了一下">${rStr}</textarea>
                </div>
                <button class="bl-del-subrule-btn" data-index="${i}" title="删除此组词汇" style="background:none; border:none; color:var(--bl-danger-color); font-size:20px; cursor:pointer; padding:5px;">&times;</button>
            </div>
        `);
    });
}

function syncSubrulesFromDOM() {
    currentEditingSubrules = [];
    $('.bl-subrule-row').each(function() {
        const tStr = $(this).find('.bl-sub-target').val();
        const rStr = $(this).find('.bl-sub-rep').val();
        currentEditingSubrules.push({
            targets: parseInputToWords(tStr),
            replacements: parseInputToWords(rStr)
        });
    });
}

function openEditModal(index = -1) {
    const settings = extension_settings[extensionName];
    currentEditingIndex = index;
    const modal = $('#bl-rule-edit-modal');
    
    if (index === -1) {
        $('#bl-edit-modal-title').text('✨ 新增规则合集');
        $('#bl-edit-name').val('');
        currentEditingSubrules = [{ targets: [], replacements: [] }]; 
    } else {
        const rule = settings.rules[index];
        $('#bl-edit-modal-title').text('✏️ 编辑规则合集');
        $('#bl-edit-name').val(rule.name || '');
        currentEditingSubrules = JSON.parse(JSON.stringify(rule.subRules || []));
    }
    
    renderSubrulesToModal();
    modal.css('display', 'flex');
}

function bindEvents() {
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { 
        updateToolbarUI(); 
        renderTags(); 
        $('#bl-purifier-popup').css('display', 'flex').hide().fadeIn(200); 
    });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    $(document).off('click', '#bl-open-new-rule-btn').on('click', '#bl-open-new-rule-btn', () => openEditModal(-1));
    $(document).off('click', '.bl-rule-edit').on('click', '.bl-rule-edit', function() { openEditModal($(this).data('index')); });
    
    $(document).off('change', '.bl-rule-toggle').on('change', '.bl-rule-toggle', function() {
        const index = $(this).data('index');
        extension_settings[extensionName].rules[index].enabled = $(this).prop('checked');
        isRegexDirty = true;
        saveSettingsDebounced();
        renderTags();
        performDataCleanse(); 
    });
    
    $(document).off('click', '.bl-rule-del').on('click', '.bl-rule-del', function() {
        extension_settings[extensionName].rules.splice($(this).data('index'), 1);
        isRegexDirty = true;
        saveSettingsDebounced();
        renderTags();
    });

    $(document).off('click', '#bl-add-subrule-btn').on('click', '#bl-add-subrule-btn', () => {
        syncSubrulesFromDOM();
        currentEditingSubrules.push({ targets: [], replacements: [] });
        renderSubrulesToModal();
        const container = $('#bl-edit-subrules-container');
        container.scrollTop(container[0].scrollHeight);
    });
    
    $(document).off('click', '.bl-del-subrule-btn').on('click', '.bl-del-subrule-btn', function() {
        syncSubrulesFromDOM();
        currentEditingSubrules.splice($(this).data('index'), 1);
        renderSubrulesToModal();
    });

    $(document).off('click', '#bl-edit-cancel').on('click', '#bl-edit-cancel', () => $('#bl-rule-edit-modal').hide());

    $(document).off('click', '#bl-edit-save').on('click', '#bl-edit-save', () => {
        syncSubrulesFromDOM();
        const nameVal = $('#bl-edit-name').val().trim();
        const validSubrules = currentEditingSubrules.filter(sub => sub.targets.length > 0);

        if (validSubrules.length === 0) {
            alert("至少需要提供一组有效的目标词！(被替换词不能全空)");
            return;
        }

        let isEnabled = true;
        if (currentEditingIndex !== -1) {
            isEnabled = extension_settings[extensionName].rules[currentEditingIndex].enabled !== false;
        }

        const newRule = {
            name: nameVal || `合集 ${extension_settings[extensionName].rules.length + 1}`,
            subRules: validSubrules,
            enabled: isEnabled 
        };

        if (currentEditingIndex === -1) {
            extension_settings[extensionName].rules.push(newRule);
        } else {
            extension_settings[extensionName].rules[currentEditingIndex] = newRule;
        }

        isRegexDirty = true; 
        saveSettingsDebounced();
        renderTags();
        performDataCleanse(); 
        $('#bl-rule-edit-modal').hide();
    });

    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', () => showConfirmModal());

    $(document).off('change', '#bl-preset-select').on('change', '#bl-preset-select', function() {
        const settings = extension_settings[extensionName];
        const name = $(this).val();
        settings.activePreset = name;
        if (name && settings.presets[name]) {
            settings.rules = JSON.parse(JSON.stringify(settings.presets[name]));
        } else {
            settings.rules = [];
        }
        isRegexDirty = true;
        saveSettingsDebounced();
        renderTags();
        performDataCleanse();
    });

    $(document).off('click', '#bl-preset-rename').on('click', '#bl-preset-rename', function() {
        const settings = extension_settings[extensionName];
        const oldName = settings.activePreset;
        if (!oldName) { alert("当前为临时规则，请先新建存档。"); return; }
        const newName = prompt("输入新存档名称：", oldName);
        if (!newName || newName === oldName) return;
        if (settings.presets[newName]) { alert("存档名称已存在。"); return; }
        settings.presets[newName] = settings.presets[oldName];
        delete settings.presets[oldName];
        settings.activePreset = newName;
        saveSettingsDebounced();
        updateToolbarUI();
    });

    $(document).off('click', '#bl-preset-delete').on('click', '#bl-preset-delete', function() {
        const settings = extension_settings[extensionName];
        const name = settings.activePreset;
        if (!name) return;
        if (confirm(`确定删除存档 "${name}" 吗？`)) {
            delete settings.presets[name];
            settings.activePreset = "";
            settings.rules = [];
            isRegexDirty = true;
            saveSettingsDebounced();
            renderTags();
            updateToolbarUI();
            performDataCleanse();
        }
    });

    $(document).off('click', '#bl-preset-new').on('click', '#bl-preset-new', function() {
        const settings = extension_settings[extensionName];
        const name = prompt("输入新存档名称：");
        if (!name) return;
        if (settings.presets[name]) { alert("存档名称已存在。"); return; }
        settings.presets[name] = JSON.parse(JSON.stringify(settings.rules));
        settings.activePreset = name;
        saveSettingsDebounced();
        updateToolbarUI();
    });

    $(document).off('click', '#bl-preset-save').on('click', '#bl-preset-save', function() {
        const settings = extension_settings[extensionName];
        if (!settings.activePreset) { alert("当前为临时规则，请点击“新建”保存为新存档。"); return; }
        settings.presets[settings.activePreset] = JSON.parse(JSON.stringify(settings.rules));
        saveSettingsDebounced();
        alert("已保存到存档：" + settings.activePreset);
    });

    $(document).off('click', '#bl-preset-export').on('click', '#bl-preset-export', function() {
        const settings = extension_settings[extensionName];
        const data = JSON.stringify(settings.rules, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fileName = (settings.activePreset || "临时规则") + ".json";
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    });

    $(document).off('click', '#bl-preset-import').on('click', '#bl-preset-import', function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const importedRules = JSON.parse(event.target.result);
                    if (!Array.isArray(importedRules)) throw new Error("格式非数组");
                    const defaultName = file.name.replace(/\.json$/i, '');
                    const newName = prompt("导入成功！\n输入存档名称直接保存，或点击取消仅作为临时规则预览：", defaultName);
                    const settings = extension_settings[extensionName];
                    
                    importedRules.forEach((r, idx) => {
                        if (!r.name) r.name = r.targets?.[0] || `未命名合集 ${idx+1}`;
                        if (r.enabled === undefined) r.enabled = true;
                        if (r.targets) {
                            r.subRules = [{ targets: r.targets, replacements: r.replacements || [] }];
                            delete r.targets;
                            delete r.replacements;
                        }
                        if (!r.subRules) r.subRules = [];
                    });
                    
                    settings.rules = importedRules;
                    if (newName) {
                        settings.presets[newName] = JSON.parse(JSON.stringify(importedRules));
                        settings.activePreset = newName;
                    } else {
                        settings.activePreset = "";
                    }
                    isRegexDirty = true;
                    saveSettingsDebounced();
                    renderTags();
                    updateToolbarUI();
                    performDataCleanse();
                } catch (err) { alert("导入失败：检查文件是否为合法规则数组。"); }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    // 绑定物理清理核心到关键交互事件
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, () => setTimeout(performDataCleanse, 100));      
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, performDataCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, performDataCleanse); 
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, () => setTimeout(performDataCleanse, 100)); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, () => setTimeout(performDataCleanse, 100));      
}

function migrateOldData() {
    const settings = extension_settings[extensionName];
    
    if (settings && settings.bannedWords) {
        if (settings.bannedWords.length > 0) {
            settings.rules = settings.rules || [];
            settings.rules.push({
                name: "旧版本过滤词",
                subRules: [{ targets: [...settings.bannedWords], replacements: [] }],
                enabled: true
            });
        }
        delete settings.bannedWords;
        isRegexDirty = true;
    }

    if (settings) {
        if (!settings.presets) settings.presets = {};
        if (settings.activePreset === undefined) settings.activePreset = "";

        if (settings.rules && settings.rules.length > 0) {
            settings.rules.forEach((r, i) => {
                if (!r.name) r.name = `合集 ${i+1}`; 
                if (r.enabled === undefined) r.enabled = true; 
                
                if (r.targets) {
                    r.subRules = [{
                        targets: r.targets,
                        replacements: r.replacements || []
                    }];
                    delete r.targets;
                    delete r.replacements;
                }
                if (!r.subRules) r.subRules = [];
            });
            
            if (Object.keys(settings.presets).length === 0) {
                settings.presets["默认存档"] = JSON.parse(JSON.stringify(settings.rules));
                settings.activePreset = "默认存档";
            }
        }
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
        performDataCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
