import {afterEach, beforeEach, mock, test} from 'node:test';
import assert from 'node:assert/strict';
import {LIMITS, measureUssd, UssdSession} from '../dist/ussd.js';
import {FeaturePhone} from '../dist/phone.js';
import {COPY} from '../dist/messages.js';

const account = (overrides = {}) => ({
    msisdn: '0712345678',
    balanceCents: 1_245_000,
    pin: '1234',
    pinAttemptsLeft: 3,
    ...overrides,
});

beforeEach(() => mock.timers.enable({apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 21, 10, 24)}));
afterEach(() => mock.timers.reset());

const phoneWithViews = (acc = account(), lang = 'en') => {
    const views = [];
    const phone = new FeaturePhone({render: (v) => views.push(v)}, acc, lang);
    return {phone, views, last: () => views.at(-1)};
};

const press = (phone, keys) => {
    for (const k of keys) phone.press(k);
};

/** Types a reply, sends it, and waits out the network delay. */
const send = (phone, digits, wait = LIMITS.transactionMs) => {
    press(phone, [...digits, 'call']);
    mock.timers.tick(wait);
};

const dial = (phone) => send(phone, '*144#', LIMITS.responseMs);

/** Opens a session and logs in with the correct PIN. */
const login = (acc = account(), now) => {
    const s = new UssdSession(acc, now);
    s.start();
    s.reply('1234');
    return s;
};

test('the session opens on a masked PIN prompt and logs in to the main menu', () => {
    const s = new UssdSession(account());
    const pin = s.start();
    assert.deepEqual([pin.type, pin.screen, pin.masked, pin.maxInput], ['CON', 'enterPin', true, 4]);
    const main = s.reply('1234');
    assert.deepEqual([main.screen, main.masked], ['main', false]);
});

test('balance shows without a second PIN and back never returns to the PIN prompt', () => {
    const s = login();
    assert.equal(s.reply('1').screen, 'balance');
    assert.equal(s.reply('0').screen, 'main');
    assert.equal(s.reply('0').screen, 'invalidChoice');
    assert.equal(s.reply('0').screen, 'main');
});

test('mobile money withdrawal to my number deducts amount plus fee on confirm', () => {
    const acc = account();
    const s = login(acc);
    assert.equal(s.reply('2').screen, 'withdraw');
    assert.equal(s.reply('1').screen, 'chooseNumber');
    const amount = s.reply('1');
    assert.deepEqual([amount.screen, amount.draft.recipient], ['enterAmount', '0712345678']);
    assert.equal(s.reply('1000').screen, 'confirm');
    assert.equal(acc.balanceCents, 1_245_000, 'nothing is debited before confirming');
    const done = s.reply('1');
    assert.deepEqual([done.type, done.screen, done.transactional], ['END', 'success', true]);
    assert.equal(acc.balanceCents, 1_245_000 - 103_000);
    assert.equal(done.notice.draft.amount, 1000);
});

test('bank withdrawal picks a bank, validates the account and charges the bank fee', () => {
    const acc = account();
    const s = login(acc);
    s.reply('2');
    assert.equal(s.reply('2').screen, 'bankList');
    assert.equal(s.reply('4').screen, 'invalidChoice');
    assert.equal(s.reply('0').screen, 'bankList');
    assert.equal(s.reply('2').screen, 'enterBankAccount');
    assert.equal(s.reply('123').screen, 'invalidAccount');
    s.reply('0');
    const amount = s.reply('0123456789');
    assert.deepEqual([amount.draft.channel, amount.draft.bank, amount.draft.recipient], ['bank', 1, '0123456789']);
    s.reply('5000');
    assert.equal(s.reply('1').screen, 'success');
    assert.equal(acc.balanceCents, 1_245_000 - 510_000);
});

test('withdraw to other number validates the phone and supports back', () => {
    const s = login();
    s.reply('2');
    s.reply('1');
    assert.equal(s.reply('2').screen, 'enterPhone');
    assert.equal(s.reply('12345').screen, 'invalidPhone');
    assert.equal(s.reply('0').screen, 'enterPhone');
    assert.equal(s.reply('0722123456').screen, 'enterAmount');
    assert.equal(s.reply('0').screen, 'enterPhone');
    assert.equal(s.reply('0').screen, 'chooseNumber');
    assert.equal(s.reply('0').screen, 'withdraw');
    assert.equal(s.reply('0').screen, 'main');
});

