import {afterEach, beforeEach, mock, test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {measureUssd} from '../dist/encoding.js';
import {createMemoryLogRepo} from '../dist/logRepo.js';
import {COPY} from '../dist/messages.js';
import {createMockAccount} from '../dist/mockData.js';
import {FeaturePhone} from '../dist/phone.js';

beforeEach(() => mock.timers.enable({apis: ['setTimeout', 'Date'], now: new Date(2026, 9, 21, 10, 24)}));
afterEach(() => mock.timers.reset());

const account = (overrides = {}) => createMockAccount(overrides, new Date(2026, 9, 21).getTime());

const phoneWithViews = (acc = account(), lang = 'en', log) => {
    const views = [];
    const phone = new FeaturePhone({render: (v) => views.push(v)}, acc, lang, undefined, log);
    return {phone, views, last: () => views.at(-1)};
};

const press = (phone, keys) => {
    for (const k of keys) phone.press(k);
};

/** Types a reply, sends it, and waits out the network delay. */
const send = (phone, digits, wait = config.transactionMs) => {
    press(phone, [...digits, 'call']);
    mock.timers.tick(wait);
};

const dial = (phone) => send(phone, config.serviceCode, config.responseMs);

const dialAndLogin = (phone) => {
    dial(phone);
    send(phone, '1234', config.responseMs);
};

test('handset dials *144#, waits for the network and runs a balance session in Swahili', () => {
    const {phone, last} = phoneWithViews(account(), 'sw');
    assert.equal(last().date, 'Jumatano 21 Okt');
    press(phone, [...config.serviceCode]);
    assert.equal(last().value, '*144#');
    phone.press('call');
    assert.equal(last().text, 'Tafadhali subiri...');
    mock.timers.tick(config.responseMs);
    assert.match(last().text, /Weka PIN/);
    press(phone, ['1', '2', '3']);
    assert.equal(last().input, '123', 'USSD shows typed digits as they are');
    assert.equal(last().softkeys.right, 'Futa');
    phone.press('4');
    phone.press('soft-left');
    mock.timers.tick(config.responseMs);
    assert.match(last().text, /1\. Angalia Salio/);
    send(phone, '1', config.responseMs);
    assert.match(last().text, /KES 12,450\.00/);
    assert.match(last().text, /0\. Rudi$/);
    phone.setLanguage('en');
    assert.match(last().text, /Account Balance/);
    send(phone, '0', config.responseMs);
    assert.match(last().text, /^Akiba SACCO\n1\. Balance Enquiry/, 'back from balance returns to the menu');
    phone.press('end');
    assert.deepEqual([last().kind, last().text, last().centered], ['message', 'Session cancelled.', true]);
    phone.press('ok');
    assert.equal(last().kind, 'idle');
});

test('session views carry the USSD encoding for the counter', () => {
    const {phone, last} = phoneWithViews();
    dial(phone);
    const {encoding, text} = last();
    assert.deepEqual(encoding, measureUssd(text));
    assert.equal(encoding.scheme, 'GSM-7');
});

test('the keypad stops at the screen input length', () => {
    const {phone, last} = phoneWithViews();
    dial(phone);
    press(phone, [...'123456']);
    assert.equal(last().input, '1234');
});

test('the mini statement pages with 98 and 0 on the handset', () => {
    const {phone, last} = phoneWithViews();
    dialAndLogin(phone);
    send(phone, '4', config.responseMs);
    const first = last().text;
    assert.match(first, /^Mini Statement\n/);
    assert.match(first, /98\. More 0\. Back$/);
    send(phone, '98', config.responseMs);
    assert.notEqual(last().text, first);
    phone.setLanguage('sw');
    assert.match(last().text, /^Taarifa Fupi\n/);
    send(phone, '0', config.responseMs);
    phone.setLanguage('en');
    assert.equal(last().text, first);
});

test('a locked account is turned away straight after dialling', () => {
    const {phone, last} = phoneWithViews(account({pinAttemptsLeft: 0}));
    dial(phone);
    assert.deepEqual([last().kind, last().text.split('\n')[0]], ['message', 'PIN locked after']);
});

test('the handset times out after 30s without a reply', () => {
    const {phone, last} = phoneWithViews();
    dial(phone);
    // The idle clock starts when the request reaches the app, before the reply's network delay.
    mock.timers.tick(config.inactivityMs - config.responseMs - 1);
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
    mock.timers.tick(config.smsDelayMs);
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
    mock.timers.tick(config.smsDelayMs);
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

test('cancelling from the handset is logged as cancelled', async () => {
    const log = createMemoryLogRepo();
    const {phone} = phoneWithViews(account(), 'en', log);
    dialAndLogin(phone);
    phone.press('end');
    const [latest] = await log.query();
    assert.deepEqual([latest.screenId, latest.status, latest.nextScreenId], ['main', 'cancelled', null]);
});

test('SMS confirmations fit one GSM-7 message in both languages', () => {
    const datas = [
        {service: 'withdraw', channel: 'mobile', recipient: '0712345678', amount: 70_000, fee: 30},
        {service: 'withdraw', channel: 'bank', bank: 0, recipient: '1234567890123456', amount: 70_000, fee: 100},
        {service: 'airtime', channel: 'mobile', recipient: '0712345678', amount: 10_000, fee: 0},
    ];
    for (const lang of ['en', 'sw']) {
        for (const data of datas) {
            const m = measureUssd(COPY[lang].sms({ref: 'AKB12345001', data, balanceCents: 999_999_999}));
            assert.equal(m.scheme, 'GSM-7');
            assert.ok(m.units <= 160, `${lang} SMS is ${m.units} units`);
        }
    }
});
