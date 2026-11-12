/**
 * HOW SCREENS ARE DRAWN AND WHAT REPLIES THEY ACCEPT.
 *
 * A screen in screens/ is plain data with a `type`:
 *
 *     main: {type: 'menu', prompt: 'main.prompt', options: {1: {label: 'main.balance', next: 'balance'}, ...}}
 *
 * Nothing in the engine or the renderer checks that type with if/switch. Instead, the
 * type is looked up in SCREEN_TYPES (below), and every screen is handled by calling
 * the same few functions on its entry:
 *
 *     SCREEN_TYPES['menu'].body(screen, ...)   → ['1. Balance Enquiry', '2. Withdraw Money', ...]
 *     SCREEN_TYPES['menu'].reply(screen, '2')  → {then: {next: 'withdraw'}, ...}
 *
 * So:
 *   - adding a screen       = write a data object in screens/ (nothing here changes)
 *   - adding a screen type  = describe its fields in types.ts and add one entry here
 *
 * renderSession() at the bottom draws ANY screen the same way:
 *
 *   ┌───────────────────────┐
 *   │ Akiba SACCO           │  title  – the screen's `prompt` (or the error after a bad reply)
 *   │ 1. Balance Enquiry    │  body   – whatever the screen type's `body()` returns
 *   │ 2. Withdraw Money     │
 *   │ 0. Back               │  footer – `0. Back` (or `98. More 0. Back` on a paged screen)
 *   └───────────────────────┘
 */
import {COPY, type Copy, type MessageId} from '../messages.js';
import {fillIn, fitsDisplay, fitsUssd, measureUssd, messageText, SESSION_GRID, type DisplayGrid} from './text.js';
import type {
    InfoScreen, InputScreen, ListScreen, MenuScreen, Msg, PagesScreen, Registry, Rendered, Screen, Session, SessionData, Then,
} from './types.js';

/** Keys that work on every screen, so no menu option may use them. */
export const KEYS = {back: '0', home: '00', more: '98'} as const;

/** What the log shows instead of a secret reply (the PIN). The phone itself shows the digits as typed, like real USSD. */
export const REDACTED = '****';

/** What a reply means. The engine applies it to the session. */
type Reply =
    /** Not accepted: show this message in place of the title, and stay. */
    | { error: Msg }
    /** Accepted: save `save` in session.data, then go to `then.next` or run `then.action`. */
    | { selected: string; then: Then; save?: Partial<SessionData> }
    /** A check ended the session (e.g. the third wrong PIN). */
    | { selected: string; end: Msg };

/** Everything the engine needs to know about one type of screen. */
interface ScreenType<S extends Screen> {
    /** The lines under the title. `text` turns a message into text in the current language. */
    body(screen: S, session: Session, text: (msg: Msg) => string): string[];
    /** Split the body over pages, with `98. More`. */
    paged: boolean;
    /** What a reply means. Navigation keys the engine already handled (0, 00, 98) never get here. */
    reply(screen: S, input: string, session: Session): Reply;
    /** How many digits the user may type (the engine adds room for `00` itself). */
    maxInput(screen: S, session: Session): number;
    /** True if replies on this screen must never be saved or logged. Leave out if never. */
    secret?(screen: S): boolean;
    /** Startup check: mistakes in the screen's definition. `exists` says whether a screen ID is real. */
    check?(screen: S, exists: (id: string) => boolean): string[];
    /** Startup check: the errors the screen can show in place of its title, and the END messages it can lead to. */
    messages?(screen: S): { errors: Msg[]; ends: Msg[] };
}

// The screen types

const CHOICE_ERROR: Msg = {id: 'error.choice'};

