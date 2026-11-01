import {config} from './config.js';
import {BANKS} from './mockData.js';
import type {Lang, Notice, SessionData} from './types.js';

export type {Lang} from './types.js';

export interface SoftkeyLabels {
    left: string;
    right: string;
}

const EN_USSD = {
    'pin.prompt': 'Akiba SACCO\nEnter your 4-digit\nPIN to continue:',
    'pin.invalid': 'PIN must be\n4 digits.\nEnter PIN:',
    'pin.wrong': 'Wrong PIN.\n{{left}} attempts left.\nEnter PIN:',
    'pin.wrongOne': 'Wrong PIN.\n1 attempt left.\nEnter PIN:',
    'pin.locked': 'PIN locked after\n{{pinAttempts}} wrong attempts.\nVisit an Akiba\nbranch to unlock.',

    'main.prompt': 'Akiba SACCO',
    'main.balance': 'Balance Enquiry',
    'main.withdraw': 'Withdraw Money',
    'main.airtime': 'Buy Airtime',
    'main.statement': 'Mini Statement',

    'balance.prompt': 'Account Balance\nKES {{balance|money}}\nAs at {{now|stamp}}',

    'withdraw.prompt': 'Withdraw to:',
    'withdraw.mobile': 'Mobile Money',
    'withdraw.bank': 'Bank Account',

    'number.withdraw': 'Mobile Money',
    'number.airtime': 'Buy Airtime',
    'number.mine': 'My Number',
    'number.other': 'Other Number',

    'phone.prompt': 'Enter phone number:\ne.g. 07XXXXXXXX',
    'phone.invalid': 'Invalid phone number.\nUse 07XXXXXXXX or\n01XXXXXXXX.',

    'bank.prompt': 'Select bank:',
    'bank.option': '{{name}}',
    'bank.account': '{{bank|bankName}}\nEnter account no.:',
    'bank.invalid': 'Invalid account no.\nUse 6 to 16 digits.',

    'amount.prompt': 'To: {{recipient|destination}}\nEnter amount (KES):',
    'amount.invalid': 'Invalid amount.\nEnter KES {{min|kes}} to\n{{max|kes}}.',
    'amount.noFunds': 'Insufficient balance.\nAvailable:\nKES {{balance|money}}',

    'confirm.withdraw': 'Withdraw KES {{amount|kes}}\nto {{recipient|destination}}?\nFee: KES {{fee}}',
    'confirm.airtime': 'Airtime KES {{amount|kes}}\nfor {{recipient}}?',
    'confirm.yes': 'Confirm',
    'confirm.no': 'Cancel',

    'statement.prompt': 'Mini Statement',
    'statement.line': '{{at|date}} {{type|txnType}} {{amount|kes}}',
    'txn.deposit': 'Dep',
    'txn.withdrawal': 'Wdr',
    'txn.airtime': 'Air',

    'dest.bank': '{{bank|bankName}}\nA/C {{recipient}}',

    'error.choice': 'Invalid choice.',
    'error.input': 'Invalid input.',

    'nav.back': 'Back',
    'nav.more': 'More',

    'end.success': 'Request received.\nYou will get an SMS\nconfirmation shortly.\nThank you.',
    'end.cancelled': 'Session cancelled.',
    'end.timeout': 'Connection problem\nor invalid MMI code.',
} as const satisfies Record<string, string>;

export type MessageId = keyof typeof EN_USSD;

export interface Copy {
    softkeys: {
        idle: SoftkeyLabels;
        dialing: SoftkeyLabels;
        pending: SoftkeyLabels;
        session: SoftkeyLabels;
        sessionEditing: SoftkeyLabels;
        message: SoftkeyLabels;
    };
    weekdays: readonly string[];
    months: readonly string[];
    unknownCode: string;
    pending: string;
    sms: (n: Notice) => string;
    ussd: Record<MessageId, string>;
}

export const kes = (value: number, decimals = 0): string =>
    value.toLocaleString('en-KE', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});

export const money = (cents: number): string => kes(cents / 100, 2);

const destination = (d: Readonly<SessionData>): string =>
    d.channel === 'bank' ? `${BANKS[d.bank ?? 0]}\nA/C ${d.recipient}` : d.recipient;

const EN: Copy = {
    softkeys: {
        idle: {left: 'Menu', right: 'Contacts'},
        dialing: {left: 'Call', right: 'Clear'},
        pending: {left: '', right: 'Cancel'},
        session: {left: 'Send', right: 'Cancel'},
        sessionEditing: {left: 'Send', right: 'Clear'},
        message: {left: 'OK', right: ''},
    },
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    unknownCode: `Unknown USSD code.\nDial ${config.serviceCode} for\nAkiba SACCO.`,
    pending: 'Please wait...',
    sms: ({ref, data, balanceCents}) =>
        data.service === 'airtime'
            ? `AKIBA ${ref}\nKES ${kes(data.amount ?? 0)} airtime\nsent to ${data.recipient}.\nBal KES ${money(balanceCents)}`
            : `AKIBA ${ref}\nKES ${kes(data.amount ?? 0)} sent to\n${destination(data)}.\nFee KES ${data.fee}.\nBal KES ${money(balanceCents)}`,
    ussd: EN_USSD,
};

