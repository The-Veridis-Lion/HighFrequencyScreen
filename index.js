import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat, chat_metadata, chat } from "../../../../script.js";

const extensionName = "ultimate_purifier";
const defaultSettings = { 
    rules: [],          // 当前正在使用的规则
    presets: {},        // 存档库
    activePreset: ""    // 新增：记录当前激活（选中）的存档名称
};

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
 * UI 保护区检测：判断当前元素是否处于系统预设、设置面板或输入框中
 */
function isProtectedNode(node) {
    if (!node || !node.closest) return false;
    
    // 1. 保护主发送框和气泡编辑框
    if (node.id === 'send_textarea' || node.classList.contains('edit_textarea')) return true;
    
    // 2. 保护本插件自身的设置界面
    if (node.closest('#bl-purifier-popup, #bl-batch-popup, #bl-confirm-modal')) return true;
    
    // 3. ★ 核心：保护所有酒馆的 UI 界面（右侧预设菜单、所有弹窗、顶部状态栏、左侧抽屉等）
    if (node.closest('#right-nav-panel, .right_menu, .drawer-content, .popup, .shadow_popup, .character-modal, #top-bar')) {
        return true;
    }
    
    return false;
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
 * 扫描并清理指定 DOM (加入保护区检测)
 */
function purifyDOM(rootNode, regex) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT, null, false);
    
    let node;
    while (node = walker.nextNode()) {
        const parent = node.parentNode;
        // 如果文本节点所在的父级属于受保护区域，或者用户正在聚焦编辑，则跳过
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
            // 过滤受保护的输入框和当前正在打字的输入框
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
            
            // 1. 清理当前显示的主消息 (msg.mes)
            if (typeof msg.mes === 'string') {
                const cleaned = msg.mes.replace(regex, dynamicReplacer);
                if (msg.mes !== cleaned) { 
                    msg.mes = cleaned; 
                    msgChanged = true; 
                }
            }
            
            // 2. 清理所有滑动分支 (Swipes)，同时兼容新老版本酒馆的数据结构
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

            // 3. 如果修改了底层，立刻命令酒馆官方渲染器刷新气泡！
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
    
    // 4. 将洗刷干净的数据真正写入 .jsonl 文档
    if (chatChanged) {
        try {
            if (typeof saveChat === 'function') saveChat();
        } catch(e) {
            console.error("[Ultimate Purifier] 存盘失败", e);
        }
    }
    
    // 5. 兜底屏幕视觉清理
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
            
            // ================= 新增成功后的切回预设提醒 =================
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
                    // 额外防线：检查文本节点的父级
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
    
    // 只监听实际的聊天气泡区域
    const chatEl = document.getElementById('chat');
    if (chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value'] });

    // 全局打字监听器
    document.addEventListener('input', (e) => {
        const regex = getPurifyRegex();
        // ★ 在这里拦截：如果打字的目标输入框属于保护区（预设面板等），直接 return 放行，不执行过滤
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

    // 省略中间的 confirm-modal HTML (保留你原有的深度清理警告弹窗不变)
    if (!$('#bl-confirm-modal').length) {
        // ... (保留你原有的 bl-confirm-modal 结构)
    }

    // ================= 重点修改：存档界面 =================
    if (!$('.bl-tools-bar').length) {
        $(`<div class="bl-tools-bar">
            <div class="bl-tools-group bl-row-full">
                <select id="bl-preset-select" class="bl-input">
                    <option value="">-- 临时规则 (未绑定存档) --</option>
                </select>
                <button id="bl-delete-preset-btn" class="bl-icon-btn" title="永久删除当前存档">
                    <i class="fa-solid fa-skull"></i>
                </button>
            </div>

            <div class="bl-tools-group bl-row-actions">
                <button id="bl-new-preset-btn" class="bl-add-btn" title="另存为新存档">新建</button>
                <button id="bl-save-preset-btn" class="bl-add-btn" title="保存到当前存档">保存</button>
                <button id="bl-import-click-btn" class="bl-add-btn">导入</button>
                <button id="bl-export-btn" class="bl-add-btn">导出</button>
                <input type="file" id="bl-file-import" style="display:none;" accept=".json">
            </div>
        </div>`).insertBefore('.bl-rule-builder'); 
    }
    
    // 初始化时渲染下拉菜单
    renderPresetDropdown();
}

function bindEvents() {
    // 基础功能绑定 (弹窗开关、添加规则、删除规则等，保留你原有的)
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => { renderTags(); $('#bl-purifier-popup').fadeIn(200); });
    $(document).off('click', '#bl-close-btn').on('click', '#bl-close-btn', () => $('#bl-purifier-popup').fadeOut(200));
    
    $(document).off('click', '#bl-add-rule-btn').on('click', '#bl-add-rule-btn', () => {
        const targets = parseInputToWords($('#bl-target-input').val());
        const replacements = parseInputToWords($('#bl-rep-input').val());
        if (targets.length > 0) {
            extension_settings[extensionName].rules.push({ targets, replacements });
            $('#bl-target-input').val(''); $('#bl-rep-input').val('');
            isRegexDirty = true; saveSettingsDebounced(); renderTags(); performGlobalCleanse(); 
        }
    });

    $(document).off('click', '.bl-tag-del').on('click', '.bl-tag-del', function() {
        extension_settings[extensionName].rules.splice($(this).data('index'), 1);
        isRegexDirty = true; saveSettingsDebounced(); renderTags();
    });

    $(document).off('click', '#bl-deep-clean-btn').on('click', '#bl-deep-clean-btn', showConfirmModal);

    // 监听打字与渲染 (保留你原有的)
    const visualCleanseOnly = () => { const regex = getPurifyRegex(); if (regex) purifyDOM(document.getElementById('chat'), regex); };
    const delayedFullCleanse = () => setTimeout(performGlobalCleanse, 1000); 
    if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, visualCleanseOnly);      
    if (event_types.GENERATION_ENDED) eventSource.on(event_types.GENERATION_ENDED, delayedFullCleanse); 
    if (event_types.GENERATION_STOPPED) eventSource.on(event_types.GENERATION_STOPPED, delayedFullCleanse); 
    if (event_types.MESSAGE_RECEIVED) eventSource.on(event_types.MESSAGE_RECEIVED, delayedFullCleanse); 
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, delayedFullCleanse);      
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, delayedFullCleanse);

    // ================= 重点修改：存档相关按钮逻辑 =================
    
    // 1. 新建存档
    $(document).off('click', '#bl-new-preset-btn').on('click', '#bl-new-preset-btn', createNewPreset);

    // 2. 保存当前修改
    $(document).off('click', '#bl-save-preset-btn').on('click', '#bl-save-preset-btn', saveCurrentPreset);

    // 3. 导入 / 导出
    $(document).off('click', '#bl-export-btn').on('click', '#bl-export-btn', exportRules);
    $(document).off('click', '#bl-import-click-btn').on('click', '#bl-import-click-btn', () => $('#bl-file-import').click());
    $(document).off('change', '#bl-file-import').on('change', '#bl-file-import', importRules);

    // 4. 下拉菜单选中即切换
    $(document).off('change', '#bl-preset-select').on('change', '#bl-preset-select', function() {
        loadPreset($(this).val());
    });

    // 5. 绑定删除存档
    $(document).off('click', '#bl-delete-preset-btn').on('click', '#bl-delete-preset-btn', deleteCurrentPreset);
}
/**
 * 触发带倒计时的确认弹窗
 */
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

