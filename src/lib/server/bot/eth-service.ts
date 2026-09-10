import { z } from 'zod';
import { ethSettingsSchema } from '../../bot/eth-config';
import type { BotStore } from './store';

const ethCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enabled'), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('settings'), settings: ethSettingsSchema }).strict(),
  z.object({ action: z.literal('cycle') }).strict(),
  z.object({ action: z.literal('emergency') }).strict(),
]);

export type EthCommand = z.infer<typeof ethCommandSchema>;

/**
 * Panel commands. None of them touch the exchange: they change stored intent and ask the worker to
 * act, because only the worker holds the database lease that makes an order safe to send.
 */
export function handleEthCommand(store: BotStore, value: unknown) {
  const parsed = ethCommandSchema.safeParse(value);
  if (!parsed.success) throw new Error('Geçersiz ETH bot komutu veya ayar aralığı.');
  const command = parsed.data;
  if (command.action === 'settings') { store.saveEthSettings(command.settings); store.ethEvent('info', `Ayarlar güncellendi · ${command.settings.mode === 'live' ? 'CANLI' : 'paper'} · ${command.settings.leverage}× · en fazla ${command.settings.maxNotionalUsdt} USDT büyüklük.`); return { ok: true }; }
  if (command.action === 'enabled') {
    store.setEthEnabled(command.enabled);
    if (command.enabled) store.requestEthCycle(true);
    store.ethEvent(command.enabled ? 'info' : 'warning', command.enabled
      ? `ETH botu çalışıyor. Kural gelen ilk 15m kapanışta ${store.getEthSettings().mode === 'live' ? 'gerçek hesapta emir açılır' : 'paper olarak işaretlenir'}.`
      : 'ETH botu durduruldu. Yeni giriş açılmaz; açık pozisyon varsa stop takibi sürer.');
    return { ok: true };
  }
  if (command.action === 'cycle') { store.requestEthCycle(true); return { ok: true }; }
  store.requestEthEmergency(true);
  store.setEthEnabled(false);
  store.ethEvent('warning', 'Acil kapatma istendi; worker sıradaki turda pozisyonu kapatıp emirleri iptal eder.');
  return { ok: true };
}

/** True while the loop must keep running: enabled, or holding a position that needs its stop. */
export function ethNeedsWorker(store: BotStore): boolean {
  return store.ethEnabled() || !!store.getEthState()?.openTrade || store.ethEmergencyRequested();
}
