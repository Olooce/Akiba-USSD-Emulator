/**
 * Every data shape the USSD menu uses, in one place.
 * Read this file first: the rest of the code just moves these objects around.
 */
import type {Encoding} from './text.js';
import type {MessageId} from '../messages.js';

export type Lang = 'en' | 'sw';

// The customer's account

export type Service = 'withdraw' | 'airtime';
export type Channel = 'mobile' | 'bank';
export type TxnType = 'deposit' | 'withdrawal' | 'airtime';

export interface Transaction {
    at: number;
    type: TxnType;
    amount: number;
    balanceCents: number;
}

export interface Account {
    balanceCents: number;
    pin: string;
    pinAttemptsLeft: number;
    transactions: Transaction[];
}

//  Messages

export type Vars = Record<string, string | number | undefined>;

/** A message ID (a key in messages.ts) plus the values for its `{{placeholders}}`. */
export interface Msg {
    id: MessageId;
    vars?: Vars;
}

//  A USSD session

/** Values the screens collect as the user moves through the menu. */
export interface SessionData {
    recipient: string;
    service?: Service;
    channel?: Channel;
    bank?: number;
    amount?: number;
    fee?: number;
}

/** One dial of `*144#`, from the first screen until the session ends. */
export interface Session {
    readonly id: string;
    readonly account: Account;
    data: SessionData;
    /** The screen being shown (a key of `registry.screens`). */
    screen: string;
    /** Screens visited since the home screen, for the `0` (back) key. */
    history: string[];
    /** The page being shown on a `pages` screen, starting at 0. */
    page: number;
    open: boolean;
    /** Set after a bad reply; shown in place of the screen's prompt. */
    error?: Msg;
    /** The END message, once the session has closed. */
    final?: Msg;
    startedAt: number;
    lastActivityAt: number;
}

export type Status = 'continue' | 'end' | 'invalid' | 'cancelled' | 'timeout';
export type Expiry = 'inactivity' | 'duration';

/** The SMS a transaction sends afterwards. */
export interface Notice {
    ref: string;
    data: Readonly<SessionData>;
    balanceCents: number;
}

/** What happened after one reply. */
export interface Outcome {
    status: Status;
    notice?: Notice;
    /** True when money moved, so the network takes a little longer to answer. */
    transactional: boolean;
    expiry?: Expiry;
}

/** What the phone shows for a session: `CON` waits for a reply, `END` closes it. */
export interface Rendered {
    type: 'CON' | 'END';
    text: string;
    encoding: Encoding;
    /** How many digits the user may type. */
    maxInput: number;
}

//  Screens (the menu is built out of these, in screens.ts)

/**
 * Functions a screen can plug in. Each lists the `messages` it can return, so the
 * startup checks can make sure they exist in every language and fit on the screen.
 */
export interface Guard {
    messages: Msg[];
    /** Returns a message to END the session with, or `null` to let the user in. */
    check: (session: Session) => Msg | null;
}

export interface Validator {
    messages: Msg[];
    /** `null` = accepted, a `Msg` = show it and ask again, `{end}` = close the session. */
    check: (value: string | number, session: Session) => null | Msg | { end: Msg };
}

export interface Action {
    messages: Msg[];
    /** Runs at the end of a flow (e.g. moves the money) and returns the END message. */
    run: (session: Session, now: number) => { message: Msg; notice?: Notice; transactional?: boolean };
}

/** Builds a list of lines at runtime, e.g. the banks or the statement. */
export type ListSource = (session: Session) => Msg[];

/** The screen's title: one message, or one chosen by a session value (e.g. by `service`). */
export type Prompt = MessageId | { by: keyof SessionData; cases: Record<string, MessageId> };

/** Where a screen goes after a good reply. Give exactly one: another screen, or an action that ends the session. */
export interface Then {
    next?: string;
    action?: Action;
}

/** Fields every screen can have. */
interface ScreenBase {
    prompt: Prompt;
    /** Allow `0` (back) and `00` (home). Defaults to true. */
    nav?: boolean;
    /** Where `0` goes, if not the previous screen. */
    back?: string;
    /** Checked before the screen opens; may end the session instead. */
    guard?: Guard;
}

/** A numbered menu. Each option says where it leads. */
export interface MenuScreen extends ScreenBase {
    type: 'menu';
    options: Record<string, MenuOption>;
    /** Show the options on one line (e.g. `1. Yes 2. No`). */
    inline?: boolean;
}

export interface MenuOption extends Then {
    label: MessageId;
    /** Values to save in `session.data` when this option is picked. */
    set?: Partial<SessionData>;
}

/** A numbered menu whose items are built at runtime. The chosen index is saved as `saveAs`. */
export interface ListScreen extends ScreenBase, Then {
    type: 'list';
    items: ListSource;
    saveAs: keyof SessionData;
}

/** Asks the user to type something (a PIN, phone number, amount...). */
export interface InputScreen extends ScreenBase, Then {
    type: 'input';
    input: {
        /** Saves the value in `session.data` under this name. */
        name?: keyof SessionData;
        /** A regular expression the whole reply must match. */
        pattern: string;
        maxLength: number;
        type?: 'text' | 'number';
        /** Never saved or logged (e.g. the PIN). */
        secret?: boolean;
        validate?: Validator;
        /** Shown when the reply does not match `pattern`. */
        error: MessageId;
    };
}

/** Read-only lines split over pages, with `98. More` and `0. Back`. */
export interface PagesScreen extends ScreenBase {
    type: 'pages';
    lines: ListSource;
}

/** Text only; the user can just go back or home. */
export interface InfoScreen extends ScreenBase {
    type: 'info';
}

/** `type` tells the engine how to show the screen and what reply it accepts. */
export type Screen = MenuScreen | ListScreen | InputScreen | PagesScreen | InfoScreen;

export interface Registry {
    /** The first screen after dialling. */
    entry: string;
    /** Where `00` goes; reaching it clears the back history. */
    home: string;
    screens: Record<string, Screen>;
}

//  The session log

export interface LogRecord {
    sessionId: string;
    phoneNumber: string;
    screenId: string | null;
    timestamp: string;
    input: string;
    selectedValue: string | null;
    nextScreenId: string | null;
    page: number;
    lang: Lang;
    status: Status;
}

export interface LogSink {
    add(record: LogRecord): Promise<void>;
}
