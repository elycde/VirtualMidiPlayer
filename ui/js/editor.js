export class Editor {
    constructor() {
        this.modal = document.getElementById('editor');
        this.scrim = document.getElementById('editor-scrim');
        this.closeBtn = document.getElementById('editor-close');
        
        if (this.closeBtn) {
            this.closeBtn.onclick = () => this.hide();
        }
        if (this.scrim) {
            this.scrim.onclick = () => this.hide();
        }
    }

    show() {
        this.modal.hidden = false;
    }

    hide() {
        this.modal.hidden = true;
    }
}
