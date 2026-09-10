import type { OkxClient } from './client';
import { validateInstrumentId } from './market';
interface OrderInput { id: string; clientOrderId: string; direction: 'long' | 'short'; contracts: number }
function validateClientId(id: string) { if (!/^[A-Za-z0-9]{1,32}$/.test(id)) throw new Error('okx_invalid_client_order_id'); }
function validate(input: OrderInput) {
  validateInstrumentId(input.id); validateClientId(input.clientOrderId);
  if (!['long','short'].includes(input.direction) || !Number.isFinite(input.contracts) || input.contracts <= 0) throw new Error('okx_invalid_order');
}
export function buildEntryOrder(input: OrderInput & { stop: number; takeProfit: number }) {
  validate(input);
  if (![input.stop,input.takeProfit].every((n) => Number.isFinite(n) && n > 0) || (input.direction === 'long' ? input.stop >= input.takeProfit : input.stop <= input.takeProfit)) throw new Error('okx_invalid_protection');
  // Only the stop is attached. A take profit here would cover the whole fill and close the entire
  // position at the first target, while the model this order came from exits in stages; the profit
  // side is placed target by target once the fill is known. `takeProfit` is still validated because
  // it is what proves the protection levels straddle the entry in the right order.
  return { instId: input.id, clOrdId: input.clientOrderId, tdMode: 'isolated', posSide: 'net', side: input.direction === 'long' ? 'buy' : 'sell', ordType: 'market', sz: String(input.contracts), attachAlgoOrds: [{ slTriggerPx: String(input.stop), slOrdPx: '-1', slTriggerPxType: 'mark' }] };
}
export function buildExitOrder(input: OrderInput) {
  validate(input);
  return { instId: input.id, clOrdId: input.clientOrderId, tdMode: 'isolated', posSide: 'net', side: input.direction === 'long' ? 'sell' : 'buy', ordType: 'market', sz: String(input.contracts), reduceOnly: true };
}
export function normalizeOrder(raw: Record<string, unknown>) {
  const states = ['live', 'partially_filled', 'filled', 'canceled', 'mmp_canceled'];
  const size = Number(raw.sz), filled = Number(raw.accFillSz);
  const averagePrice = raw.avgPx === '' ? null : Number(raw.avgPx);
  if (typeof raw.ordId !== 'string' || !raw.ordId || typeof raw.clOrdId !== 'string' || typeof raw.state !== 'string' || !states.includes(raw.state) || typeof raw.sz !== 'string' || !raw.sz || typeof raw.accFillSz !== 'string' || !raw.accFillSz || !Number.isFinite(size) || size <= 0 || !Number.isFinite(filled) || filled < 0 || filled > size || (averagePrice !== null && (!Number.isFinite(averagePrice) || averagePrice <= 0))) throw new Error('okx_invalid_order_response');
  // Attached algos are submitted after complete parent fill; attachment presence is not protection evidence.
  return { orderId: raw.ordId, clientOrderId: raw.clOrdId, state: raw.state, contracts: size, filledContracts: filled, remainingContracts: size - filled, averagePrice, protectionConfirmed: false as const };
}
export async function queryOrder(client: OkxClient, id: string, clientOrderId: string) {
  validateInstrumentId(id); validateClientId(clientOrderId);
  const rows = await client.get<Record<string, unknown>>(`/api/v5/trade/order?instId=${id}&clOrdId=${clientOrderId}`);
  if (rows.length !== 1) throw new Error('okx_order_not_found');
  if (rows[0]?.clOrdId !== clientOrderId || (rows[0].instId !== undefined && rows[0].instId !== id)) throw new Error('okx_order_identity_mismatch');
  return normalizeOrder(rows[0]);
}
