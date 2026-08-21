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

        const timeWindowMs = 2000; 
        
        const keyH = 50;
        let whiteCount = 0;
        for(let i=0; i<this.keys; i++) {
            if (![1,3,6,8,10].includes((this.startKey + i) % 12)) whiteCount++;
        }
        const kwWhite = w / (whiteCount || 52);
        
        let whiteIdx = 0;
        let keyPositions = [];
        for (let i = 0; i < this.keys; i++) {
            const k = this.startKey + i;
            const isBlack = [1, 3, 6, 8, 10].includes(k % 12);
            if (!isBlack) {
                keyPositions.push({ x: whiteIdx * kwWhite, isBlack, kw: kwWhite, k });
                whiteIdx++;
            } else {
                keyPositions.push({ x: whiteIdx * kwWhite - (kwWhite * 0.35), isBlack, kw: kwWhite * 0.7, k });
            }
        }

        const isDark = document.body.hasAttribute('data-theme');
        this.ctx.fillStyle = isDark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
        for (let i = 0; i < this.song.notes.length; i++) {
            const [start, dur, key, vel, track] = this.song.notes[i];
            
            if (start > this.posMs + timeWindowMs) break; 
            if (start + dur < this.posMs) continue; 
            
            const k = key - this.startKey;
            if (k < 0 || k >= this.keys) continue;

            const y1 = h - ((start - this.posMs) / timeWindowMs) * h;
            const y2 = h - ((start + dur - this.posMs) / timeWindowMs) * h;
            
            const nh = Math.max(2, y1 - y2);
            const pos = keyPositions[k];
            if (pos) {
                this.ctx.fillRect(pos.x, y2 - keyH, pos.kw - 1, nh);
            }
        }

        // Keyboard background
        this.ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#ccc';
        this.ctx.fillRect(0, h - keyH, w, keyH);
        
        for (let pos of keyPositions) {
            if (!pos.isBlack) {
                // Draw white key
                this.ctx.fillStyle = '#fff';
                this.ctx.fillRect(pos.x + 1, h - keyH, pos.kw - 2, keyH - 2);
                
                // Red label for edge keys (Roblox 88)
                if (pos.k < 36 || pos.k > 96) {
                    this.ctx.fillStyle = '#f44336';
                    this.ctx.font = '10px sans-serif';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText("•", pos.x + pos.kw / 2, h - 8);
                }
            }
        }
        
        // Draw black keys on top
        for (let pos of keyPositions) {
            if (pos.isBlack) {
                this.ctx.fillStyle = '#222';
                this.ctx.fillRect(pos.x, h - keyH, pos.kw, keyH * 0.6);
                
                if (pos.k < 36 || pos.k > 96) {
                    this.ctx.fillStyle = '#f44336';
                    this.ctx.font = '10px sans-serif';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText("•", pos.x + pos.kw / 2, h - keyH + (keyH * 0.6) - 6);
                }
            }
        }
    }
}
