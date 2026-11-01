import {type Copy, kes, type MessageId, money} from './messages.js';
import {BANKS} from './mockData.js';
import type {Msg, Vars} from './types.js';

export interface FormatContext {
    copy: Copy;
    vars: Vars;
    t: (msg: Msg) => string;
}

/** Turns a `{{var|name}}` value into text. Words come from the copy, never from here. */
export type Formatter = (value: string | number | undefined, ctx: FormatContext) => string;

const pad = (n: number) => String(n).padStart(2, '0');
const dayMonth = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

export const formatters = {
    kes: (v) => kes(Number(v ?? 0)),
    money: (v) => money(Number(v ?? 0)),
    bankName: (v) => BANKS[Number(v ?? 0)] ?? '',
    destination: (v, ctx) => (ctx.vars.channel === 'bank' ? ctx.t({id: 'dest.bank', vars: ctx.vars}) : String(v ?? '')),
    txnType: (v, ctx) => {
        const id = `txn.${v}`;
        return id in ctx.copy.ussd ? ctx.t({id: id as MessageId}) : String(v ?? '');
    },
    date: (v) => dayMonth(new Date(Number(v))),
    stamp: (v) => {
        const d = new Date(Number(v));
        return `${dayMonth(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
} satisfies Record<string, Formatter>;

const PLACEHOLDER = /\{\{(\w+)(?:\|(\w+))?}}/g;

/** Fills `{{var}}` and `{{var|formatter}}` placeholders. Unknown names are left in place so checks can spot them. */
export function format(copy: Copy, msg: Msg, base: Vars = {}): string {
    const vars = {...base, ...msg.vars};
    const t = (m: Msg) => format(copy, m, vars);
    return copy.ussd[msg.id].replace(PLACEHOLDER, (whole, name: string, fmt?: string) => {
        if (fmt) {
            const formatter = (formatters as Record<string, Formatter>)[fmt];
            return formatter ? formatter(vars[name], {copy, vars, t}) : whole;
        }
        return name in vars && vars[name] !== undefined ? String(vars[name]) : whole;
    });
}

/** Every formatter name used by a template, for the startup checks. */
export const formattersIn = (template: string): string[] =>
    [...template.matchAll(PLACEHOLDER)].flatMap((m) => (m[2] ? [m[2]] : []));
