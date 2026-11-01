import {type Action, actions} from './actions.js';
import {config} from './config.js';
import {type Encoding, fitsUssd, measureUssd} from './encoding.js';
import {type DisplayGrid, displayRows, fitsDisplay} from './lcdGrid.js';
import {format, formatters, formattersIn} from './formatters.js';
import {COPY, type Copy, type MessageId} from './messages.js';
import {type Resolver, resolvers} from './resolvers.js';
import {type Option, type Registry, registry as defaultRegistry, SAMPLE_DATA, type Screen} from './screens.js';
import type {Account, Lang, Msg, Notice, SessionData, Vars} from './types.js';
import {type Guard, guards, type Validator, validators} from './validators.js';

export type Status = 'continue' | 'end' | 'invalid' | 'cancelled' | 'timeout';
export type Expiry = 'inactivity' | 'duration';

const KEY_BACK = '0';
const KEY_HOME = '00';
const KEY_MORE = '98';
const RESERVED_KEYS: ReadonlySet<string> = new Set([KEY_BACK, KEY_HOME, KEY_MORE]);
/** USSD shows typed digits as they are; secret inputs are only kept out of storage and the log. */
const REDACTED = '****';
/** Errors a paginated screen can show in place of its title. */
const PAGE_ERRORS: readonly MessageId[] = ['error.choice', 'error.input'];

export interface Session {
    readonly id: string;
    readonly account: Account;
    data: SessionData;
    screen: string;
    history: string[];
    page: number;
    open: boolean;
    error?: Msg;
    /** The END message once the session is closed. */
    final?: Msg;
    startedAt: number;
    lastActivityAt: number;
}

export interface Outcome {
    status: Status;
    notice?: Notice;
    transactional: boolean;
    expiry?: Expiry;
}

export interface Rendered {
    type: 'CON' | 'END';
    text: string;
    encoding: Encoding;
    maxInput: number;
}

export interface LogRecord {
    sessionId: string;
    phoneNumber: string;
    screenId: string | null;
    timestamp: string;
    input: string;
    selectedValue: string | null;
    nextScreenId: string | null;
    page: number;
    lang: Lang;
    status: Status;
}

export interface LogSink {
    add(record: LogRecord): Promise<void>;
}

export interface Registries {
    actions: Record<string, Action>;
    validators: Record<string, Validator>;
    guards: Record<string, Guard>;
    resolvers: Record<string, Resolver>;
    formatters: Record<string, unknown>;
}

const DEFAULT_REGISTRIES: Registries = {actions, validators, guards, resolvers, formatters};

export interface EngineOptions {
    registry?: Registry;
    registries?: Registries;
    copies?: Record<Lang, Copy>;
    log?: LogSink;
    now?: () => number;
    newId?: () => string;
}

const sortedKeys = (options: Record<string, Option>) => Object.keys(options).sort((a, b) => Number(a) - Number(b));

function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

const SESSION_GRID: DisplayGrid = {columns: config.display.columns, rows: config.display.sessionRows};
const MESSAGE_GRID: DisplayGrid = {columns: config.display.columns, rows: config.display.messageRows};

/** `98. More 0. Back` on one row while there is a next page, `0. Back` on the last. */
export const pageFooter = (copy: Copy, hasMore: boolean): string => {
    const back = `${KEY_BACK}. ${copy.ussd['nav.back']}`;
    return hasMore ? `${KEY_MORE}. ${copy.ussd['nav.more']} ${back}` : back;
};

/**
 * Splits `lines` into pages. A page must fit, *with* its footer, both the USSD message limit
 * (hard: the network will not carry more) and the display grid (what the handset can show).
 * It must fit under every header in `headers`, so page breaks do not move when an error replaces
 * the title.
 */