test('airtime purchase uses its own limits and has no fee', () => {
    const acc = account();
    const s = login(acc);
    assert.equal(s.reply('3').screen, 'chooseNumber');
    s.reply('2');
    s.reply('0733000111');
    assert.equal(s.reply('5').screen, 'invalidAmount');
    s.reply('0');
    assert.equal(s.reply('100').screen, 'confirm');
    assert.equal(s.reply('1').screen, 'success');
    assert.equal(acc.balanceCents, 1_245_000 - 10_000);
});

test('declining the confirmation ends the session without a debit', () => {
    const acc = account();
    const s = login(acc);
    for (const reply of ['3', '1', '100']) s.reply(reply);
    assert.deepEqual([s.reply('2').type, acc.balanceCents], ['END', 1_245_000]);
});

test('amount limits and insufficient funds include the fee', () => {
    const s = login(account({balanceCents: 100_000}));
    s.reply('2');
    s.reply('1');
    s.reply('1');
    assert.equal(s.reply('10').screen, 'invalidAmount');
    s.reply('0');
    assert.equal(s.reply('980').screen, 'insufficientFunds');
    s.reply('0');
    assert.equal(s.reply('970').screen, 'confirm');
});

test('malformed PINs are free, wrong PINs count, and three wrong PINs lock the account', () => {
    const acc = account();
    const s = new UssdSession(acc);
    s.start();
    assert.equal(s.reply('12').screen, 'invalidPin');
    assert.equal(acc.pinAttemptsLeft, 3);
    assert.equal(s.reply('0000').screen, 'wrongPin');
    assert.equal(s.reply('1111').pinAttemptsLeft, 1);
    const locked = s.reply('2222');
    assert.deepEqual([locked.type, locked.screen], ['END', 'pinLocked']);

    const next = new UssdSession(acc).start();
    assert.deepEqual([next.type, next.screen], ['END', 'pinLocked'], 'the lock outlives the session');
});

test('a correct PIN resets the attempt counter', () => {
    const acc = account();
    const s = new UssdSession(acc);
    s.start();
    s.reply('9999');
    assert.equal(acc.pinAttemptsLeft, 2);
    assert.equal(s.reply('1234').screen, 'main');
    assert.equal(acc.pinAttemptsLeft, 3);
});

test('invalid choice and cancel', () => {
    const s = login();
    assert.equal(s.reply('9').screen, 'invalidChoice');
    assert.equal(s.reply('5').screen, 'invalidChoice');
    assert.equal(s.reply('0').screen, 'main');
    const c = s.cancel();
    assert.deepEqual([c.type, c.screen], ['END', 'cancelled']);
    assert.equal(s.isOpen, false);
});

test('the session rejects replies after inactivity or the overall duration', () => {
    let now = 0;
    const s = login(account(), () => now);
    now = LIMITS.inactivityMs - 1;
    assert.equal(s.reply('2').screen, 'withdraw');
    now += LIMITS.inactivityMs;
    const idle = s.reply('1');
    assert.deepEqual([idle.type, idle.screen, idle.expiry], ['END', 'timeout', 'inactivity']);

    now = 0;
    s.start();
    s.reply('1234');
    for (let t = 0; t < LIMITS.sessionMs; t += LIMITS.inactivityMs - 1_000) {
        now = t;
        s.reply('9');
        s.reply('0');
    }
    now = LIMITS.sessionMs;
    assert.equal(s.reply('1').expiry, 'duration');
});

test('every screen fits the GSM-7 USSD limit in both languages', () => {
    const drafts = [
        {service: 'withdraw', channel: 'mobile', recipient: '0712345678', amount: 70_000, fee: 30},
        {service: 'withdraw', channel: 'bank', bank: 0, recipient: '1234567890123456', amount: 70_000, fee: 100},
        {service: 'airtime', recipient: '0712345678', amount: 10_000, fee: 0},
    ];
    for (const lang of ['en', 'sw']) {
        for (const draft of drafts) {
            const r = {draft, balanceCents: 999_999_999, pinAttemptsLeft: 2, expiry: 'duration'};
            const texts = [
                ...Object.values(COPY[lang].screens).map((screen) => screen(r)),
                COPY[lang].sms({ref: 'AKB12345001', draft, balanceCents: 999_999_999}),
            ];
            for (const text of texts) {
                const m = measureUssd(text);
                assert.equal(m.scheme, 'GSM-7', text);
                assert.ok(m.units <= m.limit, `${m.units} > ${m.limit}: ${text}`);
            }
        }
    }
});

