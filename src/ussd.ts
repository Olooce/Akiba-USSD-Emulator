export const SERVICE_CODE = '*144#';

export const MOBILE_FEE = 30;
export const BANK_FEE = 100;
export const MIN_WITHDRAWAL = 50;
export const MAX_WITHDRAWAL = 70_000;
export const MIN_AIRTIME = 10;
export const MAX_AIRTIME = 10_000;
export const PIN_ATTEMPTS = 3;

export const BANKS = ['Pamoja Bank', 'Umoja Bank', 'Jamii Bank'] as const;

export const LIMITS = {
    sessionMs: 180_000,
    inactivityMs: 30_000,
    responseMs: 600,
    transactionMs: 1_500,
    smsDelayMs: 4_000,
    gsm7Units: 182,
    ucs2Units: 80,
} as const;

export type ScreenId =
    | 'main'
    | 'enterPin'
    | 'wrongPin'
    | 'invalidPin'
    | 'pinLocked'
    | 'balance'
    | 'withdraw'
    | 'chooseNumber'
    | 'enterPhone'
    | 'bankList'
    | 'enterBankAccount'
    | 'enterAmount'
    | 'confirm'
    | 'success'
    | 'cancelled'
    | 'timeout'
    | 'invalidChoice'
    | 'invalidPhone'
    | 'invalidAccount'
    | 'invalidAmount'
    | 'insufficientFunds';

export type Service = 'withdraw' | 'airtime';
export type Channel = 'mobile' | 'bank';
export type Expiry = 'inactivity' | 'duration';

export interface Account {
    msisdn: string;
    balanceCents: number;
    pin: string;
    pinAttemptsLeft: number;
}

export interface Draft {
    service?: Service;
    channel?: Channel;
    bank?: number;
    recipient?: string;
    amount?: number;
    fee?: number;
}


export interface Notice {
    ref: string;
    draft: Readonly<Draft>;
    balanceCents: number;
}

export interface UssdResponse {
    type: 'CON' | 'END';
    screen: ScreenId;
    maxInput: number;
    masked: boolean;
    transactional: boolean;
    draft: Readonly<Draft>;
    balanceCents: number;
    pinAttemptsLeft: number;
    expiry?: Expiry;
    notice?: Notice;
}

export interface Encoding {
    scheme: 'GSM-7' | 'UCS-2';
    units: number;
    limit: number;
}

const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export function measureUssd(text: string): Encoding {
    let septets = 0;
    for (const ch of text) {
        if (GSM7_BASIC.includes(ch)) septets += 1;
        else if (GSM7_EXTENDED.includes(ch)) septets += 2;
        else return {scheme: 'UCS-2', units: text.length, limit: LIMITS.ucs2Units};
    }
    return {scheme: 'GSM-7', units: septets, limit: LIMITS.gsm7Units};
}

const INPUT_LIMITS: Partial<Record<ScreenId, number>> = {
    enterPin: 4,
    wrongPin: 4,
    invalidPin: 4,
    enterPhone: 10,
    enterBankAccount: 16,
    enterAmount: 6,
};

const PIN_SCREENS: ReadonlySet<ScreenId> = new Set(['enterPin', 'wrongPin', 'invalidPin']);

const PHONE_PATTERN = /^0[17]\d{8}$/;
const BANK_ACCOUNT_PATTERN = /^\d{6,16}$/;
const PIN_PATTERN = /^\d{4}$/;

export const amountLimits = (service: Service | undefined): [number, number] =>
    service === 'airtime' ? [MIN_AIRTIME, MAX_AIRTIME] : [MIN_WITHDRAWAL, MAX_WITHDRAWAL];

let refCounter = 0;

function transactionRef(now: number): string {
    refCounter = (refCounter + 1) % 1000;
    return `AKB${now.toString(36).toUpperCase().slice(-5)}${String(refCounter).padStart(3, '0')}`;
}

export class UssdSession {
    private readonly stack: ScreenId[] = [];
    private draft: Draft = {};
    private closed = false;
    private startedAt = 0;
    private lastActivityAt = 0;

    constructor(
        private readonly account: Account,
        private readonly now: () => number = Date.now,
    ) {
    }

    get isOpen(): boolean {
        return !this.closed && this.stack.length > 0;
    }

    start(): UssdResponse {
        this.stack.length = 0;
        this.draft = {};
        this.closed = false;
        this.startedAt = this.lastActivityAt = this.now();
        if (this.account.pinAttemptsLeft <= 0) return this.end('pinLocked');
        return this.push('enterPin');
    }

    reply(rawInput: string): UssdResponse {
        if (!this.isOpen) throw new Error('USSD session is not open');
        const expiry = this.expiry();
        if (expiry) return this.expire(expiry);
        this.lastActivityAt = this.now();
        return this.route(this.stack[this.stack.length - 1], rawInput.trim());
    }

    cancel(): UssdResponse {
        return this.end('cancelled');
    }

    expiry(): Expiry | null {
        const now = this.now();
        if (now - this.startedAt >= LIMITS.sessionMs) return 'duration';
        if (now - this.lastActivityAt >= LIMITS.inactivityMs) return 'inactivity';
        return null;
    }

