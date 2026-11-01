import {config} from './config.js';
import type {Session} from './engine.js';
import type {Msg} from './types.js';

/** `null` = valid, a `Msg` = show it and stay, `{end}` = close the session with that message. */
export type Verdict = null | Msg | { end: Msg };

export interface Validator {
    /** Every message `run` can return, so the startup checks can measure them. */
    messages: Msg[];
    run: (value: string | number, session: Session) => Verdict;
}

export interface Guard {
    messages: Msg[];
    /** Returns an end message when the screen may not be entered. */
    run: (session: Session) => Msg | null;
}

const AMOUNT_LIMITS = {withdraw: [50, 70_000], airtime: [10, 10_000]} as const;

export const validators = {
    checkPin: {
        messages: [{id: 'pin.wrong', vars: {left: config.pinAttempts - 1}}, {id: 'pin.wrongOne'}],
        run: (value, {account}) => {
            if (value === account.pin) {
                account.pinAttemptsLeft = config.pinAttempts;
                return null;
            }
            account.pinAttemptsLeft -= 1;
            if (account.pinAttemptsLeft <= 0) return {end: {id: 'pin.locked'}};
            return account.pinAttemptsLeft === 1
                ? {id: 'pin.wrongOne'}
                : {id: 'pin.wrong', vars: {left: account.pinAttemptsLeft}};
        },
    },
    amountAllowed: {
        messages: [{id: 'amount.invalid', vars: {min: 50, max: 70_000}}, {id: 'amount.noFunds'}],
        run: (value, {account, data}) => {
            const amount = Number(value);
            const [min, max] = AMOUNT_LIMITS[data.service ?? 'withdraw'];
            if (amount < min || amount > max) return {id: 'amount.invalid', vars: {min, max}};
            if ((amount + (data.fee ?? 0)) * 100 > account.balanceCents) return {id: 'amount.noFunds'};
            return null;
        },
    },
} satisfies Record<string, Validator>;

export const guards = {
    notLocked: {
        messages: [{id: 'pin.locked'}],
        run: ({account}) => (account.pinAttemptsLeft <= 0 ? {id: 'pin.locked'} : null),
    },
} satisfies Record<string, Guard>;

export type ValidatorName = keyof typeof validators;
export type GuardName = keyof typeof guards;
