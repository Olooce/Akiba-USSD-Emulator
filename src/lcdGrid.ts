export interface DisplayGrid {
    columns: number;
    rows: number;
}


export function displayRows(text: string, columns: number): number {
    let rows = 0;
    for (const line of text.split('\n')) {
        let row = 1;
        let col = 0;
        for (const token of line.match(/[^ ]*( +|$)/g) ?? []) {
            const word = token.trimEnd().length;
            if (col > 0 && col + word > columns) {
                row += 1;
                col = 0;
            }
            if (word > columns) {
                const extra = Math.ceil(word / columns) - 1;
                row += extra;
                col = word - extra * columns;
            } else {
                col += word;
            }
            col += token.length - word;
        }
        rows += row;
    }
    return rows;
}

export const fitsDisplay = (text: string, grid: DisplayGrid): boolean => displayRows(text, grid.columns) <= grid.rows;