export function paginate(
    headers: readonly string[],
    lines: readonly string[],
    copy: Copy,
    grid: DisplayGrid = SESSION_GRID,
): string[][] {
    const fits = (body: readonly string[], hasMore: boolean) => {
        const footer = pageFooter(copy, hasMore);
        return headers.every((header) => {
            const text = [header, ...body, footer].join('\n');
            return fitsUssd(text) && fitsDisplay(text, grid);
        });
    };

    const pages: string[][] = [];
    let i = 0;
    while (i < lines.length) {
        const rest = lines.slice(i);
        if (fits(rest, false)) {
            pages.push(rest);
            break;
        }
        const page: string[] = [];
        while (i < lines.length && fits([...page, lines[i]], true)) page.push(lines[i++]);
        if (page.length === 0) throw new Error(`Line does not fit on a page: ${lines[i]}`);
        pages.push(page);
    }
    return pages.length ? pages : [[]];
}

export class UssdEngine {
    private readonly registry: Registry;
    private readonly fns: Registries;
    private readonly copies: Record<Lang, Copy>;
    private readonly log?: LogSink;
    private readonly now: () => number;
    private readonly newId: () => string;
    private active?: Session;

    constructor(options: EngineOptions = {}) {
        this.registry = options.registry ?? defaultRegistry;
        this.fns = options.registries ?? DEFAULT_REGISTRIES;
        this.copies = options.copies ?? COPY;
        this.log = options.log;
        this.now = options.now ?? Date.now;
        this.newId = options.newId ?? randomId;
    }

    /** Dials the service code. A session that is still open is cancelled first: one phone, one session. */
    start(account: Account, lang: Lang): Session {
        if (this.active?.open) this.cancel(this.active, lang);
        const now = this.now();
        const session: Session = {
            id: this.newId(),
            account,
            data: {recipient: config.myNumber},
            screen: this.registry.entry,
            history: [],
            page: 0,
            open: true,
            startedAt: now,
            lastActivityAt: now,
        };
        this.active = session;
        this.enter(session, this.registry.entry);
        this.record(session, null, config.serviceCode, null, lang, session.open ? 'continue' : 'end');
        return session;
    }

    reply(session: Session, raw: string, lang: Lang): Outcome {
        if (!session.open) throw new Error('USSD session is not open');
        const expiry = this.expiry(session);
        if (expiry) return this.expire(session, expiry, lang);
        session.lastActivityAt = this.now();
        session.error = undefined;

        const from = session.screen;
        const screen = this.screen(from);
        const input = raw.trim();
        const logged = screen.input?.secret ? REDACTED : input;
        const done = (status: Status, selected: string | null, extra: Partial<Outcome> = {}): Outcome => {
            this.record(session, from, logged, selected, lang, status);
            return {status, transactional: false, ...extra};
        };
        const invalid = (error: Msg): Outcome => {
            session.error = error;
            return done('invalid', null);
        };

        if (!input || input.includes('*')) return invalid({id: 'error.input'});
        const nav = screen.nav !== false;
        if (nav && input === KEY_HOME) {
            this.goHome(session);
            return done('continue', null);
        }
        if (screen.resolver) {
            const last = this.pages(session, lang).length - 1;
            session.page = Math.min(session.page, last);
            if (input === KEY_MORE && session.page < last) {
                session.page += 1;
                return done('continue', null);
            }
            if (input === KEY_BACK && session.page > 0) {
                session.page -= 1;
                return done('continue', null);
            }
        }
        if (nav && input === KEY_BACK) {
            this.goBack(session);
            return done('continue', null);
        }

        if (screen.options) {
            const option = screen.options[input];
            if (!option) return invalid({id: 'error.choice'});
            if (option.set) session.data = {...session.data, ...option.set};
            return this.follow(session, option, option.label, done);
        }

        if (screen.optionsFrom) {
            const list = this.fns.resolvers[screen.optionsFrom](session);
            const index = /^\d+$/.test(input) ? Number(input) - 1 : -1;
            if (!(index in list)) return invalid({id: 'error.choice'});
            if (screen.select) session.data = {...session.data, [screen.select]: index};
            return this.follow(session, screen, format(this.copies.en, list[index]), done);
        }

        if (screen.input) {
            const spec = screen.input;
            if (!new RegExp(spec.pattern).test(input)) return invalid({id: spec.error});
            const value = spec.type === 'number' ? Number(input) : input;
            const verdict = spec.validate ? this.fns.validators[spec.validate].run(value, session) : null;
            if (verdict && 'end' in verdict) {
                this.close(session, verdict.end);
                return done('end', logged);
            }
            if (verdict) return invalid(verdict);
            if (spec.name && !spec.secret) session.data = {...session.data, [spec.name]: value};
            return this.follow(session, screen, logged, done);
        }

        return invalid({id: 'error.choice'});
    }

