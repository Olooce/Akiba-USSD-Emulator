import {createDataTable, type TableState} from './dataTable.js';
import type {LogRecord, Status} from './engine.js';
import {createIndexedDbLogRepo} from './logRepo.js';
import {COPY, type Lang} from './messages.js';

const LANG_STORAGE_KEY = 'akiba-emulator-lang';
const CSV_FIELDS: (keyof LogRecord)[] = [
    'sessionId', 'phoneNumber', 'screenId', 'timestamp', 'input', 'selectedValue', 'nextScreenId', 'page', 'lang', 'status',
];
const STATUSES: Status[] = ['continue', 'end', 'invalid', 'cancelled', 'timeout'];

/** A log record plus its position in the session, for replaying the path. */
type Row = LogRecord & { id: string; step: number };

const repo = createIndexedDbLogRepo();

function required<T extends Element>(selector: string): T {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Missing log page element: ${selector}`);
    return el;
}

function readLang(): Lang {
    try {
        return localStorage.getItem(LANG_STORAGE_KEY) === 'sw' ? 'sw' : 'en';
    } catch {
        return 'en';
    }
}

/** Message IDs are stored so records do not depend on language; show them as text here. */
function label(value: string | null, lang: Lang): string {
    if (value === null) return '';
    const ussd = COPY[lang].ussd as Record<string, string>;
    return value in ussd ? ussd[value].replace(/\n/g, ' ') : value;
}

function toCsv(records: LogRecord[]): string {
    const escape = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [CSV_FIELDS.join(','), ...records.map((r) => CSV_FIELDS.map((f) => escape(r[f])).join(','))].join('\n');
}

function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
    const a = Object.assign(document.createElement('a'), {href: url, download: name});
    a.click();
    URL.revokeObjectURL(url);
}

/** Numbers each record within its session, oldest first. */
function withSteps(records: LogRecord[]): Row[] {
    const counts = new Map<string, number>();
    return records
        .slice()
        .reverse()
        .map((r, i) => {
            const step = (counts.get(r.sessionId) ?? 0) + 1;
            counts.set(r.sessionId, step);
            return {...r, id: String(i), step};
        })
        .reverse();
}

/** `dial → enterPin → main → …` for one session. */
function pathOf(rows: Row[]): string {
    const steps = rows.slice().sort((a, b) => a.step - b.step);
    const path = [steps[0]?.screenId ?? 'dial', ...steps.map((r) => r.nextScreenId ?? 'END')];
    return path.filter((s, i) => s !== path[i - 1]).join(' → ');
}

const sessionFilter = (state: TableState): string | null =>
    state.filters.length === 1 && state.filters[0].field === 'sessionId' && state.filters[0].op === 'eq' && !state.quick
        ? state.filters[0].value
        : null;

async function init(): Promise<void> {
    const count = required<HTMLElement>('[data-log-count]');
    const path = required<HTMLElement>('[data-log-path]');
    const clear = required<HTMLButtonElement>('[data-log-clear]');
    const exportCsv = required<HTMLButtonElement>('[data-log-export]');
    const refreshBtn = required<HTMLButtonElement>('[data-log-refresh]');
    const langSelect = required<HTMLSelectElement>('[data-log-lang]');
    let lang = readLang();
    let records: LogRecord[] = [];
    let rows: Row[] = [];
    langSelect.value = lang;

    const showPath = (state: TableState) => {
        const id = sessionFilter(state);
        const session = id ? rows.filter((r) => r.sessionId === id) : [];
        path.hidden = !session.length;
        path.textContent = session.length ? `Path: ${pathOf(session)}` : '';
    };

    const table = createDataTable<Row>({
        container: '[data-log-table]',
        label: 'Session log',
        rowId: (r) => r.id,
        rowLabel: (r) => `step ${r.step} of session ${r.sessionId.slice(0, 8)}`,
        pageSizes: [10, 25, 50, 100],
        pageSize: 25,
        sorts: [{field: 'timestamp', dir: 'desc'}],
        persistKey: 'akiba:dt:session-log',
        emptyMessage: `No records yet. Dial the service code on the emulator.`,
        maxHeight: '65vh',
        columns: [
            {
                key: 'timestamp',
                label: 'Time',
                type: 'datetime',
                dateFormat: {dateStyle: 'short', timeStyle: 'medium'},
                locale: 'en-KE'
            },
            {key: 'sessionId', label: 'Session', format: (raw) => String(raw ?? '').slice(0, 8), maxWidth: '7rem'},
            {key: 'step', label: 'Step', type: 'number'},
            {key: 'phoneNumber', label: 'Phone number', hidden: true},
            {key: 'screenId', label: 'Screen', format: (raw) => String(raw ?? 'dial')},
            {key: 'input', label: 'Input'},
            {
                key: 'selectedValue',
                label: 'Selected',
                format: (raw) => label(raw as string | null, lang),
                maxWidth: '14rem'
            },
            {key: 'nextScreenId', label: 'Next screen', format: (raw) => String(raw ?? 'END')},
            {key: 'page', label: 'Page', type: 'number', format: (raw) => String(Number(raw) + 1), hidden: true},
            {
                key: 'lang',
                label: 'Lang',
                type: 'enum',
                options: [{value: 'en', label: 'EN'}, {value: 'sw', label: 'SW'}]
            },
            {
                key: 'status', label: 'Status', type: 'enum', options: STATUSES,
                render: (r) => Object.assign(document.createElement('span'), {
                    className: `log-status log-status--${r.status}`,
                    textContent: r.status
                }),
            },
        ],
        rowActions: (row, t) => [
            {
                label: 'Replay this session',
                title: 'Show only this session, in the order it happened',
                onSelect: () => t.setState({
                    filters: [{field: 'sessionId', op: 'eq', value: row.sessionId, value2: ''}],
                    quick: null,
                    sorts: [{field: 'step', dir: 'asc'}],
                    page: 1,
                }),
            },
            {
                label: 'Copy session ID',
                onSelect: () => navigator.clipboard?.writeText(row.sessionId),
            },
        ],
        onStateChange: showPath,
    });

    const load = async () => {
        records = await repo.query();
        rows = withSteps(records);
        await table.setRows(rows);
        const sessions = new Set(records.map((r) => r.sessionId)).size;
        count.textContent = `${records.length} records in ${sessions} sessions`;
        showPath(table.getState());
    };

    langSelect.addEventListener('change', () => {
        lang = langSelect.value === 'sw' ? 'sw' : 'en';
        void table.refresh();
    });
    refreshBtn.addEventListener('click', () => void load());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void load();
    });
    exportCsv.addEventListener('click', () => download(`akiba-session-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(records)));

    // Two clicks to clear, instead of a blocking confirm() dialog.
    let armed: ReturnType<typeof setTimeout> | undefined;
    clear.addEventListener('click', async () => {
        if (!armed) {
            clear.textContent = 'Click again to clear';
            armed = setTimeout(() => {
                armed = undefined;
                clear.textContent = 'Clear log';
            }, 3_000);
            return;
        }
        clearTimeout(armed);
        armed = undefined;
        clear.textContent = 'Clear log';
        await repo.clear();
        await load();
    });

    await load();
}

void init();
