/** USSD page limits are set by the encoding the network picks for the text. */
export const USSD_LIMITS = {gsm7Units: 182, ucs2Units: 80} as const;

export interface Encoding {
    scheme: 'GSM-7' | 'UCS-2';
    units: number;
    limit: number;
}

const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export function measureUssd(text: string): Encoding {
    let septets = 0;
    for (const ch of text) {
        if (GSM7_BASIC.includes(ch)) septets += 1;
        else if (GSM7_EXTENDED.includes(ch)) septets += 2;
        else return {scheme: 'UCS-2', units: text.length, limit: USSD_LIMITS.ucs2Units};
    }
    return {scheme: 'GSM-7', units: septets, limit: USSD_LIMITS.gsm7Units};
}

export const fitsUssd = (text: string): boolean => {
    const {units, limit} = measureUssd(text);
    return units <= limit;
};
