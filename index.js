/* --- 屏蔽词汇管理 CSS (带开关功能版) --- */

:root {
    --bl-accent-color: var(--SmartThemeQuoteColor, rgba(148, 0, 211, 0.7));
    --bl-accent-color-hover: var(--SmartThemeQuoteColor, rgba(148, 0, 211, 1));
    --bl-danger-color: #ff4757;
    --bl-background-popup: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 1)); 
    --bl-background-secondary: rgba(0, 0, 0, 0.05);
    --bl-border-color: var(--SmartThemeBorderColor, #dee2e6);
    --bl-text-primary: var(--SmartThemeBodyColor, #343a40); 
    --bl-text-secondary: #868e96; 
    --bl-input-bg: var(--SmartThemeInputBackground, #ffffff); 
}

#bl-wand-btn { cursor: pointer !important; }

#bl-purifier-popup {
    position: fixed !important;
    top: 10vh !important; 
    left: 50% !important;
    transform: translateX(-50%) !important; 
    
    width: 90% !important;
    max-width: 420px !important;
    max-height: 80vh !important;
    display: flex !important; 
    flex-direction: column !important;
    
    background: var(--bl-background-popup) !important;
    border: 1px solid var(--bl-border-color) !important;
    border-radius: 12px !important;
    z-index: 999999 !important;
    padding: 20px 25px !important;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
    box-sizing: border-box !important;
    
    backdrop-filter: blur(16px) !important;
    -webkit-backdrop-filter: blur(16px) !important;
    animation: blFadeIn 0.3s ease-out !important;
}

@keyframes blFadeIn {
    from { opacity: 0; transform: translateX(-50%) scale(0.95); }
    to { opacity: 1; transform: translateX(-50%) scale(1); }
}

#bl-purifier-popup .bl-header {
    display: flex !important; justify-content: space-between !important; align-items: center !important;
    padding-bottom: 12px !important; border-bottom: 1px solid var(--bl-border-color) !important; margin: 0 !important;
}
#bl-purifier-popup .bl-title { font-size: 18px !important; font-weight: bold !important; margin: 0 !important; color: var(--bl-text-primary) !important; }
#bl-purifier-popup .bl-close {
    background: none !important; border: none !important; color: var(--bl-text-secondary) !important;
    font-size: 28px !important; line-height: 1 !important; cursor: pointer !important; transition: color 0.2s ease !important;
    padding: 0 !important; margin-left: 10px !important;
}
#bl-purifier-popup .bl-close:hover { color: var(--bl-danger-color) !important; }

/* 通用输入框样式 */
.bl-input, .bl-textarea {
    width: 100% !important;
    padding: 10px 12px !important;
    border-radius: 8px !important;
    border: 1px solid var(--bl-border-color) !important;
    background-color: var(--bl-input-bg) !important;
    color: var(--bl-text-primary) !important;
    font-size: 14px !important;
    box-sizing: border-box !important;
    outline: none !important;
    font-family: inherit !important;
}
.bl-textarea { resize: vertical !important; }
.bl-input:focus, .bl-textarea:focus { border-color: var(--bl-accent-color) !important; }

/* 新增规则按钮 */
.bl-add-rule-btn {
    padding: 10px !important;
    border-radius: 8px !important;
    border: none !important;
    background-color: var(--bl-accent-color) !important;
    color: white !important;
    font-weight: bold !important;
    cursor: pointer !important;
    transition: opacity 0.2s !important;
}
.bl-add-rule-btn:hover { opacity: 0.8 !important; }

/* 深度屏蔽底部按钮 */
#bl-purifier-popup .bl-footer {
    margin-top: auto !important;
    padding-top: 15px !important;
    border-top: 1px solid var(--bl-border-color) !important;
}
.bl-deep-clean-btn {
    width: 100% !important;
    padding: 12px !important;
    background: var(--bl-danger-color) !important;
    color: white !important;
    border: none !important;
    border-radius: 8px !important;
    font-size: 15px !important;
    font-weight: bold !important;
    cursor: pointer !important;
    transition: opacity 0.2s !important;
    display: flex !important; justify-content: center !important; align-items: center !important;
}
.bl-deep-clean-btn:hover { opacity: 0.8 !important; }

