import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata, chat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { rules: [], presets: {}, activePreset: "" };

// 缓存正则与映射字典
let cachedRegex = null;
let wordToRuleMap = {};
let isRegexDirty = true; 

// 剥离引号并按中英符号分割
function parseInputToWords(text) {
    if (!text) return [];
    const noQuotes = text.replace(/['"‘’”“”]/g, ' ');
    return noQuotes.split(/[\s,，、\n]+/).map(w => w.trim()).filter(w => w);
}

// 构建正则及映射字典
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

// 抽取替换词
function dynamicReplacer(match) {
    const reps = wordToRuleMap[match];
    if (!reps || reps.length === 0) return ''; 
    const randIndex = Math.floor(Math.random() * reps.length); 
    return reps[randIndex];
}

// 保护区检测
function isProtectedNode(node) {
    if (!node || !node.closest) return false;
    if (node.id === 'send_textarea' || node.classList.contains('edit_textarea')) return true;
    if (node.closest('#bl-purifier-popup, #bl-batch-popup, #bl-confirm-modal')) return true;
    if (node.closest('#right-nav-panel, .right_menu, .drawer-content, .popup, .shadow_popup, .character-modal, #top-bar')) {
        return true;
    }
    return false;
}

// 递归对象清理
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
                    // 保护插件自身规则配置
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

// DOM清理
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

    if (rootNode.nodeType === 1) {
        let inputs = [];
        if (rootNode.matches && rootNode.matches('input, textarea')) inputs.push(rootNode);
        if (rootNode.querySelectorAll) inputs.push(...Array.from(rootNode.querySelectorAll('input, textarea')));

        inputs.forEach(input => {
            if (isProtectedNode(input) || document.activeElement === input) return;
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
    
    if (chat && Array.isArray(chat)) {
        chat.forEach((msg, index) => {
            let msgChanged = false; 
            
            if (typeof msg.mes === 'string') {
                const cleaned = msg.mes.replace(regex, dynamicReplacer);
                if (msg.mes !== cleaned) { 
                    msg.mes = cleaned; 
                    msgChanged = true; 
                }
            }
            
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

            if (msgChanged) {
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
    
    purifyDOM(document.getElementById('chat'), regex);
}

async function performDeepCleanse() {
    const regex = getPurifyRegex();
    if (!regex) { alert("请先添加屏蔽规则。"); return; }

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
    
    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        if (isProtectedNode(e.target)) return;
        
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

                <div class="bl-tools-bar" style="display:flex; flex-direction:column; gap:8px; margin:10px 0 15px 0; border-bottom:1px solid var(--bl-border-color); padding-bottom:12px;">
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select id="bl-preset-select" style="flex:1; padding:8px; border-radius:6px; border:1px solid var(--bl-border-color); background:var(--bl-input-bg); color:var(--bl-text-primary); outline:none; font-family:inherit;"></select>
                        <button id="bl-preset-rename" title="重命名" style="padding:8px 12px; border-radius:6px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); cursor:pointer;">✏️</button>
                        <button id="bl-preset-delete" title="删除" style="padding:8px 12px; border-radius:6px; background:var(--bl-background-secondary); border:1px solid var(--bl-border-color); cursor:pointer; color:var(--bl-danger-color);">💀</button>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="bl-tool-btn" id="bl-preset-new">新建</button>
                        <button class="bl-tool-btn" id="bl-preset-save">保存</button>
                        <button class="bl-tool-btn" id="bl-preset-import">导入</button>
                        <button class="bl-tool-btn" id="bl-preset-export">导出</button>
                    </div>
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

    if (!$('#bl-confirm-modal').length) {
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
        
        $('#bl-modal-cancel').hover(function(){ $(this).css('opacity', '0.7') }, function(){ $(this).css('opacity', '1') });
    }
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

// 更新工具栏UI状态
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

function bindEvents() {
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { updateToolbarUI(); renderTags(); $('#bl-purifier-popup').fadeIn(200); });
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

    // 存档系统交互事件
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
        performGlobalCleanse();
    });

    $(document).off('click', '#bl-preset-rename').on('click', '#bl-preset-rename', function() {
        const settings = extension_settings[extensionName];
        const oldName = settings.activePreset;
        if (!oldName) {
            alert("当前为临时规则，请先新建存档。");
            return;
        }
        const newName = prompt("输入新存档名称：", oldName);
        if (!newName || newName === oldName) return;
        if (settings.presets[newName]) {
            alert("存档名称已存在。");
            return;
        }
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
            performGlobalCleanse();
        }
    });

    $(document).off('click', '#bl-preset-new').on('click', '#bl-preset-new', function() {
        const settings = extension_settings[extensionName];
        const name = prompt("输入新存档名称：");
        if (!name) return;
        if (settings.presets[name]) {
            alert("存档名称已存在。");
            return;
        }
        settings.presets[name] = JSON.parse(JSON.stringify(settings.rules));
        settings.activePreset = name;
        saveSettingsDebounced();
        updateToolbarUI();
    });

    $(document).off('click', '#bl-preset-save').on('click', '#bl-preset-save', function() {
        const settings = extension_settings[extensionName];
        if (!settings.activePreset) {
            alert("当前为临时规则，请点击“新建”保存为新存档。");
            return;
        }
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
                    performGlobalCleanse();
                } catch (err) {
                    alert("导入失败：检查文件是否为合法规则数组。");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    const visualCleanseOnly = () => {
        const regex = getPurifyRegex();
        if (regex) purifyDOM(document.getElementById('chat'), regex);
    };

    const delayedFullCleanse = () => setTimeout(performGlobalCleanse, 1000); 
    
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseOnly);      
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, delayedFullCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedFullCleanse); 
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedFullCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedFullCleanse);      
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedFullCleanse);          
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

// 自动数据迁移
function migrateOldData() {
    const settings = extension_settings[extensionName];
    
    // 迁移旧 bannedWords
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
    }

    // 迁移至多存档结构
    if (settings) {
        if (!settings.presets) settings.presets = {};
        if (settings.activePreset === undefined) settings.activePreset = "";

        if (settings.rules && settings.rules.length > 0 && Object.keys(settings.presets).length === 0) {
            settings.presets["默认存档"] = JSON.parse(JSON.stringify(settings.rules));
            settings.activePreset = "默认存档";
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
        performGlobalCleanse(); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
