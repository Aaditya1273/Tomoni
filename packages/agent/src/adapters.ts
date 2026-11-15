/**
 * What the agent can reach (rule 2.2): a pharmacy portal and an e-prescribing outbox. Nothing
 * else: no web, no shell, no free-form HTTP. Real adapters (a Surescripts-certified partner,
 * pharmacy integrations) are not chosen yet (ARCHITECTURE "Integrations"); the mocks below are
 * deterministic, labeled, and make the SANDBOX bar show.
 *
 * Anything an adapter returns as text is untrusted: it is stored under `untrusted` and never
 * read as an instruction (SECURITY "Agent and prompt-injection defenses").
 */
export interface PharmacyPortal {
  readonly mode: 'mock';
  refillStatus(o: { pharmacyNpi: string; rxcui: string }): Promise<{
    status: 'ready' | 'in_progress' | 'needs_renewal' | 'not_found';
    untrusted?: string;
  }>;
  stock(o: { rxcui: string; pharmacyNpis: string[] }): Promise<{ pharmacyNpi: string; inStock: boolean }[]>;
  requestTransfer(o: {
    rxcui: string;
    fromNpi: string;
    toNpi: string;
    idempotencyKey: string;
  }): Promise<{ ref: string }>;
  transferStatus(o: {
    ref: string;
  }): Promise<{ status: 'pending' | 'done' | 'rejected'; untrusted?: string }>;
  bookPickup(o: {
    pharmacyNpi: string;
    rxcui: string;
    date: string;
    idempotencyKey: string;
  }): Promise<{ ref: string }>;
}

export interface ERx {
  readonly mode: 'mock';
  /** A draft only: nothing is sent until the physician signs it. */
  draft(o: {
    kind: 'renewal' | 'formulary_exception';
    rxcui: string;
    idempotencyKey: string;
  }): Promise<{ ref: string }>;
  get(o: { ref: string }): Promise<{ status: 'draft' | 'missing' }>;
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;

export class MockPharmacyPortal implements PharmacyPortal {
  readonly mode = 'mock' as const;
  /** Lets tests inject hostile portal text; the real world will. */
  constructor(private readonly opts: { note?: string; fail?: boolean } = {}) {}
  private check() {
    if (this.opts.fail) throw new Error('pharmacy portal unavailable');
  }
  async refillStatus(o: { pharmacyNpi: string; rxcui: string }) {
    this.check();
    const statuses = ['ready', 'in_progress', 'needs_renewal'] as const;
    return {
      status: statuses[hash(o.pharmacyNpi + o.rxcui) % 3]!,
      ...(this.opts.note ? { untrusted: this.opts.note } : {}),
    };
  }
  async stock(o: { rxcui: string; pharmacyNpis: string[] }) {
    this.check();
    return o.pharmacyNpis.map((n) => ({ pharmacyNpi: n, inStock: hash(n + o.rxcui) % 3 !== 0 }));
  }
  async requestTransfer(o: { idempotencyKey: string }) {
    this.check();
    return { ref: `mock-transfer-${hash(o.idempotencyKey).toString(36)}` };
  }
  async transferStatus() {
    this.check();
    return { status: 'done' as const, ...(this.opts.note ? { untrusted: this.opts.note } : {}) };
  }
  async bookPickup(o: { idempotencyKey: string }) {
    this.check();
    return { ref: `mock-pickup-${hash(o.idempotencyKey).toString(36)}` };
  }
}

export class MockERx implements ERx {
  readonly mode = 'mock' as const;
  private readonly drafts = new Set<string>();
  async draft(o: { idempotencyKey: string }) {
    const ref = `mock-erx-${hash(o.idempotencyKey).toString(36)}`;
    this.drafts.add(ref);
    return { ref };
  }
  async get(o: { ref: string }) {
    return {
      status:
        this.drafts.has(o.ref) || o.ref.startsWith('mock-erx-') ? ('draft' as const) : ('missing' as const),
    };
  }
}

export interface Adapters {
  pharmacy: PharmacyPortal;
  erx: ERx;
}