/* ================== 工具栏样式 ================== */
.bl-icon-btn {
    padding: 6px 10px !important;
    font-size: 16px !important;
    line-height: 1 !important;
    border-radius: 6px !important;
    background: var(--bl-background-secondary) !important;
    border: 1px solid var(--bl-border-color) !important;
    cursor: pointer !important;
}
#bl-purifier-popup .bl-tools-bar > div:last-child {
    width: 100% !important;
    box-sizing: border-box !important;
}
.bl-tool-btn {
    flex: 1 1 0% !important; 
    padding: 8px 0 !important; 
    border-radius: 6px !important;
    border: 1px solid var(--bl-border-color) !important;
    background: var(--bl-background-secondary) !important;
    color: var(--bl-text-primary) !important;
    cursor: pointer !important;
    font-size: 13px !important; 
    font-weight: 500 !important;
    text-align: center !important;
    transition: background 0.2s, opacity 0.2s !important;
    white-space: nowrap !important; 
}
.bl-tool-btn:hover { background: var(--bl-border-color) !important; opacity: 0.9 !important; }

/* ================== 规则卡片与开关样式 ================== */
#bl-tags-container::-webkit-scrollbar { width: 6px; }
#bl-tags-container::-webkit-scrollbar-thumb { background: var(--bl-border-color); border-radius: 3px; }

.bl-rule-card {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    width: 100% !important;
    padding: 10px 12px !important;
    background: var(--bl-input-bg) !important;
    border: 1px solid var(--bl-border-color) !important;
    border-radius: 8px !important;
    margin-bottom: 8px !important;
    box-sizing: border-box !important;
    transition: all 0.2s !important;
}
.bl-rule-card:hover { border-color: var(--bl-accent-color) !important; }

/* 禁用状态样式 */
.bl-rule-disabled { border-color: transparent !important; opacity: 0.65 !important; background: var(--bl-background-secondary) !important; }
.bl-rule-disabled .bl-rule-name { text-decoration: line-through !important; color: var(--bl-text-secondary) !important; }

/* 开关 Toggle UI */
.bl-toggle-switch {
    position: relative !important;
    display: inline-block !important;
    width: 36px !important;
    height: 20px !important;
    flex-shrink: 0 !important;
    margin-right: 12px !important;
}
.bl-toggle-switch input { opacity: 0 !important; width: 0 !important; height: 0 !important; margin: 0 !important; }
.bl-toggle-slider {
    position: absolute !important; cursor: pointer !important;
    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    background-color: var(--bl-border-color) !important;
    transition: .3s !important; border-radius: 20px !important;
}
.bl-toggle-slider:before {
    position: absolute !important; content: "" !important;
    height: 14px !important; width: 14px !important;
    left: 3px !important; bottom: 3px !important;
    background-color: white !important;
    transition: .3s !important; border-radius: 50% !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3) !important;
}
.bl-toggle-switch input:checked + .bl-toggle-slider { background-color: var(--bl-accent-color) !important; }
.bl-toggle-switch input:checked + .bl-toggle-slider:before { transform: translateX(16px) !important; }

.bl-rule-info { flex: 1 !important; overflow: hidden !important; }
.bl-rule-name { 
    font-weight: bold !important; 
    font-size: 14px !important; 
    color: var(--bl-text-primary) !important; 
    margin-bottom: 4px !important; 
    transition: color 0.2s !important;
}
.bl-rule-preview { 
    font-size: 12px !important; 
    color: var(--bl-text-secondary) !important; 
    white-space: nowrap !important; 
    overflow: hidden !important; 
    text-overflow: ellipsis !important; 
}

.bl-rule-actions { display: flex !important; gap: 6px !important; align-items: center !important; margin-left:10px !important; }
.bl-rule-edit, .bl-rule-del {
    background: var(--bl-background-secondary) !important;
    border: 1px solid var(--bl-border-color) !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    padding: 4px 8px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: all 0.2s !important;
}
.bl-rule-edit { font-size: 12px !important; }
.bl-rule-del { font-size: 16px !important; color: var(--bl-text-secondary) !important; font-weight: bold !important; padding: 2px 8px !important; }

.bl-rule-edit:hover { background: var(--bl-accent-color) !important; border-color: var(--bl-accent-color) !important; }
.bl-rule-del:hover { background: var(--bl-danger-color) !important; border-color: var(--bl-danger-color) !important; color: white !important; }

/* --- 手机端微调 --- */
@media screen and (max-width: 600px) {
    #bl-purifier-popup { padding: 15px 20px !important; width: 92% !important; top: 12vh !important; }
    .bl-tool-btn { font-size: 12px !important; padding: 7px 0 !important; }
    .bl-rule-card { padding: 8px 10px !important; }
    .bl-rule-name { font-size: 13px !important; }
}
