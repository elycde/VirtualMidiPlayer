export class Pianoroll {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.song = null;
        this.posMs = 0;
        this.keys = 88;
        this.startKey = 21;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.draw();
    }

    setSong(song) {
        this.song = song;
        if (song.max_key > 0) {
            const range = Math.max(48, song.max_key - song.min_key + 4);
            this.keys = range;
            this.startKey = Math.max(0, song.min_key - 2);
        }
        this.draw();
    }

    updatePosition(ms) {
        this.posMs = ms;
        this.draw();
    }

    draw() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);
        
        if (!this.song) return;

        const kw = w / this.keys;
        const timeWindowMs = 2000; 

        this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
        for (let i = 0; i < this.song.notes.length; i++) {
            const [start, dur, key, vel, track] = this.song.notes[i];
            
            if (start > this.posMs + timeWindowMs) break; 
            if (start + dur < this.posMs) continue; 
            
            const k = key - this.startKey;
            if (k < 0 || k >= this.keys) continue;

            const y1 = h - ((start - this.posMs) / timeWindowMs) * h;
            const y2 = h - ((start + dur - this.posMs) / timeWindowMs) * h;
            
            const nh = Math.max(2, y1 - y2);
            this.ctx.fillRect(k * kw, y2 - 20, kw - 1, nh);
        }

        // Keyboard
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(0, h - 20, w, 20);
        this.ctx.fillStyle = '#000';
        for (let i = 0; i < this.keys; i++) {
            const k = this.startKey + i;
            const isBlack = [1, 3, 6, 8, 10].includes(k % 12);
            if (isBlack) {
                this.ctx.fillRect(i * kw - (kw * 0.25), h - 20, kw * 0.5, 12);
            } else {
                this.ctx.strokeRect(i * kw, h - 20, kw, 20);
            }
        }
    }
}
