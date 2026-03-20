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
    private dragStartCropW = 0;
    private dragStartCropH = 0;

    // 渲染节流
    private rafId: number | null = null;
    private needsRedraw = false;

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
        const maxW = 900;
        const maxH = 640;
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

    private scheduleRedraw(): void {
        if (!this.needsRedraw) {
            this.needsRedraw = true;
            this.rafId = requestAnimationFrame(() => {
                this.needsRedraw = false;
                this.draw();
            });
        }
    }

    private draw(): void {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // 绘制图片
        ctx.drawImage(
            this.image,
            this.imgDisplayX, this.imgDisplayY,
            this.imgDisplayW, this.imgDisplayH,
        );

        // 半透明遮罩（用 4 个矩形避免重叠裁剪区域）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        // 上
        ctx.fillRect(0, 0, w, this.cropY);
        // 下
        ctx.fillRect(0, this.cropY + this.cropH, w, h - this.cropY - this.cropH);
        // 左
        ctx.fillRect(0, this.cropY, this.cropX, this.cropH);
        // 右
        ctx.fillRect(this.cropX + this.cropW, this.cropY, w - this.cropX - this.cropW, this.cropH);

        // 裁剪框边框
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.cropX, this.cropY, this.cropW, this.cropH);

        // 三等分线
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
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

        // 角落 L 形手柄
        this.drawCornerHandles(ctx);
    }

    private drawCornerHandles(ctx: CanvasRenderingContext2D): void {
        const len = 20;
        const thickness = 3;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = thickness;
        ctx.lineCap = 'square';

        const corners: [number, number, number, number][] = [
            // [x, y, xDir, yDir]
            [this.cropX, this.cropY, 1, 1],           // nw
            [this.cropX + this.cropW, this.cropY, -1, 1],  // ne
            [this.cropX, this.cropY + this.cropH, 1, -1],  // sw
            [this.cropX + this.cropW, this.cropY + this.cropH, -1, -1], // se
        ];

        for (const [x, y, dx, dy] of corners) {
            ctx.beginPath();
            ctx.moveTo(x, y + dy * len);
            ctx.lineTo(x, y);
            ctx.lineTo(x + dx * len, y);
            ctx.stroke();
        }
    }

    private bindEvents(): void {
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);

        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('mouseleave', this.onMouseUp);

        // 触屏支持
        this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));
    }

    private getCanvasPos(e: MouseEvent | Touch): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    }

    private getResizeHandle(x: number, y: number): string {
        const threshold = 16;
        const handles: Record<string, [number, number]> = {
            'nw': [this.cropX, this.cropY],
            'ne': [this.cropX + this.cropW, this.cropY],
            'sw': [this.cropX, this.cropY + this.cropH],
            'se': [this.cropX + this.cropW, this.cropY + this.cropH],
        };

        for (const [handle, [cx, cy]] of Object.entries(handles)) {
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
        e.preventDefault();
        const pos = this.getCanvasPos(e);
        this.startInteraction(pos.x, pos.y);
    }

    private onTouchStart(e: TouchEvent): void {
        e.preventDefault();
        if (e.touches.length === 1) {
            const pos = this.getCanvasPos(e.touches[0]);
            this.startInteraction(pos.x, pos.y);
        }
    }

    private startInteraction(x: number, y: number): void {
        const handle = this.getResizeHandle(x, y);
        if (handle) {
            this.isResizing = true;
            this.resizeHandle = handle;
            this.dragStartX = x;
            this.dragStartY = y;
            this.dragStartCropX = this.cropX;
            this.dragStartCropY = this.cropY;
            this.dragStartCropW = this.cropW;
            this.dragStartCropH = this.cropH;
            return;
        }

        if (this.isInsideCropBox(x, y)) {
            this.isDragging = true;
            this.dragStartX = x;
            this.dragStartY = y;
            this.dragStartCropX = this.cropX;
            this.dragStartCropY = this.cropY;
        }
    }

    private onMouseMove(e: MouseEvent): void {
        const pos = this.getCanvasPos(e);
        this.moveInteraction(pos.x, pos.y);

        // 更新鼠标样式（不在拖拽中时）
        if (!this.isDragging && !this.isResizing) {
            const handle = this.getResizeHandle(pos.x, pos.y);
            if (handle) {
                this.canvas.style.cursor = handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize';
            } else if (this.isInsideCropBox(pos.x, pos.y)) {
                this.canvas.style.cursor = 'move';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }
    }

    private onTouchMove(e: TouchEvent): void {
        e.preventDefault();
        if (e.touches.length === 1) {
            const pos = this.getCanvasPos(e.touches[0]);
            this.moveInteraction(pos.x, pos.y);
        }
    }

    private moveInteraction(x: number, y: number): void {
        if (this.isDragging) {
            const dx = x - this.dragStartX;
            const dy = y - this.dragStartY;

            this.cropX = Math.max(
                this.imgDisplayX,
                Math.min(this.dragStartCropX + dx, this.imgDisplayX + this.imgDisplayW - this.cropW),
            );
            this.cropY = Math.max(
                this.imgDisplayY,
                Math.min(this.dragStartCropY + dy, this.imgDisplayY + this.imgDisplayH - this.cropH),
            );
            this.scheduleRedraw();
            return;
        }

        if (this.isResizing) {
            const dx = x - this.dragStartX;
            this.handleResize(dx);
            this.scheduleRedraw();
        }
    }

    private handleResize(dx: number): void {
        const minW = 100;
        const minH = minW / COVER_ASPECT_RATIO;

        let newW: number, newH: number, newX: number, newY: number;

        switch (this.resizeHandle) {
            case 'se':
                newW = this.dragStartCropW + dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX;
                newY = this.dragStartCropY;
                break;
            case 'sw':
                newW = this.dragStartCropW - dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX + dx;
                newY = this.dragStartCropY;
                break;
            case 'ne':
                newW = this.dragStartCropW + dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX;
                newY = this.dragStartCropY + this.dragStartCropH - newH;
                break;
            case 'nw':
                newW = this.dragStartCropW - dx;
                newH = newW / COVER_ASPECT_RATIO;
                newX = this.dragStartCropX + dx;
                newY = this.dragStartCropY + this.dragStartCropH - newH;
                break;
            default:
                return;
        }

        if (newW < minW || newH < minH) return;
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

    private onTouchEnd(): void {
        this.isDragging = false;
        this.isResizing = false;
    }

    private doCrop(): void {
        const scaleX = this.image.width / this.imgDisplayW;
        const scaleY = this.image.height / this.imgDisplayH;

        const srcX = (this.cropX - this.imgDisplayX) * scaleX;
        const srcY = (this.cropY - this.imgDisplayY) * scaleY;
        const srcW = this.cropW * scaleX;
        const srcH = this.cropH * scaleY;

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = Math.round(srcW);
        outputCanvas.height = Math.round(srcH);
        const outputCtx = outputCanvas.getContext('2d')!;

        outputCtx.drawImage(
            this.image,
            Math.round(srcX), Math.round(srcY), Math.round(srcW), Math.round(srcH),
            0, 0, outputCanvas.width, outputCanvas.height,
        );

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
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
        }
        this.contentEl.empty();
    }
}
