/**
 * The USSD session: what happens when the user dials and replies.
 *
 * The engine knows nothing about specific screens. After each reply it only updates
 * the session, and screenTypes.ts turns the session into text:
 *
 *   session.screen  → which screen comes next (from the screen's `next`, or back/home)
 *   session.error   → set when the reply was not accepted
 *   session.page    → moved by `98` / `0` on a paged screen
 *   session.open    → false once an `action` or a check has ended the session
 */
import {config} from '../config.js';
import {COPY, type Copy} from '../messages.js';
import {KEYS, pagesOf, REDACTED, renderSession, SCREEN_TYPES} from './screenTypes.js';
import {registry as defaultRegistry} from './screens/index.js';
import type {Account, Expiry, Lang, LogSink, Msg, Notice, Outcome, Registry, Rendered, Screen, Session, Status, Then} from './types.js';

/** What one reply led to. `reply()` turns it into an `Outcome` and one log record. */
interface Result {
    status: Status;
    /** What the user picked or typed, for the log. */
    selected?: string;
    notice?: Notice;
    transactional?: boolean;
}

export interface EngineOptions {
    registry?: Registry;
    copies?: Record<Lang, Copy>;
    log?: LogSink;
    now?: () => number;
    newId?: () => string;
}

export class UssdEngine {
    private readonly registry: Registry;
    private readonly copies: Record<Lang, Copy>;
    private readonly log?: LogSink;
    private readonly now: () => number;
    private readonly newId: () => string;
    /** One phone, one session: the session currently open, if any. */
    private active?: Session;

    constructor(options: EngineOptions = {}) {
        this.registry = options.registry ?? defaultRegistry;
        this.copies = options.copies ?? COPY;
        this.log = options.log;
        this.now = options.now ?? Date.now;
        this.newId = options.newId ?? randomId;
    }

    /** The text to show for the session right now. All the work is in screenTypes.ts. */
    render(session: Session, lang: Lang): Rendered {
        return renderSession(session, this.registry, this.copies[lang], this.now());
    }

    /** The pages of the current screen (a single page unless its type is paged). */
    pages(session: Session, lang: Lang): string[][] {
        return pagesOf(session, this.screen(session.screen), this.copies[lang], this.now());
    }

    // Dialling, cancelling, timing out

    /** Dials the service code. A session that is still open is cancelled first. */
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
        this.goTo(session, this.registry.entry);
        this.record(session, null, config.serviceCode, null, lang, session.open ? 'continue' : 'end');
        return session;
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

    /** The network releases the session. */
    expire(session: Session, reason: Expiry, lang: Lang): Outcome {
        const from = session.screen;
        this.close(session, {id: 'end.timeout'});
        this.record(session, from, '', null, lang, 'timeout');
        return {status: 'timeout', transactional: false, expiry: reason};
    }

    /** Why the session should end now, or `null` if it may go on. */
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

    // Replying

    reply(session: Session, raw: string, lang: Lang): Outcome {
        if (!session.open) throw new Error('USSD session is not open');
        const expiry = this.expiry(session);
        if (expiry) return this.expire(session, expiry, lang);

        session.lastActivityAt = this.now();
        session.error = undefined; // the old error goes; a new one may be set below

        const from = session.screen;
        const screen = this.screen(from);
        const input = raw.trim();
        const forLog = SCREEN_TYPES[screen.type].secret?.(screen) ? REDACTED : input;

        const result = this.handle(session, screen, input, lang);

        this.record(session, from, forLog, result.selected ?? null, lang, result.status);
        return {status: result.status, transactional: result.transactional ?? false, notice: result.notice};
    }

    /** Works out what `input` means on `screen` and updates the session to match. */
    private handle(session: Session, screen: Screen, input: string, lang: Lang): Result {
        const type = SCREEN_TYPES[screen.type];
        const reject = (error: Msg): Result => {
            session.error = error; // drawn in place of the title
            return {status: 'invalid'};
        };

        if (input === '' || input.includes('*')) return reject({id: 'error.input'});

        // 1. Navigation keys come first, unless the screen turns them off.
        const nav = screen.nav !== false;
        if (nav && input === KEYS.home) {
            this.goTo(session, this.registry.home);
            return {status: 'continue'};
        }
        if (type.paged) {
            // On a paged screen, 98 and 0 turn pages; 0 on the first page goes back as usual.
            const lastPage = this.pages(session, lang).length - 1;
            session.page = Math.min(session.page, lastPage);
            if (input === KEYS.more && session.page < lastPage) {
                session.page += 1;
                return {status: 'continue'};
            }
            if (input === KEYS.back && session.page > 0) {
                session.page -= 1;
                return {status: 'continue'};
            }
        }
        if (nav && input === KEYS.back) {
            this.goBack(session);
            return {status: 'continue'};
        }

        // 2. Anything else: the screen's type says what the reply means.
        const reply = type.reply(screen, input, session);
        if ('error' in reply) return reject(reply.error);
        if ('end' in reply) {
            this.close(session, reply.end);
            return {status: 'end', selected: reply.selected};
        }
        if (reply.save) session.data = {...session.data, ...reply.save};
        return this.proceed(session, reply.then, reply.selected);
    }

    /** After an accepted reply: go to the `next` screen, or run the `action`, which ends the session. */
    private proceed(session: Session, then: Then, selected: string): Result {
        if (then.next) {
            this.goTo(session, then.next);
            return {status: session.open ? 'continue' : 'end', selected};
        }
        const result = then.action!.run(session, this.now());
        this.close(session, result.message);
        return {status: 'end', selected, notice: result.notice, transactional: !!result.transactional};
    }

    // Moving between screens

    /** Shows screen `id`, unless its guard ends the session. Reaching home clears the history. */
    private goTo(session: Session, id: string): void {
        const blocked = this.screen(id).guard?.check(session);
        if (blocked) {
            this.close(session, blocked);
            return;
        }
        session.screen = id;
        session.page = 0;
        if (id === this.registry.home) session.history = [id];
        else session.history.push(id);
    }

    /** `0`: the screen's fixed `back` target, else the previous screen, else home. */
    private goBack(session: Session): void {
        const fixed = this.screen(session.screen).back;
        session.history.pop();
        const previous = fixed ?? session.history.at(-1) ?? this.registry.home;
        if (session.history.at(-1) !== previous) session.history.push(previous);
        session.screen = previous;
        session.page = 0;
    }

    /** Ends the session; `final` is then shown as the END message. */
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
        this.log
            .add({
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
            })
            .catch((error) => console.warn('[Akiba emulator] Could not write the session log.', error));
    }
}

/** `crypto.randomUUID` only exists on secure origins (https, localhost), so fall back elsewhere. */
function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}
