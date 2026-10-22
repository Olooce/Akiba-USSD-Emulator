import { LcdDisplay } from './display.js';
import type { Lang } from './messages.js';
import { FeaturePhone, type PhoneKey } from './phone.js';

const LANG_STORAGE_KEY = 'akiba-emulator-lang';

const KEYBOARD_MAP: Record<string, PhoneKey> = {
  Enter: 'call',
  Escape: 'end',
  Backspace: 'soft-right',
  F1: 'soft-left',
  F2: 'soft-right',
  ' ': 'ok',
};

function readStoredLang(): Lang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === 'sw' ? 'sw' : 'en';
  } catch {
    return 'en';
  }
}

function storeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Storage can be unavailable
  }
}

function init(): void {
  const lcd = document.querySelector<HTMLElement>('[data-lcd="root"]');
  if (!lcd) throw new Error('LCD element not found');
  const overflowWarning = document.querySelector<HTMLElement>('[data-overflow-warning]');

  const display = new LcdDisplay(lcd, (overflowing) => {
    if (overflowWarning) overflowWarning.hidden = !overflowing;
  });

  const lang = readStoredLang();
  const phone = new FeaturePhone(display, { msisdn: '0712345678', balanceCents: 1_245_000 }, lang);
  document.documentElement.lang = lang;

  const buttons = new Map<string, HTMLButtonElement>();
  document.querySelectorAll<HTMLButtonElement>('button[data-key]').forEach((button) => {
    const key = button.dataset.key as PhoneKey;
    buttons.set(key, button);
    button.addEventListener('click', () => phone.press(key));
  });

  document.querySelectorAll<HTMLInputElement>('input[name="lang"]').forEach((radio) => {
    radio.checked = radio.value === lang;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const next = radio.value as Lang;
      phone.setLanguage(next);
      document.documentElement.lang = next;
      storeLang(next);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement) return;
    const key = KEYBOARD_MAP[event.key] ?? event.key;
    const button = buttons.get(key);
    if (!button) return;
    event.preventDefault();
    button.classList.add('is-pressed');
    if (!event.repeat) button.click();
  });

  document.addEventListener('keyup', (event) => {
    const key = KEYBOARD_MAP[event.key] ?? event.key;
    buttons.get(key)?.classList.remove('is-pressed');
  });

  window.setInterval(() => phone.tick(), 10_000);
}

init();
