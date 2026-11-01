// TypeScript port of survey-pad's `assets/js/components/dataTable.js`; behaviour, markup and class names are unchanged.

/**
 * DataTable: standalone, configuration-driven table.
 *
 * const table = createDataTable<Row>({
 *   container: '#host',                 // element or selector (plain <div>)
 *   label: 'Surveys',                   // accessible name (caption + aria-labels)
 *   columns: [{ key, label, type, align, ... }],
 *   data: rowsArray | async (query) => ({ rows, total }),   // function = server mode
 *   rowId: (row) => row.id,
 *   rowLabel: (row) => row.title,       // used in "Actions for ..." label
 *   rowActions: (row, table) => [{ label, onSelect(row) | href, danger, disabled, title, separatorBefore }],
 *   pageSizes: [10, 25, 50, 100], pageSize: 25,
 *   sorts: [{ field, dir: 'asc' | 'desc' }],  // initial sort (invalid config throws)
 *   persistKey: 'sp:dt:surveys',        // localStorage key for view state (optional)
 *   emptyMessage: 'Nothing here yet.',
 *   minHeight: '16rem',                 // CSS length; minimum height of the scroll region (optional)
 *   maxHeight: '70vh',                  // CSS length; maximum height of the scroll region (optional)
 *   onStateChange: (state) => {},
 * });
 * table.setRows(rows); table.refresh(); table.getState(); table.destroy();
 * table.setState(patch) -> { ok, errors }   // atomic: if anything is invalid nothing is applied and the
 *                                           // errors are shown to the user and returned
 *
 * Column: {
 *   key (required, unique), label,
 *   type: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum',   (default 'text')
 *   align: 'start' | 'center' | 'end',        (default by type)
 *   accessor(row) -> raw value,               (default row[key])
 *   format(raw, row) -> string,               (overrides built-in formatting; also used for any-column search)
 *   render(row, raw) -> Node | string,        (cell content; strings are inserted as text, never HTML)
 *   options: [{value,label}] | string[],      (enum)
 *   numberFormat: Intl.NumberFormat options, dateFormat: Intl.DateTimeFormat options, locale,
 *   trueLabel, falseLabel, step (number filter inputs),
 *   operators: ['contains', ...],             (restrict the relationships offered)
 *   width, minWidth, maxWidth (CSS lengths; maxWidth truncates), wrap: true,
 *   sortable (true), filterable (true), hideable (true), hidden (false)
 * }
 */

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum';
export type Align = 'start' | 'center' | 'end';
export type SortDir = 'asc' | 'desc';
export type Match = 'all' | 'any';

export interface EnumOption {
    value: string | number;
    label: string;
}

export interface ColumnConfig<R> {
    key: string;
    label?: string;
    type?: ColumnType;
    align?: Align;
    accessor?: (row: R) => unknown;
    format?: (raw: unknown, row: R | null) => string;
    render?: (row: R, raw: unknown) => Node | string;
    options?: (EnumOption | string)[];
    numberFormat?: Intl.NumberFormatOptions;
    dateFormat?: Intl.DateTimeFormatOptions;
    locale?: string;
    trueLabel?: string;
    falseLabel?: string;
    step?: number | string;
    operators?: string[];
    width?: string;
    minWidth?: string;
    maxWidth?: string;
    wrap?: boolean;
    sortable?: boolean;
    filterable?: boolean;
    hideable?: boolean;
    hidden?: boolean;
}

export interface Sort {
    field: string;
    dir: SortDir;
}

export interface Condition {
    field: string;
    op: string;
    value: string;
    value2: string;
}

export interface Query {
    page: number;
    pageSize: number;
    sorts: Sort[];
    filters: Condition[];
    match: Match;
    quick: Condition | null;
    signal: AbortSignal;
}

export interface TableState {
    page: number;
    pageSize: number;
    total: number;
    sorts: Sort[];
    filters: Condition[];
    match: Match;
    quick: Condition | null;
    hidden: string[];
}

export interface StatePatch {
    sorts?: unknown;
    filters?: unknown;
    match?: unknown;
    quick?: unknown;
    pageSize?: unknown;
    page?: unknown;
    hidden?: unknown;
}

export interface RowAction<R> {
    label: string;
    onSelect?: (row: R, table: DataTable<R>) => unknown;
    href?: string;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
    separatorBefore?: boolean;
}

export interface DataTableOptions<R> {
    container: string | HTMLElement;
    label?: string;
    columns: ColumnConfig<R>[];
    data?: R[] | ((query: Query) => Promise<{ rows: R[]; total: number }>);
    rowId?: (row: R) => unknown;
    rowLabel?: (row: R) => string;
    rowActions?: (row: R, table: DataTable<R>) => (RowAction<R> | null | undefined | false)[];
    pageSizes?: number[];
    pageSize?: number;
    sorts?: Sort[];
    persistKey?: string;
    emptyMessage?: string;
    minHeight?: string;
    maxHeight?: string;
    onStateChange?: (state: TableState) => void;
}

export interface DataTable<R> {
    element: HTMLElement;

    setRows(rows: R[]): Promise<void>;

    refresh(): Promise<void>;

    getState(): TableState;

    setState(patch?: StatePatch): { ok: boolean; errors: string[] };

    destroy(): void;
}

/** What a filter condition can target: a real column, or the "any text column" search. */
interface Field {
    key: string;
    label: string;
    type: ColumnType;
    operators?: readonly string[];
    options: EnumOption[];
    step?: number | string;
}

interface Column<R> extends Field {
    align: Align;
    accessor: (row: R) => unknown;
    format?: (raw: unknown, row: R | null) => string;
    render?: (row: R, raw: unknown) => Node | string;
    numberFormat?: Intl.NumberFormatOptions;
    dateFormat?: Intl.DateTimeFormatOptions;
    locale?: string;
    trueLabel?: string;
    falseLabel?: string;
    width?: string;
    minWidth?: string;
    maxWidth?: string;
    wrap?: boolean;
    sortable: boolean;
    filterable: boolean;
    hideable: boolean;
    hidden: boolean;
    nf?: Intl.NumberFormat;
}

type Norm = string | number | boolean | null;

interface Operator {
    id: string;
    label: string;
    arity: 0 | 1 | 2;
    test: (v: Norm, a: Norm, b: Norm) => boolean;
}

interface ConditionRow extends HTMLDivElement {
    validate(): boolean;

    hasBadInput(): boolean;
}

type Child = Node | string | number | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Record<string, unknown> = {},
    children: Child | Child[] = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = String(value);
        else if (key === 'html') node.innerHTML = String(value);
        else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        } else if (value === true) {
            node.setAttribute(key, '');
        } else {
            node.setAttribute(key, String(value));
        }
    }
    const kids = Array.isArray(children) ? children : [children];
    for (const child of kids) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

const TYPES: readonly ColumnType[] = ['text', 'number', 'date', 'datetime', 'boolean', 'enum'];
let instanceSeq = 0;

const ICONS = {
    kebab: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    sort: '<path d="m3 8 4-4 4 4M7 4v16M21 16l-4 4-4-4M17 20V4"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    first: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
    last: '<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
} as const;
type IconName = keyof typeof ICONS;

const MAX_TEXT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const BOUNDS: Partial<Record<ColumnType, { min: string; max: string }>> = {
    date: {min: '1000-01-01', max: '9999-12-31'},
    datetime: {min: '1000-01-01T00:00', max: '9999-12-31T23:59'},
};