    cancel(session: Session, lang: Lang): Outcome {
        if (session.open) {
            const from = session.screen;
            this.close(session, {id: 'end.cancelled'});
            this.record(session, from, '', null, lang, 'cancelled');
        } else {
            // A request already answered (e.g. a committed transfer) still shows as cancelled on the handset.
            session.final = {id: 'end.cancelled'};
        }
        return {status: 'cancelled', transactional: false};
    }

    /** Releases the session. */
    expire(session: Session, reason: Expiry, lang: Lang): Outcome {
        const from = session.screen;
        this.close(session, {id: 'end.timeout'});
        this.record(session, from, '', null, lang, 'timeout');
        return {status: 'timeout', transactional: false, expiry: reason};
    }

    expiry(session: Session): Expiry | null {
        const now = this.now();
        if (now - session.startedAt >= config.sessionMs) return 'duration';
        if (now - session.lastActivityAt >= config.inactivityMs) return 'inactivity';
        return null;
    }

    msUntilExpiry(session: Session): number {
        const deadline = Math.min(session.startedAt + config.sessionMs, session.lastActivityAt + config.inactivityMs);
        return Math.max(0, deadline - this.now());
    }

    render(session: Session, lang: Lang): Rendered {
        if (!session.open) {
            const text = this.text(session, lang, session.final ?? {id: 'end.cancelled'});
            return {type: 'END', text, encoding: measureUssd(text), maxInput: 0};
        }
        const screen = this.screen(session.screen);
        const text = this.compose(session, screen, lang);
        return {type: 'CON', text, encoding: measureUssd(text), maxInput: this.maxInput(session, screen)};
    }

    /** Pages of the current resolver screen in `lang`; a single empty page for any other screen. */
    pages(session: Session, lang: Lang): string[][] {
        const screen = this.screen(session.screen);
        if (!screen.resolver) return [[]];
        return paginate(this.pageHeaders(session, screen, lang), this.lines(session, screen, lang), this.copies[lang]);
    }

    private compose(session: Session, screen: Screen, lang: Lang): string {
        const copy = this.copies[lang];
        const header = this.header(session, screen, lang);
        if (screen.resolver) {
            const pages = paginate(this.pageHeaders(session, screen, lang), this.lines(session, screen, lang), copy);
            const page = Math.min(session.page, pages.length - 1);
            return [header, ...pages[page], pageFooter(copy, page < pages.length - 1)].join('\n');
        }
        const parts = [header];
        if (screen.options) {
            const items = sortedKeys(screen.options).map((key) => `${key}. ${this.text(session, lang, {id: screen.options![key].label})}`);
            parts.push(...(screen.inline ? [items.join(' ')] : items));
        }
        if (screen.optionsFrom) {
            const list = this.fns.resolvers[screen.optionsFrom](session);
            parts.push(...list.map((msg, i) => `${i + 1}. ${this.text(session, lang, msg)}`));
        }
        if (screen.nav !== false) parts.push(`${KEY_BACK}. ${copy.ussd['nav.back']}`);
        return parts.join('\n');
    }

    private prompt(session: Session, screen: Screen, lang: Lang): string {
        const id = typeof screen.prompt === 'string'
            ? screen.prompt
            : screen.prompt.cases[String(session.data[screen.prompt.by])] ?? Object.values(screen.prompt.cases)[0];
        return this.text(session, lang, {id});
    }

    /** After wrong input the error takes the prompt's place, so the screen keeps its height. */
    private header(session: Session, screen: Screen, lang: Lang): string {
        return session.error ? this.text(session, lang, session.error) : this.prompt(session, screen, lang);
    }

    /** Every header a paginated screen can show: its title, or an error in its place. */
    private pageHeaders(session: Session, screen: Screen, lang: Lang): string[] {
        return [this.prompt(session, screen, lang), ...PAGE_ERRORS.map((id) => this.text(session, lang, {id}))];
    }