test('encoding falls back to UCS-2 with its smaller limit', () => {
    assert.deepEqual(measureUssd('Salio €5'), {scheme: 'GSM-7', units: 9, limit: 182});
    assert.deepEqual(measureUssd('Karibu 👋'), {scheme: 'UCS-2', units: 9, limit: 80});
});

test('handset dials *144#, waits for the network and runs a balance session in Swahili', () => {
    const {phone, last} = phoneWithViews(account(), 'sw');
    assert.equal(last().date, 'Jumatano 21 Okt');
    press(phone, ['*', '1', '4', '4', '#']);
    assert.equal(last().value, '*144#');
    phone.press('call');
    assert.equal(last().text, 'Tafadhali subiri...');
    mock.timers.tick(LIMITS.responseMs);
    assert.match(last().text, /Weka PIN/);
    press(phone, ['1', '2', '3']);
    assert.equal(last().input, '***', 'PIN digits are masked');
    assert.equal(last().softkeys.right, 'Futa');
    phone.press('4');
    phone.press('soft-left');
    mock.timers.tick(LIMITS.responseMs);
    assert.match(last().text, /1\. Angalia Salio/);
    send(phone, '1', LIMITS.responseMs);
    assert.match(last().text, /KES 12,450\.00/);
    phone.setLanguage('en');
    assert.match(last().text, /Account Balance/);
    phone.press('end');
    assert.deepEqual([last().kind, last().text], ['message', 'Session cancelled.']);
    phone.press('ok');
    assert.equal(last().kind, 'idle');
});

const dialAndLogin = (phone) => {
    dial(phone);
    send(phone, '1234', LIMITS.responseMs);
};

test('a locked account is turned away straight after dialling', () => {
    const {phone, last} = phoneWithViews(account({pinAttemptsLeft: 0}));
    dial(phone);
    assert.deepEqual([last().kind, last().text.split('\n')[0]], ['message', 'PIN locked after']);
});

test('the handset times out after 30s without a reply', () => {
    const {phone, last} = phoneWithViews();
    dial(phone);
    // The idle clock starts when the request reaches the app, before the reply's network delay.
    mock.timers.tick(LIMITS.inactivityMs - LIMITS.responseMs - 1);
    assert.equal(last().kind, 'session');
    mock.timers.tick(1);
    assert.equal(last().text, 'Connection problem\nor invalid MMI code.');
});

test('a confirmed withdrawal still delivers its SMS when the session is cut off', () => {
    const acc = account();
    const {phone, last} = phoneWithViews(acc);
    dialAndLogin(phone);
    for (const reply of ['2', '1', '1', '500']) send(phone, reply);
    press(phone, ['1', 'call']);
    assert.equal(last().text, 'Please wait...');
    phone.press('end');
    assert.equal(last().text, 'Session cancelled.');
    assert.equal(acc.balanceCents, 1_245_000 - 53_000, 'the backend already committed');
    phone.press('ok');
    mock.timers.tick(LIMITS.smsDelayMs);
    assert.match(last().text, /KES 500 sent to\n0712345678/);
    assert.match(last().text, /Bal KES 11,920\.00/);
});

test('an SMS that arrives mid-session waits until the handset is idle', () => {
    const {phone, last} = phoneWithViews();
    dialAndLogin(phone);
    for (const reply of ['3', '1', '50', '1']) send(phone, reply);
    assert.match(last().text, /Request received/);
    phone.press('ok');
    dial(phone);
    mock.timers.tick(LIMITS.smsDelayMs);
    assert.equal(last().kind, 'session');
    phone.press('end');
    phone.press('ok');
    assert.match(last().text, /KES 50 airtime/);
    phone.press('ok');
    assert.equal(last().kind, 'idle');
});

test('unknown codes show an error instead of opening a session', () => {
    const {phone, last} = phoneWithViews();
    press(phone, ['*', '1', '2', '3', '#', 'call']);
    assert.equal(last().kind, 'message');
    assert.match(last().text, /Unknown USSD code/);
});
