import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "direct_remover";
const defaultSettings = { bannedWords: ["极度", "极其", "病态"] };

// 核心：直接从文本中扣掉那些词
function removeBannedWords() {
    const words = extension_settings[extensionName].bannedWords;
    if (!words || words.length === 0) return;

    const regex = new RegExp(`(${words.join('|')})`, 'g');
    
    // 扫描所有聊天消息文本
    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) {
            // 直接用空字符串替换掉
            const newHtml = html.replace(regex, '');
            $(this).html(newHtml);
        }
    });
}

function createUI() {
    // 注入魔法棒入口
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词管理" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer;">
                <i class="fa-solid fa-ban"></i><span>屏蔽词</span>
            </div>`);
    }

    // 弹窗 HTML
    if (!$('#bl-popup').length) {
        $('body').append(`
            <div id="bl-popup" class="bl-helper-popup">
                <span id="bl-close" class="bl-popup-close-icon">&times;</span>
                <h3 style="margin-top:0">物理抹除屏蔽词</h3>
                <div style="display:flex; gap:5px;">
                    <input type="text" id="bl-input" style="flex:1; padding:5px; background:rgba(0,0,0,0.3); border:1px solid #555; color:white;" placeholder="输入屏蔽词...">
                    <button id="bl-add" class="menu_button">添加</button>
                </div>
                <div id="bl-list" class="bl-words-list"></div>
                <div style="font-size:11px; color:#4ade80;">* 添加后词汇将直接从消息中移除。</div>
            </div>`);
    }

    // 事件绑定
    $('#bl-wand-btn').on('click', () => {
        renderWords();
        $('#bl-popup').show();
    });
    $('#bl-close').on('click', () => $('#bl-popup').hide());
    $('#bl-add').on('click', () => {
        const val = $('#bl-input').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input').val('');
            saveSettingsDebounced();
            renderWords();
            removeBannedWords(); // 立即执行一次抹除
        }
    });
    $('#bl-list').on('click', '.bl-del-btn', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        location.reload(); // 删除词汇后刷新页面恢复显示
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-list').html(words.map((w, i) => `<div class="bl-word-tag">${w}<span class="bl-del-btn" data-index="${i}">&times;</span></div>`).join(''));
}

// 初始化
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    const boot = () => {
        createUI();
        removeBannedWords();
        // 监听消息生成，每秒强制清洗一次，确保“极度”这类词一露头就消失
        setInterval(removeBannedWords, 500); 
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
