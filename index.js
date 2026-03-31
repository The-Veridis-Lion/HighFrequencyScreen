import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "breeding_preventer";
const defaultSettings = { bannedWords: [] };

// --- 核心逻辑：双重同步净化 (DOM + 内存) ---
function performGlobalCleanse() {
    const words = extension_settings[extensionName].bannedWords;
    if (!words || words.length === 0) return;
    
    // 生成正则
    const regex = new RegExp(`(${words.join('|')})`, 'g');

    // 1. 净化 DOM (让你眼不见为净)
    $('.mes_text').each(function() {
        const currentHtml = $(this).html();
        if (regex.test(currentHtml)) {
            $(this).html(currentHtml.replace(regex, ''));
        }
    });

    // 2. 净化内存数据 (让 AI 彻底失忆，防止繁殖)
    const chatData = window.chat || [];
    let memoryChanged = false;

    chatData.forEach(msg => {
        if (msg.mes && regex.test(msg.mes)) {
            msg.mes = msg.mes.replace(regex, '');
            memoryChanged = true;
        }
    });

    // 如果数据变了，静默保存，不打扰用户
    if (memoryChanged) {
        // saveSettingsDebounced 并不直接保存聊天记录，
        // 这里依靠酒馆自身的每条消息生成后的自动存档机制即可。
    }
}

function createUI() {
    // 注入魔法棒按钮
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词净化" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
                <i class="fa-solid fa-shield-halved"></i><span>屏蔽词</span>
            </div>`);
    }

    // 注入悬浮窗 UI
    if (!$('#bl-helper-popup').length) {
        $('body').append(`
            <div id="bl-helper-popup">
                <div class="bl-popup-header">
                    <h3 class="bl-popup-title">屏蔽词净化器</h3>
                    <button id="bl-close-icon" class="bl-close-icon">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-input" class="bl-input" placeholder="输入词语 (如: 极度)...">
                    <button id="bl-add" class="bl-add-btn">添加</button>
                </div>
                <div id="bl-words-container"></div>
                <div style="font-size:11px; color:#4ade80; text-align:center; margin-top:12px; line-height:1.4;">
                    <i class="fa-solid fa-bolt"></i> 实时抹除屏幕文字<br>
                    <i class="fa-solid fa-brain"></i> 同步切除 AI 记忆 (防止复读)
                </div>
            </div>`);
    }

    // 事件绑定
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => {
        renderWords();
        $('#bl-helper-popup').fadeIn(200);
    });

    $(document).off('click', '#bl-close-icon').on('click', '#bl-close-icon', () => {
        $('#bl-helper-popup').fadeOut(200);
    });

    $('#bl-add').off('click').on('click', () => {
        const val = $('#bl-input').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input').val('');
            saveSettingsDebounced();
            renderWords();
            performGlobalCleanse(); // 添加后立刻净化全场
        }
    });

    $('#bl-words-container').off('click', '.del-btn').on('click', '.del-btn', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        // 删除后建议刷新，因为已经抹除的数据无法通过脚本找回
        if(confirm('已删除规则。由于数据已被永久抹除，建议刷新页面，是否刷新？')) location.reload();
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-words-container').html(words.map((w, i) => `
        <div class="bl-word-tag">${w}<span class="del-btn" data-index="${i}">&times;</span></div>
    `).join('') || '<span style="opacity:0.5; font-size:12px; width:100%; text-align:center;">净化库为空</span>');
}

// 初始化
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    const boot = () => {
        createUI();
        // 每 500ms 强制清洗一遍，确保打字机效果吐出的词也立刻消失
        setInterval(performGlobalCleanse, 500); 
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
