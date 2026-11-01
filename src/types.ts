import type {MessageId} from './messages.js';

export type Lang = 'en' | 'sw';

export type Service = 'withdraw' | 'airtime';
export type Channel = 'mobile' | 'bank';
export type TxnType = 'deposit' | 'withdrawal' | 'airtime';

export interface Transaction {
    at: number;
    type: TxnType;
    amount: number;
    balanceCents: number;
}

export interface Account {
    balanceCents: number;
    pin: string;
    pinAttemptsLeft: number;
    transactions: Transaction[];
}

/** Values the screens collect. Option `set`s and input fields write here. */
export interface SessionData {
    recipient: string;
    service?: Service;
    channel?: Channel;
    bank?: number;
    amount?: number;
    fee?: number;
}

export interface Notice {
    ref: string;
    data: Readonly<SessionData>;
    balanceCents: number;
}

export type Vars = Record<string, string | number | undefined>;

/** A message ID plus the variables its template needs. */
export interface Msg {
    id: MessageId;
    vars?: Vars;
}