/** A numbered menu with fixed options. */
const menu: ScreenType<MenuScreen> = {
    paged: false,
    body: (screen, _session, text) => {
        const keys = Object.keys(screen.options).sort((a, b) => Number(a) - Number(b));
        const choices = keys.map((key) => `${key}. ${text({id: screen.options[key].label})}`);
        return screen.inline ? [choices.join(' ')] : choices; // inline: "1. Yes 2. No"
    },
    reply: (screen, input) => {
        const option = screen.options[input];
        if (!option) return {error: CHOICE_ERROR};
        return {selected: option.label, then: option, save: option.set};
    },
    maxInput: (screen) => Math.max(...Object.keys(screen.options).map((key) => key.length)),
    check: (screen, exists) => {
        const problems: string[] = [];
        for (const [key, option] of Object.entries(screen.options)) {
            if (!/^\d+$/.test(key)) problems.push(`option "${key}" is not digits only`);
            if ((Object.values(KEYS) as string[]).includes(key)) problems.push(`option "${key}" uses a reserved key`);
            problems.push(...checkThen(option, exists).map((problem) => `option "${key}" ${problem}`));
        }
        return problems;
    },
    messages: (screen) => ({errors: [CHOICE_ERROR], ends: actionMessages(Object.values(screen.options))}),
};

/** A numbered menu whose items are built at runtime (e.g. the banks). */
const list: ScreenType<ListScreen> = {
    paged: false,
    body: (screen, session, text) => screen.items(session).map((item, i) => `${i + 1}. ${text(item)}`),
    reply: (screen, input, session) => {
        const items = screen.items(session);
        const index = Number(input) - 1;
        if (!/^\d+$/.test(input) || !items[index]) return {error: CHOICE_ERROR};
        const save = {[screen.saveAs]: index} as Partial<SessionData>;
        return {selected: fillIn(COPY.en, items[index]), then: screen, save};
    },
    maxInput: (screen, session) => String(screen.items(session).length).length,
    check: (screen, exists) => checkThen(screen, exists),
    messages: (screen) => ({errors: [CHOICE_ERROR], ends: actionMessages([screen])}),
};

/** Asks the user to type a value (a PIN, a phone number, an amount...). */
const input: ScreenType<InputScreen> = {
    paged: false,
    body: () => [], // just the title, e.g. "Enter amount:"
    reply: (screen, typed, session) => {
        const field = screen.input;
        if (!new RegExp(field.pattern).test(typed)) return {error: {id: field.error}};
        const value = field.type === 'number' ? Number(typed) : typed;
        const selected = field.secret ? REDACTED : typed;
        const verdict = field.validate ? field.validate.check(value, session) : null;
        if (verdict && 'end' in verdict) return {selected, end: verdict.end};
        if (verdict) return {error: verdict};
        const save = field.name && !field.secret ? ({[field.name]: value} as Partial<SessionData>) : undefined;
        return {selected, then: screen, save};
    },
    maxInput: (screen) => screen.input.maxLength,
    secret: (screen) => !!screen.input.secret,
    check: (screen, exists) => {
        const problems = checkThen(screen, exists);
        try {
            new RegExp(screen.input.pattern);
        } catch {
            problems.push(`has an invalid pattern "${screen.input.pattern}"`);
        }
        if (!screen.input.name && !screen.input.secret) problems.push('input needs a name to store its value');
        return problems;
    },
    messages: (screen) => {
        const checkMessages = screen.input.validate?.messages ?? [];
        return {errors: [{id: screen.input.error}, ...checkMessages], ends: [...checkMessages, ...actionMessages([screen])]};
    },
};

/** Read-only lines split over pages (e.g. the mini statement). */
const pages: ScreenType<PagesScreen> = {
    paged: true,
    body: (screen, session, text) => screen.lines(session).map(text),
    reply: () => ({error: CHOICE_ERROR}), // only the navigation keys work here
    maxInput: () => KEYS.more.length,
    check: (screen) => (screen.nav === false ? ['is paginated, so it needs navigation'] : []),
    messages: () => ({errors: [CHOICE_ERROR], ends: []}),
};

/** Text only (e.g. the balance); the user can just go back or home. */
const info: ScreenType<InfoScreen> = {
    paged: false,
    body: () => [],
    reply: () => ({error: CHOICE_ERROR}),
    maxInput: () => 1,
};

/** Every screen type, by the name used in a screen's `type` field. */
export const SCREEN_TYPES: Record<Screen['type'], ScreenType<Screen>> = {menu, list, input, pages, info};

/** Problems with a `next` / `action` pair: exactly one must be given, and `next` must exist. */
function checkThen(then: Then, exists: (id: string) => boolean): string[] {
    const problems: string[] = [];
    if ((then.next === undefined) === (then.action === undefined)) problems.push('needs exactly one of next or action');
    if (then.next !== undefined && !exists(then.next)) problems.push(`goes to unknown screen "${then.next}"`);
    return problems;
}

