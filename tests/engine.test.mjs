import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {measureUssd} from '../dist/encoding.js';
import {assertRegistry, checkRegistry, pageFooter, paginate, UssdEngine} from '../dist/engine.js';
import {displayRows} from '../dist/lcdGrid.js';
import {createMemoryLogRepo} from '../dist/logRepo.js';
import {COPY} from '../dist/messages.js';
import {createMockAccount} from '../dist/mockData.js';
import {registry, SAMPLE_DATA} from '../dist/screens.js';
import {actions} from '../dist/actions.js';
import {validators, guards} from '../dist/validators.js';
import {resolvers} from '../dist/resolvers.js';
import {format, formatters} from '../dist/formatters.js';

const NOW = new Date(2026, 9, 31, 10, 0).getTime();
const GRID = {columns: config.display.columns, rows: config.display.sessionRows};
const REGISTRIES = {actions, validators, guards, resolvers, formatters};

const setup = ({account = createMockAccount({}, NOW), now = () => NOW, lang = 'en'} = {}) => {
    const log = createMemoryLogRepo();
    let id = 0;
    const engine = new UssdEngine({now, log, newId: () => `s${++id}`});
    const session = engine.start(account, lang);
    const reply = (...inputs) => {
        let outcome;
        for (const input of inputs) outcome = engine.reply(session, input, lang);
        return outcome;
    };
    const text = (l = lang) => engine.render(session, l).text;
    return {engine, session, account, log, reply, text};
};

const login = (opts) => {
    const ctx = setup(opts);
    ctx.reply('1234');
    return ctx;
};

const fits = (text) => measureUssd(text).units <= measureUssd(text).limit && displayRows(text, GRID.columns) <= GRID.rows;

test('the registry passes every startup check', () => {
    assert.deepEqual(checkRegistry(), []);
    assert.doesNotThrow(() => assertRegistry());
});

test('the session opens on the PIN prompt; digits are not masked', () => {
    const {engine, session} = setup();
    const view = engine.render(session, 'en');
    assert.deepEqual([view.type, session.screen, view.maxInput], ['CON', 'enterPin', 4]);
    assert.equal('masked' in view, false);
});

test('options resolve by key and merge their `set` values', () => {
    const {session, reply} = login();
    assert.equal(session.screen, 'main');
    reply('2', '2');
    assert.equal(session.screen, 'bankList');
    assert.deepEqual([session.data.service, session.data.channel, session.data.fee], ['withdraw', 'bank', 100]);
});

test('invalid input keeps the same screen and shows the error in place of the prompt', () => {
    const {session, reply, text} = login();
    const outcome = reply('9');
    assert.deepEqual([outcome.status, session.screen, session.open, session.error.id], ['invalid', 'main', true, 'error.choice']);
    assert.match(text(), /^Invalid choice\.\n1\. Balance Enquiry/);
    reply('2');
    assert.equal(session.error, undefined, 'the error clears on the next good reply');
});

test('* is rejected anywhere in the input', () => {
    const {session, reply} = login();
    for (const input of ['*', '1*', '*2#']) {
        assert.equal(reply(input).status, 'invalid');
        assert.deepEqual([session.screen, session.error.id], ['main', 'error.input']);
    }
});

test('0 goes back through the history and 00 goes home', () => {
    const {session, reply} = login();
    reply('2', '1', '2');
    assert.equal(session.screen, 'enterPhone');
    reply('0');
    assert.equal(session.screen, 'chooseNumber');
    reply('0');
    assert.equal(session.screen, 'withdraw');
    reply('1', '2', '00');
    assert.deepEqual([session.screen, session.history], ['main', ['main']]);
});

test('nav: false blocks 0 and 00 on the PIN, main and confirm screens', () => {
    const pin = setup();
    pin.reply('0');
    assert.deepEqual([pin.session.screen, pin.session.error.id], ['enterPin', 'pin.invalid']);
    pin.reply('00');
    assert.equal(pin.session.screen, 'enterPin', '00 does not skip the PIN');

    const {session, reply} = login();
    reply('0');
    assert.deepEqual([session.screen, session.error.id], ['main', 'error.choice']);
    reply('3', '1', '100', '0');
    assert.deepEqual([session.screen, session.error.id], ['confirm', 'error.choice']);
});

