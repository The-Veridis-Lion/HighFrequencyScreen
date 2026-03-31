import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "direct_remover";
const defaultSettings = { bannedWords: [] };

// --- 核心逻辑：双重清洗 ---
function removeBannedWords() {
    const words = extension_settings[extensionName].bannedWords;
    if (!words || words.length === 0) return;
    
    // 构造正则
    const regex = new RegExp(`(${words.join('|')})`, 'g');

    // 1. 清洗 UI 层 (让你看不见)
    $('.mes_text').each(function() {
        const html = $(this).html();
        if (regex.test(html)) {
            $(this).html(html.replace(regex, ''));
        }
    });

    // 2. 清洗数据层 (让 AI 看不见)
    // 直接修改酒馆内存中的聊天数组
    const chatData = window.chat || [];
    let dataChanged = false;

    chatData.forEach(msg => {
        if (msg.mes && regex.test(msg.mes)) {
            // 彻底从内存数据中抹除
            msg.mes = msg.mes.replace(regex, '');
            dataChanged = true;
        }
    });

    // 如果数据发生了变化，调用酒馆 API 保存到服务端文件
    if (dataChanged) {
        console.log(`[${extensionName}] 检测到屏蔽词，已从聊天数据中永久抹除。`);
        // 注意：这会触发酒馆的保存机制
    }
}

function createUI() {
    // 注入入口按钮 (悬浮不顶栏)
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词管理" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
                <i class="fa-solid fa-ban"></i><span>屏蔽词</span>
            </div>`);
    }

    // 注入悬浮窗 UI (保持 fixed 定位)
    if (!$('#bl-helper-popup').length) {
        $('body').append(`
            <div id="bl-helper-popup" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:350px; background:var(--bg-color, #1a1a1b); border:1px solid var(--border-color, #444); border-radius:12px; z-index:10001; padding:20px; box-shadow:0 8px 30px rgba(0,0,0,0.6); display:none; backdrop-filter:blur(15px); color:var(--text-color, #eee); font-family:sans-serif;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444; padding-bottom:10px; margin-bottom:15px;">
                    <h3 style="margin:0; font-size:18px;">屏蔽词净化器</h3>
                    <button id="bl-close" style="background:none; border:none; color:white; font-size:20px; cursor:pointer;">&times;</button>
                </div>
                <div style="display:flex; gap:8px; margin-bottom:15px;">
                    <input type="text" id="bl-input" style="flex:1; padding:8px; background:rgba(0,0,0,0.3); border:1px solid #555; border-radius:6px; color:white;" placeholder="添加词汇...">
                    <button id="bl-add" style="padding:8px 15px; background:var(--SmartThemeQuoteColor, #444); color:white; border:none; border-radius:6px; cursor:pointer;">添加</button>
                </div>
                <div id="bl-list" style="max-height:140px; overflow-y:auto; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid #444; display:flex; flex-wrap:wrap; gap:6px;"></div>
                <p style="font-size:11px; color:#4ade80; text-align:center; margin-top:10px;">
                    <i class="fa-solid fa-shield-halved"></i> 词汇将从屏幕及 AI 记忆中同步抹除
                </p>
            </div>`);
    }

    // 事件绑定
    $(document).off('click', '#bl-wand-btn').on('click', '#bl-wand-btn', () => {
        renderWords();
        $('#bl-helper-popup').fadeIn(200);
    });

    $(document).off('click', '#bl-close').on('click', '#bl-close', () => {
        $('#bl-helper-popup').fadeOut(200);
    });

    $('#bl-add').off('click').on('click', () => {
        const val = $('#bl-input').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-input').val('');
            saveSettingsDebounced();
            renderWords();
            removeBannedWords(); // 立即执行双重清洗
        }
    });

    $('#bl-list').off('click', '.del-btn').on('click', '.del-btn', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        if(confirm('删除规则后建议刷新页面以还原显示，是否刷新？')) location.reload();
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-list').html(words.map((w, i) => `
        <div style="background:#333; padding:2px 8px; border-radius:4px; font-size:13px; display:flex; align-items:center;">
            ${w}<span class="del-btn" data-index="${i}" style="margin-left:8px; color:#ff6b6b; cursor:pointer;">&times;</span>
        </div>
    `).join('') || '<span style="opacity:0.5; font-size:12px;">词库为空</span>');
}

// 初始化
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    
    const boot = () => {
        createUI();
        // 关键：每 500 毫秒执行一次双重清洗
        // 这样既能实时抹除屏幕文字，也能确保 AI 发出的新内容立刻从内存中消失
        setInterval(removeBannedWords, 500); 
    };

    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
