import type {Registry, SessionData} from '../types.js';
import {loginScreens} from './login.js';
import {menuScreens} from './menu.js';
import {paymentScreens} from './payments.js';
import {statementScreens} from './statement.js';

export const registry: Registry = {
    entry: 'enterPin',
    home: 'main',
    screens: {...loginScreens, ...menuScreens, ...paymentScreens, ...statementScreens},
};

/** Worst-case session data the startup checks render every screen with. */
export const SAMPLE_DATA: SessionData[] = [
    {service: 'withdraw', channel: 'mobile', recipient: '0712345678', amount: 70_000, fee: 30},
    {service: 'withdraw', channel: 'bank', bank: 0, recipient: '1234567890123456', amount: 70_000, fee: 100},
    {service: 'airtime', channel: 'mobile', recipient: '0712345678', amount: 10_000, fee: 0},
];
