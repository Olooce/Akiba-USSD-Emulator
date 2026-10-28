import {
    amountLimits,
    BANKS,
    type Draft,
    type Notice,
    PIN_ATTEMPTS,
    type ScreenId,
    SERVICE_CODE,
    type UssdResponse,
} from './ussd.js';

export type Lang = 'en' | 'sw';

export interface SoftkeyLabels {
    left: string;
    right: string;
}

interface Copy {
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
    screens: Record<ScreenId, (r: UssdResponse) => string>;
}

const kes = (value: number, decimals = 0): string =>
    value.toLocaleString('en-KE', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});

const balance = (cents: number): string => kes(cents / 100, 2);

const stamp = (d = new Date()): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const bankName = (d: Readonly<Draft>): string => BANKS[d.bank ?? 0];

const destination = (d: Readonly<Draft>): string =>
    d.channel === 'bank' ? `${bankName(d)}\nA/C ${d.recipient}` : `${d.recipient}`;

const limitsOf = (r: UssdResponse) => amountLimits(r.draft.service).map((n) => kes(n));

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
    unknownCode: `Unknown USSD code.\nDial ${SERVICE_CODE} for\nAkiba SACCO.`,
    pending: 'Please wait...',
    sms: ({ref, draft, balanceCents}) =>
        draft.service === 'airtime'
            ? `AKIBA ${ref}\nKES ${kes(draft.amount ?? 0)} airtime\nsent to ${draft.recipient}.\nBal KES ${balance(balanceCents)}`
            : `AKIBA ${ref}\nKES ${kes(draft.amount ?? 0)} sent to\n${destination(draft)}.\nFee KES ${draft.fee}.\nBal KES ${balance(balanceCents)}`,
    screens: {
        main: () => 'Akiba SACCO\n1. Balance Enquiry\n2. Withdraw Money\n3. Buy Airtime',
        enterPin: () => 'Akiba SACCO\nEnter your 4-digit\nPIN to continue:',
        wrongPin: (r) =>
            `Wrong PIN.\n${r.pinAttemptsLeft} ${r.pinAttemptsLeft === 1 ? 'attempt' : 'attempts'} left.\nEnter PIN:`,
        invalidPin: () => 'PIN must be\n4 digits.\nEnter PIN:',
        pinLocked: () => `PIN locked after\n${PIN_ATTEMPTS} wrong attempts.\nVisit an Akiba\nbranch to unlock.`,
        balance: (r) => `Account Balance\nKES ${balance(r.balanceCents)}\nAs at ${stamp()}\n0. Back`,
        withdraw: () => 'Withdraw to:\n1. Mobile Money\n2. Bank Account\n0. Back',
        chooseNumber: (r) =>
            `${r.draft.service === 'airtime' ? 'Buy Airtime' : 'Mobile Money'}\n1. My Number\n2. Other Number\n0. Back`,
        enterPhone: () => 'Enter phone number:\ne.g. 07XXXXXXXX\n0. Back',
        bankList: () => `Select bank:\n${BANKS.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n0. Back`,
        enterBankAccount: (r) => `${bankName(r.draft)}\nEnter account no.:\n0. Back`,
        enterAmount: (r) => `To: ${destination(r.draft)}\nEnter amount (KES):\n0. Back`,
        confirm: (r) =>
            r.draft.service === 'airtime'
                ? `Airtime KES ${kes(r.draft.amount ?? 0)}\nfor ${r.draft.recipient}?\n1. Confirm 2. Cancel`
                : `Withdraw KES ${kes(r.draft.amount ?? 0)}\nto ${destination(r.draft)}?\nFee: KES ${r.draft.fee}\n1. Confirm 2. Cancel`,
        success: () => 'Request received.\nYou will get an SMS\nconfirmation shortly.\nThank you.',
        cancelled: () => 'Session cancelled.',
        timeout: () => 'Connection problem\nor invalid MMI code.',
        invalidChoice: () => 'Invalid choice.\nPlease try again.\n0. Back',
        invalidPhone: () => 'Invalid phone number.\nUse 07XXXXXXXX or\n01XXXXXXXX.\n0. Back',
        invalidAccount: () => 'Invalid account no.\nUse 6 to 16 digits.\n0. Back',
        invalidAmount: (r) => {
            const [min, max] = limitsOf(r);
            return `Invalid amount.\nEnter KES ${min} to\n${max}.\n0. Back`;
        },
        insufficientFunds: (r) => `Insufficient balance.\nAvailable:\nKES ${balance(r.balanceCents)}\n0. Back`,
    },
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
    unknownCode: `Msimbo haujulikani.\nPiga ${SERVICE_CODE} kwa\nAkiba SACCO.`,
    pending: 'Tafadhali subiri...',
    sms: ({ref, draft, balanceCents}) =>
        draft.service === 'airtime'
            ? `AKIBA ${ref}\nAirtime KES ${kes(draft.amount ?? 0)}\nimetumwa kwa\n${draft.recipient}.\nSalio KES ${balance(balanceCents)}`
            : `AKIBA ${ref}\nKES ${kes(draft.amount ?? 0)} imetumwa\nkwa ${destination(draft)}.\nAda KES ${draft.fee}.\nSalio KES ${balance(balanceCents)}`,
    screens: {
        main: () => 'Akiba SACCO\n1. Angalia Salio\n2. Toa Pesa\n3. Nunua Airtime',
        enterPin: () => 'Akiba SACCO\nWeka PIN yako ya\ntarakimu 4:',
        wrongPin: (r) =>
            r.pinAttemptsLeft === 1
                ? 'PIN si sahihi.\nJaribio 1\nlimebaki.\nWeka PIN:'
                : `PIN si sahihi.\nMajaribio ${r.pinAttemptsLeft}\nyamebaki.\nWeka PIN:`,
        invalidPin: () => 'PIN ni tarakimu 4.\nWeka PIN:',
        pinLocked: () => `PIN imefungwa baada\nya majaribio ${PIN_ATTEMPTS}.\nTembelea tawi la\nAkiba kuifungua.`,
        balance: (r) => `Salio la Akaunti\nKES ${balance(r.balanceCents)}\nKufikia ${stamp()}\n0. Rudi`,
        withdraw: () => 'Toa pesa kwenda:\n1. Pesa ya Simu\n2. Akaunti ya Benki\n0. Rudi',
        chooseNumber: (r) =>
            `${r.draft.service === 'airtime' ? 'Nunua Airtime' : 'Pesa ya Simu'}\n1. Nambari Yangu\n2. Nambari Nyingine\n0. Rudi`,
        enterPhone: () => 'Weka nambari ya simu:\nmfano 07XXXXXXXX\n0. Rudi',
        bankList: () => `Chagua benki:\n${BANKS.map((b, i) => `${i + 1}. ${b}`).join('\n')}\n0. Rudi`,
        enterBankAccount: (r) => `${bankName(r.draft)}\nWeka nambari ya\nakaunti:\n0. Rudi`,
        enterAmount: (r) => `Kwa: ${destination(r.draft)}\nWeka kiasi (KES):\n0. Rudi`,
        confirm: (r) =>
            r.draft.service === 'airtime'
                ? `Airtime KES ${kes(r.draft.amount ?? 0)}\nkwa ${r.draft.recipient}?\n1. Ndiyo 2. Hapana`
                : `Toa KES ${kes(r.draft.amount ?? 0)}\nkwa ${destination(r.draft)}?\nAda: KES ${r.draft.fee}\n1. Ndiyo 2. Hapana`,
        success: () => 'Ombi limepokelewa.\nUtapokea SMS ya\nuthibitisho punde.\nAsante.',
        cancelled: () => 'Huduma imesitishwa.',
        timeout: () => 'Tatizo la mtandao\nau msimbo wa MMI\nsi sahihi.',
        invalidChoice: () => 'Chaguo si sahihi.\nTafadhali jaribu\ntena.\n0. Rudi',
        invalidPhone: () => 'Nambari si sahihi.\nTumia 07XXXXXXXX au\n01XXXXXXXX.\n0. Rudi',
        invalidAccount: () => 'Akaunti si sahihi.\nTumia tarakimu\n6 hadi 16.\n0. Rudi',
        invalidAmount: (r) => {
            const [min, max] = limitsOf(r);
            return `Kiasi si sahihi.\nWeka KES ${min} hadi\n${max}.\n0. Rudi`;
        },
        insufficientFunds: (r) => `Salio halitoshi.\nSalio lako:\nKES ${balance(r.balanceCents)}\n0. Rudi`,
    },
};

export const COPY: Record<Lang, Copy> = {en: EN, sw: SW};

export function formatIdleDate(lang: Lang, d: Date): string {
    const c = COPY[lang];
    return `${c.weekdays[d.getDay()]} ${d.getDate()} ${c.months[d.getMonth()]}`;
}
