import type { Renderer, View } from './phone.js';

const LONG_DIAL_THRESHOLD = 8;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing display element: ${selector}`);
  return el;
}

export class LcdDisplay implements Renderer {
  private readonly body: HTMLElement;
  private readonly idleTime: HTMLElement;
  private readonly idleDate: HTMLElement;
  private readonly dialValue: HTMLElement;
  private readonly sessionText: HTMLElement;
  private readonly sessionInput: HTMLElement;
  private readonly messageText: HTMLElement;
  private readonly softLeft: HTMLElement;
  private readonly softRight: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onOverflow: (overflowing: boolean) => void = () => {},
  ) {
    this.body = required(root, '[data-lcd="body"]');
    this.idleTime = required(root, '[data-lcd="idle-time"]');
    this.idleDate = required(root, '[data-lcd="idle-date"]');
    this.dialValue = required(root, '[data-lcd="dial-value"]');
    this.sessionText = required(root, '[data-lcd="session-text"]');
    this.sessionInput = required(root, '[data-lcd="session-input"]');
    this.messageText = required(root, '[data-lcd="message-text"]');
    this.softLeft = required(root, '[data-lcd="soft-left"]');
    this.softRight = required(root, '[data-lcd="soft-right"]');
  }

  render(view: View): void {
    this.root.dataset.view = view.kind;
    switch (view.kind) {
      case 'idle':
        this.idleTime.textContent = view.time;
        this.idleDate.textContent = view.date;
        break;
      case 'dial':
        this.dialValue.textContent = view.value;
        this.dialValue.classList.toggle('is-long', view.value.length > LONG_DIAL_THRESHOLD);
        break;
      case 'session':
        this.sessionText.textContent = view.text;
        this.sessionInput.textContent = view.input;
        break;
      case 'message':
        this.messageText.textContent = view.text;
        this.messageText.classList.toggle('is-centered', view.centered);
        break;
    }
    this.softLeft.textContent = view.softkeys.left;
    this.softRight.textContent = view.softkeys.right;
    this.checkOverflow();
  }

  private checkOverflow(): void {
    const active = this.body.querySelector<HTMLElement>(`[data-view-panel="${this.root.dataset.view}"]`);
    const overflowing =
      this.body.scrollHeight > this.body.clientHeight + 0.5 ||
      (active !== null && (active.scrollHeight > active.clientHeight + 0.5 || active.scrollWidth > active.clientWidth + 0.5));
    if (overflowing) console.warn('[Akiba emulator] Screen copy exceeds the 160×128 display.');
    this.onOverflow(overflowing);
  }
}
