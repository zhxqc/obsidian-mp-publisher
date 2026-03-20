import { App, MarkdownView, Modal, Notice, Setting } from 'obsidian';
import MPPlugin from '../main';
import { markdownToHtml } from '../converter';
import { AccountEditModal } from '../settings/MPSettingTab';
import { ImageCropperModal } from './ImageCropperModal';

// 发布模态框
export class PublishModal extends Modal {
	plugin: MPPlugin;
	markdownView: MarkdownView;
	titleInput: HTMLInputElement;
	platformSelect: HTMLSelectElement;
	accountSelect: HTMLSelectElement;
	coverImagePreview: HTMLElement;
	selectedCoverMediaId: string = '';
	selectedAccountId: string = '';

	constructor(app: App, plugin: MPPlugin, markdownView: MarkdownView) {
		super(app);
		this.plugin = plugin;
		this.markdownView = markdownView;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const modalEl = (this.containerEl.querySelector('.modal') as HTMLElement);
		if (modalEl) {
			modalEl.classList.add('mod-publish');
		}

		contentEl.createEl('h2', { text: '发布到内容平台' });

		// 标题输入
		const titleSetting = new Setting(contentEl)
			.setName('标题')
			.setDesc('文章标题');

		this.titleInput = document.createElement('input');
		this.titleInput.type = 'text';
		this.titleInput.value = this.markdownView.file?.basename || '';
		this.titleInput.className = 'full-width-input';

		titleSetting.controlEl.appendChild(this.titleInput);

		// 平台选择
		const platformSetting = new Setting(contentEl)
			.setName('平台')
			.setDesc('选择发布平台');

		this.platformSelect = document.createElement('select');
		this.platformSelect.className = 'enhanced-publisher-platform-selector';

		const wechatOption = document.createElement('option');
		wechatOption.value = 'wechat';
		wechatOption.text = '微信公众号';
		this.platformSelect.appendChild(wechatOption);

		platformSetting.controlEl.appendChild(this.platformSelect);

		// ---- 公众号账号选择 ----
		const accountSetting = new Setting(contentEl)
			.setName('公众号')
			.setDesc('选择要发布到的公众号');

		const accountControlContainer = document.createElement('div');
		accountControlContainer.style.display = 'flex';
		accountControlContainer.style.alignItems = 'center';
		accountControlContainer.style.gap = '8px';

		this.accountSelect = document.createElement('select');
		this.accountSelect.className = 'enhanced-publisher-platform-selector';
		this.refreshAccountOptions();

		this.accountSelect.addEventListener('change', () => {
			this.selectedAccountId = this.accountSelect.value;
		});

		accountControlContainer.appendChild(this.accountSelect);

		// 快捷新增账号按钮
		const addAccountBtn = document.createElement('button');
		addAccountBtn.textContent = '+ 新增';
		addAccountBtn.className = 'mod-cta';
		addAccountBtn.style.whiteSpace = 'nowrap';
		addAccountBtn.addEventListener('click', () => {
			const modal = new AccountEditModal(this.app, null, async (newAccount) => {
				await this.plugin.settingsManager.addAccount(newAccount);
				new Notice(`公众号「${newAccount.name}」已添加`);
				this.refreshAccountOptions();
			});
			modal.open();
		});
		accountControlContainer.appendChild(addAccountBtn);

		accountSetting.controlEl.appendChild(accountControlContainer);

		// 添加草稿复选框
		const draftSetting = new Setting(contentEl)
			.setName('草稿')
			.setDesc('当前仅支持保存到草稿箱，后续将支持直接发布');

		const draftCheckbox = document.createElement('input');
		draftCheckbox.type = 'checkbox';
		draftCheckbox.checked = true;
		draftCheckbox.disabled = true;
		draftSetting.controlEl.appendChild(draftCheckbox);

		// 封面图选择
		const coverImageSetting = new Setting(contentEl)
			.setName('封面图')
			.setDesc('选择文章封面图');

		const coverImageContainer = document.createElement('div');
		coverImageContainer.className = 'cover-container';

		this.coverImagePreview = document.createElement('div');
		this.coverImagePreview.className = 'cover-preview';
		this.coverImagePreview.textContent = '无封面图';

		const selectCoverButton = document.createElement('button');
		selectCoverButton.className = 'mod-cta';
		selectCoverButton.textContent = '选择封面图';

		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = 'image/*';
		fileInput.style.display = 'none';
		coverImageContainer.appendChild(fileInput);

		selectCoverButton.addEventListener('click', () => {
			fileInput.click();
		});

		fileInput.addEventListener('change', () => {
			const file = fileInput.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = (e) => {
				const dataUrl = e.target?.result as string;
				if (!dataUrl) return;

				const cropperModal = new ImageCropperModal(
					this.app,
					dataUrl,
					async (croppedData: ArrayBuffer, croppedPreviewUrl: string) => {
						await this.handleCroppedCover(croppedData, croppedPreviewUrl, file.name);
					},
				);
				cropperModal.open();
			};
			reader.readAsDataURL(file);
			fileInput.value = '';
		});

		coverImageContainer.appendChild(this.coverImagePreview);
		coverImageContainer.appendChild(selectCoverButton);

		coverImageSetting.controlEl.appendChild(coverImageContainer);

		// 发布按钮
		const publishButtonContainer = contentEl.createDiv({
			cls: 'publish-button-container'
		});

		const publishButton = publishButtonContainer.createEl('button', {
			text: '发布',
			cls: 'mod-cta'
		});

		publishButton.addEventListener('click', async () => {
			const title = this.titleInput.value;
			const platform = this.platformSelect.value;

			if (!title) {
				new Notice('请输入标题');
				return;
			}

			if (platform === 'wechat' && !this.coverImagePreview.querySelector('img')) {
				new Notice('请选择封面图');
				return;
			}

			if (!this.markdownView.file) {
				new Notice('无法获取当前文件');
				return;
			}

			// 检查文章是否已发布，如已发布则二次确认
			const isPublished = await this.checkPublishedStatus();
			if (isPublished) {
				const confirmed = await this.showRepublishConfirm();
				if (!confirmed) return;
			}

			const content = this.markdownView.getViewData();
			const htmlContent = await markdownToHtml(
				this.app,
				content,
				this.markdownView.file?.path || '',
				this.plugin.themeManager,
			);

			if (platform === 'wechat') {
				// 获取选中的账号配置
				const accountId = this.selectedAccountId;
				const account = this.plugin.settingsManager.getAccountById(accountId);

				if (!account) {
					new Notice('请先选择或添加一个公众号配置');
					return;
				}

				if (!account.appId || !account.appSecret) {
					new Notice(`公众号「${account.name}」的 AppID 或 AppSecret 未配置`);
					return;
				}

				if (!this.selectedCoverMediaId) {
					new Notice('请先选择封面图');
					return;
				}

				try {
					publishButton.disabled = true;
					publishButton.textContent = '发布中...';

					const success = await this.plugin.publishToWechat(
						title,
						htmlContent,
						this.selectedCoverMediaId,
						this.markdownView.file,
						account
					);

					if (success) {
						this.close();
					} else {
						publishButton.disabled = false;
						publishButton.textContent = '发布';
					}
				} catch (error: any) {
					console.error('发布失败:', error);
					new Notice('发布失败：' + (error.message || '未知错误'));
					publishButton.disabled = false;
					publishButton.textContent = '发布';
				}
			}
		});
	}

