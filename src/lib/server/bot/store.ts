import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultBotSettings, settingsSchema } from '../../bot/config';
import type { BotSettings, BacktestResult } from '../../bot/types';
import type { BotPortfolio, BotComparison, BotProgress, BotEvent, BotJob, PaperState, ScanResult } from '../../bot/dashboard-types';
import type { DemoIntent, IntentRepository } from '../okx/demo-broker';
import { defaultEthSettings, ethSettingsSchema, type EthEvent, type EthRuntimeState, type EthSettings } from '../../bot/eth-config';

type Row = Record<string, unknown>;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export class BotStore {
  private db: DatabaseSync;
  constructor(path = resolve(process.env.BOT_DATA_DIR || '.bot-data', 'bot.sqlite')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, heartbeat INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, input TEXT NOT NULL, result TEXT, owner TEXT);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS backtests (id TEXT PRIMARY KEY, created INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS demo_intents (id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS eth_orders (key TEXT PRIMARY KEY, created INTEGER NOT NULL, detail TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private read<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key) as Row | undefined;
    return row ? JSON.parse(String(row.value)) as T : fallback;
  }
  private write(key: string, value: unknown) {
    this.db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }
  getSettings(): BotSettings { return settingsSchema.parse(this.read('settings', defaultBotSettings)); }
  saveSettings(settings: BotSettings) {
    settingsSchema.parse(settings);
    this.transaction(() => {
      if (this.enabled() || this.getPaper().positions.length || this.hasPendingJobs()) throw new Error('Ayarlar için taramayı durdurun ve işleri tamamlayın.');
      const previous = this.getSettings();
      if (settings.initialEquity !== previous.initialEquity && (this.getPaper().trades.length || this.getPaper().positions.length)) throw new Error('Başlangıç bakiyesi işlem oturumu başladıktan sonra değiştirilemez.');
      this.write('settings', settings);
      if (!this.getPaper().trades.length && settings.initialEquity !== previous.initialEquity) this.write('paper', this.emptyPaper(settings.initialEquity));
    });
  }
  private emptyPaper(cash: number): PaperState { return { cash, equity: cash, day: '', dayStartEquity: cash, dailyHalted: false, positions: [], trades: [], lastCycle: null }; }
  getPaper(): PaperState { return this.read('paper', this.emptyPaper(this.getSettings().initialEquity)); }
  enabled(): boolean { return this.read('enabled', false); }
  setEnabled(enabled: boolean) { this.write('enabled', enabled); }
  getProgress(): BotProgress | null { return this.read('progress', null); }
  saveProgress(owner: string, progress: Omit<BotProgress, 'updatedAt'>) { this.transaction(() => { this.assertLease(owner, Date.now()); this.write('progress', { ...progress, updatedAt: Date.now() }); }); }
  getComparison(): BotComparison | null { return this.read('comparison', null); }
  getPortfolio(): BotPortfolio | null { return this.read('portfolio', null); }
  savePortfolio(owner: string, portfolio: BotPortfolio) { this.transaction(() => { this.assertLease(owner, Date.now()); this.write('portfolio', portfolio); }); }
  saveComparison(owner: string, comparison: BotComparison) { this.transaction(() => { this.assertLease(owner, Date.now()); this.write('comparison', comparison); }); }
  requestWorkerStart(now = Date.now()): boolean {
    return this.transaction(() => {
      if (this.workerStatus(now).online || now - this.read<number>('worker-start', 0) < 10_000) return false;
      this.write('worker-start', now); return true;
    });
  }
  requestWorkerStop(stop: boolean) { this.write('worker-stop', stop); }
  workerStopRequested(): boolean { return this.read('worker-stop', false); }
  getScan(): ScanResult | null { return this.read('scan', null); }
  saveScan(owner: string, scan: ScanResult, now = Date.now()) { this.transaction(() => { this.assertLease(owner, now); this.write('scan', scan); }); }
  acquireLease(owner: string, now = Date.now(), ttl = 30_000): boolean {
    return this.transaction(() => {
      const lease = this.db.prepare('SELECT * FROM lease WHERE id=1').get() as Row | undefined;
      if (lease && Number(lease.expires) > now && lease.owner !== owner) return false;
      this.db.prepare('INSERT INTO lease(id,owner,heartbeat,expires) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,heartbeat=excluded.heartbeat,expires=excluded.expires').run(owner, now, now + ttl);
      // A crashed read/replay job is marked failed, never blindly repeated as a mutation.
      this.db.prepare("UPDATE jobs SET status='failed', result=?, updated=? WHERE status='running' AND owner!=?").run(JSON.stringify({ message: 'Önceki worker kesildi; iş yeniden istenebilir.' }), now, owner);
      return true;
    });
  }
  heartbeat(owner: string, now = Date.now(), ttl = 30_000): boolean {
    return Number(this.db.prepare('UPDATE lease SET heartbeat=?,expires=? WHERE id=1 AND owner=? AND expires>?').run(now, now + ttl, owner, now).changes) === 1;
  }
  releaseLease(owner: string) { this.db.prepare('DELETE FROM lease WHERE id=1 AND owner=?').run(owner); }
  workerStatus(now = Date.now()) {
    const row = this.db.prepare('SELECT heartbeat,expires FROM lease WHERE id=1').get() as Row | undefined;
    return { online: !!row && Number(row.expires) > now, heartbeat: row ? Number(row.heartbeat) : null };
  }
  private assertLease(owner: string, now: number) {
    const row = this.db.prepare('SELECT owner FROM lease WHERE id=1 AND owner=? AND expires>?').get(owner, now);
    if (!row) throw new Error('Worker sahipliği sona erdi.');
  }
  reserveSignal(id: string, payload: unknown): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO signals(id,payload,created) VALUES(?,?,?)').run(id, JSON.stringify(payload), Date.now()).changes) === 1;
  }
  /** Intents the exchange may still act on: anything not finished or definitively rejected. */
  openIntents(): DemoIntent[] {
    const rows = this.db.prepare('SELECT value FROM demo_intents').all() as Row[];
    return rows.map(row => JSON.parse(String(row.value)) as DemoIntent).filter(intent => intent.state !== 'closed' && intent.state !== 'rejected');
  }
  /** Demo broker persistence. Writes require the current worker lease and atomic version CAS. */
  demoIntents(owner: string): IntentRepository {
    const find = (id: string): DemoIntent | null => {
      const row = this.db.prepare('SELECT value FROM demo_intents WHERE id=?').get(id) as Row | undefined;
      return row ? JSON.parse(String(row.value)) as DemoIntent : null;
    };
    return {
      find: async id => find(id),
      save: async (intent, expectedVersion) => this.transaction(() => {
        this.assertLease(owner, Date.now());
        const previous = find(intent.signalId);
        if (!Number.isInteger(intent.version) || intent.version !== (expectedVersion === null ? 0 : expectedVersion + 1)) return false;
        if (expectedVersion === null) {
          if (previous) return false;
          this.db.prepare('INSERT INTO demo_intents VALUES(?,?,?)').run(intent.signalId, intent.version, JSON.stringify(intent));
          return true;
        }
        if (!previous || previous.version !== expectedVersion || intent.filledContracts < previous.filledContracts) return false;
        for (const key of ['signalId', 'id', 'direction', 'contracts', 'stop', 'takeProfit', 'clientOrderId'] as const) if (previous[key] !== intent[key]) return false;
        return Number(this.db.prepare('UPDATE demo_intents SET version=?,value=? WHERE id=? AND version=?').run(intent.version, JSON.stringify(intent), intent.signalId, expectedVersion).changes) === 1;
      }),
    };
  }
  commitCycle(owner: string, state: PaperState, signals: { id: string; payload: unknown }[], now = Date.now()) {
    this.transaction(() => {
      this.assertLease(owner, now);
      for (const s of signals) if (!this.reserveSignal(s.id, s.payload)) throw new Error('Yinelenen sinyal: durum yazılmadı.');
      this.write('paper', state);
    });
  }
  hasPendingJobs() { return !!this.db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1").get(); }
  enqueue(kind: BotJob['kind'], input: Record<string, unknown>): BotJob {
    return this.transaction(() => {
      const same = this.db.prepare("SELECT * FROM jobs WHERE kind=? AND input=? AND status IN ('queued','running') ORDER BY created DESC LIMIT 1").get(kind, JSON.stringify(input)) as Row | undefined;
      if (same) return this.job(same);
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running')").get() as Row;
      if (Number(count.n) >= 5) throw new Error('İş kuyruğu dolu.');
      const now = Date.now(), id = randomUUID();
      this.db.prepare("INSERT INTO jobs VALUES(?,?,'queued',?,?,?,NULL,NULL)").run(id, kind, now, now, JSON.stringify(input));
      return { id, kind, status: 'queued', createdAt: now, updatedAt: now, input, result: null };
    });
  }
  private job(row: Row): BotJob { return { id: String(row.id), kind: row.kind as BotJob['kind'], status: row.status as BotJob['status'], createdAt: Number(row.created), updatedAt: Number(row.updated), input: JSON.parse(String(row.input)), result: row.result ? JSON.parse(String(row.result)) : null }; }
  /**
   * Drops queued work and marks running work cancelled. A running job's own loop notices this on
   * its next checkpoint; nothing here interrupts an in-flight exchange call, so a cancel can never
   * leave an order half-sent. Cancelling requires no lease: the operator must always be able to stop.
   */
  cancelJobs(): number {
    return this.transaction(() => {
      const now = Date.now();
      const changed = this.db.prepare("UPDATE jobs SET status='failed',result=?,updated=? WHERE status IN ('queued','running')")
        .run(JSON.stringify({ message: 'Kullanıcı tarafından durduruldu.' }), now);
      this.write('progress', null);
      return Number(changed.changes);
    });
  }
  /** True when the operator asked to stop; long loops poll this between steps. */
  cancelled(jobId: string): boolean {
    const row = this.db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId) as Row | undefined;
    return !row || row.status !== 'running';
  }
  claimJob(owner: string, now = Date.now(), controlOnly = false): BotJob | null {
    return this.transaction(() => {
      this.assertLease(owner, now);
      const row = this.db.prepare(`SELECT * FROM jobs WHERE status='queued' ${controlOnly ? "AND kind IN ('scan','connection')" : ''} ORDER BY CASE WHEN kind='scan' AND json_extract(input,'$.emergency')=1 THEN 0 ELSE 1 END, created LIMIT 1`).get() as Row | undefined;
      if (!row) return null;
      this.db.prepare("UPDATE jobs SET status='running',owner=?,updated=? WHERE id=?").run(owner, now, String(row.id));
      return this.job({ ...row, status: 'running', updated: now });
    });
  }
  finishJob(owner: string, id: string, status: 'done' | 'failed' | 'blocked', result: unknown, now = Date.now()) {
    this.transaction(() => {
      this.assertLease(owner, now);
      const changed = this.db.prepare("UPDATE jobs SET status=?,result=?,updated=? WHERE id=? AND status='running' AND owner=?").run(status, JSON.stringify(result), now, id, owner);
      if (!changed.changes) throw new Error('İş bu worker tarafından çalıştırılmıyor.');
    });
  }
  listJobs(): BotJob[] { return (this.db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 30').all() as Row[]).map(r => this.job(r)); }
  event(level: BotEvent['level'], message: string) {
    this.db.prepare('INSERT INTO events(time,level,message) VALUES(?,?,?)').run(Date.now(), level, message.slice(0, 500));
    this.db.exec('DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0)-500 FROM events)');
  }
  listEvents(): BotEvent[] { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50').all() as unknown as BotEvent[]; }
  saveBacktest(owner: string, result: BacktestResult, now = Date.now()) {
    this.transaction(() => { this.assertLease(owner, now); this.db.prepare('INSERT INTO backtests VALUES(?,?,?)').run(randomUUID(), now, JSON.stringify(result)); });
  }
  listBacktests(): BacktestResult[] { return (this.db.prepare('SELECT value FROM backtests ORDER BY created DESC LIMIT 10').all() as Row[]).map(row => JSON.parse(String(row.value))); }
  // ---- ETH Momentum bot ----------------------------------------------------------------
  // Its own keys and its own log. The two bots share a database and a worker process but never a
  // setting, a position or an event: reading one bot's stop level as the other's is exactly the
  // kind of mistake that costs real money, so the storage keeps them apart by construction.
  getEthSettings(): EthSettings { return ethSettingsSchema.parse(this.read('eth-settings', defaultEthSettings)); }
  saveEthSettings(settings: EthSettings) {
    const parsed = ethSettingsSchema.parse(settings);
    this.transaction(() => {
      if (this.ethEnabled() || this.getEthState()?.openTrade) throw new Error('ETH botunu durdurun ve açık pozisyonu kapatın; ayarlar öyle değişir.');
      this.write('eth-settings', parsed);
    });
  }
  ethEnabled(): boolean { return this.read('eth-enabled', false); }
  // The panel cannot talk to the exchange itself: every write goes through the leased worker. A
  // button therefore leaves a request here and the worker picks it up on its next tick.
  requestEthCycle(request: boolean) { this.write('eth-cycle-now', request); }
  ethCycleRequested(): boolean { return this.read('eth-cycle-now', false); }
  requestEthEmergency(request: boolean) { this.write('eth-emergency', request); }
  ethEmergencyRequested(): boolean { return this.read('eth-emergency', false); }
  setEthEnabled(enabled: boolean) { this.write('eth-enabled', enabled); }
  getEthState(): EthRuntimeState | null { return this.read('eth-state', null); }
  saveEthState(owner: string, state: EthRuntimeState) { this.transaction(() => { this.assertLease(owner, Date.now()); this.write('eth-state', state); }); }
  ethEvent(level: EthEvent['level'], message: string) {
    this.db.prepare('INSERT INTO eth_events(time,level,message) VALUES(?,?,?)').run(Date.now(), level, message.slice(0, 500));
    this.db.exec('DELETE FROM eth_events WHERE id < (SELECT COALESCE(MAX(id),0)-500 FROM eth_events)');
  }
  listEthEvents(): EthEvent[] { return this.db.prepare('SELECT * FROM eth_events ORDER BY id DESC LIMIT 60').all() as unknown as EthEvent[]; }
  /**
   * Reserves one exchange action. Returns false when the same action was already recorded, which
   * is what stops a retried cycle — or a worker restarted mid-order — from sending a second entry
   * for the same bar. The key must describe the action completely, price included.
   */
  reserveEthOrder(key: string, detail: unknown): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO eth_orders(key,created,detail) VALUES(?,?,?)').run(key, Date.now(), JSON.stringify(detail)).changes) === 1;
  }
  /** Drops reservations older than a week so the table cannot grow without bound. */
  pruneEthOrders(now = Date.now()) { this.db.prepare('DELETE FROM eth_orders WHERE created < ?').run(now - 7 * 86_400_000); }

  createSession(now = Date.now()): string {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(token), now + 86_400_000);
    return token;
  }
  validSession(token: string, now = Date.now()): boolean {
    return /^[a-f0-9]{64}$/.test(token) && !!this.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash(token), now);
  }
}
