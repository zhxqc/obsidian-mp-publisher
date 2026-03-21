import { CSSTheme, FontOption, DEFAULT_FONTS, RemoteThemeIndex } from '../types/css-theme';
import { nanoid } from '../utils/nanoid';

// 单个公众号账号配置
export interface WechatAccountConfig {
    id: string;
    name: string;       // 公众号名称
    author: string;     // 作者名称
    appId: string;
    appSecret: string;
}

export interface MPSettings {
    // 主题设置
    activeThemeId: string;
    fontFamily: string;
    fontSize: number;
    customFonts: FontOption[];
    downloadedRemoteThemes: CSSTheme[];
    remoteThemeIndexCache?: RemoteThemeIndex[];
    remoteIndexLastUpdate?: number;
    // 微信公众号相关设置（多账号）
    wechatAccounts: WechatAccountConfig[];
    defaultAccountId: string;  // 默认选中的账号 ID
    // 兼容旧版单账号配置
    wechatAppId: string;
    wechatAppSecret: string;
    imageAttachmentLocation: string;
    enableComment: boolean;
    debugMode: boolean;
}

const DEFAULT_SETTINGS: MPSettings = {
    // 主题默认设置
    activeThemeId: 'default',
    fontFamily: DEFAULT_FONTS[0].value,
    fontSize: 16,
    customFonts: [...DEFAULT_FONTS],
    downloadedRemoteThemes: [],
    // 微信公众号默认设置
    wechatAccounts: [],
    defaultAccountId: '',
    wechatAppId: '',
    wechatAppSecret: '',
    imageAttachmentLocation: '${filename}__assets',
    enableComment: true,
    debugMode: false,
};

export class SettingsManager {
    private plugin: any;
    private settings: MPSettings;

    constructor(plugin: any) {
        this.plugin = plugin;
        this.settings = { ...DEFAULT_SETTINGS };
    }

    async loadSettings(): Promise<void> {
        const savedData = (await this.plugin.loadData()) || {};

        // 迁移旧设置：如果有旧的 templateId，映射到 activeThemeId
        if (savedData.templateId && !savedData.activeThemeId) {
            savedData.activeThemeId = savedData.templateId;
        }

        // 确保 customFonts 存在
        if (!savedData.customFonts || savedData.customFonts.length === 0) {
            savedData.customFonts = [...DEFAULT_FONTS];
        }

        // 确保 downloadedRemoteThemes 存在
        if (!savedData.downloadedRemoteThemes) {
            savedData.downloadedRemoteThemes = [];
        }

        // 确保 wechatAccounts 存在
        if (!savedData.wechatAccounts) {
            savedData.wechatAccounts = [];
        }

        this.settings = { ...DEFAULT_SETTINGS, ...savedData };

        // 迁移旧版单账号到多账号配置
        await this.migrateOldAccountConfig();
    }

    /** 将旧版 wechatAppId/wechatAppSecret 迁移到 wechatAccounts 数组 */
    private async migrateOldAccountConfig(): Promise<void> {
        if (
            this.settings.wechatAppId &&
            this.settings.wechatAppSecret &&
            this.settings.wechatAccounts.length === 0
        ) {
            const migratedAccount: WechatAccountConfig = {
                id: nanoid(),
                name: '默认公众号',
                author: '',
                appId: this.settings.wechatAppId,
                appSecret: this.settings.wechatAppSecret,
            };
            this.settings.wechatAccounts = [migratedAccount];
            this.settings.defaultAccountId = migratedAccount.id;
            await this.saveSettings();
        }
    }

    async saveSettings(): Promise<void> {
        await this.plugin.saveData(this.settings);
    }

    getSettings(): MPSettings {
        return this.settings;
    }

    async updateSettings(updates: Partial<MPSettings>): Promise<void> {
        this.settings = { ...this.settings, ...updates };
        await this.saveSettings();
    }

    getFontOptions(): FontOption[] {
        return this.settings.customFonts;
    }

    // ---- 多账号管理 ----

    getAccounts(): WechatAccountConfig[] {
        return this.settings.wechatAccounts;
    }

    getAccountById(id: string): WechatAccountConfig | undefined {
        return this.settings.wechatAccounts.find(a => a.id === id);
    }

    getDefaultAccount(): WechatAccountConfig | undefined {
        if (this.settings.defaultAccountId) {
            return this.getAccountById(this.settings.defaultAccountId);
        }
        return this.settings.wechatAccounts[0];
    }

    async addAccount(account: Omit<WechatAccountConfig, 'id'>): Promise<WechatAccountConfig> {
        const newAccount: WechatAccountConfig = {
            id: nanoid(),
            ...account,
        };
        this.settings.wechatAccounts.push(newAccount);
        if (this.settings.wechatAccounts.length === 1) {
            this.settings.defaultAccountId = newAccount.id;
        }
        await this.saveSettings();
        return newAccount;
    }

    async updateAccount(id: string, updates: Partial<Omit<WechatAccountConfig, 'id'>>): Promise<void> {
        const account = this.settings.wechatAccounts.find(a => a.id === id);
        if (account) {
            Object.assign(account, updates);
            await this.saveSettings();
        }
    }

    async removeAccount(id: string): Promise<void> {
        this.settings.wechatAccounts = this.settings.wechatAccounts.filter(a => a.id !== id);
        if (this.settings.defaultAccountId === id) {
            this.settings.defaultAccountId = this.settings.wechatAccounts[0]?.id || '';
        }
        await this.saveSettings();
    }

    async setDefaultAccount(id: string): Promise<void> {
        if (this.getAccountById(id)) {
            this.settings.defaultAccountId = id;
            await this.saveSettings();
        }
    }
}