function icon(name: IconName, size = 16): HTMLSpanElement {
    return el('span', {
        class: 'dt-icon', 'aria-hidden': 'true',
        html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[name]}</svg>`,
    });
}

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
const isBlank = (v: unknown): v is null | undefined | '' => v === null || v === undefined || v === '';
const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lc = (v: unknown) => String(v).toLowerCase();

function toDate(raw: unknown): Date | null {
    if (isBlank(raw)) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const d = new Date(raw as string | number);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalises a raw cell value into a comparable primitive for its column type (null = empty). */
function normalize(type: ColumnType, raw: unknown): Norm {
    if (isBlank(raw)) return null;
    switch (type) {
        case 'number': {
            const n = Number(raw);
            return Number.isFinite(n) ? n : null;
        }
        case 'date': {
            const d = toDate(raw);
            return d ? dateKey(d) : null;
        }
        case 'datetime': {
            const d = toDate(raw);
            return d ? Math.floor(d.getTime() / 60000) * 60000 : null; // minute
        }
        case 'boolean':
            if (raw === true || raw === 'true' || raw === 1) return true;
            if (raw === false || raw === 'false' || raw === 0) return false;
            return null;
        default:
            return String(raw);
    }
}

function compareValues(a: Norm, b: Norm): number {
    if (typeof a === 'number' || typeof a === 'boolean') return Number(a) - Number(b);
    return collator.compare(String(a), String(b));
}

/*  operators */

// Values compared here were normalised for the same column type, so they share a primitive type.
const gt = (a: Norm, b: Norm) => (a as number) > (b as number);
const gte = (a: Norm, b: Norm) => (a as number) >= (b as number);

const op = (id: string, label: string, arity: Operator['arity'], test: Operator['test']): Operator => ({
    id,
    label,
    arity,
    test
});
const EMPTY = op('empty', 'is empty', 0, (v) => v === null || v === '');
const NOT_EMPTY = op('notEmpty', 'is not empty', 0, (v) => v !== null && v !== '');

const ordered = (L: Record<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between', string>): Operator[] => [
    op('eq', L.eq, 1, (v, a) => v !== null && v === a),
    op('neq', L.neq, 1, (v, a) => v === null || v !== a),
    op('gt', L.gt, 1, (v, a) => v !== null && gt(v, a)),
    op('gte', L.gte, 1, (v, a) => v !== null && gte(v, a)),
    op('lt', L.lt, 1, (v, a) => v !== null && gt(a, v)),
    op('lte', L.lte, 1, (v, a) => v !== null && gte(a, v)),
    op('between', L.between, 2, (v, a, b) => v !== null && gte(v, gt(b, a) ? a : b) && gte(gt(b, a) ? b : a, v)),
    EMPTY, NOT_EMPTY,
];

const NUMBER_LABELS = {eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'is between'};
const DATE_LABELS = {
    eq: 'is', neq: 'is not', gt: 'is after', gte: 'is on or after',
    lt: 'is before', lte: 'is on or before', between: 'is between',
};

const OPERATORS: Record<ColumnType, Operator[]> = {
    text: [
        op('contains', 'contains', 1, (v, a) => v !== null && lc(v).includes(lc(a))),
        op('notContains', 'does not contain', 1, (v, a) => v === null || !lc(v).includes(lc(a))),
        op('eq', 'equals', 1, (v, a) => v !== null && lc(v) === lc(a)),
        op('neq', 'does not equal', 1, (v, a) => v === null || lc(v) !== lc(a)),
        op('startsWith', 'starts with', 1, (v, a) => v !== null && lc(v).startsWith(lc(a))),
        op('endsWith', 'ends with', 1, (v, a) => v !== null && lc(v).endsWith(lc(a))),
        EMPTY, NOT_EMPTY,
    ],
    number: ordered(NUMBER_LABELS),
    date: ordered(DATE_LABELS),
    datetime: ordered(DATE_LABELS),
    boolean: [
        op('isTrue', 'is yes', 0, (v) => v === true),
        op('isFalse', 'is no', 0, (v) => v === false),
        EMPTY, NOT_EMPTY,
    ],
    enum: [
        op('eq', 'is', 1, (v, a) => v !== null && v === a),
        op('neq', 'is not', 1, (v, a) => v === null || v !== a),
        EMPTY, NOT_EMPTY,
    ],
};

/** Pseudo-column for the quick search: matches against the text of every text/enum column. */
const ANY: Field = {
    key: '', label: 'Any text column', type: 'text',
    operators: ['contains', 'startsWith', 'endsWith', 'eq'], options: [],
};

function operatorsFor(col: Field): Operator[] {
    const all = OPERATORS[col.type] || OPERATORS.text;
    return col.operators ? all.filter((o) => col.operators!.includes(o.id)) : all;
}

const findOp = (col: Field, id: string): Operator => {
    const ops = operatorsFor(col);
    return ops.find((o) => o.id === id) || ops[0];
};

/*  validation */

/** Text is trimmed; everything else is passed through as a string. */
const clean = (col: Field, raw: unknown): string => {
    const s = String(raw ?? '');
    return col.type === 'text' ? s.trim() : s;
};

/** Strict calendar check: rejects Feb 30 and years < 100 (which `new Date(y, m, d)` remaps to 19xx). */
function validDate(s: string): boolean {
    if (!DATE_RE.test(s)) return false;
    const d = toDate(s);
    return !!d && dateKey(d) === s;
}

function validateValue(col: Field, raw: unknown): string | null {
    const v = clean(col, raw);
    if (v === '') return 'Enter a value.';
    switch (col.type) {
        case 'number':
            return Number.isFinite(Number(v)) ? null : 'Enter a valid number.';
        case 'date':
            return validDate(v) ? null : 'Enter a valid date.';
        case 'datetime':
            return DATETIME_RE.test(v) && validDate(v.slice(0, 10)) && !Number.isNaN(new Date(v).getTime())
                ? null : 'Enter a valid date and time.';
        case 'enum':
            return col.options.some((o) => String(o.value) === v) ? null : 'Choose one of the listed options.';
        default:
            return v.length > MAX_TEXT ? `Use at most ${MAX_TEXT} characters.` : null;
    }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Returns an error message or null. `cols` is the set of columns this condition is allowed to target. */
function validateCondition(cond: unknown, cols: readonly Field[]): string | null {
    if (!isRecord(cond)) return 'Invalid condition.';
    const col = cols.find((c) => c.key === cond.field);
    if (!col) return 'Choose a column.';
    const o = operatorsFor(col).find((x) => x.id === cond.op);
    if (!o) return 'Choose a valid relationship.';
    if (o.arity >= 1) {
        const err = validateValue(col, cond.value);
        if (err) return o.arity === 2 ? `From: ${err}` : err;
    }
    if (o.arity === 2) {
        const err = validateValue(col, cond.value2);
        if (err) return `To: ${err}`;
        const a = normalize(col.type, clean(col, cond.value));
        const b = normalize(col.type, clean(col, cond.value2));
        if (compareValues(a, b) > 0) return 'From must not be after To.';
    }
    return null;
}

/** Call only on validated conditions. Trims text and drops values the operator does not use. */
function sanitizeCondition(cond: Condition, cols: readonly Field[]): Condition {
    const col = cols.find((c) => c.key === cond.field)!;
    const o = operatorsFor(col).find((x) => x.id === cond.op)!;
    return {
        field: cond.field,
        op: o.id,
        value: o.arity >= 1 ? clean(col, cond.value) : '',
        value2: o.arity === 2 ? clean(col, cond.value2) : '',
    };
}

/* builders */

function select(options: [string, string][], value: string, label: string, onChange: (value: string) => void): HTMLSelectElement {
    const node = el('select', {'aria-label': label},
        options.map(([v, l]) => el('option', {value: v}, l)));
    node.value = value;
    node.addEventListener('change', () => onChange(node.value));
    return node;
}

function iconButton(name: IconName, label: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
    return el('button', {
            class: `dt-icon-btn ${cls}`.trim(),
            type: 'button',
            'aria-label': label,
            title: label,
            onClick,
        },
        icon(name));
}

function valueInput(col: Field, value: string, onInput: (value: string) => void, label: string): HTMLInputElement | HTMLSelectElement {
    let node: HTMLInputElement | HTMLSelectElement;
    if (col.type === 'enum') {
        node = el('select', {'aria-label': label}, [
            el('option', {value: ''}, 'Select…'),
            ...col.options.map((o) => el('option', {value: o.value}, o.label)),
        ]);
    } else {
        const type = ({
            number: 'number',
            date: 'date',
            datetime: 'datetime-local'
        } as Partial<Record<ColumnType, string>>)[col.type] || 'text';
        node = el('input', {
            type, 'aria-label': label, autocomplete: 'off',
            step: col.type === 'number' ? (col.step ?? 'any') : undefined,
            placeholder: col.type === 'text' ? 'Value' : undefined,
            maxlength: col.type === 'text' ? MAX_TEXT : undefined,
            ...BOUNDS[col.type],
        });
    }
    node.value = value ?? '';
    node.addEventListener('input', () => onInput(node.value));
    return node;
}

function valueControls(col: Field, opDef: Operator, cond: Condition, touch: () => void): Node[] {
    const out: Node[] = [];
    if (opDef.arity >= 1) {
        out.push(valueInput(col, cond.value, (v) => {
            touch();
            cond.value = v;
        }, opDef.arity === 2 ? 'From' : 'Value'));
    }
    if (opDef.arity === 2) {
        out.push(el('span', {class: 'dt-and'}, 'and'), valueInput(col, cond.value2, (v) => {
            touch();
            cond.value2 = v;
        }, 'To'));
    }
    return out;
}

/**
 * Editable "column / relationship / value" row. Mutates `cond` in place.
 * Relationship list and value inputs are rebuilt whenever the column (and data type) changes.
 * The returned row exposes `validate()` (shows the error, returns true/false) and `hasBadInput()`.
 */
function buildCondition(
    cond: Condition,
    cols: readonly Field[],
    {onRemove, onTouch, label = 'Condition'}: { onRemove?: () => void; onTouch?: () => void; label?: string } = {},
): ConditionRow {
    const byKey = (k: string) => cols.find((c) => c.key === k) || cols[0];
    const opSlot = el('span', {class: 'dt-slot'});
    const valSlot = el('span', {class: 'dt-slot dt-slot--values'});
    const errId = `dt-err-${++instanceSeq}`;
    const errEl = el('p', {class: 'field-error dt-cond-error', id: errId, hidden: true});

    const setError = (message: string | null) => {
        row.classList.toggle('dt-cond--invalid', !!message);
        errEl.textContent = message || '';
        errEl.hidden = !message;
        valSlot.querySelectorAll('input, select').forEach((n) => {
            if (message) {
                n.setAttribute('aria-invalid', 'true');
                n.setAttribute('aria-describedby', errId);
            } else {
                n.removeAttribute('aria-invalid');
                n.removeAttribute('aria-describedby');
            }
        });
    };
    const touch = () => {
        setError(null);
        onTouch?.();
    };

    // number/date inputs report unparseable text as value === '' + validity.badInput
    const hasBadInput = () => [...valSlot.querySelectorAll('input')].some((n) => n.validity.badInput);
    const row: ConditionRow = Object.assign(el('div', {class: 'dt-cond', role: 'group', 'aria-label': label}), {
        hasBadInput,
        validate: () => {
            const col = byKey(cond.field);
            const message = hasBadInput()
                ? `Enter a valid ${col.type === 'number' ? 'number' : 'date or time'}.`
                : validateCondition(cond, cols);
            setError(message);
            return !message;
        },
    });

    const drawValues = () => {
        const col = byKey(cond.field);
        const opDef = findOp(col, cond.op);
        if (opDef.arity < 2) cond.value2 = '';
        if (opDef.arity < 1) cond.value = '';
        valSlot.replaceChildren(...valueControls(col, opDef, cond, touch));
    };
    const drawOps = () => {
        const ops = operatorsFor(byKey(cond.field));
        if (!ops.some((o) => o.id === cond.op)) cond.op = ops[0].id;
        opSlot.replaceChildren(select(ops.map((o) => [o.id, o.label]), cond.op, 'Relationship', (v) => {
            touch();
            cond.op = v;
            drawValues();
        }));
    };
    const colSelect = select(cols.map((c) => [c.key, c.label]), cond.field, 'Column', (v) => {
        touch();
        cond.field = v;
        cond.value = '';
        cond.value2 = '';
        drawOps();
        drawValues();
    });

    row.append(colSelect, opSlot, valSlot);
    if (onRemove) row.append(iconButton('trash', `Remove ${label.toLowerCase()}`, onRemove, 'dt-icon-btn--danger'));
    row.append(errEl);
    drawOps();
    drawValues();
    return row;
}

/*  dialog */

interface DialogOptions {
    title: string;
    body: Node;
    applyLabel?: string;
    resetLabel?: string;
    onReset?: () => void;
    /** Return `false` to keep the dialog open. */
    onApply: () => boolean | void;
    size?: 'sm' | 'md' | 'lg';
}

function openDialog(host: HTMLElement, {
    title,
    body,
    applyLabel = 'Apply',
    resetLabel,
    onReset,
    onApply,
    size = 'md'
}: DialogOptions): HTMLDialogElement {
    const titleId = `dt-dlg-${++instanceSeq}`;
    const dialog = el('dialog', {class: `dialog dialog--${size} dt-dialog`, 'aria-labelledby': titleId});
    const form = el('form', {method: 'dialog', novalidate: true});

    const actions = el('div', {class: 'dialog-actions'}, [
        resetLabel ? el('button', {
            class: 'btn btn--ghost btn--sm dt-reset',
            type: 'button',
            onClick: onReset,
        }, resetLabel) : null,
        el('button', {class: 'btn btn--ghost', type: 'button', onClick: () => dialog.close('cancel')}, 'Cancel'),
        el('button', {class: 'btn btn--primary', type: 'submit'}, applyLabel),
    ]);

    form.append(
        el('div', {class: 'dialog-header'}, [
            el('h2', {class: 'dialog-title', id: titleId}, title),
            iconButton('x', 'Close', () => dialog.close('cancel')),
        ]),
        el('div', {class: 'dialog-body'}, [body, actions]),
    );
    dialog.append(form);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (onApply() === false) return;
        dialog.close('apply');
    });
    dialog.addEventListener('close', () => dialog.remove());
    host.append(dialog);
    dialog.showModal();
    return dialog;
}

/* component */

export function createDataTable<R>(options: DataTableOptions<R>): DataTable<R> {
    const opts = {
        pageSizes: [10, 25, 50, 100], pageSize: 25, emptyMessage: 'No records to display.',
        rowId: (r: R) => (r as { id?: unknown }).id, ...options,
    };
    const host = typeof opts.container === 'string' ? document.querySelector<HTMLElement>(opts.container) : opts.container;
    if (!host) throw new Error('createDataTable: container not found');

    if (opts.data != null && !Array.isArray(opts.data) && typeof opts.data !== 'function') {
        throw new Error('createDataTable: data must be an array or a function');
    }
    if (!Array.isArray(opts.pageSizes) || !opts.pageSizes.length
        || !opts.pageSizes.every((n) => Number.isInteger(n) && n > 0)) {
        throw new Error('createDataTable: pageSizes must be a non-empty array of positive integers');
    }

    /*  columns  */
    const columns: Column<R>[] = (opts.columns || []).map((c) => {
        if (!c.key) throw new Error('createDataTable: every column needs a key');
        if (c.type !== undefined && !TYPES.includes(c.type)) {
            throw new Error(`createDataTable: column "${c.key}" has unknown type "${c.type}"`);
        }
        const type = c.type || 'text';
        if (c.operators) {
            const known = OPERATORS[type].map((o) => o.id);
            if (!c.operators.length || c.operators.some((id) => !known.includes(id))) {
                throw new Error(`createDataTable: column "${c.key}" has invalid operators for type "${type}"`);
            }
        }
        if (type === 'enum' && c.filterable !== false && !c.options?.length) {
            throw new Error(`createDataTable: enum column "${c.key}" needs options`);
        }
        return {
            sortable: true, filterable: true, hideable: true, hidden: false, label: c.key,
            accessor: (row: R) => (row as Record<string, unknown>)[c.key],
            ...c,
            type,
            align: c.align || (type === 'number' ? 'end' : type === 'boolean' ? 'center' : 'start'),
            options: (c.options || []).map((o) => (typeof o === 'object' ? o : {value: o, label: String(o)})),
        };
    });
    if (!columns.length) throw new Error('createDataTable: at least one column is required');

    const uid = `dt${++instanceSeq}`;
    const serverMode = typeof opts.data === 'function';
    const label = opts.label || 'Data table';

    const colMap = new Map(columns.map((c) => [c.key, c]));
    if (colMap.size !== columns.length) throw new Error('createDataTable: duplicate column keys');
    const filterCols = columns.filter((c) => c.filterable);
    const searchCols = filterCols.filter((c) => c.type === 'text' || c.type === 'enum');
    const quickCols: Field[] = searchCols.length ? [ANY, ...filterCols] : filterCols;
    const sortCols = columns.filter((c) => c.sortable);
    const rowActions = opts.rowActions;

    /*  formatting  */
    function displayText(col: Column<R>, raw: unknown, row: R | null): string {
        if (col.format) return String(col.format(raw, row) ?? '');
        if (isBlank(raw)) return '';
        switch (col.type) {
            case 'number':
                return (col.nf ??= new Intl.NumberFormat(col.locale, col.numberFormat)).format(Number(raw));
            case 'date': {
                const d = toDate(raw);
                return d ? d.toLocaleDateString(col.locale, col.dateFormat || {
                    year: 'numeric', month: 'short', day: 'numeric',
                }) : String(raw);
            }
            case 'datetime': {
                const d = toDate(raw);
                return d ? d.toLocaleString(col.locale, col.dateFormat || {
                    dateStyle: 'medium', timeStyle: 'short',
                }) : String(raw);
            }
            case 'boolean':
                return raw === true || raw === 'true' || raw === 1 ? (col.trueLabel || 'Yes') : (col.falseLabel || 'No');
            case 'enum':
                return col.options.find((o) => String(o.value) === String(raw))?.label ?? String(raw);
            default:
                return String(raw);
        }
    }

    /*  validators (return a list of messages; empty = valid)  */
    function validateSorts(list: unknown): string[] {
        if (!Array.isArray(list)) return ['Sorts must be a list.'];
        const errors: string[] = [];
        const seen = new Set<string>();
        list.forEach((s: unknown, i) => {
            const field = isRecord(s) ? s.field : undefined;
            const col = colMap.get(String(field));
            if (!col) errors.push(`Sort ${i + 1}: unknown column "${field}".`);
            else if (!col.sortable) errors.push(`Sort ${i + 1}: "${col.label}" cannot be sorted.`);
            else if (!isRecord(s) || (s.dir !== 'asc' && s.dir !== 'desc')) errors.push(`Sort ${i + 1}: order must be "asc" or "desc".`);
            else if (seen.has(col.key)) errors.push(`Sort ${i + 1}: "${col.label}" is used more than once.`);
            else seen.add(col.key);
        });
        return errors;
    }

    function validateHidden(keys: unknown): string[] {
        if (!Array.isArray(keys)) return ['Hidden columns must be a list.'];
        const errors: string[] = [];
        keys.forEach((k) => {
            const col = colMap.get(k);
            if (!col) errors.push(`Unknown column "${k}".`);
            else if (!col.hideable) errors.push(`"${col.label}" cannot be hidden.`);
        });
        if (!errors.length && columns.every((c) => keys.includes(c.key))) {
            errors.push('At least one column must stay visible.');
        }
        return errors;
    }

    function validateFilters(list: unknown): string[] {
        if (!Array.isArray(list)) return ['Filters must be a list.'];
        return list.flatMap((f, i) => {
            const err = validateCondition(f, quickCols);
            return err ? [`Filter ${i + 1}: ${err}`] : [];
        });
    }

    const sortErrors = validateSorts(opts.sorts || []);
    if (sortErrors.length) throw new Error(`createDataTable: invalid sorts: ${sortErrors.join(' ')}`);

    /*  state  */
    const state = {
        page: 1,
        pageSize: opts.pageSizes.includes(opts.pageSize) ? opts.pageSize : opts.pageSizes[0],
        sorts: (opts.sorts || []).map(({field, dir}) => ({field, dir})),
        filters: [] as Condition[],
        match: 'all' as Match,
        quick: null as Condition | null,
        hidden: new Set(columns.filter((c) => c.hidden).map((c) => c.key)),
    };
    const view = {rows: [] as R[], total: 0, loading: false, error: null as Error | null};
    let source: R[] = Array.isArray(opts.data) ? opts.data : [];
    let quickDraft = freshQuick();
    let quickRow: ConditionRow | null = null;
    let abortCtl: AbortController | null = null;
    let reqSeq = 0;

    function newCondition(col: Field): Condition {
        return {field: col.key, op: operatorsFor(col)[0].id, value: '', value2: ''};
    }

    function freshQuick(): Condition | null {
        return quickCols.length ? newCondition(quickCols[0]) : null;
    }

    // quickCols is a superset of filterCols; call only after validation
    const cleanCondition = (cond: Condition) => sanitizeCondition(cond, quickCols);

    function restore(): void {
        if (!opts.persistKey) return;
        let saved: unknown;
        try {
            saved = JSON.parse(localStorage.getItem(opts.persistKey) ?? 'null');
        } catch {
            showNotice('Saved view settings could not be read and were ignored.', []);
            return;
        }
        if (saved == null) return;
        if (!isRecord(saved)) {
            showNotice('Saved view settings are malformed and were ignored.', []);
            return;
        }

        const errors: string[] = [];
        if ('pageSize' in saved) {
            if (opts.pageSizes.includes(saved.pageSize as number)) state.pageSize = saved.pageSize as number;
            else errors.push(`Page size ${saved.pageSize} is no longer available.`);
        }
        if ('sorts' in saved) {
            const e = validateSorts(saved.sorts);
            if (e.length) errors.push(...e);
            else state.sorts = (saved.sorts as Sort[]).map(({field, dir}) => ({field, dir}));
        }
        if ('filters' in saved) {
            if (!Array.isArray(saved.filters)) {
                errors.push('Filters must be a list.');
            } else {
                saved.filters.forEach((f: unknown, i: number) => {
                    const err = validateCondition(f, quickCols);
                    if (err) errors.push(`Filter ${i + 1}: ${err}`);
                    else state.filters.push(cleanCondition(f as Condition));
                });
            }
        }
        if ('match' in saved) {
            if (saved.match === 'any' || saved.match === 'all') state.match = saved.match;
            else errors.push('Filter matching mode was invalid.');
        }
        if ('hidden' in saved) {
            const e = validateHidden(saved.hidden);
            if (e.length) errors.push(...e);
            else state.hidden = new Set(saved.hidden as string[]);
        }
        if (errors.length) showNotice('Some saved view settings were invalid and were not restored:', errors);
    }

    function persist(): void {
        if (!opts.persistKey) return;
        try {
            localStorage.setItem(opts.persistKey, JSON.stringify({
                pageSize: state.pageSize, sorts: state.sorts, filters: state.filters,
                match: state.match, hidden: [...state.hidden],
            }));
        } catch { /* storage unavailable: view state won't persist */
        }
    }

    const snapshot = (): TableState => ({
        page: state.page, pageSize: state.pageSize, total: view.total,
        sorts: state.sorts.map((s) => ({...s})),
        filters: state.filters.map(cleanCondition),
        match: state.match,
        quick: state.quick ? cleanCondition(state.quick) : null,
        hidden: [...state.hidden],
    });

    const visibleCols = () => columns.filter((c) => !state.hidden.has(c.key));

    /*  data pipeline  */
    function testFor(cond: Condition): (row: R) => boolean {
        if (cond.field === '') {
            const o = findOp(ANY, cond.op);
            const a = String(cond.value);
            return (row) => searchCols.some((col) => {
                const text = displayText(col, col.accessor(row), row);
                return o.test(text === '' ? null : text, a, null);
            });
        }
        const col = colMap.get(cond.field)!;
        const o = findOp(col, cond.op);
        const norm = (s: string): Norm => {
            if (isBlank(s)) return null;
            return col.type === 'number' ? Number(s) : col.type === 'date' ? String(s) : normalize(col.type, s);
        };
        const a = norm(cond.value);
        const b = norm(cond.value2);
        return (row) => o.test(normalize(col.type, col.accessor(row)), a, b);
    }

    function sortKey(col: Column<R>, row: R): Norm {
        const raw = col.accessor(row);
        return col.type === 'enum' ? (isBlank(raw) ? null : displayText(col, raw, row)) : normalize(col.type, raw);
    }

    function computeClient(): void {
        const quickTest = state.quick ? testFor(state.quick) : null;
        const tests = state.filters.map(testFor);
        const any = state.match === 'any';
        const filtered = source.filter((row) => {
            if (quickTest && !quickTest(row)) return false;
            if (!tests.length) return true;
            return any ? tests.some((t) => t(row)) : tests.every((t) => t(row));
        });
        view.total = filtered.length;
        clampPage();

        let ordered = filtered;
        if (state.sorts.length) {
            const specs = state.sorts.map((s) => ({col: colMap.get(s.field)!, dir: s.dir === 'desc' ? -1 : 1}));
            const keyed = filtered.map((row) => ({row, keys: specs.map((s) => sortKey(s.col, row))}));
            keyed.sort((x, y) => {
                for (let i = 0; i < specs.length; i += 1) {
                    const a = x.keys[i];
                    const b = y.keys[i];
                    if (a === b) continue;
                    if (a === null) return 1; // empty values always last
                    if (b === null) return -1;
                    const c = compareValues(a, b);
                    if (c) return c * specs[i].dir;
                }
                return 0;
            });
            ordered = keyed.map((k) => k.row);
        }
        const start = (state.page - 1) * state.pageSize;
        view.rows = ordered.slice(start, start + state.pageSize);
        view.error = null;
    }

    async function fetchServer(): Promise<boolean> {
        abortCtl?.abort();
        abortCtl = new AbortController();
        const mine = ++reqSeq;
        view.loading = true;
        renderBusy();
        try {
            const fetchRows = opts.data as (query: Query) => Promise<{ rows: R[]; total: number }>;
            const res = await fetchRows({
                page: state.page, pageSize: state.pageSize,
                sorts: state.sorts.map((s) => ({...s})),
                filters: state.filters.map(cleanCondition), match: state.match,
                quick: state.quick ? cleanCondition(state.quick) : null,
                signal: abortCtl.signal,
            });
            if (mine !== reqSeq) return false;
            if (!res || !Array.isArray(res.rows) || !Number.isFinite(res.total) || res.total < 0) {
                throw new Error('Invalid response from data source');
            }
            view.rows = res.rows;
            view.total = res.total;
            view.error = null;
            clampPage();
        } catch (err) {
            if ((err as Error)?.name === 'AbortError' || mine !== reqSeq) return false;
            view.rows = [];
            view.error = err instanceof Error ? err : new Error(String(err));
        }
        view.loading = false;
        return true;
    }

    function clampPage(): void {
        const pages = Math.max(1, Math.ceil(view.total / state.pageSize));
        state.page = Math.min(Math.max(1, state.page), pages);
    }

    const totalPages = () => Math.max(1, Math.ceil(view.total / state.pageSize));

    async function update(): Promise<void> {
        if (serverMode) {
            if (!await fetchServer()) return;
        } else {
            computeClient();
        }
        render();
    }

    function commit(): void {
        hideNotice();
        persist();
        void update();
        opts.onStateChange?.(snapshot());
    }

    /*  DOM skeleton  */
    const root = el('section', {class: 'dt', id: uid, 'aria-label': label});

    const quickForm = el('form', {
        class: 'dt-search',
        role: 'search',
        novalidate: true,
        'aria-label': `Search ${label}`,
    });
    const quickSlot = el('div', {class: 'dt-search-fields'});
    const quickSubmit = el('button', {class: 'btn btn--primary btn--sm', type: 'submit'}, [icon('search'), 'Search']);
    quickForm.append(quickSlot, quickSubmit);

    type ToolId = 'filters' | 'sorting' | 'columns';
    const toolButtons = {} as Record<ToolId, { btn: HTMLButtonElement; badge: HTMLSpanElement }>;
    const tool = (id: ToolId, text: string, iconName: IconName, onClick: () => void) => {
        const badge = el('span', {class: 'dt-badge', hidden: true});
        const btn = el('button', {
            class: 'btn btn--ghost btn--sm',
            type: 'button',
            onClick,
        }, [icon(iconName), text, badge]);
        toolButtons[id] = {btn, badge};
        return btn;
    };
    const tools = el('div', {class: 'dt-tools'}, [
        tool('filters', 'Filters', 'filter', openFilters),
        tool('sorting', 'Sorting', 'sort', openSorting),
        tool('columns', 'Columns', 'columns', openColumns),
    ]);

    const toolbar = el('div', {class: 'dt-toolbar'}, [quickForm, tools]);
    const notice = el('div', {class: 'dt-notice', role: 'alert', hidden: true});
    const chips = el('ul', {class: 'dt-chips', 'aria-label': 'Active filters and sorting', hidden: true});

    function showNotice(title: string, errors: string[]): void {
        notice.replaceChildren(
            el('div', {class: 'dt-notice__body'}, [
                el('strong', {}, title),
                errors.length ? el('ul', {}, errors.map((m) => el('li', {}, m))) : null,
            ]),
            iconButton('x', 'Dismiss', hideNotice),
        );
        notice.hidden = false;
    }

    function hideNotice(): void {
        notice.hidden = true;
        notice.replaceChildren();
    }

    const thead = el('thead');
    const tbody = el('tbody');
    const table = el('table', {class: 'dt-table'}, [el('caption', {class: 'dt-sr'}, label), thead, tbody]);
    const scroll = el('div', {
        class: 'dt-scroll',
        role: 'region',
        tabindex: '0',
        'aria-label': `${label} table`,
    }, table);
    if (opts.maxHeight) scroll.style.setProperty('--dt-max-height', opts.maxHeight);
    if (opts.minHeight) scroll.style.setProperty('--dt-min-height', opts.minHeight);

    // footer
    const sizeSelect = select(opts.pageSizes.map((n) => [String(n), String(n)]), String(state.pageSize), 'Rows per page', (v) => {
        state.pageSize = Number(v);
        state.page = 1;
        commit();
    });
    const rangeText = el('span', {class: 'dt-range', 'aria-live': 'polite'});
    const pageInput = el('input', {
        class: 'dt-page-input',
        type: 'number',
        min: '1',
        step: '1',
        'aria-label': 'Page number',
        inputmode: 'numeric',
    });
    const pageTotal = el('span', {class: 'dt-page-total'});

    const pageErrId = `${uid}-page-err`;
    const pageError = el('p', {class: 'field-error dt-page-error', id: pageErrId, role: 'alert', hidden: true});
    const setPageError = (msg: string | null) => {
        pageError.textContent = msg || '';
        pageError.hidden = !msg;
        if (msg) {
            pageInput.setAttribute('aria-invalid', 'true');
            pageInput.setAttribute('aria-describedby', pageErrId);
        } else {
            pageInput.removeAttribute('aria-invalid');
            pageInput.removeAttribute('aria-describedby');
        }
    };

    const goTo = (p: number) => {
        const next = Math.min(Math.max(1, Math.trunc(p) || 1), totalPages());
        if (next === state.page) {
            pageInput.value = String(state.page);
            return;
        }
        state.page = next;
        commit();
    };
    pageInput.addEventListener('input', () => setPageError(null));
    pageInput.addEventListener('change', () => {
        const raw = pageInput.value.trim();
        const n = Number(raw);
        const pages = totalPages();
        if (pageInput.validity.badInput) return setPageError('Page must be a whole number.');
        if (raw === '') return setPageError('Enter a page number.');
        if (!Number.isInteger(n)) return setPageError('Page must be a whole number.');
        if (n < 1 || n > pages) return setPageError(`Page must be between 1 and ${pages}.`);
        setPageError(null);
        goTo(n);
    });
    const pagerBtn = (name: IconName, text: string, onClick: () => void) => iconButton(name, text, onClick);
    const btnFirst = pagerBtn('first', 'First page', () => goTo(1));
    const btnPrev = pagerBtn('prev', 'Previous page', () => goTo(state.page - 1));
    const btnNext = pagerBtn('next', 'Next page', () => goTo(state.page + 1));
    const btnLast = pagerBtn('last', 'Last page', () => goTo(totalPages()));
    const pager = el('nav', {class: 'dt-pager', 'aria-label': `${label} pagination`}, [
        btnFirst, btnPrev,
        el('label', {class: 'dt-page-label'}, ['Page', pageInput, pageTotal]),
        btnNext, btnLast,
    ]);
    const footer = el('div', {class: 'dt-footer'}, [
        el('label', {class: 'dt-size'}, ['Rows per page', sizeSelect]),
        rangeText, pager, pageError,
    ]);

    // shared row-action menu
    const menu = el('div', {class: 'dt-menu', role: 'menu', popover: 'auto', 'aria-label': 'Row actions'});
    const menuRows = new WeakMap<HTMLButtonElement, R>();
    let menuOpener: HTMLButtonElement | null = null;
    let menuClosedAt = 0;
    let menuClosedFor: HTMLButtonElement | null = null;

    root.append(toolbar, notice, chips, scroll, footer, menu);
    host.replaceChildren(root);

    /*  quick search  */
    function drawQuick(): void {
        quickForm.hidden = !quickDraft;
        if (!quickDraft) return;
        quickRow = buildCondition(quickDraft, quickCols, {label: 'Search'});
        quickSlot.replaceChildren(quickRow);
    }

    quickForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!quickRow || !quickDraft) return;
        if (!quickRow.validate()) {
            quickRow.querySelector<HTMLElement>('.dt-slot--values :is(input, select)')?.focus();
            return;
        }
        state.quick = cleanCondition(quickDraft);
        state.page = 1;
        commit();
    });

    /*  header / body  */
    function renderHead(): void {
        const cells = visibleCols().map((col) => {
            const idx = state.sorts.findIndex((s) => s.field === col.key);
            const dir = idx >= 0 ? state.sorts[idx].dir : null;
            const th = el('th', {
                scope: 'col', 'data-align': col.align,
                'aria-sort': dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined,
                style: [
                    col.width && `width:${col.width}`,
                    col.minWidth && `min-width:${col.minWidth}`,
                    col.maxWidth && `max-width:${col.maxWidth}`,
                ].filter(Boolean).join(';') || undefined,
            });
            if (!col.sortable) {
                th.append(col.label);
            } else {
                const btn = el('button', {
                    class: 'dt-sort', type: 'button',
                    title: `Sort by ${col.label} (Shift+click adds a secondary sort)`,
                    onClick: (e: MouseEvent) => toggleSort(col.key, e.shiftKey),
                }, [
                    el('span', {}, col.label),
                    el('span', {class: 'dt-carets', 'aria-hidden': 'true'}, [
                        el('span', {class: 'dt-caret dt-caret--up'}, icon('up', 10)),
                        el('span', {class: 'dt-caret dt-caret--down'}, icon('down', 10)),
                    ]),
                    state.sorts.length > 1 && idx >= 0 ? el('sup', {class: 'dt-sort-rank'}, String(idx + 1)) : null,
                ]);
                th.append(btn);
            }
            return th;
        });
        if (rowActions) {
            cells.push(el('th', {scope: 'col', class: 'dt-col-actions'}, el('span', {class: 'dt-sr'}, 'Actions')));
        }
        thead.replaceChildren(el('tr', {}, cells));
    }

    function toggleSort(field: string, additive: boolean): void {
        const idx = state.sorts.findIndex((s) => s.field === field);
        const cur = idx >= 0 ? state.sorts[idx].dir : null;
        const next: SortDir | null = cur === null ? 'asc' : cur === 'asc' ? 'desc' : null;
        if (!additive) {
            state.sorts = next ? [{field, dir: next}] : [];
        } else if (idx >= 0) {
            if (next) state.sorts[idx].dir = next;
            else state.sorts.splice(idx, 1);
        } else {
            state.sorts.push({field, dir: 'asc'});
        }
        state.page = 1;
        commit();
    }

    function cellContent(col: Column<R>, row: R): Node | string {
        const raw = col.accessor(row);
        if (col.render) return col.render(row, raw);
        const text = displayText(col, raw, row);
        return text === '' ? el('span', {class: 'dt-null', 'aria-label': 'empty'}, '–') : text;
    }

    function renderBody(): void {
        const cols = visibleCols();
        const span = cols.length + (rowActions ? 1 : 0);
        tbody.replaceChildren();

        if (view.error) {
            tbody.append(el('tr', {}, el('td', {class: 'dt-state', colspan: span}, [
                el('p', {role: 'alert'}, `Could not load data${view.error.message ? `: ${view.error.message}` : '.'}`),
                el('button', {class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => update()}, 'Retry'),
            ])));
            return;
        }
        if (!view.rows.length) {
            const filtered = state.quick || state.filters.length;
            tbody.append(el('tr', {}, el('td', {class: 'dt-state', colspan: span}, [
                el('p', {}, filtered ? 'No records match the current filters.' : opts.emptyMessage),
                filtered ? el('button', {
                    class: 'btn btn--ghost btn--sm',
                    type: 'button',
                    onClick: clearFilters,
                }, 'Clear filters') : null,
            ])));
            return;
        }

        const rows = view.rows.map((row) => {
            const cells = cols.map((col) => {
                const td = el('td', {'data-align': col.align, 'data-label': col.label}, cellContent(col, row));
                if (col.wrap) td.classList.add('dt-wrap');
                if (col.minWidth) td.style.minWidth = col.minWidth;
                if (col.maxWidth) {
                    td.classList.add('dt-clip');
                    td.style.maxWidth = col.maxWidth;
                    td.title = td.textContent ?? '';
                }
                return td;
            });
            if (rowActions) {
                const actions = rowActions(row, api) || [];
                const name = opts.rowLabel ? opts.rowLabel(row) : displayText(cols[0], cols[0].accessor(row), row);
                const td = el('td', {class: 'dt-col-actions'});
                if (actions.length) {
                    const btn = el('button', {
                        class: 'dt-icon-btn dt-kebab', type: 'button',
                        'aria-label': `Actions for ${name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
                    }, icon('kebab'));
                    menuRows.set(btn, row);
                    td.append(btn);
                }
                cells.push(td);
            }
            return el('tr', {'data-row-id': String(opts.rowId(row))}, cells);
        });
        tbody.append(...rows);
    }

    function renderBusy(): void {
        scroll.setAttribute('aria-busy', String(view.loading));
        root.classList.toggle('dt--loading', view.loading);
    }

    /*  chips  */
    function describe(cond: Condition): string {
        const col: Field = cond.field === '' ? ANY : colMap.get(cond.field)!;
        const o = findOp(col, cond.op);
        const fmt = (v: string) => (col.type === 'text' || col === ANY ? `“${v}”` : displayText(col as Column<R>, v, null));
        let text = `${col.label} ${o.label}`;
        if (o.arity >= 1) text += ` ${fmt(cond.value)}`;
        if (o.arity === 2) text += ` and ${fmt(cond.value2)}`;
        return text;
    }

    // The search is ANDed with the filters, which are combined by `match`.
    function describeFilters(): string {
        const parts = state.filters.map(describe);
        const joiner = state.match === 'any' ? ' or ' : ' and ';
        let text = parts.join(joiner);
        if (state.quick) {
            const grouped = state.match === 'any' && parts.length > 1 ? `(${text})` : text;
            text = parts.length ? `${describe(state.quick)} and ${grouped}` : describe(state.quick);
        }
        return text;
    }

    function describeSorts(): string {
        return state.sorts.map((s) => `${colMap.get(s.field)!.label} ${s.dir === 'asc' ? 'ascending' : 'descending'}`)
            .join(', ');
    }

    function renderChips(): void {
        const items: HTMLLIElement[] = [];
        const chip = (kind: string, text: string, onEdit: () => void, clearLabel: string, onClear: () => void) => el('li', {class: 'dt-chip'}, [
            el('button', {
                class: 'dt-chip__edit', type: 'button', title: `Edit ${kind.toLowerCase()}`, onClick: onEdit,
            }, [el('strong', {}, `${kind}:`), ` ${text}`]),
            iconButton('x', clearLabel, onClear),
        ]);
        if (state.quick || state.filters.length) {
            items.push(chip('Filter', describeFilters(), openFilters, 'Clear filters', clearFilters));
        }
        if (state.sorts.length) {
            items.push(chip('Sort', describeSorts(), openSorting, 'Clear sorting', () => {
                state.sorts = [];
                state.page = 1;
                commit();
            }));
        }
        if (items.length > 1) {
            items.push(el('li', {}, el('button', {
                class: 'btn btn--ghost btn--sm',
                type: 'button',
                onClick: clearAll,
            }, 'Clear all')));
        }
        chips.replaceChildren(...items);
        chips.hidden = !items.length;
    }

    function resetQuick(): void {
        state.quick = null;
        quickDraft = freshQuick();
        drawQuick();
    }

    function clearFilters(): void {
        resetQuick();
        state.filters = [];
        state.page = 1;
        commit();
    }

    function clearAll(): void {
        resetQuick();
        state.filters = [];
        state.sorts = [];
        state.page = 1;
        commit();
    }

    /*  footer + toolbar badges  */
    function renderFooter(): void {
        setPageError(null);
        const {total} = view;
        const start = total ? (state.page - 1) * state.pageSize + 1 : 0;
        const end = Math.min(state.page * state.pageSize, total);
        rangeText.textContent = total ? `${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}` : 'No results';
        const pages = totalPages();
        pageInput.value = String(state.page);
        pageInput.max = String(pages);
        pageInput.disabled = pages === 1;
        pageTotal.textContent = `of ${pages.toLocaleString()}`;
        btnFirst.disabled = btnPrev.disabled = state.page <= 1;
        btnNext.disabled = btnLast.disabled = state.page >= pages;
        sizeSelect.value = String(state.pageSize);
    }

    function renderBadges(): void {
        const set = (id: ToolId, n: number, what: string) => {
            toolButtons[id].badge.replaceChildren(String(n), el('span', {class: 'dt-sr'}, ` ${what}`));
            toolButtons[id].badge.hidden = !n;
        };
        set('filters', state.filters.length + (state.quick ? 1 : 0), 'active filters');
        set('sorting', state.sorts.length, 'active sorts');
        // Akiba: the badge counts the columns on show, not the hidden ones (survey-pad counts hidden).
        set('columns', columns.length - state.hidden.size, 'visible columns');
        toolButtons.filters.btn.disabled = !filterCols.length;
        toolButtons.sorting.btn.disabled = !sortCols.length;
        toolButtons.columns.btn.disabled = !columns.some((c) => c.hideable);
    }

    function render(): void {
        renderBusy();
        renderHead();
        renderBody();
        renderChips();
        renderFooter();
        renderBadges();
    }

    /*  panels  */
    function openFilters(): void {
        // the active search is listed first; applying turns it into a regular filter
        const draft = [state.quick, ...state.filters].filter((f): f is Condition => !!f).map((f) => ({...f}));
        let match = state.match;
        const list = el('div', {class: 'dt-conds'});
        const error = el('p', {class: 'field-error', role: 'alert', hidden: true});
        const matchRow = el('label', {class: 'dt-match'}, [
            'Show records matching',
            select([['all', 'all filters'], ['any', 'any filter']], match, 'Combine filters', (v) => {
                match = v as Match;
            }),
        ]);
        const empty = el('p', {class: 'dt-hint'}, 'No filters yet.');

        const draw = () => {
            list.replaceChildren(...draft.map((c, i) => buildCondition(c, quickCols, {
                label: `Filter ${i + 1}`,
                onTouch: () => {
                    error.hidden = true;
                },
                onRemove: () => {
                    draft.splice(i, 1);
                    draw();
                },
            })));
            matchRow.hidden = draft.length < 2;
            empty.hidden = draft.length > 0;
            error.hidden = true;
        };
        const add = () => {
            draft.push(newCondition(filterCols[0]));
            draw();
            list.lastElementChild?.querySelector('select')?.focus();
        };
        draw();

        const body = el('div', {class: 'dt-panel'}, [
            matchRow, list, empty,
            el('button', {class: 'btn btn--ghost btn--sm', type: 'button', onClick: add}, [icon('plus'), 'Add filter']),
            error,
        ]);

        openDialog(root, {
            title: 'Filters', size: 'lg', body, resetLabel: 'Clear filters',
            onReset: () => {
                draft.length = 0;
                draw();
            },
            onApply: () => {
                const rows = [...list.children] as ConditionRow[];
                const results = rows.map((r) => r.validate()); // validate all, so every error shows at once
                const bad = results.filter((ok) => !ok).length;
                if (bad) {
                    error.textContent = bad === 1 ? 'Fix the highlighted filter.' : `Fix the ${bad} highlighted filters.`;
                    error.hidden = false;
                    rows[results.indexOf(false)].querySelector<HTMLElement>('.dt-slot--values :is(input, select)')?.focus();
                    return false;
                }
                resetQuick();
                state.filters = draft.map(cleanCondition);
                state.match = match;
                state.page = 1;
                commit();
                return true;
            },
        });
    }

    const ORDER_LABELS: Record<ColumnType, [string, string]> = {
        text: ['A → Z', 'Z → A'], number: ['Lowest first', 'Highest first'],
        date: ['Oldest first', 'Newest first'], datetime: ['Oldest first', 'Newest first'],
        boolean: ['No first', 'Yes first'], enum: ['A → Z', 'Z → A'],
    };

    function openSorting(): void {
        const draft = state.sorts.map((s) => ({...s}));
        const list = el('div', {class: 'dt-conds'});
        const empty = el('p', {class: 'dt-hint'}, 'No sorting applied. Records appear in their original order.');

        const draw = () => {
            list.replaceChildren(...draft.map((s, i) => {
                const used = new Set(draft.filter((_, j) => j !== i).map((d) => d.field));
                const avail = sortCols.filter((c) => !used.has(c.key));
                const orderSlot = el('span', {class: 'dt-slot'});
                const drawOrder = () => {
                    const [asc, desc] = ORDER_LABELS[colMap.get(s.field)!.type];
                    orderSlot.replaceChildren(select([['asc', asc], ['desc', desc]], s.dir, 'Order', (v) => {
                        s.dir = v as SortDir;
                    }));
                };
                const colSel = select(avail.map((c) => [c.key, c.label]), s.field, 'Column', (v) => {
                    s.field = v;
                    drawOrder();
                    draw();
                });
                drawOrder();
                return el('div', {
                    class: 'dt-cond dt-cond--sort',
                    role: 'group',
                    'aria-label': i === 0 ? 'Primary sort' : `Then by ${i}`,
                }, [
                    el('span', {class: 'dt-rank'}, i === 0 ? 'Sort by' : 'Then by'),
                    colSel, orderSlot,
                    iconButton('trash', 'Remove sort', () => {
                        draft.splice(i, 1);
                        draw();
                    }, 'dt-icon-btn--danger'),
                ]);
            }));
            empty.hidden = draft.length > 0;
            addBtn.disabled = draft.length >= sortCols.length;
        };
        const addBtn = el('button', {
            class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => {
                const used = new Set(draft.map((d) => d.field));
                const next = sortCols.find((c) => !used.has(c.key));
                if (!next) return;
                draft.push({field: next.key, dir: 'asc'});
                draw();
                list.lastElementChild?.querySelector('select')?.focus();
            },
        }, [icon('plus'), 'Add sort']);
        draw();

        openDialog(root, {
            title: 'Sorting', body: el('div', {class: 'dt-panel'}, [list, empty, addBtn]),
            resetLabel: 'Clear sorting',
            onReset: () => {
                draft.length = 0;
                draw();
            },
            onApply: () => {
                state.sorts = draft.map((s) => ({...s}));
                state.page = 1;
                commit();
                return true;
            },
        });
    }

    function openColumns(): void {
        const draft = new Set(state.hidden);
        const boxes: { box: HTMLInputElement; col: Column<R> }[] = [];
        const sync = () => {
            const visible = columns.filter((c) => !draft.has(c.key));
            boxes.forEach(({box, col}) => {
                box.checked = !draft.has(col.key);
                // the last visible column can't be hidden, and locked columns never can
                box.disabled = !col.hideable || (box.checked && visible.length === 1);
            });
        };
        const fieldset = el('fieldset', {class: 'dt-columns'}, [
            el('legend', {class: 'dt-sr'}, 'Visible columns'),
            ...columns.map((col) => {
                const box = el('input', {type: 'checkbox'});
                box.addEventListener('change', () => {
                    if (box.checked) draft.delete(col.key);
                    else draft.add(col.key);
                    sync();
                });
                boxes.push({box, col});
                return el('label', {class: 'choice-option'}, [box, el('span', {}, col.label)]);
            }),
        ]);
        const hint = el('p', {class: 'dt-hint'}, 'At least one column must stay visible.');
        const error = el('p', {class: 'field-error', role: 'alert', hidden: true});
        sync();

        openDialog(root, {
            title: 'Columns', size: 'sm', body: el('div', {class: 'dt-panel'}, [fieldset, hint, error]),
            resetLabel: 'Reset to default',
            onReset: () => {
                draft.clear();
                columns.filter((c) => c.hidden).forEach((c) => draft.add(c.key));
                error.hidden = true;
                sync();
            },
            onApply: () => {
                const errors = validateHidden([...draft]);
                if (errors.length) {
                    error.textContent = errors.join(' ');
                    error.hidden = false;
                    return false;
                }
                state.hidden = draft;
                commit();
                return true;
            },
        });
    }

    /*  row action menu  */
    function buildMenuItem(action: RowAction<R>, row: R): HTMLElement {
        const cls = `dt-menu__item${action.danger ? ' dt-menu__item--danger' : ''}`;
        const common = {class: cls, role: 'menuitem', tabindex: '-1', title: action.title};
        const done = () => menu.hidePopover();
        if (action.href && !action.disabled) {
            return el('a', {...common, href: action.href, onClick: done}, action.label);
        }
        return el('button', {
            ...common, type: 'button', disabled: action.disabled || undefined,
            onClick: () => {
                done();
                Promise.resolve(action.onSelect?.(row, api)).catch((err) => console.error('DataTable action failed', err));
            },
        }, action.label);
    }

    function openMenu(btn: HTMLButtonElement): void {
        const row = menuRows.get(btn);
        if (row === undefined || !rowActions) return;
        const actions = (rowActions(row, api) || []).filter((a): a is RowAction<R> => !!a);
        if (!actions.length) return;
        menu.replaceChildren(...actions.flatMap((a) => [
            a.separatorBefore ? el('div', {role: 'separator', class: 'dt-menu__sep'}) : null,
            buildMenuItem(a, row),
        ]).filter((n): n is HTMLElement => !!n));
        if (menu.matches(':popover-open')) menu.hidePopover();
        menuOpener = btn;
        btn.setAttribute('aria-expanded', 'true');
        menu.showPopover();

        const r = btn.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        let top = r.bottom + 4;
        if (top + m.height > window.innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
        const left = Math.min(Math.max(8, r.right - m.width), window.innerWidth - m.width - 8);
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')?.focus();
    }

    tbody.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLButtonElement>('.dt-kebab');
        if (!btn) return;
        // light-dismiss already closed the menu on this same click: treat it as a toggle
        if (menuClosedFor === btn && performance.now() - menuClosedAt < 250) return;
        openMenu(btn);
    });

    menu.addEventListener('toggle', (e) => {
        if ((e as ToggleEvent).newState !== 'closed' || !menuOpener) return;
        menuOpener.setAttribute('aria-expanded', 'false');
        menuClosedFor = menuOpener;
        menuClosedAt = performance.now();
        menuOpener = null;
    });

    menu.addEventListener('keydown', (e) => {
        const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const focusAt = (n: number) => items[(n + items.length) % items.length]?.focus();
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                focusAt(i + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                focusAt(i - 1);
                break;
            case 'Home':
                e.preventDefault();
                focusAt(0);
                break;
            case 'End':
                e.preventDefault();
                focusAt(items.length - 1);
                break;
            case 'Tab':
                menu.hidePopover();
                break;
            default:
        }
    });

    /*  public API  */
    const api: DataTable<R> = {
        element: root,
        setRows(rows) {
            source = Array.isArray(rows) ? rows : [];
            return update();
        },
        refresh: () => update(),
        getState: snapshot,
        /** Atomic: if any part of the patch is invalid, nothing is applied, the errors are shown and returned. */
        setState(patch = {}) {
            const errors: string[] = [];
            if ('sorts' in patch) errors.push(...validateSorts(patch.sorts));
            if ('filters' in patch) errors.push(...validateFilters(patch.filters));
            if ('match' in patch && patch.match !== 'any' && patch.match !== 'all') {
                errors.push('match must be "all" or "any".');
            }
            if (patch.quick) {
                const err = validateCondition(patch.quick, quickCols);
                if (err) errors.push(`Search: ${err}`);
            }
            if ('pageSize' in patch && !opts.pageSizes.includes(patch.pageSize as number)) {
                errors.push(`pageSize must be one of ${opts.pageSizes.join(', ')}.`);
            }
            if ('page' in patch && !(Number.isInteger(patch.page) && (patch.page as number) >= 1)) {
                errors.push('page must be a positive integer.');
            }
            if ('hidden' in patch) errors.push(...validateHidden(patch.hidden));

            if (errors.length) {
                showNotice('Could not apply the requested view state:', errors);
                return {ok: false, errors};
            }

            if ('sorts' in patch) state.sorts = (patch.sorts as Sort[]).map(({field, dir}) => ({field, dir}));
            if ('filters' in patch) state.filters = (patch.filters as Condition[]).map(cleanCondition);
            if ('match' in patch) state.match = patch.match as Match;
            if ('quick' in patch) state.quick = patch.quick ? cleanCondition(patch.quick as Condition) : null;
            if ('pageSize' in patch) state.pageSize = patch.pageSize as number;
            if ('page' in patch) state.page = patch.page as number;
            if ('hidden' in patch) state.hidden = new Set(patch.hidden as string[]);
            commit();
            return {ok: true, errors: []};
        },
        destroy() {
            abortCtl?.abort();
            reqSeq += 1;
            root.remove();
        },
    };

    restore();
    drawQuick();
    void update();
    return api;
}
