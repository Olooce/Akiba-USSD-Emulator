import {config} from './config.js';
import type {Account, Transaction, TxnType} from './ussd/types.js';

export const BANKS = ['Pamoja Bank', 'Umoja Bank', 'Jamii Bank'] as const;

const DAY_MS = 86_400_000;

const HISTORY: ReadonlyArray<[TxnType, number]> = [
    ['deposit', 15_000],
    ['withdrawal', -2_000],
    ['airtime', -100],
    ['deposit', 5_000],
    ['withdrawal', -1_500],
    ['airtime', -250],
    ['withdrawal', -3_000],
    ['deposit', 2_500],
    ['airtime', -50],
    ['withdrawal', -1_000],
    ['deposit', 1_000],
    ['airtime', -150],
];

/** Builds a dated history, oldest first, that ends on `balanceCents`. */
function history(balanceCents: number, now: number): Transaction[] {
    let balance = balanceCents - HISTORY.reduce((sum, [, amount]) => sum + amount * 100, 0);
    return HISTORY.map(([type, amount], i) => {
        balance += amount * 100;
        return {at: now - (HISTORY.length - i) * DAY_MS, type, amount, balanceCents: balance};
    });
}

export function createMockAccount(overrides: Partial<Account> = {}, now = Date.now()): Account {
    const balanceCents = overrides.balanceCents ?? 1_245_000;
    return {
        balanceCents,
        pin: '1234',
        pinAttemptsLeft: config.pinAttempts,
        transactions: history(balanceCents, now),
        ...overrides,
    };
}
