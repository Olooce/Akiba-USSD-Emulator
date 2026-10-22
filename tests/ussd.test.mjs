import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UssdSession } from '../dist/ussd.js';
import { FeaturePhone } from '../dist/phone.js';

const account = () => ({ msisdn: '0712345678', balanceCents: 1_245_000 });

test('main menu routes to balance and back', () => {
  const s = new UssdSession(account());
  assert.equal(s.start().screen, 'main');
  assert.equal(s.reply('1').screen, 'balance');
  assert.equal(s.reply('0').screen, 'main');
});

test('withdraw to my number deducts amount plus fee', () => {
  const acc = account();
  const s = new UssdSession(acc);
  s.start();
  s.reply('2');
  const amount = s.reply('1');
  assert.equal(amount.screen, 'enterAmount');
  assert.equal(amount.draft.recipient, '0712345678');
  assert.equal(s.reply('1000').screen, 'confirm');
  const done = s.reply('1');
  assert.deepEqual([done.type, done.screen], ['END', 'success']);
  assert.equal(acc.balanceCents, 1_245_000 - 103_000);
});

test('withdraw to other number validates the phone and supports back', () => {
  const s = new UssdSession(account());
  s.start();
  s.reply('2');
  assert.equal(s.reply('2').screen, 'enterPhone');
  assert.equal(s.reply('12345').screen, 'invalidPhone');
  assert.equal(s.reply('0').screen, 'enterPhone');
  assert.equal(s.reply('0722123456').screen, 'enterAmount');
  assert.equal(s.reply('0').screen, 'enterPhone');
  assert.equal(s.reply('0').screen, 'withdraw');
  assert.equal(s.reply('0').screen, 'main');
});

test('amount limits and insufficient funds', () => {
  const s = new UssdSession({ msisdn: '0712345678', balanceCents: 100_000 });
  s.start();
  s.reply('2');
  s.reply('1');
  assert.equal(s.reply('10').screen, 'invalidAmount');
  s.reply('0');
  assert.equal(s.reply('980').screen, 'insufficientFunds');
  s.reply('0');
  assert.equal(s.reply('970').screen, 'confirm');
});

test('invalid choice and cancel', () => {
  const s = new UssdSession(account());
  s.start();
  assert.equal(s.reply('9').screen, 'invalidChoice');
  assert.equal(s.reply('5').screen, 'invalidChoice');
  assert.equal(s.reply('0').screen, 'main');
  const c = s.cancel();
  assert.deepEqual([c.type, c.screen], ['END', 'cancelled']);
  assert.equal(s.isOpen, false);
});

test('handset dials *144# and runs a full balance session in Swahili', () => {
  const views = [];
  const phone = new FeaturePhone({ render: (v) => views.push(v) }, account(), 'sw', () => new Date(2026, 9, 21, 10, 24));
  assert.equal(views.at(-1).date, 'Jumatano 21 Okt');
  for (const k of ['*', '1', '4', '4', '#']) phone.press(k);
  assert.equal(views.at(-1).value, '*144#');
  phone.press('call');
  assert.match(views.at(-1).text, /1\. Angalia Salio/);
  phone.press('1');
  assert.equal(views.at(-1).softkeys.right, 'Futa');
  phone.press('soft-left');
  assert.match(views.at(-1).text, /KES 12,450\.00/);
  phone.setLanguage('en');
  assert.match(views.at(-1).text, /Account Balance/);
  phone.press('end');
  assert.deepEqual([views.at(-1).kind, views.at(-1).text], ['message', 'Session cancelled.']);
  phone.press('ok');
  assert.equal(views.at(-1).kind, 'idle');
});

test('unknown codes show an error instead of opening a session', () => {
  const views = [];
  const phone = new FeaturePhone({ render: (v) => views.push(v) }, account());
  for (const k of ['*', '1', '2', '3', '#', 'call']) phone.press(k);
  assert.equal(views.at(-1).kind, 'message');
  assert.match(views.at(-1).text, /Unknown USSD code/);
});
