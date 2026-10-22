// Abstract library map: uniform room boxes on a grid, keeping only rough relative positions
// and the building's curved exterior as a sense of direction. 3F sits in 2F's free corner.

const CELL = { w: 56, h: 34, gap: 6 };

// Place room ids on a grid anchored at (x0, y0); cells are [col, row, id].
function grid(x0, y0, cells) {
  return cells.map(([c, r, id]) => ({
    id, x: x0 + c * (CELL.w + CELL.gap), y: y0 + r * (CELL.h + CELL.gap), w: CELL.w, h: CELL.h,
  }));
}

const range = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => a + (a <= b ? i : -i));
const at = (col, row0, ids) => ids.map((id, i) => [col, row0 + i, id]);   // vertical run
const across = (row, col0, ids) => ids.map((id, i) => [col0 + i, row, id]); // horizontal run

const MAP = {
  viewBox: '0 0 720 480',
  exterior: 'M14 412 A 400 120 0 0 0 706 412',
  panels: [
    [466, 270, 220, 128],  // [x, y, w, h] frame setting 3F apart from 2F
  ],
  labels: [
    [40, 24, '2F', 'floor'],
    [223, 24, 'Medium Carrels'],
    [223, 230, 'Small Carrels'],
    [576, 24, '8-Person Rooms'],
    [607, 104, '5-Person Rooms'],
    [486, 292, '3F', 'floor'],
    [596, 292, '10-Person Rooms'],
  ],
  rooms: [
    ...grid(40, 36, [
      ...across(0, 1, range(240, 237)),  // medium carrels, 237 on the right
      ...at(0, 0, range(228, 236)),      // west side, 228 at the top
      ...at(5, 0, range(227, 219)),      // east side, 219 at the bottom
    ]),
    ...grid(486, 36, [
      ...across(0, 0, [202, 203, 204]),  // row 1 is the corridor
      ...at(1, 2, [205, 206, 207]),
      ...at(2, 2, [210, 209, 208]),
    ]),
    ...grid(486, 306, [
      ...across(0, 0, [302, 304, 306]),
      ...across(1, 0, [303, 305, 307]),
    ]),
  ],
};
