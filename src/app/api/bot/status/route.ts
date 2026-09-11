import { withBot } from '@/lib/server/bot/http';
import { snapshot } from '@/lib/server/bot/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return withBot(request, store => snapshot(store)); }
