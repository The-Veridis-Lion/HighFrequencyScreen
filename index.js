// 严格引用官方核心模块
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, saveChat } from "../../../../script.js";

const extensionName = "absolute_memory_purifier";
const defaultSettings = { bannedWords: [] };

// 弹窗居中算法
function centerPopup($popup) {
    if (!$popup || $popup.length === 0 || $popup.is(':hidden')) return;
    const top = Math.max(10, ($(window).height() - $popup.outerHeight()) / 2);
    const left = Math.max(10, ($(window).width() - $popup.outerWidth()) / 2);
    $popup.css({ top: `${top}px`, left: `${left}px`, transform: 'none' });
}

// 核心功能：双重深度切除 (DOM + window.chat 数据)
function performDeepCleanse() {
    const words = extension_settings[extensionName]?.bannedWords;
    if (!words || words.length === 0) return;

    const regex = new RegExp(`(${words.join('|')})`, 'g');
    let dataChanged = false;

    // 1. 切除内存数据 (让铅笔编辑框也没词，AI彻底扫不到)
    if (window.chat && Array.isArray(window.chat)) {
        window.chat.forEach((msg) => {
            if (msg.mes && regex.test(msg.mes)) {
                msg.mes = msg.mes.replace(regex, '');
                dataChanged = true;
            }
        });
    }

    // 2. 物理保存聊天文件
    if (dataChanged) {
        saveChat(); // 强制持久化到 JSON，切断 AI 后路
    }

    // 3. 实时清洗屏幕 DOM
    $('.mes_text').each(function() {
        const currentHtml = $(this).html();
        if (regex.test(currentHtml)) {
            $(this).html(currentHtml.replace(regex, ''));
        }
    });
}

function createUI() {
    // A. 注入抽屉设置栏
    if (!$('#bl-purifier-drawer').length) {
        const drawerHtml = `
        <div id="bl-purifier-drawer" class="hide-helper-container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header interactable">
                    <b>🚫 屏蔽词深度净化器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding:10px; display:none;">
                    <button id="bl-drawer-open" class="menu_button" style="width:100%;">管理净化词库</button>
                </div>
            </div>
        </div>`;
        $("#extensions_settings").append(drawerHtml);
        
        // 绑定抽屉折叠
        $('#bl-purifier-drawer .inline-drawer-toggle').on('click', function() {
            $(this).next('.inline-drawer-content').slideToggle(200);
            $(this).find('.inline-drawer-icon').toggleClass('down up');
        });
    }

    // B. 注入魔法棒按钮
    if (!$('#bl-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="bl-wand-btn" title="屏蔽词净化" style="display:flex; align-items:center; gap:8px; padding:5px 10px; cursor:pointer; color:var(--text-secondary);">
                <i class="fa-solid fa-brain-z"></i><span>净化</span>
            </div>`);
    }

    // C. 注入悬浮窗 (必须 append 到 body)
    if (!$('#bl-purifier-popup').length) {
        $('body').append(`
            <div id="bl-purifier-popup">
                <div class="bl-popup-header">
                    <h3 class="bl-popup-title">屏蔽词深度净化</h3>
                    <button id="bl-popup-close" class="bl-close-icon">&times;</button>
                </div>
                <div class="bl-input-group">
                    <input type="text" id="bl-popup-input" class="bl-input" placeholder="输入词语 (如: 极度)...">
                    <button id="bl-popup-add" class="bl-add-btn">净化</button>
                </div>
                <div id="bl-list"></div>
                <div style="font-size:11px; color:#4ade80; text-align:center; margin-top:12px;">
                    <i class="fa-solid fa-check-double"></i> 词汇已从 AI 记忆及铅笔编辑框中同步切除
                </div>
            </div>`);
    }
}

// 绑定事件 (使用全局代理，确保永远生效)
function bindEvents() {
    $(document).on('click', '#bl-wand-btn, #bl-drawer-open', () => {
        renderWords();
        const $popup = $('#bl-purifier-popup');
        $popup.fadeIn(200);
        centerPopup($popup);
    });

    $(document).on('click', '#bl-popup-close', () => $('#bl-purifier-popup').fadeOut(200));

    $(document).on('click', '#bl-popup-add', () => {
        const val = $('#bl-popup-input').val().trim();
        if (val && !extension_settings[extensionName].bannedWords.includes(val)) {
            extension_settings[extensionName].bannedWords.push(val);
            $('#bl-popup-input').val('');
            saveSettingsDebounced();
            renderWords();
            performDeepCleanse(); 
        }
    });

    $(document).on('click', '.bl-tag span', function() {
        const idx = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(idx, 1);
        saveSettingsDebounced();
        renderWords();
        if(confirm('规则已删。建议刷新页面以还原显示。')) location.reload();
    });
}

function renderWords() {
    const words = extension_settings[extensionName].bannedWords || [];
    $('#bl-list').html(words.map((w, i) => `<div class="bl-tag">${w}<span data-index="${i}">&times;</span></div>`).join('') || '<div style="opacity:0.5; width:100%; text-align:center; font-size:12px;">词库为空</div>');
}

// 启动引导
jQuery(() => {
    extension_settings[extensionName] = extension_settings[extensionName] || { ...defaultSettings };
    const boot = () => {
        createUI();
        bindEvents();
        setInterval(performDeepCleanse, 500); 
    };
    if (typeof eventSource !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        if (document.getElementById('send_textarea')) boot();
    }
});
