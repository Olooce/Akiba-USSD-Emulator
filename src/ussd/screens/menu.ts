/** The main menu (home) and the balance screen. */
import type {Screen} from '../types.js';

export const menuScreens: Record<string, Screen> = {
    main: {
        type: 'menu',
        prompt: 'main.prompt',
        options: {
            1: {label: 'main.balance', next: 'balance'},
            2: {label: 'main.withdraw', next: 'withdraw'},
            // 3: {label: 'main.deposit', next: 'withdraw'},
            3: {label: 'main.airtime', next: 'chooseNumber', set: {service: 'airtime', channel: 'mobile', fee: 0}},
            4: {label: 'main.statement', next: 'miniStatement'},
        },
        nav: false,
    },

    balance: {
        type: 'info',
        prompt: 'balance.prompt',
    },
};
