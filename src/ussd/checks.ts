import {config} from '../config.js';
import {COPY, type Copy, type MessageId} from '../messages.js';
import {UssdEngine} from './engine.js';
import {SCREEN_TYPES} from './screenTypes.js';
import {registry as defaultRegistry, SAMPLE_DATA} from './screens/index.js';
import {displayRows, fitsDisplay, fitsUssd, formatters, formattersIn, MESSAGE_GRID, measureUssd, SESSION_GRID} from './text.js';
import type {Account, Lang, Msg, Registry, Screen, Session, SessionData} from './types.js';

export interface CheckOptions {
    registry?: Registry;
    copies?: Record<Lang, Copy>;
    samples?: SessionData[];
    account?: Account;
}

/** Throws with every problem found. */
export function assertRegistry(options: CheckOptions = {}): void {
    const problems = checkRegistry(options);
    if (problems.length) throw new Error(`USSD screen registry is invalid:\n- ${problems.join('\n- ')}`);
}

/** Every problem with the screens and copy; empty when all is well. */
export function checkRegistry(options: CheckOptions = {}): string[] {
    const registry = options.registry ?? defaultRegistry;
    const copies = options.copies ?? COPY;
    const problems: string[] = [];

    // 1. Wiring
    const exists = (id: string) => id in registry.screens;
    if (!exists(registry.entry)) problems.push(`entry screen "${registry.entry}" does not exist`);
    if (!exists(registry.home)) problems.push(`home screen "${registry.home}" does not exist`);
    for (const [id, screen] of Object.entries(registry.screens)) {
        const at = `screen "${id}"`;
        if (!(screen.type in SCREEN_TYPES)) {
            problems.push(`${at} has unknown type "${screen.type}"`);
            continue;
        }
        if (screen.back !== undefined && !exists(screen.back)) problems.push(`${at} goes back to unknown screen "${screen.back}"`);
        const typeProblems = SCREEN_TYPES[screen.type].check?.(screen, exists) ?? [];
        for (const problem of typeProblems) problems.push(`${at} ${problem}`);
    }
    if (problems.length) return problems; // the checks below need every screen to have a known type

    // 2. Copy (TypeScript already checks this for messages.ts; this catches copies passed in at runtime)
    for (const [lang, copy] of Object.entries(copies)) {
        for (const id of Object.keys(copies.en.ussd)) {
            if (typeof copy.ussd[id as MessageId] !== 'string') problems.push(`message "${id}" is missing in ${lang}`);
        }
        for (const [id, template] of Object.entries(copy.ussd)) {
            for (const name of formattersIn(template)) {
                if (!(name in formatters)) problems.push(`message "${id}" (${lang}) uses unknown formatter "${name}"`);
            }
        }
    }

    // 3. Lengths (only worth measuring once everything above is sound)
    if (problems.length) return problems;
    return checkLengths(registry, copies, options.samples ?? SAMPLE_DATA, options.account);
}

/** The errors a screen can show in place of its title, and the END messages it can lead to (its guard's included). */
function screenMessages(screen: Screen): { errors: Msg[]; ends: Msg[] } {
    const {errors, ends} = SCREEN_TYPES[screen.type].messages?.(screen) ?? {errors: [], ends: []};
    return {errors, ends: [...ends, ...(screen.guard?.messages ?? [])]};
}

/** Draws every screen, error and END message with worst-case data and measures it. */
function checkLengths(registry: Registry, copies: Record<Lang, Copy>, samples: SessionData[], account?: Account): string[] {
    const problems: string[] = [];
    const engine = new UssdEngine({registry, copies, now: () => new Date(2026, 11, 31, 23, 59).getTime()});
    const sampleAccount = (): Account => account ?? {
        balanceCents: 999_999_999,
        pin: '0000',
        pinAttemptsLeft: config.pinAttempts,
        transactions: [{at: Date.UTC(2026, 11, 31), type: 'withdrawal', amount: -70_100, balanceCents: 999_999_999}],
    };
    const fakeSession = (data: SessionData, screen: string, error?: Msg): Session => ({
        id: 'check', account: sampleAccount(), data, screen, history: [screen], page: 0, open: true, error,
        startedAt: 0, lastActivityAt: 0,
    });
    const measure = (text: string) => {
        const {scheme, units, limit} = measureUssd(text);
        return `${scheme} ${units}/${limit}`;
    };
    const rows = (text: string) => `${displayRows(text, config.display.columns)} rows`;

    const allEnds: Msg[] = [{id: 'end.cancelled'}, {id: 'end.timeout'}, ...Object.values(registry.screens).flatMap((s) => screenMessages(s).ends)];

    for (const lang of Object.keys(copies) as Lang[]) {
        for (const data of samples) {
            // Every open screen: clean, and with each error it can show in place of its title.
            for (const [id, screen] of Object.entries(registry.screens)) {
                const errors: (Msg | undefined)[] = [undefined, {id: 'error.input'}, ...screenMessages(screen).errors];
                for (const error of errors) {
                    let text: string;
                    try {
                        text = engine.render(fakeSession(data, id, error), lang).text;
                    } catch (e) {
                        problems.push(`screen "${id}" (${lang}) cannot be paginated: ${(e as Error).message}`);
                        continue;
                    }
                    const where = `screen "${id}" (${lang}${error ? `, error ${error.id}` : ''})`;
                    if (!fitsUssd(text)) problems.push(`${where} is over the USSD limit: ${measure(text)}`);
                    if (!fitsDisplay(text, SESSION_GRID)) problems.push(`${where} does not fit the display: ${rows(text)} > ${SESSION_GRID.rows}`);
                    if (text.includes('{{')) problems.push(`${where} has an unfilled placeholder: ${text}`);
                }
            }

            // Every END message.
            for (const msg of allEnds) {
                const session = fakeSession(data, registry.home);
                session.open = false;
                session.final = msg;
                const text = engine.render(session, lang).text;
                if (!fitsUssd(text)) problems.push(`message "${msg.id}" (${lang}) is over the USSD limit: ${measure(text)}`);
                if (!fitsDisplay(text, MESSAGE_GRID)) problems.push(`message "${msg.id}" (${lang}) does not fit the display: ${rows(text)} > ${MESSAGE_GRID.rows}`);
            }
        }
    }
    return [...new Set(problems)];
}
