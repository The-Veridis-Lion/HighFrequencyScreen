// 引用官方模块
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "absolute_purifier";
const defaultSettings = { bannedWords: [] };

/**
 * 核心逻辑：双重清洗（屏幕显示 + 内存数据）
 */
function performDeepCleanse() {
    const words = extension_settings[extensionName]?.bannedWords;
    if (!words || words.length === 0) return;

    const regex = new RegExp(`(${words.join('|')})`, 'g');
    let dataWasChanged = false;

    // 1. 清洗内存数据 (让 AI 彻底失忆，解决小铅笔里的残留)
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach((msg) => {
            if (msg.mes && regex.test(msg.mes)) {
                // 物理抹除：直接修改内存中的消息原文
                msg.mes = msg.mes.replace(regex, '');
                dataWasChanged = true;
            }
        });
    }

    // 2. 如果数据变了，强制保存聊天记录并刷新当前 UI
    if (dataWasChanged) {
        console.log(`[${extensionName}] 检测到屏蔽词，已从后台数据中永久切除。`);
        saveChat(); // 调用官方接口保存修改后的 chat 数组到 JSON 文件
    }

    // 3. 清洗屏幕显示 (让你眼不见为净)
    $('.mes_text').each(function() {
        const currentHtml = $(this).html();
        if (regex.test(currentHtml)) {
            $(this).html(currentHtml.replace(regex, ''));
        }
    });
}

/**
 * UI 注入 (参考 hide 扩展的标准模式)
 */
function createUI() {
    if ($('#bl-purifier-settings').length) return;

    const settingsHtml = `
    <div id="bl-purifier-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🚫 屏蔽词净化器 (深度切除)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding:10px;">
                <button id="bl-open-btn" class="menu_button" style="width:100%;">
                    管理净化词库
                </button>
            </div>
        </div>
    </div>`;
    $("#extensions_settings").append(settingsHtml);

    // 注入魔法棒按钮
    $('#bl-wand-btn').remove();
    $('#data_bank_wand_container').append(`
        <div id="bl-wand-btn" title="屏蔽词净化" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
            <i class="fa-solid fa-brain-z"></i><span>净化</span>
        </div>`);

    // 创建弹窗
    if (!$('#bl-popup').length) {
        $('body').append(`
            <div id="bl-popup" class="bl-helper-popup">
                <button id="bl-close" class="bl-popup-close-icon">&times;</button>
                <h3 class="bl-popup-title">屏蔽词深度净化</h3>
                <div class="bl-input-group">
                    <input type="text" id="bl-input" class="bl-input" placeholder="输入词语 (如: 极度)...">
                    <button id="bl-add" class="bl-add-btn">净化</button>
                </div>
                <div id="bl-list"></div>
                <div style="font-size:11px; color:#4ade80; text-align:center; margin-top:12px; line-height:1.4;">
                    <i class="fa-solid fa-check-double"></i> 词汇已从 AI 记忆及历史记录中彻底剔除
                </div>
            </div>`);
    }

    bindEvents();
}

function bindEvents() {
    $('#bl-wand-btn, #bl-open-btn').on('click', () => {
        renderWords();
        $('#bl-popup').fadeIn(200);
    });

    $('#bl-close').on('click', () => $('#bl-popup').fadeOut(200));

    $('#bl-add').off('click').on('click', () => {
        const val = $('#bl-input').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input').val('');
            saveSettingsDebounced(); // 保存设置
            renderWords();
            performDeepCleanse(); // 立即净化所有历史记录
        }
    });

    $('#bl-list').on('click', '.del-btn', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        location.reload(); // 删除词汇建议刷新页面以恢复之前被删掉的文字
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-list').html(words.map((w, i) => `
        <div class="bl-word-tag">${w}<span class="del-btn" data-index="${i}">&times;</span></div>
    `).join('') || '<span style="opacity:0.5; font-size:12px;">词库为空</span>');
}

// 引导启动
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    const init = () => {
        createUI();
        // 持续扫描，确保新生成的打字机消息也立刻被“数据切除”
        setInterval(performDeepCleanse, 500); 
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
        if (document.getElementById('send_textarea')) init();
    }
});
