import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "auto_blacklist";
const REGEX_RULE_ID = "auto_blacklist_generated_rule"; // 我们在酒馆正则库里的唯一通行证

const defaultSettings = {
    bannedWords: ["极度", "极其", "病态"],
    replacement: "***",
    autoApply: true
};

// 1. 加载本地设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], {
        ...defaultSettings,
        ...extension_settings[extensionName]
    });
}

// 2. 核心大招：将我们的词汇表直接“注入”到酒馆的内置正则引擎中
function syncToNativeRegex() {
    const settings = extension_settings[extensionName];
    
    // 确保酒馆全局的正则数组存在
    if (!extension_settings.regex) {
        extension_settings.regex = [];
    }

    // 找找看之前有没有注入过我们的专属规则
    let ruleIndex = extension_settings.regex.findIndex(r => r.id === REGEX_RULE_ID);
    
    if (!settings.autoApply || settings.bannedWords.length === 0) {
        // 如果开关没开，或者没有词，就禁用这条规则
        if (ruleIndex !== -1) extension_settings.regex[ruleIndex].disabled = true;
    } else {
        // 为了防止正则报错，对用户输入的符号进行转义
        const escapedWords = settings.bannedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regexStr = `/(${escapedWords.join('|')})/g`;

        // 构造标准的酒馆正则对象
        const ruleObj = {
            id: REGEX_RULE_ID,
            scriptName: "🚫 自动屏蔽词拦截 (由插件管理)",
            regex: regexStr,
            replacementStr: settings.replacement,
            placement: [1, 2], // 1代表修改用户输入, 2代表修改AI输出 (彻底杜绝)
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: true,
            minDepth: null,
            maxDepth: null
        };

        if (ruleIndex !== -1) {
            extension_settings.regex[ruleIndex] = ruleObj; // 更新
        } else {
            extension_settings.regex.push(ruleObj); // 新增
        }
    }

    saveSettingsDebounced(); // 保存全局设置

    // 唤醒酒馆的正则引擎，让新规则立刻生效
    if (typeof window.loadRegex === 'function') {
        window.loadRegex();
    }
}

// 3. 渲染 UI
function renderUI() {
    const settings = extension_settings[extensionName];
    const container = $('#bl-words-container');
    
    if (settings.bannedWords.length === 0) {
        container.html('<div style="opacity:0.5; font-size:12px; width:100%; text-align:center;">黑名单为空</div>');
    } else {
        container.html(settings.bannedWords.map((w, index) => `
            <div class="bl-word-tag">
                ${w} <span class="del-btn" data-index="${index}">&times;</span>
            </div>
        `).join(''));
    }

    $('#bl-replacement-input').val(settings.replacement);
    $('#bl-auto-apply-checkbox').prop('checked', settings.autoApply);
}

// 4. 将控制面板嵌入扩展菜单
function createUI() {
    if ($('#bl-helper-settings').length > 0) return;

    const html = `
    <div id="bl-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header interactable">
                <b><i class="fa-solid fa-ban"></i> 自动屏蔽词管家</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding: 15px 10px; display:none;">
                
                <div class="bl-flex-row">
                    <input type="checkbox" id="bl-auto-apply-checkbox" style="width:16px; height:16px;">
                    <label for="bl-auto-apply-checkbox" style="font-size:14px; cursor:pointer;">启用全自动拦截 (接入内置引擎)</label>
                    <span id="bl-sync-status" class="bl-status"><i class="fa-solid fa-check"></i> 已同步生效</span>
                </div>

                <div class="bl-flex-row">
                    <span style="font-size:13px; opacity:0.8;">将屏蔽词替换为:</span>
                    <input type="text" id="bl-replacement-input" class="bl-input" style="max-width: 80px;" placeholder="***">
                </div>
                <hr class="sysHR">
                <div class="bl-flex-row">
                    <input type="text" id="bl-new-word" class="bl-input" placeholder="输入不想看到的词 (如: 极度)">
                    <button id="bl-add-word-btn" class="bl-btn bl-btn-primary">添加</button>
                </div>
                <div style="font-size:12px; opacity:0.8; margin-bottom:8px;">当前黑名单：</div>
                <div id="bl-words-container"></div>
            </div>
        </div>
    </div>`;

    $("#extensions_settings").prepend(html);

    $('#bl-helper-settings .inline-drawer-toggle').on('click', function () {
        $(this).next('.inline-drawer-content').slideToggle(200);
        $(this).find('.inline-drawer-icon').toggleClass('down up');
    });

    renderUI();
    bindEvents();
}

function showSyncSuccess() {
    $('#bl-sync-status').stop(true, true).fadeIn(200).delay(1500).fadeOut(300);
}

// 每次改动都会自动同步给酒馆引擎
function handleSettingsChange() {
    saveSettingsDebounced();
    syncToNativeRegex();
    showSyncSuccess();
    renderUI();
}

// 5. 事件绑定
function bindEvents() {
    $('#bl-add-word-btn').on('click', function() {
        const input = document.getElementById('bl-new-word');
        const word = input.value.trim();
        const wordsList = extension_settings[extensionName].bannedWords;
        
        if (word && !wordsList.includes(word)) {
            wordsList.push(word);
            input.value = '';
            handleSettingsChange();
        } else if (wordsList.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已经在黑名单中了！');
        }
    });

    $('#bl-new-word').on('keypress', function(e) {
        if (e.which === 13) $('#bl-add-word-btn').click();
    });

    $('#bl-words-container').on('click', '.del-btn', function() {
        const index = $(this).data('index');
        extension_settings[extensionName].bannedWords.splice(index, 1);
        handleSettingsChange();
    });

    $('#bl-replacement-input').on('change', function() {
        extension_settings[extensionName].replacement = $(this).val();
        handleSettingsChange();
    });

    $('#bl-auto-apply-checkbox').on('change', function() {
        extension_settings[extensionName].autoApply = $(this).is(':checked');
        handleSettingsChange();
    });
}

// 6. 原生启动流程
jQuery(async () => {
    let isInitialized = false;
    const init = () => {
        if (isInitialized) return;
        isInitialized = true;
        loadSettings();
        createUI();
        syncToNativeRegex(); // 启动时自动同步一次规则
    };

    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined' && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    } else {
        setTimeout(init, 2000);
    }
});
