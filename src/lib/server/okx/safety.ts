import { OkxError, type OkxClient } from './client';
import { validateInstrumentId } from './market';
import type { DemoSafetyPort, DemoIntent } from './demo-broker';
import { buildExitOrder } from './execution';

/**
 * The safety half of live execution: put a real protective stop on the exchange after a fill,
 * prove it is actually there and covers the exposure, and prove the position is flat when closing.
 *
 * Nothing here trusts an attached-algo field on the parent order. Protection counts only when a
 * pending algo order is visible on the exchange, is reduce-only in the closing direction, and
 * covers at least the exposure currently held. With leverage, an unprotected position is the one
 * failure that can lose far more than the trade's risk budget, so every check queries the exchange.
 */
const algoId = (clientOrderId: string, suffix: string) => `${clientOrderId.slice(0, 28)}${suffix}`.slice(0, 32);
const closingSide = (direction: DemoIntent['direction']) => direction === 'long' ? 'sell' : 'buy';

interface AlgoRow { algoId?: unknown; algoClOrdId?: unknown; instId?: unknown; side?: unknown; sz?: unknown; slTriggerPx?: unknown; state?: unknown; reduceOnly?: unknown }

export function createOkxSafetyPort(client: OkxClient): DemoSafetyPort {
  if (client.mode !== 'demo' && client.mode !== 'live') throw new Error('okx_safety_requires_trading_mode');

  /** Pending stop algos this bot owns for one instrument, as reported by the exchange. */
  async function pendingStops(intent: DemoIntent): Promise<AlgoRow[]> {
    validateInstrumentId(intent.id);
    const rows = await client.get<AlgoRow>(`/api/v5/trade/orders-algo-pending?instId=${intent.id}&ordType=conditional`);
    // The staged exit rests its take profits under the same client id prefix. Those are not stops:
    // counting one as protection would let an unstopped position pass verification, and the stale
    // cancel below would delete the profit side of the plan on every reconcile.
    return rows.filter(row => typeof row.algoClOrdId === 'string' && row.algoClOrdId.startsWith(intent.clientOrderId.slice(0, 28)) && Number(row.slTriggerPx) > 0);
  }

  async function ownedExposure(intent: DemoIntent): Promise<number> {
    validateInstrumentId(intent.id);
    const rows = await client.get<{ instId?: unknown; pos?: unknown; posSide?: unknown }>(`/api/v5/account/positions?instId=${intent.id}`);
    let net = 0;
    for (const row of rows) {
      if (row.instId !== intent.id) continue;
      const size = Number(row.pos);
      if (!Number.isFinite(size)) throw new Error('okx_position_unreadable');
      net += size;
    }
    return Math.abs(net);
  }

  return {
    /**
     * Places a reduce-only stop covering `contracts`. The client id is derived from the parent, so
     * a retry after a timeout re-sends the same id and OKX rejects the duplicate rather than
     * stacking a second stop.
     */
    async protectFilled(intent, contracts) {
      if (!Number.isFinite(contracts) || contracts <= 0) throw new Error('okx_invalid_protection_size');
      const existing = await pendingStops(intent);
      if (existing.some(row => Number(row.sz) >= contracts)) return;
      // A stale stop for a smaller size must go before a correctly sized one is placed, or the
      // exchange holds two reduce-only orders and the second fill closes an already flat position.
      for (const row of existing) {
        if (typeof row.algoId !== 'string') continue;
        try { await client.post('/api/v5/trade/cancel-algos', [{ instId: intent.id, algoId: row.algoId }]); }
        catch (error) { if (!(error instanceof OkxError)) throw error; }
      }
      await client.post('/api/v5/trade/order-algo', {
        instId: intent.id, tdMode: 'isolated', side: closingSide(intent.direction), posSide: 'net',
        ordType: 'conditional', sz: String(contracts), reduceOnly: true,
        algoClOrdId: algoId(intent.clientOrderId, 'sl'),
        slTriggerPx: String(intent.stop), slOrdPx: '-1', slTriggerPxType: 'mark',
      });
    },

    /** True only when a live exchange-side stop covers the exposure in the closing direction. */
    async verifyProtection(intent, contracts) {
      if (!Number.isFinite(contracts) || contracts <= 0) return false;
      const rows = await pendingStops(intent);
      return rows.some(row => row.instId === intent.id && row.side === closingSide(intent.direction) &&
        (row.state === 'live' || row.state === 'partially_effective') &&
        Number.isFinite(Number(row.sz)) && Number(row.sz) >= contracts &&
        Number.isFinite(Number(row.slTriggerPx)) && Number(row.slTriggerPx) > 0);
    },

    /** True only when the exchange reports no exposure and no working entry that could still fill. */
    async verifyFlat(intent) {
      if (await ownedExposure(intent) !== 0) return false;
      const working = await client.get<{ instId?: unknown; clOrdId?: unknown; state?: unknown }>(`/api/v5/trade/orders-pending?instId=${intent.id}`);
      return !working.some(row => row.instId === intent.id && row.clOrdId === intent.clientOrderId);
    },

    /**
     * Exit sends are keyed by their own client id, so a resend after an ambiguous timeout is the
     * same order to OKX. A duplicate-id rejection therefore means the exit already exists.
     */
    async sendIdempotentExit(payload) {
      try { await client.post('/api/v5/trade/order', payload); }
      catch (error) {
        // 51603/51000-family duplicate identifiers mean the exit is already on the exchange.
        if (error instanceof OkxError && (error.code === '51603' || error.code === '51002')) return;
        throw error;
      }
    },
  };
}

export { buildExitOrder };
