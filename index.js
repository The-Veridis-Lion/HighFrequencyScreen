(function () {
    const extensionName = "blacklist-regex-helper";
    
    // 从本地缓存读取黑名单，如果没有就给几个默认例子
    let bannedWords = JSON.parse(localStorage.getItem('stx_banned_words')) || ["极度", "极其", "病态"];

    // --- 1. 核心逻辑：渲染 UI 与生成正则 ---
    function renderBlacklist() {
        const container = document.getElementById('bl-words-container');
        const regexInput = document.getElementById('bl-regex-input');
        if (!container || !regexInput) return;

        // 保存到本地
        localStorage.setItem('stx_banned_words', JSON.stringify(bannedWords));

        // 渲染词汇标签
        if (bannedWords.length === 0) {
            container.innerHTML = '<div style="opacity:0.5; font-size:12px; width:100%; text-align:center;">还没有添加任何屏蔽词</div>';
            regexInput.value = '';
        } else {
            container.innerHTML = bannedWords.map((w, index) => `
                <div class="bl-word-tag">
                    ${w} <span class="del-btn" data-index="${index}">&times;</span>
                </div>
            `).join('');
            
            // 自动生成高亮正则格式
            regexInput.value = `/(${bannedWords.join('|')})/g`;
        }
    }

    // --- 2. 初始化弹窗 DOM ---
    function initModal() {
        if ($('#bl-helper-popup').length) return;
        const popupHtml = `
        <div id="bl-helper-popup">
            <div class="bl-popup-header">
                <div class="bl-popup-title"><i class="fa-solid fa-ban"></i> 屏蔽词正则生成器</div>
                <button id="bl-close-btn" class="bl-close-btn">&times;</button>
            </div>
            
            <div class="bl-input-group">
                <input type="text" id="bl-new-word" class="bl-input" placeholder="输入不想看到的词 (如: 极度)">
                <button id="bl-add-word-btn" class="bl-add-btn">添加</button>
            </div>

            <div style="font-size:12px; opacity:0.8; margin-bottom:5px;">当前黑名单词汇 (点击 x 删除)：</div>
            <div id="bl-words-container"></div>
            
            <div style="font-size:12px; margin-bottom:5px;">自动生成的正则预览：</div>
            <textarea id="bl-regex-input" class="bl-textarea" readonly></textarea>
            
            <button id="bl-copy-regex" class="bl-copy-btn"><i class="fa-solid fa-copy"></i> 复制正则表达式</button>
        </div>`;
        $('body').append(popupHtml);
        renderBlacklist(); // 初次渲染
    }

    // --- 3. 强力注入菜单入口 (免疫菜单刷新) ---
    function injectMenuButton() {
        const targetMenu = $('#extensions_settings .list-group, .extensions-menu').first();
        if (targetMenu.length > 0 && !$('#bl-native-btn').length) {
            const btnHtml = `
            <div id="bl-native-btn" class="list-group-item interactable" title="手动管理屏蔽词汇">
                <i class="fa-solid fa-ban" style="margin-right: 8px; width: 20px; text-align: center;"></i>
                <span class="drawer-item-text">屏蔽词管理</span>
            </div>`;
            targetMenu.prepend(btnHtml);
        }
    }

    // --- 4. 绑定事件 (绝对防卡死的全局事件代理) ---
    // 这种写法将事件绑定在 document 上，无论按钮被重绘多少次，只要 ID 匹配就绝对能点开！
    $(document).on('click', '#bl-native-btn', function(e) {
        e.stopPropagation(); // 阻止抽屉自动收起
        $('#bl-helper-popup').fadeIn(150);
        renderBlacklist();
    });

    $(document).on('click', '#bl-close-btn', function() {
        $('#bl-helper-popup').fadeOut(150);
    });

    // 添加词汇逻辑 (点击添加按钮)
    $(document).on('click', '#bl-add-word-btn', function() {
        const input = document.getElementById('bl-new-word');
        const word = input.value.trim();
        if (word && !bannedWords.includes(word)) {
            bannedWords.push(word);
            input.value = '';
            renderBlacklist();
        } else if (bannedWords.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已经在黑名单中了！');
        }
    });

    // 添加词汇逻辑 (按回车键)
    $(document).on('keypress', '#bl-new-word', function(e) {
        if (e.which === 13) $('#bl-add-word-btn').click();
    });

    // 删除词汇逻辑
    $(document).on('click', '.bl-word-tag .del-btn', function() {
        const index = $(this).data('index');
        bannedWords.splice(index, 1);
        renderBlacklist();
    });

    // 复制正则
    $(document).on('click', '#bl-copy-regex', function() {
        const ta = document.getElementById('bl-regex-input');
        if (!ta.value) return;
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('复制成功！快去替换工具里粘贴吧。');
    });

    // --- 5. 启动流程 ---
    function bootStrap() {
        initModal();
        setInterval(injectMenuButton, 1000); // 只负责补回按钮，不再重复绑定事件
    }

    // 监听酒馆核心启动事件
    if (typeof eventSource !== 'undefined' && event_types && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, bootStrap);
        if (document.getElementById('send_textarea')) bootStrap();
    } else {
        setTimeout(bootStrap, 2000);
    }
})();
