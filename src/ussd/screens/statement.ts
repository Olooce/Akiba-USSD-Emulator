/** Mini statement: the account's transactions, split over pages. */
import type {ListSource, Screen} from '../types.js';

/** Newest first. */
const statementLines: ListSource = ({account}) =>
    account.transactions
        .slice()
        .reverse()
        .map(({at, type, amount}) => ({id: 'statement.line', vars: {at, type, amount}}));

export const statementScreens: Record<string, Screen> = {
    miniStatement: {
        type: 'pages',
        prompt: 'statement.prompt',
        lines: statementLines,
    },
};
