import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "direct_remover";
const defaultSettings = { bannedWords: [] };

// 核心抹除逻辑
function removeBannedWords() {
    const words = extension_settings[extensionName].bannedWords;
    if (!words || words.length === 0) return;
    const regex = new RegExp(`(${words.join('|')})`, 'g');
    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) {
            $(this).html(html.replace(regex, ''));
        }
    });
}

function createUI() {
    // 注入魔法棒入口 (保持原样)
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词管理" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer;">
                <i class="fa-solid fa-ban"></i><span>屏蔽词</span>
            </div>`);
    }

    // 注入悬浮窗 UI 到 BODY (防止顶起回复栏)
    if (!$('#bl-helper-popup').length) {
        $('body').append(`
            <div id="bl-helper-popup">
                <div class="bl-popup-header">
                    <h3 class="bl-popup-title">屏蔽词实时过滤</h3>
                    <button id="bl-close-icon" class="bl-close-icon">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-input" class="bl-input" placeholder="添加屏蔽词...">
                    <button id="bl-add" class="bl-add-btn">添加</button>
                </div>
                <div id="bl-words-container"></div>
                <p style="font-size:11px; opacity:0.6; text-align:center;">添加后自动生效，词汇将直接消失</p>
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
            removeBannedWords();
        }
    });

    $('#bl-words-container').off('click', '.del-btn').on('click', '.del-btn', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        // 删除词后通过刷新页面恢复
        if(confirm('删除规则后建议刷新页面以恢复显示，是否刷新？')) location.reload();
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-words-container').html(words.map((w, i) => `
        <div class="bl-word-tag">${w}<span class="del-btn" data-index="${i}">&times;</span></div>
    `).join('') || '<span style="opacity:0.5; font-size:12px;">词库为空</span>');
}

jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        createUI();
        setInterval(removeBannedWords, 500); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
