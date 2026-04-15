export type Direction = "up" | "down" | "left" | "right";

export type Tile = {
  id: string;
  value: number;
};

export type Cell = Tile | null;
export type Board = Cell[][];
export type MoveResult = { board: Board; scoreGain: number; moved: boolean };

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((c) => (c ? { ...c } : null)));
}

function uid() {
  return (
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2) +
    Date.now().toString(16)
  );
}

export function createEmptyBoard(size: number = 4): Board {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function spawnRandomTile(board: Board): Board {
  const size = board.length;
  const empties: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (!board[r][c]) empties.push({ r, c });
  }
  if (empties.length === 0) return board;

  const { r, c } = empties[Math.floor(Math.random() * empties.length)];
  const next = cloneBoard(board);
  const value = Math.random() < 0.9 ? 2 : 4;
  next[r][c] = { id: uid(), value };
  return next;
}

export function newGame(size: number = 4): { board: Board; score: number } {
  let board = createEmptyBoard(size);
  board = spawnRandomTile(board);
  board = spawnRandomTile(board);
  return { board, score: 0 };
}

function lineToTiles(line: Cell[]): Tile[] {
  return line.filter(Boolean) as Tile[];
}

function mergeLine(tiles: Tile[], size: number): { out: Cell[]; scoreGain: number } {
  const out: Cell[] = [];
  let scoreGain = 0;

  for (let i = 0; i < tiles.length; i++) {
    const cur = tiles[i];
    const next = tiles[i + 1];
    if (next && next.value === cur.value) {
      const mergedValue = cur.value * 2;
      out.push({ id: uid(), value: mergedValue });
      scoreGain += mergedValue;
      i++;
    } else {
      out.push(cur);
    }
  }

  while (out.length < size) out.push(null);
  return { out, scoreGain };
}

function getLine(board: Board, index: number, dir: Direction): Cell[] {
  const size = board.length;
  const line: Cell[] = [];
  for (let i = 0; i < size; i++) {
    if (dir === "left") line.push(board[index][i]);
    if (dir === "right") line.push(board[index][size - 1 - i]);
    if (dir === "up") line.push(board[i][index]);
    if (dir === "down") line.push(board[size - 1 - i][index]);
  }
  return line;
}

function setLine(board: Board, index: number, dir: Direction, line: Cell[]) {
  const size = board.length;
  for (let i = 0; i < size; i++) {
    const v = line[i];
    if (dir === "left") board[index][i] = v;
    if (dir === "right") board[index][size - 1 - i] = v;
    if (dir === "up") board[i][index] = v;
    if (dir === "down") board[size - 1 - i][index] = v;
  }
}

export function move(board: Board, dir: Direction): MoveResult {
  const size = board.length;
  const next = cloneBoard(board);
  let scoreGain = 0;
  let moved = false;

  for (let idx = 0; idx < size; idx++) {
    const before = getLine(board, idx, dir);
    const tiles = lineToTiles(before);
    const { out, scoreGain: gain } = mergeLine(tiles, size);

    for (let i = 0; i < size; i++) {
      const a = before[i]?.value ?? 0;
      const b = out[i]?.value ?? 0;
      if (a !== b) moved = true;
      if ((before[i] === null) !== (out[i] === null)) moved = true;
    }

    scoreGain += gain;
    setLine(next, idx, dir, out);
  }

  return { board: next, scoreGain, moved };
}

export function hasMoves(board: Board): boolean {
  const size = board.length;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!board[r][c]) return true;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = board[r][c]?.value ?? 0;
      if (r + 1 < size && (board[r + 1][c]?.value ?? 0) === v) return true;
      if (c + 1 < size && (board[r][c + 1]?.value ?? 0) === v) return true;
    }
  }
  return false;
}

export function boardToCells(board: Board): Array<{ posKey: string; tile: Tile | null }> {
  const size = board.length;
  const cells: Array<{ posKey: string; tile: Tile | null }> = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) cells.push({ posKey: `${r}-${c}`, tile: board[r][c] });
  }
  return cells;
}
