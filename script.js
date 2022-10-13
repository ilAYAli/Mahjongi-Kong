"use strict";

// ---[ state ]-----------------------------------------------------------------
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

const spriteParam = urlParams.get('spriteIdx')
const spriteIdx = spriteParam ? Number(spriteParam) : 0;

const canvas = document.getElementById('board_canvas');
const ctx = canvas.getContext('2d');

let level = 0;
const DEFAULT_TIMEOUT = 60 * 5;

const TILE = {
    unused:     "unused",
    active:     "active",
    selected:   "selected",
    dead:       "dead",
}

const SOLVED = {
    all: Symbol("all"),
    one: Symbol("one"),
    none: Symbol("none"),
}


// ---[ triggers ]--------------------------------------------------------------
window.onload = () => {
    loadHighscore();
    let tmp = document.getElementById("canvas");
    if (tmp) {
        ;//tmp.width = window.innerWidth;
    }
    board.init();
}


var scheduledRedraw;
window.addEventListener('resize', () => {
    clearTimeout(scheduledRedraw);
    scheduledRedraw = setTimeout(() => {
        ctx.canvas.width  = 1024;
        ctx.canvas.height = 768;
        board.draw(ctx);
    }, 100);
});


canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect()
    const xpos = e.clientX - rect.left
    const ypos = e.clientY - rect.top
    board.mouseClick(board, xpos, ypos, true);
});


//---[ classes ]-----------------------------------------------------------------

class SpriteSheet {
    constructor(width, height, cols, rows, dark, light) {
        this.tile_width = width;
        this.tile_height = height;
        this.cols = cols;
        this.rows = rows;
        this.dark_image = new Image();
        this.light_image = new Image();
        this.dark_image.src = dark;
        this.light_image.src = light;

        this.empty_tile = 0;
        this.unused_tiles = [];
    }

    idxToCoord(idx) {
        console.assert(idx < (this.cols * this.rows), this.idxToCoord.name, ": index too large:", idx);
        let tile_y = Math.floor(idx / this.rows)
        let tile_x = Math.floor(idx % this.rows)
        return [tile_x, tile_y]
    }

    getRandomTile () {
        while (true) {
            let idx = Math.floor(Math.random() * this.cols * this.rows);
            let [sprite_x, sprite_y] = this.idxToCoord(idx)

            let usable = true;
            for (let i = 0; i < this.unused_tiles.length; ++i) {
                if (idx == this.unused_tiles[i]) {
                    usable = false;
                    break;
                }
            }

            if (!usable)
                continue;

            return idx;
        }
    }
}


