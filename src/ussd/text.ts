/**
 * Text helpers used when drawing screens:
 *  - messageText / fillIn: a message ID → text, with its {{placeholders}} filled in
 *  - measureUssd / fitsDisplay: does a piece of text fit the network limit and the LCD?
 */
import {config} from '../config.js';
import {BANKS} from '../mockData.js';
import {type Copy, kes, type MessageId, money} from '../messages.js';
import type {Msg, Session, Vars} from './types.js';

//  Turning a message into text
//
// Templates in messages.ts can say `{{amount}}` (insert the value) or `{{amount|kes}}`
// (insert it through the `kes` formatter below, e.g. 70000 → "70,000").

/** A message's text in `copy`'s language, with placeholders filled from the session. */
export function messageText(msg: Msg, session: Session, copy: Copy, now: number): string {
    return fillIn(copy, msg, {
        ...session.data,
        balance: session.account.balanceCents,
        pinAttemptsLeft: session.account.pinAttemptsLeft,
        pinAttempts: config.pinAttempts,
        now,
    });
}

type Formatter = (value: string | number | undefined, vars: Vars, copy: Copy) => string;

const pad = (n: number) => String(n).padStart(2, '0');
const dayMonth = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

export const formatters: Record<string, Formatter> = {
    kes: (v) => kes(Number(v ?? 0)),
    money: (v) => money(Number(v ?? 0)),
    bankName: (v) => BANKS[Number(v ?? 0)] ?? '',
    destination: (v, vars, copy) => (vars.channel === 'bank' ? fillIn(copy, {id: 'dest.bank'}, vars) : String(v ?? '')),
    txnType: (v, vars, copy) => {
        const id = `txn.${v}`;
        return id in copy.ussd ? fillIn(copy, {id: id as MessageId}, vars) : String(v ?? '');
    },
    date: (v) => dayMonth(new Date(Number(v))),
    stamp: (v) => {
        const d = new Date(Number(v));
        return `${dayMonth(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
};

const PLACEHOLDER = /\{\{(\w+)(?:\|(\w+))?}}/g;

/** Fills `{{name}}` / `{{name|formatter}}` in a message. Unknown names stay, so the startup checks can spot them. */
export function fillIn(copy: Copy, msg: Msg, vars: Vars = {}): string {
    const all = {...vars, ...msg.vars};
    return copy.ussd[msg.id].replace(PLACEHOLDER, (whole, name: string, formatterName?: string) => {
        if (formatterName) {
            const formatter = formatters[formatterName];
            return formatter ? formatter(all[name], all, copy) : whole;
        }
        return all[name] !== undefined ? String(all[name]) : whole;
    });
}

/** Every formatter name a template uses, for the startup checks. */
export const formattersIn = (template: string): string[] =>
    [...template.matchAll(PLACEHOLDER)].flatMap((m) => (m[2] ? [m[2]] : []));

//  Does it fit?
//
// Two limits apply to every screen: the network's message size (hard: it will not carry
// more) and the handset's display grid (what the LCD shows without scrolling).

/** USSD page limits are set by the encoding the network picks for the text. */
const USSD_LIMITS = {gsm7Units: 182, ucs2Units: 80} as const;

export interface Encoding {
    scheme: 'GSM-7' | 'UCS-2';
    units: number;
    limit: number;
}

const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

/** GSM-7 if every character allows it (extended ones cost 2), otherwise UCS-2. */
export function measureUssd(text: string): Encoding {
    let septets = 0;
    for (const ch of text) {
        if (GSM7_BASIC.includes(ch)) septets += 1;
        else if (GSM7_EXTENDED.includes(ch)) septets += 2;
        else return {scheme: 'UCS-2', units: text.length, limit: USSD_LIMITS.ucs2Units};
    }
    return {scheme: 'GSM-7', units: septets, limit: USSD_LIMITS.gsm7Units};
}

export function fitsUssd(text: string): boolean {
    const {units, limit} = measureUssd(text);
    return units <= limit;
}

export interface DisplayGrid {
    columns: number;
    rows: number;
}

/** Room for a session screen (above the softkeys) and for an END message. */
export const SESSION_GRID: DisplayGrid = {columns: config.display.columns, rows: config.display.sessionRows};
export const MESSAGE_GRID: DisplayGrid = {columns: config.display.columns, rows: config.display.messageRows};

/** How many rows `text` takes when word-wrapped to `columns`, like the LCD does. */
export function displayRows(text: string, columns: number): number {
    let rows = 0;
    for (const line of text.split('\n')) {
        let row = 1;
        let col = 0;
        for (const token of line.match(/[^ ]*( +|$)/g) ?? []) {
            const word = token.trimEnd().length;
            if (col > 0 && col + word > columns) {
                row += 1;
                col = 0;
            }
            if (word > columns) {
                const extra = Math.ceil(word / columns) - 1;
                row += extra;
                col = word - extra * columns;
            } else {
                col += word;
            }
            col += token.length - word;
        }
        rows += row;
    }
    return rows;
}

export function fitsDisplay(text: string, grid: DisplayGrid): boolean {
    return displayRows(text, grid.columns) <= grid.rows;
}
