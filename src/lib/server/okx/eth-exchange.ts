import { createHash } from 'node:crypto';
import { OkxClient, OkxError } from './client';
import { validateInstrumentId } from './market';
import type { EthAlgoView, EthExchangeView, EthFillView, EthPositionView } from '../../bot/eth-config';

/**
 * The ETH bot's window onto the real OKX account, and the four things it is allowed to do there.
 *
 * Everything this bot places carries a client id starting with `eth`. That prefix is the whole
 * ownership model: a position or a resting order without it was put there by the account's owner
 * by hand, and the bot reads it but never cancels, amends or closes it.
 */
const PREFIX = 'eth';
const number = (value: unknown): number => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) ? Number(value) : NaN;

/** A deterministic client id: the same action, described identically, always produces the same id,
 *  so a resend after an ambiguous timeout is the same order to OKX rather than a second one. */
export function ethClientId(kind: 'entry' | 'exit' | 'sl' | 'tp1' | 'tp2', ...parts: (string | number)[]): string {
  const digest = createHash('sha256').update([kind, ...parts].join(':')).digest('hex');
  return (PREFIX + kind + digest).slice(0, 32).replace(/[^A-Za-z0-9]/g, '0');
}
const ours = (clientId: unknown) => typeof clientId === 'string' && clientId.startsWith(PREFIX);
const closingSide = (direction: 'long' | 'short') => direction === 'long' ? 'sell' : 'buy';

export async function readEthExchange(client: OkxClient, id: string, botOwnsPosition: boolean): Promise<EthExchangeView> {
  validateInstrumentId(id);
  const [balances, positions, algos, fills] = await Promise.all([
    client.get<{ details?: { ccy?: string; availBal?: string; cashBal?: string; eq?: string }[] }>('/api/v5/account/balance?ccy=USDT'),
    client.get<Record<string, unknown>>(`/api/v5/account/positions?instId=${id}`),
    client.get<Record<string, unknown>>(`/api/v5/trade/orders-algo-pending?instId=${id}&ordType=conditional`),
    client.get<Record<string, unknown>>(`/api/v5/trade/fills?instType=SWAP&instId=${id}&limit=50`),
  ]);

  const usdt = balances[0]?.details?.find(detail => detail.ccy === 'USDT');
  const balance = number(usdt?.availBal ?? usdt?.cashBal ?? usdt?.eq);

  let position: EthPositionView | null = null;
  let net = 0;
  for (const row of positions) {
    if (row.instId !== id) continue;
    const size = number(row.pos);
    if (!Number.isFinite(size)) throw new Error('okx_eth_position_unreadable');
    net += size;
    if (size === 0) continue;
    position = {
      contracts: Math.abs(size), direction: size > 0 ? 'long' : 'short',
      entryPrice: Number.isFinite(number(row.avgPx)) ? number(row.avgPx) : null,
      markPrice: Number.isFinite(number(row.markPx)) ? number(row.markPx) : null,
      unrealizedPnl: Number.isFinite(number(row.upl)) ? number(row.upl) : null,
      leverage: Number.isFinite(number(row.lever)) ? number(row.lever) : null,
      margin: Number.isFinite(number(row.margin)) ? number(row.margin) : null,
      liquidationPrice: Number.isFinite(number(row.liqPx)) ? number(row.liqPx) : null,
    };
  }
  if (position) position.contracts = Math.abs(net);

  const view: EthAlgoView[] = [];
  for (const row of algos) {
    if (row.instId !== id || !ours(row.algoClOrdId) || typeof row.algoId !== 'string') continue;
    const stop = number(row.slTriggerPx), target = number(row.tpTriggerPx);
    const kind = Number.isFinite(stop) && stop > 0 ? 'stop' as const : Number.isFinite(target) && target > 0 ? 'target' as const : null;
    if (!kind) continue;
    view.push({ algoId: row.algoId, clientId: String(row.algoClOrdId), kind, trigger: kind === 'stop' ? stop : target, contracts: number(row.sz), state: String(row.state ?? '') });
  }

  const recent: EthFillView[] = [];
  for (const row of fills) {
    if (row.instId !== id) continue;
    const time = number(row.ts), price = number(row.fillPx), size = number(row.fillSz);
    if (!Number.isSafeInteger(time) || !Number.isFinite(price) || !Number.isFinite(size)) continue;
    recent.push({ time, side: row.side === 'sell' ? 'sell' : 'buy', price, contracts: size,
      fee: Number.isFinite(number(row.fee)) ? number(row.fee) : 0, orderId: String(row.ordId ?? ''),
      pnl: Number.isFinite(number(row.fillPnl)) ? number(row.fillPnl) : null });
  }
  recent.sort((a, b) => b.time - a.time);

  // A position with no bot entry behind it belongs to the account's owner, not to the bot.
  return { balanceUsdt: Number.isFinite(balance) ? balance : null, position, algos: view, fills: recent.slice(0, 30), foreign: !!position && !botOwnsPosition };
}

/** Writes the account's leverage for ETH before anything is sent. An unconfirmed reply is a failure. */
export async function setEthLeverage(client: OkxClient, id: string, leverage: number): Promise<void> {
  const rows = await client.post<{ lever?: unknown }>('/api/v5/account/set-leverage', { instId: id, lever: String(leverage), mgnMode: 'isolated', posSide: 'net' });
  if (Number(rows[0]?.lever) !== leverage) throw new Error('okx_eth_leverage_not_applied');
}

/** Duplicate-client-id rejections mean the order is already on the exchange, not that it failed. */
const duplicate = (error: unknown) => error instanceof OkxError && ['51603', '51002', '51000'].includes(error.code);