const SW: Copy = {
    softkeys: {
        idle: {left: 'Menyu', right: 'Majina'},
        dialing: {left: 'Piga', right: 'Futa'},
        pending: {left: '', right: 'Ghairi'},
        session: {left: 'Tuma', right: 'Ghairi'},
        sessionEditing: {left: 'Tuma', right: 'Futa'},
        message: {left: 'Sawa', right: ''},
    },
    weekdays: ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'],
    months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
    unknownCode: `Msimbo haujulikani.\nPiga ${config.serviceCode} kwa\nAkiba SACCO.`,
    pending: 'Tafadhali subiri...',
    sms: ({ref, data, balanceCents}) =>
        data.service === 'airtime'
            ? `AKIBA ${ref}\nAirtime KES ${kes(data.amount ?? 0)}\nimetumwa kwa\n${data.recipient}.\nSalio KES ${money(balanceCents)}`
            : `AKIBA ${ref}\nKES ${kes(data.amount ?? 0)} imetumwa\nkwa ${destination(data)}.\nAda KES ${data.fee}.\nSalio KES ${money(balanceCents)}`,
    ussd: {
        'pin.prompt': 'Akiba SACCO\nWeka PIN yako ya\ntarakimu 4:',
        'pin.invalid': 'PIN ni tarakimu 4.\nWeka PIN:',
        'pin.wrong': 'PIN si sahihi.\nMajaribio {{left}}\nyamebaki.\nWeka PIN:',
        'pin.wrongOne': 'PIN si sahihi.\nJaribio 1\nlimebaki.\nWeka PIN:',
        'pin.locked': 'PIN imefungwa baada\nya majaribio {{pinAttempts}}.\nTembelea tawi la\nAkiba kuifungua.',

        'main.prompt': 'Akiba SACCO',
        'main.balance': 'Angalia Salio',
        'main.withdraw': 'Toa Pesa',
        'main.airtime': 'Nunua Airtime',
        'main.statement': 'Taarifa Fupi',

        'balance.prompt': 'Salio la Akaunti\nKES {{balance|money}}\nKufikia {{now|stamp}}',

        'withdraw.prompt': 'Toa pesa kwenda:',
        'withdraw.mobile': 'Pesa ya Simu',
        'withdraw.bank': 'Akaunti ya Benki',

        'number.withdraw': 'Pesa ya Simu',
        'number.airtime': 'Nunua Airtime',
        'number.mine': 'Nambari Yangu',
        'number.other': 'Nambari Nyingine',

        'phone.prompt': 'Weka nambari ya simu:\nmfano 07XXXXXXXX',
        'phone.invalid': 'Nambari si sahihi.\nTumia 07XXXXXXXX au\n01XXXXXXXX.',

        'bank.prompt': 'Chagua benki:',
        'bank.option': '{{name}}',
        'bank.account': '{{bank|bankName}}\nWeka nambari ya\nakaunti:',
        'bank.invalid': 'Akaunti si sahihi.\nTumia tarakimu\n6 hadi 16.',

        'amount.prompt': 'Kwa: {{recipient|destination}}\nWeka kiasi (KES):',
        'amount.invalid': 'Kiasi si sahihi.\nWeka KES {{min|kes}} hadi\n{{max|kes}}.',
        'amount.noFunds': 'Salio halitoshi.\nSalio lako:\nKES {{balance|money}}',

        'confirm.withdraw': 'Toa KES {{amount|kes}}\nkwa {{recipient|destination}}?\nAda: KES {{fee}}',
        'confirm.airtime': 'Airtime KES {{amount|kes}}\nkwa {{recipient}}?',
        'confirm.yes': 'Ndiyo',
        'confirm.no': 'Hapana',

        'statement.prompt': 'Taarifa Fupi',
        'statement.line': '{{at|date}} {{type|txnType}} {{amount|kes}}',
        'txn.deposit': 'Wek',
        'txn.withdrawal': 'Toa',
        'txn.airtime': 'Air',

        'dest.bank': '{{bank|bankName}}\nA/C {{recipient}}',

        'error.choice': 'Chaguo si sahihi.',
        'error.input': 'Jibu si sahihi.',

        'nav.back': 'Rudi',
        'nav.more': 'Zaidi',

        'end.success': 'Ombi limepokelewa.\nUtapokea SMS ya\nuthibitisho punde.\nAsante.',
        'end.cancelled': 'Huduma imesitishwa.',
        'end.timeout': 'Tatizo la mtandao\nau msimbo wa MMI\nsi sahihi.',
    },
};

export const COPY: Record<Lang, Copy> = {en: EN, sw: SW};

export function formatIdleDate(lang: Lang, d: Date): string {
    const c = COPY[lang];
    return `${c.weekdays[d.getDay()]} ${d.getDate()} ${c.months[d.getMonth()]}`;
}