    private lines(session: Session, screen: Screen, lang: Lang): string[] {
        return screen.resolver ? this.fns.resolvers[screen.resolver](session).map((msg) => this.text(session, lang, msg)) : [];
    }

    private text(session: Session, lang: Lang, msg: Msg): string {
        const vars: Vars = {
            ...session.data,
            balance: session.account.balanceCents,
            pinAttemptsLeft: session.account.pinAttemptsLeft,
            pinAttempts: config.pinAttempts,
            now: this.now(),
        };
        return format(this.copies[lang], msg, vars);
    }

    private maxInput(session: Session, screen: Screen): number {
        if (screen.input) return screen.input.maxLength;
        if (screen.resolver) return KEY_MORE.length;
        const keys = screen.options ? Object.keys(screen.options)
            : screen.optionsFrom ? [String(this.fns.resolvers[screen.optionsFrom](session).length)] : [];
        const navLength = screen.nav !== false ? KEY_HOME.length : 0;
        return Math.max(navLength, ...keys.map((k) => k.length), 1);
    }

    private follow(
        session: Session,
        target: { next?: string; action?: string },
        selected: string,
        done: (status: Status, selected: string | null, extra?: Partial<Outcome>) => Outcome,
    ): Outcome {
        if (target.next) {
            this.enter(session, target.next);
            return done(session.open ? 'continue' : 'end', selected);
        }
        const result = this.fns.actions[target.action!].run(session, this.now());
        this.close(session, result.message);
        return done('end', selected, {notice: result.notice, transactional: !!result.transactional});
    }

    /** Moves to `id`, unless its guard ends the session. The home screen resets the history. */
    private enter(session: Session, id: string): void {
        const screen = this.screen(id);
        const blocked = screen.guard ? this.fns.guards[screen.guard].run(session) : null;
        if (blocked) {
            this.close(session, blocked);
            return;
        }
        session.screen = id;
        session.page = 0;
        if (id === this.registry.home) session.history = [id];
        else session.history.push(id);
    }

    private goHome(session: Session): void {
        this.enter(session, this.registry.home);
    }

    private goBack(session: Session): void {
        const fixed = this.screen(session.screen).back;
        session.history.pop();
        const previous = fixed ?? session.history.at(-1) ?? this.registry.home;
        if (session.history.at(-1) !== previous) session.history.push(previous);
        session.screen = previous;
        session.page = 0;
    }

    private close(session: Session, final: Msg): void {
        session.open = false;
        session.final = final;
        session.error = undefined;
        if (this.active === session) this.active = undefined;
    }

    private screen(id: string): Screen {
        const screen = this.registry.screens[id];
        if (!screen) throw new Error(`Unknown screen ${id}`);
        return screen;
    }

    private record(session: Session, screenId: string | null, input: string, selectedValue: string | null, lang: Lang, status: Status): void {
        if (!this.log) return;
        const record: LogRecord = {
            sessionId: session.id,
            phoneNumber: config.myNumber,
            screenId,
            timestamp: new Date(this.now()).toISOString(),
            input,
            selectedValue,
            nextScreenId: session.open ? session.screen : null,
            page: session.page,
            lang,
            status,
        };
        this.log.add(record).catch((error) => console.warn('[Akiba emulator] Could not write the session log.', error));
    }
}

export interface CheckOptions {
    registry?: Registry;
    registries?: Registries;
    copies?: Record<Lang, Copy>;
    samples?: SessionData[];
    account?: Account;
}

