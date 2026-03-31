(function () {
    // 1. 数据准备
    let bannedWords = JSON.parse(localStorage.getItem('stx_banned_words')) || ["极度", "极其", "病态"];

    // 2. 将弹窗 UI 注入到页面主体 (只执行一次)
    function setupPopupUI() {
        if ($('#bl-helper-popup').length > 0) return;

        const popupHtml = `
            <div id="bl-helper-popup">
                <div class="bl-popup-header">
                    <div class="bl-popup-title"><i class="fa-solid fa-ban"></i> 屏蔽词生成器</div>
                    <button id="bl-close-btn" class="bl-close-btn">&times;</button>
                </div>
                <div class="bl-input-row">
                    <input type="text" id="bl-new-word" placeholder="输入你想屏蔽的词语...">
                    <button id="bl-add-btn" class="bl-add-btn">添加</button>
                </div>
                <div style="font-size:12px; margin-bottom:5px; opacity:0.8;">当前黑名单：</div>
                <div class="bl-words-list" id="bl-words-container"></div>
                <div style="font-size:12px; margin-bottom:5px; opacity:0.8;">生成的正则：</div>
                <div class="bl-regex-row">
                    <textarea id="bl-regex-output" readonly></textarea>
                </div>
                <button id="bl-copy-btn" class="bl-copy-btn"><i class="fa-solid fa-copy"></i> 复制正则表达式</button>
            </div>
        `;
        $('body').append(popupHtml);

        // 绑定弹窗内的固定事件
        $('#bl-close-btn').on('click', () => $('#bl-helper-popup').hide());
        $('#bl-add-btn').on('click', addWord);
        $('#bl-new-word').on('keypress', function(e) { if (e.which === 13) addWord(); });
        $('#bl-copy-btn').on('click', copyRegex);
        
        // 绑定词汇删除事件 (使用委托，因为词汇是动态生成的)
        $('#bl-words-container').on('click', '.bl-del-btn', function() {
            const index = $(this).data('index');
            bannedWords.splice(index, 1);
            renderWords();
        });

        renderWords(); // 初次渲染内容
    }

    // 3. 核心功能逻辑
    function addWord() {
        const word = $('#bl-new-word').val().trim();
        if (word && !bannedWords.includes(word)) {
            bannedWords.push(word);
            $('#bl-new-word').val('');
            renderWords();
        } else if (bannedWords.includes(word)) {
            if (typeof toastr !== 'undefined') toastr.warning('该词已经在列表里了！');
        }
    }

    function renderWords() {
        localStorage.setItem('stx_banned_words', JSON.stringify(bannedWords));
        const container = $('#bl-words-container');
        
        if (bannedWords.length === 0) {
            container.html('<span style="opacity:0.5; font-size:12px;">没有任何屏蔽词</span>');
            $('#bl-regex-output').val('');
        } else {
            const tags = bannedWords.map((w, i) => `
                <div class="bl-word-tag">
                    ${w} <span class="bl-del-btn" data-index="${i}">&times;</span>
                </div>
            `).join('');
            container.html(tags);
            $('#bl-regex-output').val(`/(${bannedWords.join('|')})/g`);
        }
    }

    function copyRegex() {
        const ta = document.getElementById('bl-regex-output');
        if (!ta.value) return;
        ta.select();
        document.execCommand('copy');
        if (typeof toastr !== 'undefined') toastr.success('复制成功！');
    }

    // 4. 最朴实、最稳妥的菜单注入方式：DOM 监视器 (MutationObserver)
    function startMenuObserver() {
        // 创建一个观察器，死盯着整个网页
        const observer = new MutationObserver(function() {
            // 每次网页有风吹草动，就去找找你截图里的那个扩展菜单列表
            const targetMenu = $('#extensions_settings .list-group').first();
            
            // 如果菜单存在，并且我们的按钮还不在里面
            if (targetMenu.length > 0 && $('#bl-menu-btn').length === 0) {
                // 生成标准的菜单项代码
                const btnHtml = `
                    <div id="bl-menu-btn" class="list-group-item interactable" title="屏蔽词生成器">
                        <i class="fa-solid fa-ban" style="width: 20px; text-align: center; margin-right: 5px;"></i>
                        <span class="drawer-item-text">屏蔽词管理</span>
                    </div>
                `;
                
                // 找到“隐藏助手”，把我们的按钮插在它后面。如果没找到，就插在最上面
                const hideHelper = targetMenu.find('.list-group-item:contains("隐藏助手")');
                if (hideHelper.length > 0) {
                    hideHelper.after(btnHtml);
                } else {
                    targetMenu.prepend(btnHtml);
                }

                // 给新塞进去的按钮绑定点击事件，点开就显示弹窗
                $('#bl-menu-btn').on('click', function(e) {
                    e.stopPropagation();
                    $('#bl-helper-popup').show();
                });
            }
        });

        // 启动观察器，监控整个 body 的子节点变化
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // 5. 扩展启动点
    jQuery(document).ready(function() {
        setupPopupUI();
        startMenuObserver();
    });
})();