test('balance is a screen with 0. Back, not the end of the session', () => {
    const {session, reply, text} = login();
    assert.equal(reply('1').status, 'continue');
    assert.equal(session.screen, 'balance');
    assert.match(text(), /^Account Balance\nKES 12,450\.00\nAs at 31\/10 10:00\n0\. Back$/);
    reply('0');
    assert.equal(session.screen, 'main');
});

test('"My Number" sends to config.myNumber, "Other Number" to the typed number', () => {
    const mine = login();
    mine.reply('2', '1', '1');
    assert.deepEqual([mine.session.screen, mine.session.data.recipient], ['enterAmount', config.myNumber]);

    const other = login();
    other.reply('2', '1', '2', '0722123456');
    assert.deepEqual([other.session.screen, other.session.data.recipient], ['enterAmount', '0722123456']);
    other.reply('0', '0', '1');
    assert.equal(other.session.data.recipient, config.myNumber, 'going back to My Number resets the recipient');
});

test('a phone number must match the pattern', () => {
    const {session, reply} = login();
    reply('2', '1', '2', '12345');
    assert.deepEqual([session.screen, session.error.id], ['enterPhone', 'phone.invalid']);
});

test('mobile money withdrawal deducts amount plus fee on confirm and returns a notice', () => {
    const {session, account, reply} = login();
    reply('2', '1', '1', '1000');
    assert.equal(session.screen, 'confirm');
    assert.equal(account.balanceCents, 1_245_000, 'nothing is debited before confirming');
    const done = reply('1');
    assert.deepEqual([done.status, done.transactional, session.open, session.final.id], ['end', true, false, 'end.success']);
    assert.equal(account.balanceCents, 1_245_000 - 103_000);
    assert.equal(done.notice.data.amount, 1000);
    assert.equal(account.transactions.at(-1).amount, -1030, 'the statement shows the new withdrawal');
});

test('bank withdrawal picks a bank, validates the account and charges the bank fee', () => {
    const {session, account, reply} = login();
    reply('2', '2', '4');
    assert.deepEqual([session.screen, session.error.id], ['bankList', 'error.choice']);
    reply('2');
    assert.deepEqual([session.screen, session.data.bank], ['enterBankAccount', 1]);
    reply('123');
    assert.equal(session.error.id, 'bank.invalid');
    reply('0123456789', '5000', '1');
    assert.equal(account.balanceCents, 1_245_000 - 510_000);
});

test('airtime uses its own limits, has no fee and needs enough balance', () => {
    const {session, account, reply} = login({account: createMockAccount({balanceCents: 100_000}, NOW)});
    reply('3', '1', '5');
    assert.deepEqual([session.error.id, session.error.vars], ['amount.invalid', {min: 10, max: 10_000}]);
    reply('2000');
    assert.equal(session.error.id, 'amount.noFunds');
    reply('1000', '1');
    assert.equal(account.balanceCents, 0);
});

test('cancelling the confirmation ends the session without a debit', () => {
    const {session, account, reply} = login();
    reply('3', '1', '100');
    assert.equal(reply('2').status, 'end');
    assert.deepEqual([session.final.id, account.balanceCents], ['end.cancelled', 1_245_000]);
});

test('malformed PINs are free, wrong PINs count, and three wrong PINs lock the account', () => {
    const account = createMockAccount({}, NOW);
    const {session, reply} = setup({account});
    reply('12');
    assert.deepEqual([session.error.id, account.pinAttemptsLeft], ['pin.invalid', 3]);
    reply('0000');
    assert.deepEqual([session.error.id, session.error.vars.left], ['pin.wrong', 2]);
    reply('1111');
    assert.equal(session.error.id, 'pin.wrongOne');
    assert.equal(reply('2222').status, 'end');
    assert.equal(session.final.id, 'pin.locked');

    const next = setup({account});
    assert.deepEqual([next.session.open, next.session.final.id], [false, 'pin.locked'], 'the lock outlives the session');
});

test('a correct PIN resets the attempt counter', () => {
    const account = createMockAccount({}, NOW);
    const {reply} = setup({account});
    reply('9999');
    assert.equal(account.pinAttemptsLeft, 2);
    reply('1234');
    assert.equal(account.pinAttemptsLeft, 3);
});