/** Every problem with the registry, empty when it is sound. */
export function checkRegistry(options: CheckOptions = {}): string[] {
    const reg = options.registry ?? defaultRegistry;
    const fns = options.registries ?? DEFAULT_REGISTRIES;
    const copies = options.copies ?? COPY;
    const samples = options.samples ?? SAMPLE_DATA;
    const problems: string[] = [];
    const langs = Object.keys(copies) as Lang[];
    const exists = (id?: string) => id !== undefined && id in reg.screens;
    const one = (t: { next?: string; action?: string }) => (t.next === undefined) !== (t.action === undefined);

    const usedMessages = new Set<MessageId>(['error.choice', 'error.input', 'nav.back', 'nav.more', 'end.cancelled', 'end.timeout']);
    const register = (msgs: Msg[]) => msgs.forEach((m) => usedMessages.add(m.id));

    if (!exists(reg.entry)) problems.push(`entry screen "${reg.entry}" does not exist`);
    if (!exists(reg.home)) problems.push(`home screen "${reg.home}" does not exist`);

    for (const [id, screen] of Object.entries(reg.screens)) {
        const at = `screen "${id}"`;
        const kinds = [screen.options, screen.optionsFrom, screen.input, screen.resolver].filter((k) => k !== undefined);
        if (kinds.length > 1) problems.push(`${at} mixes options, optionsFrom, input and resolver`);

        const prompts = typeof screen.prompt === 'string' ? [screen.prompt] : Object.values(screen.prompt.cases);
        prompts.forEach((p) => usedMessages.add(p));

        if (screen.options) {
            if (screen.next !== undefined || screen.action !== undefined) problems.push(`${at} has options and its own next/action`);
            for (const [key, option] of Object.entries(screen.options)) {
                if (!/^\d+$/.test(key)) problems.push(`${at} option "${key}" is not digits only`);
                if (RESERVED_KEYS.has(key)) problems.push(`${at} option "${key}" uses a reserved key`);
                if (!one(option)) problems.push(`${at} option "${key}" needs exactly one of next or action`);
                if (option.next !== undefined && !exists(option.next)) problems.push(`${at} option "${key}" goes to unknown screen "${option.next}"`);
                if (option.action !== undefined && !(option.action in fns.actions)) problems.push(`${at} option "${key}" uses unknown action "${option.action}"`);
                usedMessages.add(option.label);
            }
        } else if (screen.optionsFrom !== undefined || screen.input !== undefined) {
            if (!one(screen)) problems.push(`${at} needs exactly one of next or action`);
        } else if (screen.next !== undefined || screen.action !== undefined) {
            problems.push(`${at} has next/action but nothing to choose or type`);
        }
        if (screen.next !== undefined && !exists(screen.next)) problems.push(`${at} goes to unknown screen "${screen.next}"`);
        if (screen.action !== undefined && !(screen.action in fns.actions)) problems.push(`${at} uses unknown action "${screen.action}"`);
        if (screen.back !== undefined && !exists(screen.back)) problems.push(`${at} goes back to unknown screen "${screen.back}"`);
        if (screen.guard !== undefined && !(screen.guard in fns.guards)) problems.push(`${at} uses unknown guard "${screen.guard}"`);
        for (const name of [screen.optionsFrom, screen.resolver]) {
            if (name !== undefined && !(name in fns.resolvers)) problems.push(`${at} uses unknown resolver "${name}"`);
        }
        if (screen.optionsFrom !== undefined && screen.select === undefined) problems.push(`${at} has optionsFrom but no select`);
        if (screen.resolver !== undefined && screen.nav === false) problems.push(`${at} is paginated, so it needs navigation`);

        const spec = screen.input;
        if (spec) {
            try {
                new RegExp(spec.pattern);
            } catch {
                problems.push(`${at} has an invalid pattern "${spec.pattern}"`);
            }
            if (!spec.name && !spec.secret) problems.push(`${at} input needs a name to store its value`);
            if (spec.validate !== undefined && !(spec.validate in fns.validators)) problems.push(`${at} uses unknown validator "${spec.validate}"`);
            usedMessages.add(spec.error);
        }
    }
    Object.values(fns.actions).forEach((a) => register(a.messages));
    Object.values(fns.validators).forEach((v) => register(v.messages));
    Object.values(fns.guards).forEach((g) => register(g.messages));

    for (const lang of langs) {
        for (const id of usedMessages) {
            if (typeof copies[lang].ussd[id] !== 'string') problems.push(`message "${id}" is missing in ${lang}`);
        }
        for (const [id, template] of Object.entries(copies[lang].ussd)) {
            for (const name of formattersIn(template)) {
                if (!(name in fns.formatters)) problems.push(`message "${id}" (${lang}) uses unknown formatter "${name}"`);
            }
        }
    }
    if (problems.length) return problems; // the length checks below need a sound registry

    problems.push(...checkLengths(reg, fns, copies, samples, options.account));
    return problems;
}

