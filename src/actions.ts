import type {Session} from './engine.js';
import type {Msg, Notice} from './types.js';

export interface ActionResult {
    message: Msg;
    notice?: Notice;
    transactional?: boolean;
}

export interface Action {
    messages: Msg[];
    run: (session: Session, now: number) => ActionResult;
}

let refCounter = 0;

function transactionRef(now: number): string {
    refCounter = (refCounter + 1) % 1000;
    return `AKB${now.toString(36).toUpperCase().slice(-5)}${String(refCounter).padStart(3, '0')}`;
}

export const actions = {
    commitTransaction: {
        messages: [{id: 'end.success'}],
        run: ({account, data}, now) => {
            const {amount = 0, fee = 0} = data;
            account.balanceCents -= (amount + fee) * 100;
            account.transactions.push({
                at: now,
                type: data.service === 'airtime' ? 'airtime' : 'withdrawal',
                amount: -(amount + fee),
                balanceCents: account.balanceCents,
            });
            return {
                message: {id: 'end.success'},
                transactional: true,
                notice: {ref: transactionRef(now), data: {...data}, balanceCents: account.balanceCents},
            };
        },
    },
    cancel: {
        messages: [{id: 'end.cancelled'}],
        run: () => ({message: {id: 'end.cancelled'}}),
    },
} satisfies Record<string, Action>;

export type ActionName = keyof typeof actions;