const actionMessages = (thens: Then[]): Msg[] => thens.flatMap((then) => then.action?.messages ?? []);

// Drawing any screen

export function renderSession(session: Session, registry: Registry, copy: Copy, now: number): Rendered {
    // Turns a message into text in this language, with {{placeholders}} filled from the session.
    const text = (msg: Msg) => messageText(msg, session, copy, now);

    // A closed session shows only its END message (e.g. "Transaction successful").
    if (!session.open) {
        const message = text(session.final ?? {id: 'end.cancelled'});
        return {type: 'END', text: message, encoding: measureUssd(message), maxInput: 0};
    }

    const screen = registry.screens[session.screen];
    const type = SCREEN_TYPES[screen.type];
    const hasNav = screen.nav !== false;

    // Title: the prompt, or after a bad reply the error in its place (so the screen keeps its height).
    const title = session.error ? text(session.error) : text({id: titleId(screen, session)});

    // Body and footer.
    let body: string[];
    let footer: string | null;
    if (type.paged) {
        const allPages = pagesOf(session, screen, copy, now);
        const page = Math.min(session.page, allPages.length - 1); // stays in range after a language switch
        body = allPages[page];
        footer = pageFooter(copy, page < allPages.length - 1);
    } else {
        body = type.body(screen, session, text);
        footer = hasNav ? backLine(copy) : null;
    }

    const lines = footer === null ? [title, ...body] : [title, ...body, footer];
    const fullText = lines.join('\n');
    const maxInput = Math.max(type.maxInput(screen, session), hasNav ? KEYS.home.length : 0);
    return {type: 'CON', text: fullText, encoding: measureUssd(fullText), maxInput};
}

/** The message ID of a screen's title. `{by, cases}` picks one by a session value, e.g. by `service`. */
export function titleId(screen: Screen, session: Session): MessageId {
    const {prompt} = screen;
    if (typeof prompt === 'string') return prompt;
    const value = String(session.data[prompt.by]);
    return prompt.cases[value] ?? Object.values(prompt.cases)[0];
}

const backLine = (copy: Copy) => `${KEYS.back}. ${copy.ussd['nav.back']}`;

// Pages

/** A screen's body split into pages. Each page must fit under every title it could show, so page breaks never move. */
export function pagesOf(session: Session, screen: Screen, copy: Copy, now: number): string[][] {
    const text = (msg: Msg) => messageText(msg, session, copy, now);
    const type = SCREEN_TYPES[screen.type];
    const body = type.body(screen, session, text);
    if (!type.paged) return [body];
    const titles = [text({id: titleId(screen, session)}), text({id: 'error.choice'}), text({id: 'error.input'})];
    return paginate(titles, body, copy);
}

/** `98. More 0. Back` on one row while there is a next page, just `0. Back` on the last. */
export function pageFooter(copy: Copy, hasMore: boolean): string {
    return hasMore ? `${KEYS.more}. ${copy.ussd['nav.more']} ${backLine(copy)}` : backLine(copy);
}

/**
 * Fills each page with as many lines as fit. A page (title + lines + footer) must fit
 * both the USSD message limit and the display, under every one of `titles`.
 */
export function paginate(titles: readonly string[], lines: readonly string[], copy: Copy, grid: DisplayGrid = SESSION_GRID): string[][] {
    const fits = (body: readonly string[], hasMore: boolean) =>
        titles.every((title) => {
            const text = [title, ...body, pageFooter(copy, hasMore)].join('\n');
            return fitsUssd(text) && fitsDisplay(text, grid);
        });

    const result: string[][] = [];
    let i = 0;
    while (i < lines.length) {
        const rest = lines.slice(i);
        if (fits(rest, false)) {
            result.push(rest); // everything left fits on the last page
            break;
        }
        const page: string[] = [];
        while (i < lines.length && fits([...page, lines[i]], true)) page.push(lines[i++]);
        if (page.length === 0) throw new Error(`Line does not fit on a page: ${lines[i]}`);
        result.push(page);
    }
    return result.length ? result : [[]];
}
