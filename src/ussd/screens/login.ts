/** Login: the PIN prompt, which every session starts on. */
import {config} from '../../config.js';
import type {Guard, Screen, Validator} from '../types.js';

/** A locked account cannot even see the PIN prompt. */
const notLocked: Guard = {
    messages: [{id: 'pin.locked'}],
    check: ({account}) => (account.pinAttemptsLeft <= 0 ? {id: 'pin.locked'} : null),
};

/** Wrong PINs count down; the last one locks the account. A right PIN resets the count. */
const checkPin: Validator = {
    messages: [{id: 'pin.wrong', vars: {left: config.pinAttempts - 1}}, {id: 'pin.wrongOne'}],
    check: (value, {account}) => {
        if (value === account.pin) {
            account.pinAttemptsLeft = config.pinAttempts;
            return null;
        }
        account.pinAttemptsLeft -= 1;
        if (account.pinAttemptsLeft <= 0) return {end: {id: 'pin.locked'}};
        if (account.pinAttemptsLeft === 1) return {id: 'pin.wrongOne'};
        return {id: 'pin.wrong', vars: {left: account.pinAttemptsLeft}};
    },
};

export const loginScreens: Record<string, Screen> = {
    enterPin: {
        type: 'input',
        prompt: 'pin.prompt',
        guard: notLocked,
        input: {pattern: '^\\d{4}$', maxLength: 4, secret: true, validate: checkPin, error: 'pin.invalid'},
        next: 'main',
        nav: false,
    },
};
