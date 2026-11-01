import type {Session} from './engine.js';
import {BANKS} from './mockData.js';
import type {Msg} from './types.js';

/** Dynamic content: options for `optionsFrom`, or lines for a paginated `resolver` screen. */
export type Resolver = (session: Session) => Msg[];

export const resolvers = {
    banks: () => BANKS.map((name) => ({id: 'bank.option', vars: {name}})),
    miniStatement: ({account}) =>
        account.transactions
            .slice()
            .reverse()
            .map(({at, type, amount}) => ({id: 'statement.line', vars: {at, type, amount}})),
} satisfies Record<string, Resolver>;

export type ResolverName = keyof typeof resolvers;
