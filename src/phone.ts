import {config} from './config.js';
import type {Encoding} from './encoding.js';
import {type LogSink, type Outcome, type Session, UssdEngine} from './engine.js';
import {COPY, formatIdleDate, type SoftkeyLabels} from './messages.js';
import type {Account, Lang, Notice} from './types.js';

export const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;
export type DigitKey = (typeof DIGIT_KEYS)[number];
export type PhoneKey = DigitKey | 'call' | 'end' | 'soft-left' | 'soft-right' | 'ok';

export type View = { softkeys: SoftkeyLabels } & (
    | { kind: 'idle'; time: string; date: string }
    | { kind: 'dial'; value: string }
    | { kind: 'session'; text: string; input: string; encoding: Encoding }
    | { kind: 'message'; text: string; centered: boolean; encoding?: Encoding }
    );

export interface Renderer {
    render(view: View): void;
}

type Mode =
    | { kind: 'idle' }
    | { kind: 'dialing'; value: string }
    | { kind: 'pending' }
    | { kind: 'session'; input: string }
    | { kind: 'message'; source: { type: 'ussd' } | { type: 'unknownCode' } | { type: 'sms'; notice: Notice } };

const MAX_DIAL_LENGTH = 20;

const isDigitKey = (key: PhoneKey): key is DigitKey => (DIGIT_KEYS as readonly string[]).includes(key);
const isSendKey = (key: PhoneKey): boolean => key === 'call' || key === 'soft-left' || key === 'ok';

export class FeaturePhone {
    private mode: Mode = {kind: 'idle'};
    private readonly engine: UssdEngine;
    private session?: Session;
    private readonly inbox: Notice[] = [];
    private timer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly renderer: Renderer,
        private readonly account: Account,
        private lang: Lang = 'en',
        private readonly now: () => Date = () => new Date(),
        log?: LogSink,
    ) {
        this.engine = new UssdEngine({now: () => this.now().getTime(), log});
        this.render();
    }

    get language(): Lang {
        return this.lang;
    }

    /** Re-renders the same session state in the other language. */
    setLanguage(lang: Lang): void {
        this.lang = lang;
        this.render();
    }

    /** Keeps the clock current. */
    tick(): void {
        if (this.mode.kind === 'idle') this.render();
    }

    press(key: PhoneKey): void {
        this.mode = this.next(this.mode, key);
        this.render();
    }

    private next(mode: Mode, key: PhoneKey): Mode {
        switch (mode.kind) {
            case 'idle':
                return isDigitKey(key) ? {kind: 'dialing', value: key} : mode;

            case 'dialing':
                if (isDigitKey(key)) {
                    return mode.value.length < MAX_DIAL_LENGTH ? {...mode, value: mode.value + key} : mode;
                }
                if (key === 'soft-right') {
                    const value = mode.value.slice(0, -1);
                    return value ? {...mode, value} : {kind: 'idle'};
                }
                if (key === 'end') return {kind: 'idle'};
                if (isSendKey(key)) {
                    if (mode.value !== config.serviceCode) return {kind: 'message', source: {type: 'unknownCode'}};
                    return this.request(() => {
                        this.session = this.engine.start(this.account, this.lang);
                        return {status: 'continue', transactional: false};
                    });
                }
                return mode;

            case 'pending':
                if (key !== 'soft-right' && key !== 'end') return mode;
                return this.cancel();

            case 'session': {
                if (/^\d$/.test(key)) {
                    return mode.input.length < this.current().maxInput ? {...mode, input: mode.input + key} : mode;
                }
                if (key === 'soft-right' && mode.input) return {...mode, input: mode.input.slice(0, -1)};
                if (key === 'soft-right' || key === 'end') return this.cancel();
                if (isSendKey(key) && mode.input) {
                    const input = mode.input;
                    return this.request(() => this.engine.reply(this.session!, input, this.lang));
                }
                return mode;
            }

            case 'message':
                return isSendKey(key) || key === 'end' ? this.idleOrInbox() : mode;
        }
    }

    private current() {
        return this.engine.render(this.session!, this.lang);
    }

    private cancel(): Mode {
        this.clearTimer();
        if (this.session) this.engine.cancel(this.session, this.lang);
        return {kind: 'message', source: {type: 'ussd'}};
    }

    private request(send: () => Outcome): Mode {
        this.clearTimer();
        const outcome = send();
        if (outcome.notice) this.scheduleSms(outcome.notice);
        const delay = outcome.transactional ? config.transactionMs : config.responseMs;
        this.timer = setTimeout(() => this.deliver(), delay);
        return {kind: 'pending'};
    }

    private deliver(): void {
        this.timer = undefined;
        const session = this.session!;
        const expiry = session.open ? this.engine.expiry(session) : null;
        if (expiry) {
            this.engine.expire(session, expiry, this.lang);
            this.mode = {kind: 'message', source: {type: 'ussd'}};
        } else if (!session.open) {
            this.mode = {kind: 'message', source: {type: 'ussd'}};
        } else {
            this.mode = {kind: 'session', input: ''};
            this.scheduleExpiry();
        }
        this.render();
    }

    /** The network releases idle or over-long sessions, whatever is on screen. */
    private scheduleExpiry(): void {
        const session = this.session!;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const expiry = this.engine.expiry(session);
            if (!expiry) return this.scheduleExpiry();
            this.engine.expire(session, expiry, this.lang);
            this.mode = {kind: 'message', source: {type: 'ussd'}};
            this.render();
        }, this.engine.msUntilExpiry(session));
    }

    private scheduleSms(notice: Notice): void {
        setTimeout(() => {
            this.inbox.push(notice);
            if (this.mode.kind === 'idle') {
                this.mode = this.idleOrInbox();
                this.render();
            }
        }, config.smsDelayMs);
    }

    private idleOrInbox(): Mode {
        const notice = this.inbox.shift();
        return notice ? {kind: 'message', source: {type: 'sms', notice}} : {kind: 'idle'};
    }

    private clearTimer(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
    }

    private render(): void {
        this.renderer.render(this.view());
    }

    private view(): View {
        const copy = COPY[this.lang];
        const mode = this.mode;
        switch (mode.kind) {
            case 'idle': {
                const now = this.now();
                const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                return {kind: 'idle', time, date: formatIdleDate(this.lang, now), softkeys: copy.softkeys.idle};
            }
            case 'dialing':
                return {kind: 'dial', value: mode.value, softkeys: copy.softkeys.dialing};
            case 'pending':
                return {kind: 'message', text: copy.pending, centered: true, softkeys: copy.softkeys.pending};
            case 'session': {
                const screen = this.current();
                return {
                    kind: 'session',
                    text: screen.text,
                    input: mode.input,
                    encoding: screen.encoding,
                    softkeys: mode.input ? copy.softkeys.sessionEditing : copy.softkeys.session,
                };
            }
            case 'message': {
                const {source} = mode;
                if (source.type === 'ussd') {
                    const screen = this.current();
                    const centered = this.session!.final?.id === 'end.cancelled';
                    return {
                        kind: 'message',
                        text: screen.text,
                        centered,
                        encoding: screen.encoding,
                        softkeys: copy.softkeys.message
                    };
                }
                const text = source.type === 'unknownCode' ? copy.unknownCode : copy.sms(source.notice);
                return {kind: 'message', text, centered: false, softkeys: copy.softkeys.message};
            }
        }
    }
}
