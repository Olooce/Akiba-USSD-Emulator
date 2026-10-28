import {COPY, formatIdleDate, type Lang, type SoftkeyLabels} from './messages.js';
import {type Account, LIMITS, measureUssd, type Notice, SERVICE_CODE, type UssdResponse, UssdSession} from './ussd.js';

export const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;
export type DigitKey = (typeof DIGIT_KEYS)[number];
export type PhoneKey = DigitKey | 'call' | 'end' | 'soft-left' | 'soft-right' | 'ok';

export type View = { softkeys: SoftkeyLabels } & (
    | { kind: 'idle'; time: string; date: string }
    | { kind: 'dial'; value: string }
    | { kind: 'session'; text: string; input: string }
    | { kind: 'message'; text: string; centered: boolean }
    );

export interface Renderer {
    render(view: View): void;
}

type Mode =
    | { kind: 'idle' }
    | { kind: 'dialing'; value: string }
    | { kind: 'pending' }
    | { kind: 'session'; response: UssdResponse; input: string }
    | {
    kind: 'message';
    source: { type: 'response'; response: UssdResponse } | { type: 'unknownCode' } | { type: 'sms'; notice: Notice };
};

const MAX_DIAL_LENGTH = 20;

const isDigitKey = (key: PhoneKey): key is DigitKey => (DIGIT_KEYS as readonly string[]).includes(key);
const isSendKey = (key: PhoneKey): boolean => key === 'call' || key === 'soft-left' || key === 'ok';

function fitUssd(text: string): string {
    const {scheme, units, limit} = measureUssd(text);
    if (units <= limit) return text;
    console.warn(`[Akiba emulator] ${scheme} message is ${units}/${limit} units and will be truncated.`);
    let out = text;
    while (measureUssd(out).units > limit) out = out.slice(0, -1);
    return out;
}

export class FeaturePhone {
    private mode: Mode = {kind: 'idle'};
    private readonly session: UssdSession;
    private readonly inbox: Notice[] = [];
    private timer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly renderer: Renderer,
        account: Account,
        private lang: Lang = 'en',
        private readonly now: () => Date = () => new Date(),
    ) {
        this.session = new UssdSession(account, () => this.now().getTime());
        this.render();
    }

    get language(): Lang {
        return this.lang;
    }

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
                    return mode.value === SERVICE_CODE
                        ? this.request(() => this.session.start())
                        : {kind: 'message', source: {type: 'unknownCode'}};
                }
                return mode;

            case 'pending':
                if (key !== 'soft-right' && key !== 'end') return mode;
                this.clearTimer();
                return this.toMessage(this.session.cancel());

            case 'session':
                if (/^\d$/.test(key)) {
                    return mode.input.length < mode.response.maxInput ? {...mode, input: mode.input + key} : mode;
                }
                if (key === 'soft-right' && mode.input) return {...mode, input: mode.input.slice(0, -1)};
                if (key === 'soft-right' || key === 'end') {
                    this.clearTimer();
                    return this.toMessage(this.session.cancel());
                }
                if (isSendKey(key) && mode.input) {
                    const input = mode.input;
                    return this.request(() => this.session.reply(input));
                }
                return mode;

            case 'message':
                return isSendKey(key) || key === 'end' ? this.idleOrInbox() : mode;
        }
    }

    private request(send: () => UssdResponse): Mode {
        this.clearTimer();
        const response = send();
        if (response.notice) this.scheduleSms(response.notice);
        const delay = response.transactional ? LIMITS.transactionMs : LIMITS.responseMs;
        this.timer = setTimeout(() => this.deliver(response), delay);
        return {kind: 'pending'};
    }

    private deliver(response: UssdResponse): void {
        this.timer = undefined;
        const expiry = response.type === 'CON' ? this.session.expiry() : null;
        if (expiry) {
            this.mode = this.toMessage(this.session.expire(expiry));
        } else if (response.type === 'END') {
            this.mode = this.toMessage(response);
        } else {
            this.mode = {kind: 'session', response, input: ''};
            this.scheduleExpiry();
        }
        this.render();
    }

    /** The network releases idle or over-long sessions, whatever is on screen. */
    private scheduleExpiry(): void {
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const expiry = this.session.expiry();
            if (!expiry) return this.scheduleExpiry();
            this.mode = this.toMessage(this.session.expire(expiry));
            this.render();
        }, this.session.msUntilExpiry());
    }

    private scheduleSms(notice: Notice): void {
        setTimeout(() => {
            this.inbox.push(notice);
            if (this.mode.kind === 'idle') {
                this.mode = this.idleOrInbox();
                this.render();
            }
        }, LIMITS.smsDelayMs);
    }

    private idleOrInbox(): Mode {
        const notice = this.inbox.shift();
        return notice ? {kind: 'message', source: {type: 'sms', notice}} : {kind: 'idle'};
    }

    private clearTimer(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
    }

    private toMessage(response: UssdResponse): Mode {
        return {kind: 'message', source: {type: 'response', response}};
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
            case 'session':
                return {
                    kind: 'session',
                    text: fitUssd(copy.screens[mode.response.screen](mode.response)),
                    input: mode.response.masked ? '*'.repeat(mode.input.length) : mode.input,
                    softkeys: mode.input ? copy.softkeys.sessionEditing : copy.softkeys.session,
                };
            case 'message': {
                const {source} = mode;
                const text =
                    source.type === 'unknownCode' ? copy.unknownCode
                        : source.type === 'sms' ? copy.sms(source.notice)
                            : fitUssd(copy.screens[source.response.screen](source.response));
                const centered = source.type === 'response' && source.response.screen === 'cancelled';
                return {kind: 'message', text, centered, softkeys: copy.softkeys.message};
            }
        }
    }
}