class GameBoard {
    constructor(cols, rows, sheet) {
        this.cols = cols;
        this.rows = rows;
        this.sheet = sheet;
        this.active_rows = rows - 2;
        this.active_cols = cols - 2;
        this.active_size = this.active_rows * this.active_cols;

        this.src_tile = 0;
        this.dst_tile = 0;

        this.tiles = [];
        this.arrows = [];

        this.shuffled = [];

        this.score = 0;
        this.margin = 0;

        this.draw_arrows = true;
        this.demo_mode = false;
    }

// private:
    #drawLine(ctx, x1, y1, x2, y2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    #drawArrowHead(ctx, x1, y1, x2, y2, filled) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5 * dy, y1 - 0.5 * dx);
        ctx.lineTo(x1 - 0.5 * dy, y1 + 0.5 * dx);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        filled ? ctx.fill() : ctx.stroke();
    }

    #drawArrowPath(ctx) {
        if (!this.draw_arrows) {
            this.arrows.splice(0, this.arrows.length)
            return;
        }

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'red';

        this.arrows.forEach((arrow, index, array) => {
            let [x1, y1] = board.coordToPos(arrow[0], arrow[1]);
            let [x2, y2] = board.coordToPos(arrow[2], arrow[3])
            x1 += (this.sheet.tile_width/2); x2 += (this.sheet.tile_width/2);
            y1 += (this.sheet.tile_height/2); y2 += (this.sheet.tile_height/2);
            if (index != array.length -1) {
                this.#drawLine(ctx, x1, y1, x2, y2);
            } else {
                const headlen = 5;
                const theta = Math.atan2(y2 - y1, x2 - x1);
                this.#drawLine(ctx, x1, y1, x2, y2);
                this.#drawArrowHead(ctx, x2 - headlen * Math.cos(theta), y2 - headlen * Math.sin(theta), x2, y2);
            }
        });
        this.arrows.splice(0, this.arrows.length)
    }

    #drawOutline(ctx) {
        let active_width = (board.rows - 2) * this.sheet.tile_width;
        let active_height = (board.cols - 2) * this.sheet.tile_height;

        ctx.beginPath();

        let top_left_x = this.sheet.tile_width;
        let top_left_y = this.sheet.tile_height;

        let top_right_x = top_left_x + active_width;
        let top_right_y = top_left_y;

        let bottom_left_x = top_left_x;
        let bottom_left_y = top_right_y + active_height;

        let bottom_right_x = top_right_x;
        let bottom_right_y = bottom_left_y;

        ctx.moveTo(top_left_x, top_left_y);
        ctx.lineTo(top_right_x, top_right_y);

        ctx.lineTo(bottom_right_x, bottom_right_y);

        ctx.lineTo(bottom_left_x, bottom_left_y);
        ctx.lineTo(top_left_x, top_left_y);

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#aaaaaa';
        ctx.stroke();
    }

    #populateInvisibleBorder() {
        let board_size = this.cols * this.rows;

        let border_state = TILE.dead;
        let border_tile = this.sheet.empty_tile;

        // top:
        for (let i = 0; i < this.rows; i++) {
            this.tiles[i] = [border_tile, border_state];
        }

        // bottom:
        for (let i = 0; i < this.rows; i++) {
            this.tiles[board_size - i - 1] = [border_tile, border_state];
        }

        // left:
        for (let i = 0; i < this.cols; i++) {
            this.tiles[i * this.rows] = [border_tile, border_state];
        }
        // right:
        for (let i = 0; i < this.cols; i++) {
            this.tiles[i * this.rows + (this.rows -1)] = [border_tile, border_state];
        }
    }

    #posToBoardCoord(x, y) {
        let tile_x = Math.floor(x / this.sheet.tile_width);
        let tile_y = Math.floor(y / this.sheet.tile_height);
        return [tile_x, tile_y]
    }


    #allValidRowsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = 0; i < x; i++) {
            let dx = x - (i + 1);
            let valid = this.#isValidHmode(x, y, dx);
            if (!valid)
                break;
            valid_moves.push(dx);
        }

        for (let i = 1; (x + i) < this.rows; i++) {
            let dx = x + i
            let valid = this.#isValidHmode(x, y, dx);
            if (!valid)
                break;
            valid_moves.push(dx);
        }

        return valid_moves;
    }


    #allValidColsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = 0; i < y; i++) {
            let dy = y - (i + 1);
            let valid = this.#isValidVmove(x, y, dy);
            if (!valid)
                break;
            valid_moves.push(dy);
        }

        for (let i = 1; (y + i) < this.cols; i++) {
            let dy = y + i
            let valid = this.#isValidVmove(x, y, dy);
            if (!valid)
                break;
            valid_moves.push(dy);
        }

        return valid_moves;
    }


    #isValidHmode(x, y, dx) {
        let valid = true;
        let src_idx = this.#coordToIdx(x, y);
        let [src_tile, src_state] = this.tiles[src_idx];

        let dist = Math.abs(dx - x);
        let mod = x < dx ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let tx = x + (i * mod);
            let board_idx = this.#coordToIdx(tx, y);
            let [tile_idx, state] = this.tiles[board_idx];
            if (state == TILE.active) {
                valid = false;
                break;
            }
        }
        return valid;
    }


    #isValidVmove(x, y, dy) {
        let valid = true;
        let src_idx = this.#coordToIdx(x, y);
        let [src_tile, src_state] = this.tiles[src_idx];

        let dist = Math.abs(dy - y);
        let mod = y < dy ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let ty = y + (i * mod);
            if (ty >= this.cols) {
                valid = false;
                break;
            }
            let board_idx = this.#coordToIdx(x, ty);
            let [tile_idx, state] = this.tiles[board_idx];
            if (state == TILE.active) {
                valid = false;
                break;
            }
        }

        return valid;
    }


    #isReachable(r, c, tr, tc) {
        if ((c == tc) && (this.#isValidHmode(r, c, tr))) {
            return true;
        }
        if ((r == tr) && (this.#isValidVmove(r, c, tc))) {
            return true;
        }
        return false;
    }


    #coordToIdx(r, c) {
        console.assert(r < this.rows, this.#coordToIdx.name, ": x pos is too large");
        console.assert(c < this.cols, this.#coordToIdx.name, ": y pos is too large");
        let idx = (c * this.rows) + r;
        return idx;
    }

    #getNumActiveTiles () {
        let board_size = this.cols * this.rows;
        let active = 0;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.active)
                active++;
        }
        return active;
    }

    #getRandomActiveTile () {
        let board_size = this.cols * this.rows;
        while (true) {
            let idx = Math.floor(Math.random() * board_size);
            if (this.tiles[idx][1] == TILE.active) {
                return idx;
            }
        }
    }

