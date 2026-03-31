(function () {
    const extensionName = "blacklist-regex-helper";
    // 从本地缓存读取数据，即使刷新页面词汇也不会丢
    let bannedWords = JSON.parse(localStorage.getItem('stx_banned_words')) || ["极度", "极其", "病态"];

    // 渲染词汇列表并自动生成正则
    function renderBlacklist() {
        const container = document.getElementById('bl-words-container');
        const regexInput = document.getElementById('bl-regex-input');
        if (!container || !regexInput) return;

        // 保存到本地
        localStorage.setItem('stx_banned_words', JSON.stringify(bannedWords));

        if (bannedWords.length === 0) {
            container.innerHTML = '<div style="opacity:0.5; font-size:12px; width:100%; text-align:center;">还没有添加任何屏蔽词</div>';
            regexInput.value = '';
        } else {
            container.innerHTML = bannedWords.map((w, index) => `
                <div class="bl-word-tag">
                    ${w} <span class="del-btn" data-index="${index}">&times;</span>
                </div>
            `).join('');
            
            regexInput.value = `/(${bannedWords.join('|')})/g`;
        }
    }

    // 核心注入逻辑：直接嵌入官方扩展设置面板
    function createUI() {
        // 如果已经存在了，就不重复注入
        if ($('#bl-regex-settings').length > 0) return;

        // 寻找酒馆官方的扩展容器 (#extensions_settings)
        const container = $('#extensions_settings');
        if (container.length === 0) return;

        // 完全采用酒馆原生的抽屉 (inline-drawer) 结构
        const html = `
        <div id="bl-regex-settings" class="bl-regex-container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header interactable">
                    <b><i class="fa-solid fa-ban"></i> 屏蔽词正则生成器</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 15px 10px; display:none;">
                    <div class="bl-input-group">
                        <input type="text" id="bl-new-word" class="bl-input" placeholder="输入屏蔽词 (如: 极度)">
                        <button id="bl-add-word-btn" class="bl-add-btn">添加</button>
                    </div>
                    <div style="font-size:12px; opacity:0.8; margin-bottom:5px;">黑名单 (点击 x 删除)：</div>
                    <div id="bl-words-container"></div>
                    <div style="font-size:12px; margin-bottom:5px;">正则预览：</div>
                    <textarea id="bl-regex-input" class="bl-textarea" readonly></textarea>
                    <button id="bl-copy-regex" class="bl-copy-btn"><i class="fa-solid fa-copy"></i> 复制正则表达式</button>
                </div>
            </div>
        </div>`;

        // 插入到面板顶部
        container.prepend(html);
        renderBlacklist();

        // 绑定抽屉的折叠/展开动画
        $('#bl-regex-settings .inline-drawer-toggle').off('click').on('click', function () {
            $(this).next('.inline-drawer-content').slideToggle(200);
            $(this).find('.inline-drawer-icon').toggleClass('down up');
        });
    }

    // --- 全局事件代理 (免疫一切 DOM 刷新) ---
    $(document).on('click', '#bl-add-word-btn', function() {
        const input = document.getElementById('bl-new-word');
        const word = input.value.trim();
        if (word && !bannedWords.includes(word)) {
            bannedWords.push(word);
            input.value = '';
            renderBlacklist();
        } else if (bannedWords.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已存在！');
        }
    });

    $(document).on('keypress', '#bl-new-word', function(e) {
        if (e.which === 13) $('#bl-add-word-btn').click();
    });

    $(document).on('click', '.bl-word-tag .del-btn', function() {
        const index = $(this).data('index');
        bannedWords.splice(index, 1);
        renderBlacklist();
    });

    $(document).on('click', '#bl-copy-regex', function() {
        const ta = document.getElementById('bl-regex-input');
        if (!ta.value) return;
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('正则复制成功！');
    });

    // --- 初始化引导 ---
    function init() {
        createUI();
        // 绝对防卫：每 2 秒检查一次。就算酒馆把整个扩展面板删了重建，我们的 UI 也会在 2 秒内重新长出来
        setInterval(createUI, 2000);
    }

    // 监听官方核心就绪事件
    $(document).ready(function() {
        if (typeof eventSource !== 'undefined' && event_types && event_types.APP_READY) {
            eventSource.on(event_types.APP_READY, init);
        } else {
            setTimeout(init, 2000);
        }
    });
})();
