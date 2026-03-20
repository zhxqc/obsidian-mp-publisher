import { App, Modal, Notice } from 'obsidian';

const COVER_ASPECT_RATIO = 2.35; // 微信公众号封面图推荐比例

export class ImageCropperModal extends Modal {
    private imageUrl: string;
    private onCropComplete: (croppedData: ArrayBuffer, previewUrl: string) => void;

    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private image: HTMLImageElement;

    // 裁剪框状态（相对于显示画布的坐标）
    private cropX = 0;
    private cropY = 0;
    private cropW = 0;
    private cropH = 0;

    // 图片在画布中的显示区域
    private imgDisplayX = 0;
    private imgDisplayY = 0;
    private imgDisplayW = 0;
    private imgDisplayH = 0;

    // 拖拽状态
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartCropX = 0;
    private dragStartCropY = 0;

    // 缩放拖拽
    private isResizing = false;
    private resizeHandle: string = '';

    constructor(
        app: App,
        imageUrl: string,
        onCropComplete: (croppedData: ArrayBuffer, previewUrl: string) => void,
    ) {
        super(app);
        this.imageUrl = imageUrl;
        this.onCropComplete = onCropComplete;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mp-cropper-modal');

        const modalEl = this.containerEl.querySelector('.modal') as HTMLElement;
        if (modalEl) {
            modalEl.classList.add('mod-cropper');
        }

        contentEl.createEl('h2', { text: '裁剪封面图' });
        contentEl.createEl('p', {
            text: '拖拽裁剪框选择封面区域（比例 2.35:1）',
            cls: 'mp-cropper-hint',
        });

        const canvasContainer = contentEl.createDiv({ cls: 'mp-cropper-canvas-container' });
        this.canvas = canvasContainer.createEl('canvas', { cls: 'mp-cropper-canvas' });
        this.ctx = this.canvas.getContext('2d')!;

        const btnContainer = contentEl.createDiv({ cls: 'mp-cropper-buttons' });
        const cancelBtn = btnContainer.createEl('button', { text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = btnContainer.createEl('button', { text: '确认裁剪', cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => this.doCrop());

        await this.loadImage();
        this.bindEvents();
    }

    private async loadImage(): Promise<void> {
        return new Promise((resolve) => {
            this.image = new Image();
            this.image.onload = () => {
                this.setupCanvas();
                this.initCropBox();
                this.draw();
                resolve();
            };
            this.image.onerror = () => {
                new Notice('加载图片失败');
                this.close();
            };
            this.image.src = this.imageUrl;
        });
    }

    private setupCanvas(): void {
        const maxW = 600;
        const maxH = 450;
        const imgRatio = this.image.width / this.image.height;

        let displayW: number, displayH: number;
        if (imgRatio > maxW / maxH) {
            displayW = maxW;
            displayH = maxW / imgRatio;
        } else {
            displayH = maxH;
            displayW = maxH * imgRatio;
        }

        this.canvas.width = maxW;
        this.canvas.height = maxH;
        this.canvas.style.width = maxW + 'px';
        this.canvas.style.height = maxH + 'px';

        this.imgDisplayX = (maxW - displayW) / 2;
        this.imgDisplayY = (maxH - displayH) / 2;
        this.imgDisplayW = displayW;
        this.imgDisplayH = displayH;
    }

    private initCropBox(): void {
        // 在图片区域内初始化最大的 2.35:1 裁剪框
        const imgRatio = this.imgDisplayW / this.imgDisplayH;

        if (imgRatio > COVER_ASPECT_RATIO) {
            this.cropH = this.imgDisplayH * 0.8;
            this.cropW = this.cropH * COVER_ASPECT_RATIO;
        } else {
            this.cropW = this.imgDisplayW * 0.8;
            this.cropH = this.cropW / COVER_ASPECT_RATIO;
        }

        this.cropX = this.imgDisplayX + (this.imgDisplayW - this.cropW) / 2;
        this.cropY = this.imgDisplayY + (this.imgDisplayH - this.cropH) / 2;
    }

    private draw(): void {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制图片
        ctx.drawImage(
            this.image,
            this.imgDisplayX, this.imgDisplayY,
            this.imgDisplayW, this.imgDisplayH,
        );

        // 半透明遮罩
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 裁剪区域清除遮罩，显示原图
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.cropX, this.cropY, this.cropW, this.cropH);
        ctx.clip();
        ctx.drawImage(
            this.image,
            this.imgDisplayX, this.imgDisplayY,
            this.imgDisplayW, this.imgDisplayH,
        );
        ctx.restore();

        // 裁剪框边框
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.cropX, this.cropY, this.cropW, this.cropH);

        // 三等分线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
            const x = this.cropX + (this.cropW / 3) * i;
            ctx.beginPath();
            ctx.moveTo(x, this.cropY);
            ctx.lineTo(x, this.cropY + this.cropH);
            ctx.stroke();

            const y = this.cropY + (this.cropH / 3) * i;
            ctx.beginPath();
            ctx.moveTo(this.cropX, y);
            ctx.lineTo(this.cropX + this.cropW, y);
            ctx.stroke();
        }

        // 四角拖拽手柄
        const handleSize = 8;
        ctx.fillStyle = '#fff';
        const corners = [
            [this.cropX, this.cropY],
            [this.cropX + this.cropW, this.cropY],
            [this.cropX, this.cropY + this.cropH],
            [this.cropX + this.cropW, this.cropY + this.cropH],
        ];
        for (const [cx, cy] of corners) {
            ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
        }
    }