// public:
    unselectAll () {
        let board_size = this.cols * this.rows;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.selected) {
                this.tiles[i][1] = TILE.active;
            }
        }
    }

    removeSelectedTilePair () {
        let board_size = this.cols * this.rows;
        let t1 = -1;
        let t2 = -1;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.selected) {
                if (t1 == -1)
                    t1 = i;
                else
                    t2 = i;
            }
            if (t1 != -1 && t2 != -1) {
                //console.assert(this.tiles[t1][0] != this.tiles[t2][0]);
                //console.log("selected pair:", t1, t2);
                if (this.tiles[t1][0] != this.tiles[t2][0]) {
                    console.log("error, selected is not a pair:", this.tiles[t1][0], this.tiles[t2][0]);
                }
                this.tiles[t1][1] = TILE.dead;
                this.tiles[t2][1] = TILE.dead;
            }
        }
        this.draw(ctx);
    }

    idxToCoord(idx) {
        console.assert(idx < (board.rows * board.cols), this.idxToCoord.name, ": index too large:", idx);
        let r = Math.floor(idx % board.rows);
        let c = Math.floor(idx / board.rows);
        return [r, c]
    }

    getUnusedTile() {
        let board_size = this.cols * this.rows;
        while (true) {
            let idx = Math.floor(Math.random() * board_size);
            if (this.tiles[idx][1] == TILE.unused) {
                return idx;
            }
        }
    }


    draw(ctx) {
        ctx.clearRect(0, 30, ctx.canvas.width, ctx.canvas.height);
        this.#drawOutline(ctx);

        for (let i = 0; i < this.tiles.length; i++) {
            let [board_x, board_y] = this.idxToCoord(i);
            const border = ((board_y == 0 || (board_y == this.cols -1)) ||
                            (board_x == 0 || (board_x == this.rows -1)));
            if (border)
                continue;

            let [ss_idx, state] = this.tiles[i]
            if (state == TILE.dead)
                continue;

            let [tile_x, tile_y] = this.sheet.idxToCoord(ss_idx);

            const sx = tile_x * this.sheet.tile_width;
            const sy = tile_y * this.sheet.tile_height;
            const dx = board_x * 64;//this.sheet.tile_width;
            const dy = board_y * 64;//this.sheet.tile_height;

            const scaled_width = 64;//this.sheet.tile_width;
            const scaled_height = 64;//this.sheet.tile_height;

            let ss = this.sheet.dark_image;
            if (state == TILE.selected) {
                if (!spriteIdx) {
                    ss = this.sheet.light_image;
                } else {
                    ctx.filter = 'invert(1)';
                }
            }

            ctx.drawImage(
                ss,
                sx, sy,
                this.sheet.tile_width,
                this.sheet.tile_height,
                dx, dy,
                scaled_width, scaled_height);

            if (state == TILE.selected) {
                if (spriteIdx)
                    ctx.filter = 'none';
            }
        }

        this.#drawArrowPath(ctx);
    }

    posToBoardIdx(x, y) {
        let tile_x = Math.floor(x / this.sheet.tile_width);
        let tile_y = Math.floor(y / this.sheet.tile_height);
        let idx = (tile_y * board.rows) + tile_x;
        return idx;
    }

    coordToPos(r, c) {
        let x = (board.sheet.tile_width * r);
        let y = (board.sheet.tile_height * c);
        return [x, y];
    }

    hasValidPath(p1, p2) {
        let [p1x, p1y] = this.idxToCoord(p1);
        let [p2x, p2y] = this.idxToCoord(p2);

        if (this.#isReachable(p1x, p1y, p2x, p2y)) {
            // point 1:
            this.arrows.push([ p1x, p1y, p2x, p2y ]);
            return true;
        }

        // check horizontal -> vertical:
        if (true) {
            this.arrows.length = 0;
            let valid_rows = this.#allValidRowsFromPoint(p1x, p1y);
            for (let r = 0; r < valid_rows.length; r++) {
                if (this.#isReachable(valid_rows[r], p1y, p2x, p2y)) {
                    // point 2:
                    this.arrows.push([ p1x, p1y, valid_rows[r], p1y ]);
                    this.arrows.push([ valid_rows[r], p1y, p2x, p2y ]);
                    return true;
                }

                let valid_cols = this.#allValidColsFromPoint(valid_rows[r], p1y)
                for (let c = 0; c < valid_cols.length; c++) {
                    if (this.#isReachable(valid_rows[r], valid_cols[c], p2x, p2y)) {
                        // point 3:
                        this.arrows.push([ p1x, p1y, valid_rows[r], p1y ]);
                        this.arrows.push([ valid_rows[r], p1y, valid_rows[r], valid_cols[c] ]);
                        this.arrows.push([ valid_rows[r], valid_cols[c], p2x, p2y ]);
                        return true;
                    }
                }
            }
        }

        // vertical -> horizontal:
        if (true) {
            this.arrows.length = 0;
            let valid_cols = this.#allValidColsFromPoint(p1x, p1y);
            for (let c = 0; c < valid_cols.length; c++) {
                if (this.#isReachable(p1x, valid_cols[c], p2x, p2y)) {
                    // point 2:
                    this.arrows.push([ p1x, p1y, p1x, valid_cols[c] ]);
                    this.arrows.push([ p1x, valid_cols[c], p2x, p2y ]);
                    return true;
                }

                let valid_rows = this.#allValidRowsFromPoint(p1x, valid_cols[c])
                for (let r = 0; r < valid_rows.length; r++) {
                    if (this.#isReachable(valid_rows[r], valid_cols[c], p2x, p2y)) {
                        // point 3:
                        this.arrows.push([ p1x, p1y, p1x, valid_cols[c] ]);
                        this.arrows.push([ p1x, valid_cols[c], valid_rows[r], valid_cols[c] ]);
                        this.arrows.push([ valid_rows[r], valid_cols[c], p2x, p2y ]);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    shuffle(interactive = true, attempt = 0) {
        attempt++;
        if (interactive && this.demo_mode) {
            console.log("can't shuffle while demo is active");
            return;
        }

        board.src_tile = -1;
        board.dst_tile = -1;
        for (let i = 0; i < this.tiles.length; i++) {
            const [ss_idx, state] = this.tiles[i]
            if (state == TILE.selected) {
                this.tiles[i] = [ss_idx, TILE.active];
            }
        }

        const t1_idx = this.#getRandomActiveTile();
        const [t1_ss_idx, t1_state] = this.tiles[t1_idx]
        let t2_idx = -1;
        for (let i = 0; i < this.tiles.length; i++) {
            const tmp_idx = this.#getRandomActiveTile();
            if (tmp_idx != t1_idx) {
                const [tmp_ss_idx, tmp_state] = this.tiles[tmp_idx]
                if (tmp_ss_idx != t1_ss_idx) {
                    t2_idx = tmp_idx;
                    break;
                }
            }
        }

        if (t2_idx == -1) {
            console.log("attempt:", attempt, "unable to find any tiles to swap");
            this.tiles = structuredClone(board_cpy);
            return false;
        }

        const tmp = this.tiles[t1_idx];
        this.tiles[t1_idx] = this.tiles[t2_idx]
        this.tiles[t2_idx] = tmp;
        this.shuffled.push(t1_idx);
        this.shuffled.push(t2_idx);

        const solvable = this.solve_board();
        if (!solvable) {
            console.log(attempt, ": not solvable, re-shuffling");
            return this.shuffle(false, attempt);
        }
        console.log("shuffled:", this.shuffled.length);
        this.shuffled.forEach((elt) => {
            this.tiles[elt][1] = TILE.selected;
        });
        this.draw(ctx);
        this.shuffled = [];
        this.unselectAll();

        if (interactive)
            timer.elapsed += 60;

        return true;
    }

    autosolveImpl() {
        const active_pre = this.#getNumActiveTiles();
        let valid = false;
        for (let sidx = 0; sidx < (this.rows * this.cols); sidx++) {
            let [src_tile_idx, src_tile_state] = this.tiles[sidx];
            if (src_tile_state != TILE.active)
                continue;

            for (let didx = 0; didx < (this.rows * this.cols); didx++) {
                if (didx == sidx)
                    continue;

                let [dst_tile_idx, dst_tile_state] = this.tiles[didx];
                if (dst_tile_state != TILE.active)
                    continue;

                if (src_tile_idx != dst_tile_idx)
                    continue;

                this.tiles[sidx][1] = TILE.selected;
                this.tiles[didx][1] = TILE.selected;
                valid = this.hasValidPath(sidx, didx);
                if (!valid) {
                    this.tiles[sidx][1] = TILE.active;
                    this.tiles[didx][1] = TILE.active;
                    continue;
                }

                return SOLVED.one;
            }
        }
        const active_post = this.#getNumActiveTiles();
        if (!active_post) {
            //console.log("[autosolve] this board was solved");
            return SOLVED.all;
        }

        if (active_pre != active_post) {
            //console.log("[autosolve] one move was solved");
            return SOLVED.one;
        }

        //console.log("[autosolve] this board is not solvable");
        return SOLVED.none;
    }

    solve_board() {
        const should_draw_arrows = this.draw_arrows;
        this.draw_arrows = false;
        const tmp_score = this.score;
        const board_clone = structuredClone(this.tiles);

        let status = SOLVED.none;
        for (let i = 0; i < this.tiles.length / 2; i++) {
            status = this.autosolveImpl();
            if (status != SOLVED.one)
                break;
        }

        this.tiles = structuredClone(board_clone);
        this.score = tmp_score;
        this.draw(ctx);
        this.draw_arrows = should_draw_arrows;
        return status == SOLVED.all;
    }

    hint(interactive = true) {
        if (interactive && this.demo_mode) {
            console.log("can't request hint while demo is active");
            return;
        }
        const should_draw_arrows = this.draw_arrows;
        board.draw_arrows = true;
        const status = this.autosolveImpl();
        board.draw(ctx);
        board.draw_arrows = should_draw_arrows;

        if (interactive) {
            timer.elapsed += 60;
            this.unselectAll();
        }

        return status;
    }

    mouseClick(board, xpos, ypos, interactive) {
        const board_width = (board.rows * board.sheet.tile_width);
        const board_height = (board.cols * board.sheet.tile_height);

        if ((xpos < 0) || (xpos > board_width)) {
            console.log("invalid xpos: ", xpos);
            return;
        }
        if ((ypos < 0) || (ypos > board_height)) {
            console.log("invalid ypos: ", ypos);
            return;
        }

        let board_idx = board.posToBoardIdx(xpos, ypos)
        let [board_row, board_col] = board.idxToCoord(board_idx);
        let [tile_idx, tile] = board.tiles[board_idx];

        let [x1, y1] = board.coordToPos(board_row, board_col);

        board.dst_tile = -1;
        if (board.src_tile == -1) {
            if (tile == TILE.active) {
                board.src_tile = board_idx;
                board.tiles[board.src_tile][1] = TILE.selected;
            }
        } else {
            let [src_tile_idx, src_tile_state] = board.tiles[board.src_tile];

            if (tile != TILE.active) {
                board.tiles[board.src_tile][1] = TILE.active;
            } else {
                board.dst_tile = board_idx;

                let [dst_tile_idx, dst_tile_state] = board.tiles[board.dst_tile];

                if (src_tile_idx != dst_tile_idx) { // not matching tiles:
                    board.tiles[board.src_tile] = [src_tile_idx, TILE.active]
                    board.tiles[board.dst_tile] = [dst_tile_idx, TILE.active]
                } else {
                    board.tiles[board.dst_tile] = [dst_tile_idx, TILE.selected];
                    if (!board.hasValidPath(board.src_tile, board_idx)) {
                        board.tiles[board.src_tile] = [src_tile_idx, TILE.active]
                        board.tiles[board.dst_tile] = [dst_tile_idx, TILE.active]
                    } else {
                        board.tiles[board.src_tile] = [src_tile_idx, TILE.dead]
                        board.tiles[board.dst_tile] = [dst_tile_idx, TILE.dead]
                        board.score++;
                        next_hint = DEFAULT_TIMEOUT;

                        const remaining_pices = this.#getNumActiveTiles();
                        if (!remaining_pices) {
                            gameOver(timer.elapsed);
                            board.init();
                            return;
                        }
                    }
                }
            }
            board.src_tile = -1;
            board.dst_tile = -1;
        }

        board.draw(ctx);
    }


    // not related to sprite type
    #populateLevel(level)
    {
        console.assert(level == 0, "level: ", level, "is not implemented");

        if (level == 0) {
            for (let i = 0; i < board.active_size/2; i++) {
                let ss_tile = board.sheet.getRandomTile();

                let first_tile = board.getUnusedTile()
                board.tiles[first_tile] = [ss_tile, TILE.active]

                let second_tile = board.getUnusedTile()
                board.tiles[second_tile] = [ss_tile, TILE.active]
            }
        }
    }


    init(attempt = 0) {
        board.tiles = [];
        board.arrows = [];
        board.score = 0;

        const empty_tile = 38;
        for (let i = 0; i < (board.cols * board.rows); i++) {
            board.tiles.push([empty_tile, TILE.unused]);
        }

        this.#populateInvisibleBorder();
        this.#populateLevel(0);

        const solvable = this.solve_board();
        board.score = 0;
        attempt++;
        if (!solvable) {
            console.log("attempt:", attempt, "this board might not be solvable, generating new");
            return board.init(attempt);
            //this.shuffle();
        }
        console.log("attempt:", attempt, "this board is solvable");

        timer.init(updateScoreCanvas);
        board.src_tile = -1;
        board.dst_tile = -1;
        board.draw(ctx);
    }
}


function getSpriteIndex(idx)
{
    if (idx < 0 || idx > 1)
        idx = 0;

    switch (idx) {
        case 0: {
            let ss = new SpriteSheet(
                64, 64,
                5, 10,
                'assets/deck_mahjong_dark_0.png',
                'assets/deck_mahjong_light_0.png'
            );
            ss.empty_tile = 38; // 38: invisible, 49: block
            ss.unused_tiles = [ 38, 39, 48, 49 ];
            return ss;
        }

        case 1: {
            let ss = new SpriteSheet(
                64, 64,
                6, 12,
                'assets/chess.png',
                'assets/chess.png'
            );
            ss.empty_tile = 71;
            return ss;
        }


        case 2: {
            let ss = new SpriteSheet(
                84, 84,
                8, 4,
                'assets/pieces.png',
                'assets/pieces.png'
            );
            ss.empty_tile = 28;
            return ss;
        }

        case 3: {
            let ss = new SpriteSheet(
                48, 64,
                4, 16,
                'assets/cards.jpg',
                'assets/cards.jpg'
            );
            ss.empty_tile = 15;
            return ss;
        }
    }

    return undefined;
}


// globals:
const timer = {
    timerid: null,
    callback: null,
    elapsed: 0,
    start: function() {
        if (!this.timerid) {
            const timerTick = this.tick.bind(this);
            this.timerid = window.setInterval(() => {
              timerTick();
            }, 1000);
            //console.log("starting timer:", this.timerid);
        }
    },
    stop: function() {
        //console.log("stopping timer:", this.timerid);
        if (this.timerid) {
            clearInterval(this.timerid);
            this.timerid = null;
        }
    },
    init: function(callback) {
        this.elapsed = 0;
        this.callback = callback;
        this.start();
        const timerStart = this.start.bind(this);
        window.onfocus = function () {
            //console.log("on focus");
            timerStart();
        };

        const timerStop = this.stop.bind(this);
        window.onblur = function () {
            //console.log("on blur");
            timerStop();
        };
    },
    tick: function() {
        this.elapsed++;
        this.callback(this);
    },
};


var board = new GameBoard(12, 16, getSpriteIndex(spriteIdx));
timer.init(updateScoreCanvas);


var next_hint = DEFAULT_TIMEOUT;
function updateScoreCanvas(timer)
{
    let xpos = 0;
    let ypos = 40;

    const canvas = document.getElementById('score_canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const font_size = 30;
    ctx.font = font_size + "px Juice Avocado";
    ctx.fillStyle = "#fff";

    ctx.fillText("Elapsed: " + new Date(timer.elapsed * 1000).toISOString().slice(14, 19),
                 xpos, ypos);

    next_hint--;
    if (next_hint <= 0) {
        next_hint = DEFAULT_TIMEOUT;
        console.log("scheduling autosolve");
        const status = board.hint(false);
        if (status == SOLVED.none) {
            alert("this board might not be solvable");
        }
    }
}


var demoId = null;
function demo(activate = true, delay = 1000) {
    if (activate) {
        if (board.demo_mode) {
            console.log("demo is already active");
            return;
        }

        if (demoId)
            return;

        //timer.stop();
        board.demo_mode = true;
        board.draw_arrows = true;
        demoId = setInterval(() => {
            const status = board.hint(false);
            switch (status) {
                case SOLVED.none:
                    console.log("unable to solve board, stopping demo");
                    clearInterval(demoId);
                    board.demo_mode = false;
                    break;
                case SOLVED.all:
                    console.log("board solved, resarting");
                    board.init();
                    break;
                case SOLVED.one:
                    window.setTimeout(() => {
                        board.removeSelectedTilePair();
                    }, delay / 2);
                    break;
            }
        }, delay);
    } else {
        board.demo_mode = false;
        board.init();

        if (!demoId)
            return;
        clearInterval(demoId);
        demoId = null;
    };
}