test('the session times out after inactivity or the overall duration', () => {
    let now = NOW;
    const {engine, session, reply} = setup({now: () => now});
    reply('1234');
    now += config.inactivityMs;
    assert.deepEqual([engine.expiry(session), reply('2').expiry, session.final.id], ['inactivity', 'inactivity', 'end.timeout']);

    now = NOW;
    const long = setup({now: () => now});
    long.reply('1234');
    for (let t = 0; t < config.sessionMs; t += config.inactivityMs - 1_000) {
        now = NOW + t;
        long.reply('9');
    }
    now = NOW + config.sessionMs;
    assert.equal(long.reply('1').expiry, 'duration');
});

test('switching language keeps the screen, data and history', () => {
    const {session, reply, text} = login();
    reply('2', '1', '2', '0722123456');
    const before = structuredClone({screen: session.screen, data: session.data, history: session.history});
    assert.match(text('en'), /^To: 0722123456\nEnter amount/);
    assert.match(text('sw'), /^Kwa: 0722123456\nWeka kiasi/);
    assert.deepEqual({screen: session.screen, data: session.data, history: session.history}, before);
});

test('every screen renders in both languages with no unfilled placeholders', () => {
    const {engine, session} = login();
    for (const data of SAMPLE_DATA) {
        session.data = data;
        for (const id of Object.keys(registry.screens)) {
            session.screen = id;
            for (const lang of ['en', 'sw']) assert.doesNotMatch(engine.render(session, lang).text, /\{\{/, `${id} ${lang}`);
        }
    }
});

// --- pagination -------------------------------------------------------------

const statement = (lang, account = createMockAccount({}, NOW)) => {
    const ctx = login({account, lang});
    ctx.reply('4');
    return ctx;
};

const allPages = ({engine, session}, lang) => {
    const count = engine.pages(session, lang).length;
    return Array.from({length: count}, (_, page) => {
        session.page = page;
        return engine.render(session, lang).text;
    });
};

test('statement pages, footer included, fit both the USSD limit and the display', () => {
    for (const lang of ['en', 'sw']) {
        const pages = allPages(statement(lang), lang);
        assert.ok(pages.length > 1, 'the mock statement needs more than one page');
        for (const page of pages) assert.ok(fits(page), `${lang}: ${page}`);
    }
});

test('every page but the last offers 98, and lines are kept in order without loss', () => {
    for (const lang of ['en', 'sw']) {
        const ctx = statement(lang);
        const pages = allPages(ctx, lang);
        const more = pageFooter(COPY[lang], true);
        const back = pageFooter(COPY[lang], false);
        pages.slice(0, -1).forEach((p) => assert.ok(p.endsWith(`\n${more}`), p));
        assert.ok(pages.at(-1).endsWith(`\n${back}`) && !pages.at(-1).includes('98.'), pages.at(-1));

        const expected = resolvers.miniStatement(ctx.session).map((msg) => format(COPY[lang], msg));
        const body = pages.flatMap((p) => p.split('\n').slice(1, -1));
        assert.deepEqual(body, expected);
    }
});

test('pages are greedy: the next line would not have fitted', () => {
    const header = ['Statement'];
    const lines = Array.from({length: 10}, (_, i) => `Line ${i}`);
    const pages = paginate(header, lines, COPY.en);
    pages.slice(0, -1).forEach((page, i) => {
        const next = pages[i + 1][0];
        const text = [header[0], ...page, next, pageFooter(COPY.en, true)].join('\n');
        assert.ok(!fits(text), `page ${i + 1} could have taken "${next}"`);
    });
});

test('the footer is measured in the language it is shown in', () => {
    const lines = Array.from({length: 6}, (_, i) => `L${i}`);
    const short = {ussd: {'nav.more': 'More', 'nav.back': 'Back'}};
    const long = {ussd: {'nav.more': 'Ukurasa unaofuata', 'nav.back': 'Rudi nyuma'}};
    // 5 rows: header + 3 lines + a one-row footer, so 3 + 3.
    assert.equal(paginate(['H'], lines, short).length, 2);
    // "98. Ukurasa unaofuata 0. Rudi nyuma" wraps to two rows, leaving room for 2 lines per page.
    assert.equal(paginate(['H'], lines, long).length, 3);
});

test('the USSD limit is hard even when the display has room', () => {
    const tall = {columns: 100, rows: 100};
    const lines = Array.from({length: 40}, (_, i) => `Transaction ${String(i).padStart(2, '0')}`);
    for (const page of paginate(['H'], lines, COPY.en, tall)) {
        const text = ['H', ...page, pageFooter(COPY.en, true)].join('\n');
        assert.ok(measureUssd(text).units <= 182, `${measureUssd(text).units} units`);
    }
    const ucs2 = paginate(['H'], lines.map((l) => `${l} ✓`), COPY.en, tall);
    for (const [i, page] of ucs2.entries()) {
        const text = ['H', ...page, pageFooter(COPY.en, i < ucs2.length - 1)].join('\n');
        assert.deepEqual([measureUssd(text).scheme, measureUssd(text).units <= 80], ['UCS-2', true]);
    }
});

test('page breaks do not move when an error replaces the title', () => {
    const ctx = statement('en');
    const clean = allPages(ctx, 'en').map((p) => p.split('\n').slice(1));
    ctx.session.page = 0;
    ctx.reply('7');
    assert.equal(ctx.session.error.id, 'error.choice');
    assert.deepEqual(ctx.text().split('\n').slice(1), clean[0]);
    assert.ok(fits(ctx.text()));
});

test('98 and 0 move between pages, and 0 on page 1 leaves the statement', () => {
    const ctx = statement('en');
    const first = ctx.text();
    ctx.reply('98');
    assert.equal(ctx.session.page, 1);
    assert.notEqual(ctx.text(), first);
    ctx.reply('0');
    assert.deepEqual([ctx.session.page, ctx.text()], [0, first]);
    ctx.reply('0');
    assert.equal(ctx.session.screen, 'main');
});

test('98 on the last page is invalid', () => {
    const ctx = statement('en');
    const count = ctx.engine.pages(ctx.session, 'en').length;
    for (let i = 1; i < count; i++) ctx.reply('98');
    assert.equal(ctx.reply('98').status, 'invalid');
    assert.equal(ctx.session.page, count - 1);
});

test('a page index past the end is clamped, e.g. after a language switch', () => {
    const ctx = statement('en');
    const pages = allPages(ctx, 'sw');
    ctx.session.page = 99;
    assert.equal(ctx.text('sw'), pages.at(-1));
    ctx.engine.reply(ctx.session, '0', 'sw');
    assert.equal(ctx.session.page, pages.length - 2);
});

// --- startup checks ---------------------------------------------------------

const withScreens = (patch) => ({registry: {...registry, screens: {...registry.screens, ...patch}}});

test('startup checks catch broken navigation and names', () => {
    const problems = checkRegistry(withScreens({
        main: {
            prompt: 'main.prompt', nav: false,
            options: {
                1: {label: 'main.balance', next: 'nowhere'},
                2: {label: 'main.withdraw', next: 'withdraw', action: 'commitTransaction'},
                3: {label: 'main.airtime', action: 'launchRocket'},
                0: {label: 'main.statement', next: 'miniStatement'},
                '5a': {label: 'main.statement', next: 'miniStatement'},
            },
        },
        enterPhone: {
            prompt: 'phone.prompt',
            input: {name: 'recipient', pattern: '(', maxLength: 10, error: 'phone.invalid'}
        },
    }));
    const expected = [
        /option "1" goes to unknown screen "nowhere"/,
        /option "2" needs exactly one of next or action/,
        /option "3" uses unknown action "launchRocket"/,
        /option "0" uses a reserved key/,
        /option "5a" is not digits only/,
        /screen "enterPhone" needs exactly one of next or action/,
        /screen "enterPhone" has an invalid pattern/,
    ];
    for (const re of expected) assert.ok(problems.some((p) => re.test(p)), `${re} not in:\n${problems.join('\n')}`);
    assert.throws(() => assertRegistry(withScreens({
        main: {
            prompt: 'main.prompt',
            options: {98: {label: 'nav.more', next: 'main'}}
        }
    })), /reserved key/);
});

test('startup checks catch a missing Swahili message', () => {
    const {'withdraw.bank': _, ...ussd} = COPY.sw.ussd;
    const problems = checkRegistry({copies: {en: COPY.en, sw: {...COPY.sw, ussd}}});
    assert.deepEqual(problems, ['message "withdraw.bank" is missing in sw']);
});

test('startup checks catch a screen that is too long in Swahili only', () => {
    const sw = {...COPY.sw, ussd: {...COPY.sw.ussd, 'withdraw.prompt': 'Toa pesa kwenda '.repeat(12)}};
    const problems = checkRegistry({copies: {en: COPY.en, sw}});
    assert.ok(problems.length > 0);
    assert.ok(problems.every((p) => /screen "withdraw" \(sw/.test(p)), problems.join('\n'));
    assert.ok(problems.some((p) => /over the USSD limit: GSM-7 \d+\/182/.test(p)));
    assert.ok(problems.some((p) => /does not fit the display/.test(p)));
});

test('startup checks catch a statement line that cannot fit on any page', () => {
    const problems = checkRegistry({
        registries: {
            ...REGISTRIES,
            resolvers: {
                ...resolvers,
                miniStatement: () => [{id: 'statement.line', vars: {at: NOW, type: 'x'.repeat(200), amount: 1}}]
            },
        },
    });
    assert.ok(problems.some((p) => /screen "miniStatement" \(en\) cannot be paginated/.test(p)), problems.join('\n'));
});

// --- session log ------------------------------------------------------------

test('every interaction is logged with the gateway record shape; the PIN is redacted', async () => {
    const {log, reply} = login();
    reply('9', '2', '1', '1', '500', '1');
    const records = (await log.query()).reverse();
    assert.deepEqual(records.map((r) => [r.screenId, r.input, r.selectedValue, r.nextScreenId, r.status]), [
        [null, '*144#', null, 'enterPin', 'continue'],
        ['enterPin', '****', '****', 'main', 'continue'],
        ['main', '9', null, 'main', 'invalid'],
        ['main', '2', 'main.withdraw', 'withdraw', 'continue'],
        ['withdraw', '1', 'withdraw.mobile', 'chooseNumber', 'continue'],
        ['chooseNumber', '1', 'number.mine', 'enterAmount', 'continue'],
        ['enterAmount', '500', '500', 'confirm', 'continue'],
        ['confirm', '1', 'confirm.yes', null, 'end'],
    ]);
    for (const r of records) {
        assert.deepEqual([r.sessionId, r.phoneNumber, r.lang], ['s1', config.myNumber, 'en']);
        assert.ok(!Number.isNaN(Date.parse(r.timestamp)));
    }
});

test('dialling again while a session is open cancels the old one', async () => {
    const log = createMemoryLogRepo();
    let id = 0;
    const engine = new UssdEngine({now: () => NOW, log, newId: () => `s${++id}`});
    const first = engine.start(createMockAccount({}, NOW), 'en');
    const second = engine.start(createMockAccount({}, NOW), 'en');
    assert.deepEqual([first.open, first.final.id, second.open], [false, 'end.cancelled', true]);
    assert.deepEqual((await log.query({sessionId: 's1', status: 'cancelled'})).length, 1);
});

test('the memory log repo filters by session, date range and status, newest first', async () => {
    const repo = createMemoryLogRepo();
    const base = {
        phoneNumber: config.myNumber,
        screenId: 'main',
        input: '1',
        selectedValue: null,
        nextScreenId: 'main',
        page: 0,
        lang: 'en'
    };
    await repo.add({...base, sessionId: 'a', timestamp: '2026-10-30T10:00:00.000Z', status: 'continue'});
    await repo.add({...base, sessionId: 'a', timestamp: '2026-10-31T10:00:00.000Z', status: 'invalid'});
    await repo.add({...base, sessionId: 'b', timestamp: '2026-10-31T11:00:00.000Z', status: 'end'});
    assert.deepEqual((await repo.query()).map((r) => r.timestamp.slice(8, 13)), ['31T11', '31T10', '30T10']);
    assert.equal((await repo.query({sessionId: 'a'})).length, 2);
    assert.equal((await repo.query({status: 'invalid'})).length, 1);
    assert.equal((await repo.query({from: '2026-10-31T00:00:00.000Z', to: '2026-10-31T10:30:00.000Z'})).length, 1);
    await repo.clear();
    assert.equal((await repo.query()).length, 0);
});
