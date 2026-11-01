import type {ActionName} from './actions.js';
import {config} from './config.js';
import type {MessageId} from './messages.js';
import type {ResolverName} from './resolvers.js';
import type {SessionData} from './types.js';
import type {GuardName, ValidatorName} from './validators.js';

export interface Option {
    label: MessageId;
    next?: string;
    action?: ActionName;
    set?: Partial<SessionData>;
}

export interface PromptCases {
    by: keyof SessionData;
    cases: Record<string, MessageId>;
}

export interface InputSpec {
    name?: keyof SessionData;
    pattern: string;
    maxLength: number;
    type?: 'text' | 'number';
    secret?: boolean;
    validate?: ValidatorName;
    error: MessageId;
}

/**
 * One screen of the menu. Its kind follows from which field it has:
 * `options` / `optionsFrom` (menu), `input` (free text), `resolver` (paginated lines),
 * or none of them (display only: the user can just go back or home).
 */
export interface Screen {
    prompt: MessageId | PromptCases;
    options?: Record<string, Option>;
    inline?: boolean;
    optionsFrom?: ResolverName;
    select?: keyof SessionData;
    input?: InputSpec;
    resolver?: ResolverName;
    next?: string;
    action?: ActionName;
    /** Allow `0` (back) and `00` (home). Defaults to true. */
    nav?: boolean;
    back?: string;
    guard?: GuardName;
}

export interface Registry {
    entry: string;
    home: string;
    screens: Record<string, Screen>;
}

export const screens = {
    enterPin: {
        prompt: 'pin.prompt',
        guard: 'notLocked',
        input: {
            pattern: '^\\d{4}$', maxLength: 4, secret: true,
            validate: 'checkPin', error: 'pin.invalid',
        },
        next: 'main',
        nav: false,
    },

    main: {
        prompt: 'main.prompt',
        options: {
            1: {label: 'main.balance', next: 'balance'},
            2: {label: 'main.withdraw', next: 'withdraw'},
            3: {label: 'main.airtime', next: 'chooseNumber', set: {service: 'airtime', channel: 'mobile', fee: 0}},
            4: {label: 'main.statement', next: 'miniStatement'},
        },
        nav: false,
    },

    balance: {
        prompt: 'balance.prompt',
    },

    withdraw: {
        prompt: 'withdraw.prompt',
        options: {
            1: {label: 'withdraw.mobile', next: 'chooseNumber', set: {service: 'withdraw', channel: 'mobile', fee: 30}},
            2: {label: 'withdraw.bank', next: 'bankList', set: {service: 'withdraw', channel: 'bank', fee: 100}},
        },
    },

    chooseNumber: {
        prompt: {by: 'service', cases: {withdraw: 'number.withdraw', airtime: 'number.airtime'}},
        options: {
            1: {label: 'number.mine', next: 'enterAmount', set: {recipient: config.myNumber}},
            2: {label: 'number.other', next: 'enterPhone'},
        },
    },

    enterPhone: {
        prompt: 'phone.prompt',
        input: {name: 'recipient', pattern: '^0[17]\\d{8}$', maxLength: 10, error: 'phone.invalid'},
        next: 'enterAmount',
    },

    bankList: {
        prompt: 'bank.prompt',
        optionsFrom: 'banks',
        select: 'bank',
        next: 'enterBankAccount',
    },

    enterBankAccount: {
        prompt: 'bank.account',
        input: {name: 'recipient', pattern: '^\\d{6,16}$', maxLength: 16, error: 'bank.invalid'},
        next: 'enterAmount',
    },

    enterAmount: {
        prompt: 'amount.prompt',
        input: {
            name: 'amount', pattern: '^\\d{1,6}$', maxLength: 6, type: 'number',
            validate: 'amountAllowed', error: 'error.input',
        },
        next: 'confirm',
    },

    confirm: {
        prompt: {by: 'service', cases: {withdraw: 'confirm.withdraw', airtime: 'confirm.airtime'}},
        options: {
            1: {label: 'confirm.yes', action: 'commitTransaction'},
            2: {label: 'confirm.no', action: 'cancel'},
        },
        inline: true,
        nav: false,
    },

    miniStatement: {
        prompt: 'statement.prompt',
        resolver: 'miniStatement',
    },
} satisfies Record<string, Screen>;

export type ScreenId = keyof typeof screens;

export const registry: Registry = {entry: 'enterPin', home: 'main', screens};

export const SAMPLE_DATA: SessionData[] = [
    {service: 'withdraw', channel: 'mobile', recipient: '0712345678', amount: 70_000, fee: 30},
    {service: 'withdraw', channel: 'bank', bank: 0, recipient: '1234567890123456', amount: 70_000, fee: 100},
    {service: 'airtime', channel: 'mobile', recipient: '0712345678', amount: 10_000, fee: 0},
];