    private bindEvents(): void {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
    }

    private getCanvasPos(e: MouseEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }

    private getResizeHandle(x: number, y: number): string {
        const threshold = 12;
        const corners: Record<string, [number, number]> = {
            'nw': [this.cropX, this.cropY],
            'ne': [this.cropX + this.cropW, this.cropY],
            'sw': [this.cropX, this.cropY + this.cropH],
            'se': [this.cropX + this.cropW, this.cropY + this.cropH],
        };

        for (const [handle, [cx, cy]] of Object.entries(corners)) {
            if (Math.abs(x - cx) < threshold && Math.abs(y - cy) < threshold) {
                return handle;
            }
        }
        return '';
    }

    private isInsideCropBox(x: number, y: number): boolean {
        return x >= this.cropX && x <= this.cropX + this.cropW &&
               y >= this.cropY && y <= this.cropY + this.cropH;
    }

    private onMouseDown(e: MouseEvent): void {
        const pos = this.getCanvasPos(e);

        const handle = this.getResizeHandle(pos.x, pos.y);
        if (handle) {
            this.isResizing = true;
            this.resizeHandle = handle;
            this.dragStartX = pos.x;
            this.dragStartY = pos.y;
            this.dragStartCropX = this.cropX;
            this.dragStartCropY = this.cropY;
            return;
        }

        if (this.isInsideCropBox(pos.x, pos.y)) {
            this.isDragging = true;
            this.dragStartX = pos.x;
            this.dragStartY = pos.y;
            this.dragStartCropX = this.cropX;
            this.dragStartCropY = this.cropY;
        }
    }

    private onMouseMove(e: MouseEvent): void {
        const pos = this.getCanvasPos(e);

        if (this.isDragging) {
            const dx = pos.x - this.dragStartX;
            const dy = pos.y - this.dragStartY;

            let newX = this.dragStartCropX + dx;
            let newY = this.dragStartCropY + dy;

            // 限制在图片范围内
            newX = Math.max(this.imgDisplayX, Math.min(newX, this.imgDisplayX + this.imgDisplayW - this.cropW));
            newY = Math.max(this.imgDisplayY, Math.min(newY, this.imgDisplayY + this.imgDisplayH - this.cropH));

            this.cropX = newX;
            this.cropY = newY;
            this.draw();
            return;
        }

        if (this.isResizing) {
            const dx = pos.x - this.dragStartX;
            const dy = pos.y - this.dragStartY;
            this.handleResize(dx, dy);
            this.draw();
            return;
        }

        // 更新鼠标样式
        const handle = this.getResizeHandle(pos.x, pos.y);
        if (handle) {
            this.canvas.style.cursor = handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize';
        } else if (this.isInsideCropBox(pos.x, pos.y)) {
            this.canvas.style.cursor = 'move';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    private handleResize(dx: number, dy: number): void {
        const minW = 80;
        const minH = minW / COVER_ASPECT_RATIO;

        let newW = this.cropW;
        let newH = this.cropH;
        let newX = this.dragStartCropX;
        let newY = this.dragStartCropY;

        // 根据拖拽的角来确定缩放方向，保持宽高比
        switch (this.resizeHandle) {
            case 'se':
                newW = this.cropW + dx;
                newH = newW / COVER_ASPECT_RATIO;
                break;
            case 'sw':
                newW = this.cropW - dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX + dx;
                break;
            case 'ne':
                newW = this.cropW + dx;
                newH = newW / COVER_ASPECT_RATIO;
                newY = this.dragStartCropY - (newH - this.cropH);
                break;
            case 'nw':
                newW = this.cropW - dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX + dx;
                newY = this.dragStartCropY - (newH - this.cropH);
                break;
        }

        // 最小尺寸限制
        if (newW < minW || newH < minH) return;

        // 边界限制
        if (newX < this.imgDisplayX) return;
        if (newY < this.imgDisplayY) return;
        if (newX + newW > this.imgDisplayX + this.imgDisplayW) return;
        if (newY + newH > this.imgDisplayY + this.imgDisplayH) return;

        this.cropW = newW;
        this.cropH = newH;
        this.cropX = newX;
        this.cropY = newY;
    }

    private onMouseUp(): void {
        this.isDragging = false;
        this.isResizing = false;
    }

    private doCrop(): void {
        // 将画布上的裁剪区域映射回原图坐标
        const scaleX = this.image.width / this.imgDisplayW;
        const scaleY = this.image.height / this.imgDisplayH;

        const srcX = (this.cropX - this.imgDisplayX) * scaleX;
        const srcY = (this.cropY - this.imgDisplayY) * scaleY;
        const srcW = this.cropW * scaleX;
        const srcH = this.cropH * scaleY;

        // 用 canvas 裁剪
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = Math.round(srcW);
        outputCanvas.height = Math.round(srcH);
        const outputCtx = outputCanvas.getContext('2d')!;

        outputCtx.drawImage(
            this.image,
            Math.round(srcX), Math.round(srcY), Math.round(srcW), Math.round(srcH),
            0, 0, outputCanvas.width, outputCanvas.height,
        );

        // 导出为 blob
        outputCanvas.toBlob((blob) => {
            if (!blob) {
                new Notice('裁剪失败');
                return;
            }

            const previewUrl = outputCanvas.toDataURL('image/jpeg', 0.9);

            blob.arrayBuffer().then((buffer) => {
                this.onCropComplete(buffer, previewUrl);
                this.close();
            });
        }, 'image/jpeg', 0.92);
    }

    onClose() {
        this.contentEl.empty();
    }
}