     msUntilExpiry(): number {
        const now = this.now();
        return Math.max(0, Math.min(this.startedAt + LIMITS.sessionMs, this.lastActivityAt + LIMITS.inactivityMs) - now);
    }

    /** Releases the session. */
    expire(reason: Expiry): UssdResponse {
        return this.end('timeout', {expiry: reason});
    }

    private route(current: ScreenId, input: string): UssdResponse {
        switch (current) {
            case 'main':
                if (input === '1') return this.push('balance');
                if (input === '2') return this.push('withdraw');
                if (input === '3') {
                    this.draft = {service: 'airtime', fee: 0};
                    return this.push('chooseNumber');
                }
                return this.push('invalidChoice');

            case 'enterPin':
            case 'wrongPin':
            case 'invalidPin':
                return this.checkPin(input);

            case 'balance':
                return input === '0' ? this.back() : this.push('invalidChoice');

            case 'withdraw':
                if (input === '1') {
                    this.draft = {service: 'withdraw', channel: 'mobile', fee: MOBILE_FEE};
                    return this.push('chooseNumber');
                }
                if (input === '2') {
                    this.draft = {service: 'withdraw', channel: 'bank', fee: BANK_FEE};
                    return this.push('bankList');
                }
                return input === '0' ? this.back() : this.push('invalidChoice');

            case 'chooseNumber':
                if (input === '1') {
                    this.draft = {...this.draft, recipient: this.account.msisdn};
                    return this.push('enterAmount');
                }
                if (input === '2') return this.push('enterPhone');
                return input === '0' ? this.back() : this.push('invalidChoice');

            case 'enterPhone':
                if (input === '0') return this.back();
                if (!PHONE_PATTERN.test(input)) return this.push('invalidPhone');
                this.draft = {...this.draft, recipient: input};
                return this.push('enterAmount');

            case 'bankList': {
                if (input === '0') return this.back();
                const bank = Number(input) - 1;
                if (!Number.isInteger(bank) || !(bank in BANKS)) return this.push('invalidChoice');
                this.draft = {...this.draft, bank};
                return this.push('enterBankAccount');
            }

            case 'enterBankAccount':
                if (input === '0') return this.back();
                if (!BANK_ACCOUNT_PATTERN.test(input)) return this.push('invalidAccount');
                this.draft = {...this.draft, recipient: input};
                return this.push('enterAmount');

            case 'enterAmount': {
                if (input === '0') return this.back();
                const [min, max] = amountLimits(this.draft.service);
                const amount = /^\d+$/.test(input) ? Number(input) : NaN;
                if (!Number.isInteger(amount) || amount < min || amount > max) return this.push('invalidAmount');
                if ((amount + (this.draft.fee ?? 0)) * 100 > this.account.balanceCents) {
                    return this.push('insufficientFunds');
                }
                this.draft = {...this.draft, amount};
                return this.push('confirm');
            }

            case 'confirm':
                if (input === '1') return this.commit();
                if (input === '2') return this.end('cancelled');
                return this.push('invalidChoice');

            case 'invalidChoice':
            case 'invalidPhone':
            case 'invalidAccount':
            case 'invalidAmount':
            case 'insufficientFunds':
                return input === '0' ? this.back() : this.respond('CON', current);

            default:
                throw new Error(`Unexpected screen ${current}`);
        }
    }

    private checkPin(input: string): UssdResponse {
        if (!PIN_PATTERN.test(input)) return this.replace('invalidPin');
        if (input !== this.account.pin) {
            this.account.pinAttemptsLeft -= 1;
            return this.account.pinAttemptsLeft > 0 ? this.replace('wrongPin') : this.end('pinLocked');
        }
        this.account.pinAttemptsLeft = PIN_ATTEMPTS;
        return this.replace('main');
    }

    private commit(): UssdResponse {
        const {amount = 0, fee = 0} = this.draft;
        this.account.balanceCents -= (amount + fee) * 100;
        const notice: Notice = {
            ref: transactionRef(this.now()),
            draft: {...this.draft},
            balanceCents: this.account.balanceCents,
        };
        return this.end('success', {transactional: true, notice});
    }

    private push(screen: ScreenId): UssdResponse {
        this.stack.push(screen);
        return this.respond('CON', screen);
    }

    private replace(screen: ScreenId): UssdResponse {
        this.stack[this.stack.length - 1] = screen;
        return this.respond('CON', screen);
    }

    private back(): UssdResponse {
        this.stack.pop();
        const previous = this.stack[this.stack.length - 1] ?? 'main';
        if (this.stack.length === 0) this.stack.push(previous);
        return this.respond('CON', previous);
    }

    private end(screen: ScreenId, extra: Partial<UssdResponse> = {}): UssdResponse {
        this.closed = true;
        return {...this.respond('END', screen), ...extra};
    }

    private respond(type: UssdResponse['type'], screen: ScreenId): UssdResponse {
        return {
            type,
            screen,
            maxInput: type === 'CON' ? INPUT_LIMITS[screen] ?? 2 : 0,
            masked: PIN_SCREENS.has(screen),
            transactional: false,
            draft: {...this.draft},
            balanceCents: this.account.balanceCents,
            pinAttemptsLeft: this.account.pinAttemptsLeft,
        };
    }
}