export async function submitEthEntry(client: OkxClient, input: { id: string; direction: 'long' | 'short'; contracts: number; stop: number; clientOrderId: string }) {
  validateInstrumentId(input.id);
  if (!Number.isFinite(input.contracts) || input.contracts <= 0 || !Number.isFinite(input.stop) || input.stop <= 0) throw new Error('okx_eth_invalid_entry');
  try {
    await client.post('/api/v5/trade/order', {
      instId: input.id, clOrdId: input.clientOrderId, tdMode: 'isolated', posSide: 'net',
      side: input.direction === 'long' ? 'buy' : 'sell', ordType: 'market', sz: String(input.contracts),
      // The stop rides with the entry so the position is never unprotected, not even for the
      // seconds between the fill and the next reconciliation pass.
      attachAlgoOrds: [{ slTriggerPx: String(input.stop), slOrdPx: '-1', slTriggerPxType: 'mark' }],
    });
  } catch (error) { if (!duplicate(error)) throw error; }
}

export async function closeEthPosition(client: OkxClient, input: { id: string; direction: 'long' | 'short'; contracts: number; clientOrderId: string }) {
  validateInstrumentId(input.id);
  if (!Number.isFinite(input.contracts) || input.contracts <= 0) throw new Error('okx_eth_invalid_exit');
  try {
    await client.post('/api/v5/trade/order', {
      instId: input.id, clOrdId: input.clientOrderId, tdMode: 'isolated', posSide: 'net',
      side: closingSide(input.direction), ordType: 'market', sz: String(input.contracts), reduceOnly: true,
    });
  } catch (error) { if (!duplicate(error)) throw error; }
}

export async function cancelEthAlgos(client: OkxClient, id: string, algoIds: string[]) {
  for (const algoId of algoIds) {
    try { await client.post('/api/v5/trade/cancel-algos', [{ instId: id, algoId }]); }
    catch (error) { if (!(error instanceof OkxError)) throw error; }
  }
}

async function placeAlgo(client: OkxClient, body: Record<string, unknown>) {
  try { await client.post('/api/v5/trade/order-algo', body); }
  catch (error) { if (!duplicate(error)) throw error; }
}

/**
 * Brings the resting orders in line with the model's current plan.
 *
 * The plan changes every bar — the trailing stop moves, and the second target disappears once the
 * partial has come off — so this is a replace, not an add: anything of the bot's that no longer
 * matches the plan is cancelled first, and only then is the missing piece placed. Doing it in the
 * other order would briefly leave two reduce-only stops resting, and the second one fires against
 * whatever position the account holds next.
 */
export async function syncEthProtection(client: OkxClient, plan: {
  id: string; direction: 'long' | 'short'; contracts: number; stop: number;
  target: { price: number; contracts: number } | null;
  runner: { price: number; contracts: number } | null;
}): Promise<string[]> {
  validateInstrumentId(plan.id);
  const notes: string[] = [];
  const side = closingSide(plan.direction);
  const round = (value: number) => Number(value.toFixed(8));
  const wanted = [
    { kind: 'sl' as const, trigger: round(plan.stop), contracts: plan.contracts },
    ...(plan.target ? [{ kind: 'tp1' as const, trigger: round(plan.target.price), contracts: plan.target.contracts }] : []),
    ...(plan.runner ? [{ kind: 'tp2' as const, trigger: round(plan.runner.price), contracts: plan.runner.contracts }] : []),
  ].filter(item => Number.isFinite(item.trigger) && item.trigger > 0 && Number.isFinite(item.contracts) && item.contracts > 0);
  const ids = new Map(wanted.map(item => [ethClientId(item.kind, plan.id, item.trigger, item.contracts), item]));

  const resting = await client.get<Record<string, unknown>>(`/api/v5/trade/orders-algo-pending?instId=${plan.id}&ordType=conditional`);
  const stale: string[] = [];
  const present = new Set<string>();
  for (const row of resting) {
    if (row.instId !== plan.id || !ours(row.algoClOrdId) || typeof row.algoId !== 'string') continue;
    if (ids.has(String(row.algoClOrdId))) { present.add(String(row.algoClOrdId)); continue; }
    stale.push(row.algoId);
  }
  if (stale.length) { await cancelEthAlgos(client, plan.id, stale); notes.push(`${stale.length} eski koruma emri iptal edildi.`); }

  for (const [clientId, item] of ids) {
    if (present.has(clientId)) continue;
    await placeAlgo(client, {
      instId: plan.id, tdMode: 'isolated', side, posSide: 'net', ordType: 'conditional',
      sz: String(item.contracts), reduceOnly: true, algoClOrdId: clientId,
      ...(item.kind === 'sl'
        ? { slTriggerPx: String(item.trigger), slOrdPx: '-1', slTriggerPxType: 'mark' }
        : { tpTriggerPx: String(item.trigger), tpOrdPx: '-1', tpTriggerPxType: 'last' }),
    });
    notes.push(item.kind === 'sl' ? `Stop ${item.trigger} seviyesine yazıldı.` : `Hedef ${item.trigger} · ${item.contracts} kontrat borsaya kondu.`);
  }
  return notes;
}

/** Everything of the bot's, off the book: used when a position closes and when the bot is stopped. */
export async function clearEthOrders(client: OkxClient, id: string): Promise<number> {
  const resting = await client.get<Record<string, unknown>>(`/api/v5/trade/orders-algo-pending?instId=${id}&ordType=conditional`);
  const mine = resting.filter(row => row.instId === id && ours(row.algoClOrdId) && typeof row.algoId === 'string').map(row => String(row.algoId));
  await cancelEthAlgos(client, id, mine);
  return mine.length;
}