	/** 检查当前文章是否已发布（通过 frontmatter 中的 published 字段） */
	private async checkPublishedStatus(): Promise<boolean> {
		const file = this.markdownView.file;
		if (!file) return false;

		const content = await this.app.vault.read(file);
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) return false;

		return /^published\s*:\s*true/m.test(match[1]);
	}

	/** 显示重复发布确认弹窗 */
	private showRepublishConfirm(): Promise<boolean> {
		return new Promise((resolve) => {
			let resolved = false;
			const modal = new ConfirmModal(this.app, () => {
				if (!resolved) { resolved = true; resolve(true); }
			}, () => {
				if (!resolved) { resolved = true; resolve(false); }
			});
			modal.open();
		});
	}

	/** 裁剪封面图后：直接上传微信 + 更新预览 */
	private async handleCroppedCover(croppedData: ArrayBuffer, croppedPreviewUrl: string, sourceFileName: string) {
		try {
			// 上传到微信（使用当前选中的账号）
			const account = this.plugin.settingsManager.getAccountById(this.selectedAccountId);
			const mediaId = await this.plugin.wechatPublisher.uploadImageToWechat(
				croppedData,
				'cover.jpg',
				account,
			);

			if (!mediaId) {
				new Notice('封面图上传失败，请重试');
				return;
			}

			// 更新 UI
			this.selectedCoverMediaId = mediaId;
			this.coverImagePreview.empty();
			const img = document.createElement('img') as HTMLImageElement;
			img.className = 'preview-image';
			img.src = croppedPreviewUrl;
			this.coverImagePreview.appendChild(img);

			new Notice('封面图上传成功');
		} catch (error: any) {
			console.error('处理封面图失败:', error);
			new Notice('处理封面图失败：' + (error.message || '未知错误'));
		}
	}

	/** 刷新公众号下拉列表 */
	private refreshAccountOptions() {
		this.accountSelect.empty();

		const accounts = this.plugin.settingsManager.getAccounts();
		const defaultId = this.plugin.settingsManager.getSettings().defaultAccountId;

		if (accounts.length === 0) {
			const emptyOpt = document.createElement('option');
			emptyOpt.value = '';
			emptyOpt.text = '-- 请先添加公众号配置 --';
			this.accountSelect.appendChild(emptyOpt);
			this.selectedAccountId = '';
			return;
		}

		for (const account of accounts) {
			const opt = document.createElement('option');
			opt.value = account.id;
			opt.text = account.name + (account.id === defaultId ? ' (默认)' : '');
			this.accountSelect.appendChild(opt);
		}

		// 默认选中
		const targetId = defaultId && accounts.find(a => a.id === defaultId)
			? defaultId
			: accounts[0].id;
		this.accountSelect.value = targetId;
		this.selectedAccountId = targetId;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	private onConfirm: () => void;
	private onCancel: () => void;
	private confirmed = false;

	constructor(app: App, onConfirm: () => void, onCancel: () => void) {
		super(app);
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		this.titleEl.setText('重复发布确认');
		this.contentEl.createEl('p', {
			text: '该文章已经发布过，确定要重新发布吗？重新发布将在草稿箱中创建新的草稿。',
		});

		const btnContainer = this.contentEl.createDiv({ cls: 'modal-button-container' });
		btnContainer.createEl('button', { text: '取消' }).addEventListener('click', () => {
			this.close();
		});
		btnContainer.createEl('button', { text: '确认发布', cls: 'mod-warning' }).addEventListener('click', () => {
			this.confirmed = true;
			this.close();
		});
	}

	onClose() {
		if (this.confirmed) {
			this.onConfirm();
		} else {
			this.onCancel();
		}
		this.contentEl.empty();
	}
}