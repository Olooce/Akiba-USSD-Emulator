import {MAX_WITHDRAWAL, MIN_WITHDRAWAL, type ScreenId, type UssdResponse, WITHDRAWAL_FEE} from './ussd.js';

export type Lang = 'en' | 'sw';

export interface SoftkeyLabels {
    left: string;
    right: string;
}

interface Copy {
    softkeys: {
        idle: SoftkeyLabels;
        dialing: SoftkeyLabels;
        session: SoftkeyLabels;
        sessionEditing: SoftkeyLabels;
        message: SoftkeyLabels;
    };
    weekdays: readonly string[];
    months: readonly string[];
    unknownCode: string;
    screens: Record<ScreenId, (r: UssdResponse) => string>;
}

const kes = (value: number, decimals = 0): string =>
    value.toLocaleString('en-KE', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});

const balance = (r: UssdResponse): string => kes(r.balanceCents / 100, 2);

const stamp = (d = new Date()): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EN: Copy = {
    softkeys: {
        idle: {left: 'Menu', right: 'Contacts'},
        dialing: {left: 'Call', right: 'Clear'},
        session: {left: 'Send', right: 'Cancel'},
        sessionEditing: {left: 'Send', right: 'Clear'},
        message: {left: 'OK', right: ''},
    },
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    unknownCode: 'Unknown USSD code.\nDial *144# for\nAkiba SACCO.',
    screens: {
        main: () => 'Akiba SACCO\n1. Balance Enquiry\n2. Withdraw Money',
        balance: (r) => `Account Balance\nKES ${balance(r)}\nAs at ${stamp()}\n0. Back`,
        withdraw: () => 'Withdraw Money\n1. My Number\n2. Other Number\n0. Back',
        enterPhone: () => 'Enter phone number:\ne.g. 07XXXXXXXX\n0. Back',
        enterAmount: (r) => `To: ${r.draft.recipient}\nEnter amount (KES):\n0. Back`,
        confirm: (r) =>
            `Withdraw KES ${kes(r.draft.amount ?? 0)}\nto ${r.draft.recipient}?\nFee: KES ${WITHDRAWAL_FEE}\n1. Confirm\n2. Cancel`,
        success: () => 'Request received.\nYou will get an SMS\nconfirmation shortly.\nThank you.',
        cancelled: () => 'Session cancelled.',
        invalidChoice: () => 'Invalid choice.\nPlease try again.\n0. Back',
        invalidPhone: () => 'Invalid phone number.\nUse 07XXXXXXXX or\n01XXXXXXXX.\n0. Back',
        invalidAmount: () => `Invalid amount.\nEnter KES ${MIN_WITHDRAWAL} to\n${kes(MAX_WITHDRAWAL)}.\n0. Back`,
        insufficientFunds: (r) => `Insufficient balance.\nAvailable:\nKES ${balance(r)}\n0. Back`,
    },
};

const SW: Copy = {
    softkeys: {
        idle: {left: 'Menyu', right: 'Majina'},
        dialing: {left: 'Piga', right: 'Futa'},
        session: {left: 'Tuma', right: 'Ghairi'},
        sessionEditing: {left: 'Tuma', right: 'Futa'},
        message: {left: 'Sawa', right: ''},
    },
    weekdays: ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'],
    months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
    unknownCode: 'Msimbo haujulikani.\nPiga *144# kwa\nAkiba SACCO.',
    screens: {
        main: () => 'Akiba SACCO\n1. Angalia Salio\n2. Toa Pesa',
        balance: (r) => `Salio la Akaunti\nKES ${balance(r)}\nKufikia ${stamp()}\n0. Rudi`,
        withdraw: () => 'Toa Pesa\n1. Nambari Yangu\n2. Nambari Nyingine\n0. Rudi',
        enterPhone: () => 'Weka nambari ya simu:\nmfano 07XXXXXXXX\n0. Rudi',
        enterAmount: (r) => `Kwa: ${r.draft.recipient}\nWeka kiasi (KES):\n0. Rudi`,
        confirm: (r) =>
            `Toa KES ${kes(r.draft.amount ?? 0)}\nkwa ${r.draft.recipient}?\nAda: KES ${WITHDRAWAL_FEE}\n1. Thibitisha\n2. Ghairi`,
        success: () => 'Ombi limepokelewa.\nUtapokea SMS ya\nuthibitisho hivi punde.\nAsante.',
        cancelled: () => 'Huduma imesitishwa.',
        invalidChoice: () => 'Chaguo si sahihi.\nTafadhali jaribu\ntena.\n0. Rudi',
        invalidPhone: () => 'Nambari si sahihi.\nTumia 07XXXXXXXX au\n01XXXXXXXX.\n0. Rudi',
        invalidAmount: () => `Kiasi si sahihi.\nWeka KES ${MIN_WITHDRAWAL} hadi\n${kes(MAX_WITHDRAWAL)}.\n0. Rudi`,
        insufficientFunds: (r) => `Salio halitoshi.\nSalio lako:\nKES ${balance(r)}\n0. Rudi`,
    },
};

export const COPY: Record<Lang, Copy> = {en: EN, sw: SW};

export function formatIdleDate(lang: Lang, d: Date): string {
    const c = COPY[lang];
    return `${c.weekdays[d.getDay()]} ${d.getDate()} ${c.months[d.getMonth()]}`;
}
