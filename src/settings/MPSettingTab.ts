import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import MPPlugin from '../main';
import { WechatAccountConfig } from './settings';

// 公众号账号编辑弹窗
export class AccountEditModal extends Modal {
    private account: Partial<WechatAccountConfig>;
    private onSave: (account: { name: string; author: string; appId: string; appSecret: string }) => void;
    private isEdit: boolean;

    constructor(
        app: App,
        account: Partial<WechatAccountConfig> | null,
        onSave: (account: { name: string; author: string; appId: string; appSecret: string }) => void
    ) {
        super(app);
        this.account = account || {};
        this.onSave = onSave;
        this.isEdit = !!account?.id;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mp-account-edit-modal');

        contentEl.createEl('h2', { text: this.isEdit ? '编辑公众号配置' : '新增公众号配置' });

        let nameValue = this.account.name || '';
        let authorValue = this.account.author || '';
        let appIdValue = this.account.appId || '';
        let appSecretValue = this.account.appSecret || '';

        new Setting(contentEl)
            .setName('公众号名称')
            .setDesc('公众号的名称，方便区分不同账号')
            .addText(text => text
                .setPlaceholder('如：我的技术博客')
                .setValue(nameValue)
                .onChange(v => nameValue = v));

        new Setting(contentEl)
            .setName('作者名称')
            .setDesc('发布文章时显示的作者名称')
            .addText(text => text
                .setPlaceholder('如：霓虹与炊烟')
                .setValue(authorValue)
                .onChange(v => authorValue = v));

        new Setting(contentEl)
            .setName('AppID')
            .setDesc('微信公众号的 AppID')
            .addText(text => text
                .setPlaceholder('输入 AppID')
                .setValue(appIdValue)
                .onChange(v => appIdValue = v));

        new Setting(contentEl)
            .setName('AppSecret')
            .setDesc('微信公众号的 AppSecret')
            .addText(text => text
                .setPlaceholder('输入 AppSecret')
                .setValue(appSecretValue)
                .onChange(v => appSecretValue = v));

        const btnContainer = contentEl.createDiv({ cls: 'mp-account-edit-buttons' });

        const cancelBtn = btnContainer.createEl('button', { text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = btnContainer.createEl('button', { text: '保存', cls: 'mod-cta' });
        saveBtn.addEventListener('click', () => {
            if (!nameValue.trim()) {
                new Notice('请输入公众号名称');
                return;
            }
            if (!appIdValue.trim()) {
                new Notice('请输入 AppID');
                return;
            }
            if (!appSecretValue.trim()) {
                new Notice('请输入 AppSecret');
                return;
            }
            this.onSave({
                name: nameValue.trim(),
                author: authorValue.trim(),
                appId: appIdValue.trim(),
                appSecret: appSecretValue.trim(),
            });
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class MPSettingTab extends PluginSettingTab {
    plugin: MPPlugin;

    constructor(app: App, plugin: MPPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('mp-settings');

        containerEl.createEl('h2', { text: 'MP Publisher 设置' });

        // 主题管理入口
        new Setting(containerEl)
            .setName('主题管理')
            .setDesc('管理内置主题、云端主题和本地自定义 CSS 主题')
            .addButton(btn => btn
                .setButtonText('打开主题管理')
                .setCta()
                .onClick(() => {
                    this.plugin.activateThemeManager();
                }));

        // ---- 微信公众号配置（多账号） ----
        containerEl.createEl('h3', { text: '微信公众号配置' });

        const accounts = this.plugin.settingsManager.getAccounts();
        const defaultId = this.plugin.settingsManager.getSettings().defaultAccountId;

        if (accounts.length === 0) {
            containerEl.createEl('p', {
                text: '暂无公众号配置，请点击下方按钮添加。',
                cls: 'setting-item-description',
            });
        }

        for (const account of accounts) {
            const isDefault = account.id === defaultId;
            const setting = new Setting(containerEl)
                .setName(account.name + (isDefault ? ' (默认)' : ''))
                .setDesc(`AppID: ${account.appId.substring(0, 6)}****`);

            if (!isDefault) {
                setting.addButton(btn => btn
                    .setButtonText('设为默认')
                    .onClick(async () => {
                        await this.plugin.settingsManager.setDefaultAccount(account.id);
                        this.display();
                    }));
            }

            setting.addButton(btn => btn
                .setButtonText('编辑')
                .onClick(() => {
                    const modal = new AccountEditModal(this.app, account, async (updated) => {
                        await this.plugin.settingsManager.updateAccount(account.id, updated);
                        new Notice(`公众号「${updated.name}」已更新`);
                        this.display();
                    });
                    modal.open();
                }));

            setting.addButton(btn => btn
                .setButtonText('删除')
                .setWarning()
                .onClick(async () => {
                    await this.plugin.settingsManager.removeAccount(account.id);
                    new Notice(`公众号「${account.name}」已删除`);
                    this.display();
                }));
        }

        // 新增账号按钮
        new Setting(containerEl)
            .setName('添加公众号')
            .setDesc('添加一个新的微信公众号配置')
            .addButton(btn => btn
                .setButtonText('+ 新增')
                .setCta()
                .onClick(() => {
                    const modal = new AccountEditModal(this.app, null, async (newAccount) => {
                        await this.plugin.settingsManager.addAccount(newAccount);
                        new Notice(`公众号「${newAccount.name}」已添加`);
                        this.display();
                    });
                    modal.open();
                }));

        // ---- 其他设置 ----
        containerEl.createEl('h3', { text: '其他设置' });

        // 图片存储位置设置
        new Setting(containerEl)
            .setName('图片存储位置')
            .setDesc('设置图片保存的文件夹路径。支持使用 ${filename} 代表当前文档的文件名')
            .addText(text => text
                .setPlaceholder('${filename}__assets')
                .setValue(this.plugin.settingsManager.getSettings().imageAttachmentLocation || '')
                .onChange(async (value) => {
                    await this.plugin.settingsManager.updateSettings({
                        imageAttachmentLocation: value,
                    });
                }));

        // 调试模式
        new Setting(containerEl)
            .setName('调试模式')
            .setDesc('启用后将显示详细的调试日志信息')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settingsManager.getSettings().debugMode)
                .onChange(async (value) => {
                    await this.plugin.settingsManager.updateSettings({
                        debugMode: value,
                    });
                    this.plugin.logger.setDebugMode(value);
                }));
    }
}