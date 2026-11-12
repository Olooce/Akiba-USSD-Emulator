/** Payments: withdraw (to mobile money or a bank) and buy airtime. They share the amount and confirm screens. */
import {config} from '../../config.js';
import {BANKS} from '../../mockData.js';
import type {Action, ListSource, Screen, Validator} from '../types.js';

const AMOUNT_LIMITS = {withdraw: [50, 70_000], airtime: [10, 10_000]} as const;

const amountAllowed: Validator = {
    messages: [{id: 'amount.invalid', vars: {min: 50, max: 70_000}}, {id: 'amount.noFunds'}],
    check: (value, {account, data}) => {
        const amount = Number(value);
        const [min, max] = AMOUNT_LIMITS[data.service ?? 'withdraw'];
        if (amount < min || amount > max) return {id: 'amount.invalid', vars: {min, max}};
        if ((amount + (data.fee ?? 0)) * 100 > account.balanceCents) return {id: 'amount.noFunds'};
        return null;
    },
};

const banks: ListSource = () => BANKS.map((name) => ({id: 'bank.option', vars: {name}}));

let refCounter = 0;

function transactionRef(now: number): string {
    refCounter = (refCounter + 1) % 1000;
    return `AKB${now.toString(36).toUpperCase().slice(-5)}${String(refCounter).padStart(3, '0')}`;
}

/** Debits amount + fee, adds it to the statement, and sends an SMS notice. */
const commitTransaction: Action = {
    messages: [{id: 'end.success'}],
    run: ({account, data}, now) => {
        const {amount = 0, fee = 0} = data;
        account.balanceCents -= (amount + fee) * 100;
        account.transactions.push({
            at: now,
            type: data.service === 'airtime' ? 'airtime' : 'withdrawal',
            amount: -(amount + fee),
            balanceCents: account.balanceCents,
        });
        return {
            message: {id: 'end.success'},
            transactional: true,
            notice: {ref: transactionRef(now), data: {...data}, balanceCents: account.balanceCents},
        };
    },
};

const cancel: Action = {
    messages: [{id: 'end.cancelled'}],
    run: () => ({message: {id: 'end.cancelled'}}),
};

export const paymentScreens: Record<string, Screen> = {
    withdraw: {
        type: 'menu',
        prompt: 'withdraw.prompt',
        options: {
            1: {label: 'withdraw.mobile', next: 'chooseNumber', set: {service: 'withdraw', channel: 'mobile', fee: 30}},
            2: {label: 'withdraw.bank', next: 'bankList', set: {service: 'withdraw', channel: 'bank', fee: 100}},
        },
    },

    chooseNumber: {
        type: 'menu',
        prompt: {by: 'service', cases: {withdraw: 'number.withdraw', airtime: 'number.airtime'}},
        options: {
            1: {label: 'number.mine', next: 'enterAmount', set: {recipient: config.myNumber}},
            2: {label: 'number.other', next: 'enterPhone'},
        },
    },

    enterPhone: {
        type: 'input',
        prompt: 'phone.prompt',
        input: {name: 'recipient', pattern: '^0[17]\\d{8}$', maxLength: 10, error: 'phone.invalid'},
        next: 'enterAmount',
    },

    bankList: {
        type: 'list',
        prompt: 'bank.prompt',
        items: banks,
        saveAs: 'bank',
        next: 'enterBankAccount',
    },

    enterBankAccount: {
        type: 'input',
        prompt: 'bank.account',
        input: {name: 'recipient', pattern: '^\\d{6,16}$', maxLength: 16, error: 'bank.invalid'},
        next: 'enterAmount',
    },

    enterAmount: {
        type: 'input',
        prompt: 'amount.prompt',
        input: {name: 'amount', pattern: '^\\d{1,6}$', maxLength: 6, type: 'number', validate: amountAllowed, error: 'error.input'},
        next: 'confirm',
    },

    confirm: {
        type: 'menu',
        prompt: {by: 'service', cases: {withdraw: 'confirm.withdraw', airtime: 'confirm.airtime'}},
        options: {
            1: {label: 'confirm.yes', action: commitTransaction},
            2: {label: 'confirm.no', action: cancel},
        },
        inline: true,
        nav: false,
    },
};