/** Renders every screen, error and end message with worst-case data and measures it against the USSD limit and the display. */
function checkLengths(reg: Registry, fns: Registries, copies: Record<Lang, Copy>, samples: SessionData[], account?: Account): string[] {
    const problems: string[] = [];
    const langs = Object.keys(copies) as Lang[];
    const engine = new UssdEngine({
        registry: reg,
        registries: fns,
        copies,
        now: () => new Date(2026, 11, 31, 23, 59).getTime()
    });
    const sampleAccount = (): Account => account ?? {
        balanceCents: 999_999_999,
        pin: '0000',
        pinAttemptsLeft: config.pinAttempts,
        transactions: [{at: Date.UTC(2026, 11, 31), type: 'withdrawal', amount: -70_100, balanceCents: 999_999_999}],
    };
    const session = (data: SessionData, screen: string, error?: Msg): Session => ({
        id: 'check', account: sampleAccount(), data, screen, history: [screen], page: 0, open: true, error,
        startedAt: 0, lastActivityAt: 0,
    });
    const over = (text: string) => !fitsUssd(text);
    const tooTall = (text: string, grid: DisplayGrid) => !fitsDisplay(text, grid);
    const rows = (text: string) => `${displayRows(text, config.display.columns)} rows`;
    const describe = (text: string) => {
        const {scheme, units, limit} = measureUssd(text);
        return `${scheme} ${units}/${limit}`;
    };
    const ends: Msg[] = [
        {id: 'end.cancelled'}, {id: 'end.timeout'},
        ...Object.values(fns.actions).flatMap((a) => a.messages),
        ...Object.values(fns.guards).flatMap((g) => g.messages),
        ...Object.values(fns.validators).flatMap((v) => v.messages),
    ];

    for (const lang of langs) {
        for (const data of samples) {
            for (const [id, screen] of Object.entries(reg.screens)) {
                const errors: (Msg | undefined)[] = [undefined, {id: 'error.input'}];
                if (screen.options || screen.optionsFrom || screen.resolver) errors.push({id: 'error.choice'});
                if (screen.input) {
                    errors.push({id: screen.input.error});
                    if (screen.input.validate) errors.push(...fns.validators[screen.input.validate].messages);
                }
                for (const error of errors) {
                    const s = session(data, id, error);
                    let text: string;
                    try {
                        text = engine.render(s, lang).text;
                    } catch (e) {
                        problems.push(`screen "${id}" (${lang}) cannot be paginated: ${(e as Error).message}`);
                        continue;
                    }
                    const where = `screen "${id}" (${lang}${error ? `, error ${error.id}` : ''})`;
                    if (over(text)) problems.push(`${where} is over the USSD limit: ${describe(text)}`);
                    if (tooTall(text, SESSION_GRID)) problems.push(`${where} does not fit the display: ${rows(text)} > ${SESSION_GRID.rows}`);
                    if (/\{\{/.test(text)) problems.push(`${where} has an unfilled placeholder: ${text}`);
                }
            }
            for (const msg of ends) {
                const s = session(data, reg.home);
                s.open = false;
                s.final = msg;
                const text = engine.render(s, lang).text;
                if (over(text)) problems.push(`message "${msg.id}" (${lang}) is over the USSD limit: ${describe(text)}`);
                if (tooTall(text, MESSAGE_GRID)) problems.push(`message "${msg.id}" (${lang}) does not fit the display: ${rows(text)} > ${MESSAGE_GRID.rows}`);
            }
        }
    }
    return [...new Set(problems)];
}

/** Startup check: throws with every problem found. */
export function assertRegistry(options: CheckOptions = {}): void {
    const problems = checkRegistry(options);
    if (problems.length) throw new Error(`USSD screen registry is invalid:\n- ${problems.join('\n- ')}`);
}