// ================= 新增的功能函数 (移到外层全局作用域) =================

// --- 渲染下拉菜单 ---
function renderPresetDropdown() {
    const presets = extension_settings[extensionName].presets || {};
    let options = '<option value="">-- 选择存档 --</option>';
    for (const name in presets) {
        options += `<option value="${name}">${name}</option>`;
    }
    $('#bl-preset-select').html(options);
}

// --- 导出当前规则 ---
function exportRules() {
    const rules = extension_settings[extensionName].rules || [];
    const dataStr = JSON.stringify(rules, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `purifier_rules_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- 导入规则 ---
function importRules(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedRules = JSON.parse(e.target.result);
            if (!Array.isArray(importedRules)) throw new Error("格式错误");
            
            extension_settings[extensionName].rules = importedRules;
            isRegexDirty = true;
            saveSettingsDebounced();
            renderTags();
            
            alert("规则导入成功！");
        } catch (err) {
            alert("导入失败：请确保文件是有效的 JSON 规则文件。");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}

// --- 保存当前规则为新存档 ---
function savePreset(presetName) {
    if (!presetName) return;
    if (!extension_settings[extensionName].presets) {
        extension_settings[extensionName].presets = {};
    }
    const currentRules = JSON.parse(JSON.stringify(extension_settings[extensionName].rules));
    extension_settings[extensionName].presets[presetName] = currentRules;
    
    saveSettingsDebounced();
    alert(`已保存为存档: ${presetName}`);
    renderPresetDropdown(); 
}

// --- 切换（加载）指定存档 ---
function loadPreset(presetName) {
    const presets = extension_settings[extensionName].presets;
    if (!presets || !presets[presetName]) return;
    
    extension_settings[extensionName].rules = JSON.parse(JSON.stringify(presets[presetName]));
    isRegexDirty = true;
    saveSettingsDebounced();
    renderTags();
    performGlobalCleanse(); 
}

// ================= 绑定事件 =================
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

    // --- 绑定存档与导入导出按钮 ---
    $(document).off('click', '#bl-export-btn').on('click', '#bl-export-btn', exportRules);
    $(document).off('click', '#bl-import-click-btn').on('click', '#bl-import-click-btn', () => $('#bl-file-import').click());
    $(document).off('change', '#bl-file-import').on('change', '#bl-file-import', importRules);

    $(document).off('click', '#bl-save-preset-btn').on('click', '#bl-save-preset-btn', () => {
        const name = prompt("请输入新存档名称：");
        if (name) savePreset(name);
    });

    // 下拉菜单选中即自动加载
    $(document).off('change', '#bl-preset-select').on('change', '#bl-preset-select', function() {
        const name = $(this).val();
        if (name) {
            loadPreset(name);
        }
    });
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

// ================= 新增与更新的逻辑函数 =================

// --- 渲染下拉菜单 ---
function renderPresetDropdown() {
    const settings = extension_settings[extensionName];
    const presets = settings.presets || {};
    const active = settings.activePreset || ""; // 获取当前激活的存档
    
    let options = '<option value="">-- 临时规则 (未绑定存档) --</option>';
    for (const name in presets) {
        // 如果是当前激活的，加上 selected 属性
        const selected = (name === active) ? 'selected' : '';
        options += `<option value="${name}" ${selected}>${name}</option>`;
    }
    $('#bl-preset-select').html(options);
}

// --- 1. 新建存档 ---
function createNewPreset() {
    const name = prompt("请输入新存档名称：");
    if (!name) return;
    
    const settings = extension_settings[extensionName];
    if (!settings.presets) settings.presets = {};
    
    // 检查重名
    if (settings.presets[name] && !confirm(`存档 "${name}" 已存在，是否覆盖？`)) {
        return;
    }
    
    // 拷贝当前规则到新存档，并将其设为激活状态
    settings.presets[name] = JSON.parse(JSON.stringify(settings.rules));
    settings.activePreset = name; 
    
    saveSettingsDebounced();
    alert(`已新建并切换至存档: ${name}`);
    renderPresetDropdown(); 
}

// --- 2. 保存当前修改到激活的存档 ---
function saveCurrentPreset() {
    const settings = extension_settings[extensionName];
    const active = settings.activePreset;
    
    if (!active) {
        alert("当前为【临时规则】状态，请先点击【新建】将规则存为一个存档！");
        return;
    }
    
    if (!settings.presets) settings.presets = {};
    
    // 覆盖当前激活的存档
    settings.presets[active] = JSON.parse(JSON.stringify(settings.rules));
    saveSettingsDebounced();
    alert(`保存成功！规则已更新至存档: ${active}`);
}

// --- 3. 切换（加载）指定存档 ---
function loadPreset(presetName) {
    const settings = extension_settings[extensionName];
    
    if (!presetName) {
        // 如果用户选择了 "-- 临时规则 --"
        settings.activePreset = "";
        saveSettingsDebounced();
        return;
    }

    const presets = settings.presets;
    if (!presets || !presets[presetName]) return;
    
    // 深拷贝取出，覆盖当前规则，并更新状态
    settings.rules = JSON.parse(JSON.stringify(presets[presetName]));
    settings.activePreset = presetName;
    
    isRegexDirty = true;
    saveSettingsDebounced();
    renderTags();
    performGlobalCleanse(); 
}

// --- 4. 导出规则 ---
function exportRules() {
    const rules = extension_settings[extensionName].rules || [];
    const dataStr = JSON.stringify(rules, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `purifier_rules_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- 5. 导入规则 ---
function importRules(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedRules = JSON.parse(e.target.result);
            if (!Array.isArray(importedRules)) throw new Error("格式错误");
            
            const settings = extension_settings[extensionName];
            settings.rules = importedRules;
            settings.activePreset = ""; // 导入的规则默认进入“临时状态”，防止误覆盖现有存档
            
            isRegexDirty = true;
            saveSettingsDebounced();
            renderPresetDropdown(); // 刷新下拉框为“临时规则”
            renderTags();
            
            alert("规则导入成功！(当前为临时状态，如果需要保存请点击【新建】)");
        } catch (err) {
            alert("导入失败：请确保文件是有效的 JSON 规则文件。");
        }
        event.target.value = ''; 
    };
    reader.readAsText(file);
}

// --- 6. 删除当前选中的存档 ---
function deleteCurrentPreset() {
    const settings = extension_settings[extensionName];
    const name = settings.activePreset;
    
    if (!name) {
        alert("当前处于【临时规则】状态，没有存档可以删除。");
        return;
    }
    
    // 确认弹窗，防止误删
    if (confirm(`⚠️ 确定要永久删除存档 "${name}" 吗？\n此操作不可撤销。`)) {
        delete settings.presets[name];
        settings.activePreset = ""; // 删除后状态切回临时
        
        saveSettingsDebounced();
        renderPresetDropdown();
        alert(`存档 "${name}" 已删除。`);
    }
}

let isBooted = false;
jQuery(() => {
    if (isBooted) return;
    extension_settings[extensionName] = extension_settings[extensionName] || { rules: [], presets: {} }; // 补全默认设置
    
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
