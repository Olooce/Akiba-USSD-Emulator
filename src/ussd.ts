export const SERVICE_CODE = '*144#';
export const WITHDRAWAL_FEE = 30;
export const MIN_WITHDRAWAL = 50;
export const MAX_WITHDRAWAL = 70_000;

export type ScreenId =
    | 'main'
    | 'balance'
    | 'withdraw'
    | 'enterPhone'
    | 'enterAmount'
    | 'confirm'
    | 'success'
    | 'cancelled'
    | 'invalidChoice'
    | 'invalidPhone'
    | 'invalidAmount'
    | 'insufficientFunds';

export interface Account {
    msisdn: string;
    balanceCents: number;
}

export interface WithdrawalDraft {
    recipient?: string;
    amount?: number;
}

export interface UssdResponse {
    type: 'CON' | 'END';
    screen: ScreenId;
    maxInput: number;
    draft: Readonly<WithdrawalDraft>;
    balanceCents: number;
}

const INPUT_LIMITS: Partial<Record<ScreenId, number>> = {
    enterPhone: 10,
    enterAmount: 6,
};

const PHONE_PATTERN = /^0[17]\d{8}$/;

export class UssdSession {
    private readonly stack: ScreenId[] = [];
    private draft: WithdrawalDraft = {};
    private closed = false;

    constructor(private readonly account: Account) {
    }

    get isOpen(): boolean {
        return !this.closed && this.stack.length > 0;
    }

    start(): UssdResponse {
        this.stack.length = 0;
        this.draft = {};
        this.closed = false;
        return this.push('main');
    }

    reply(rawInput: string): UssdResponse {
        if (!this.isOpen) throw new Error('USSD session is not open');
        const input = rawInput.trim();
        const current = this.stack[this.stack.length - 1];

        switch (current) {
            case 'main':
                if (input === '1') return this.push('balance');
                if (input === '2') return this.push('withdraw');
                return this.push('invalidChoice');

            case 'balance':
                return input === '0' ? this.back() : this.push('invalidChoice');

            case 'withdraw':
                if (input === '1') {
                    this.draft = {recipient: this.account.msisdn};
                    return this.push('enterAmount');
                }
                if (input === '2') {
                    this.draft = {};
                    return this.push('enterPhone');
                }
                return input === '0' ? this.back() : this.push('invalidChoice');

            case 'enterPhone':
                if (input === '0') return this.back();
                if (!PHONE_PATTERN.test(input)) return this.push('invalidPhone');
                this.draft = {recipient: input};
                return this.push('enterAmount');

            case 'enterAmount': {
                if (input === '0') return this.back();
                const amount = /^\d+$/.test(input) ? Number(input) : NaN;
                if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
                    return this.push('invalidAmount');
                }
                if ((amount + WITHDRAWAL_FEE) * 100 > this.account.balanceCents) {
                    return this.push('insufficientFunds');
                }
                this.draft = {...this.draft, amount};
                return this.push('confirm');
            }

            case 'confirm':
                if (input === '1') {
                    this.account.balanceCents -= ((this.draft.amount ?? 0) + WITHDRAWAL_FEE) * 100;
                    return this.end('success');
                }
                if (input === '2') return this.end('cancelled');
                return this.push('invalidChoice');

            case 'invalidChoice':
            case 'invalidPhone':
            case 'invalidAmount':
            case 'insufficientFunds':
                return input === '0' ? this.back() : this.respond('CON', current);

            default:
                throw new Error(`Unexpected screen ${current}`);
        }
    }

    cancel(): UssdResponse {
        return this.end('cancelled');
    }

    private push(screen: ScreenId): UssdResponse {
        this.stack.push(screen);
        return this.respond('CON', screen);
    }

    private back(): UssdResponse {
        this.stack.pop();
        const previous = this.stack[this.stack.length - 1] ?? 'main';
        if (this.stack.length === 0) this.stack.push(previous);
        return this.respond('CON', previous);
    }

    private end(screen: ScreenId): UssdResponse {
        this.closed = true;
        return this.respond('END', screen);
    }

    private respond(type: UssdResponse['type'], screen: ScreenId): UssdResponse {
        return {
            type,
            screen,
            maxInput: type === 'CON' ? INPUT_LIMITS[screen] ?? 2 : 0,
            draft: {...this.draft},
            balanceCents: this.account.balanceCents,
        };
    }
}
