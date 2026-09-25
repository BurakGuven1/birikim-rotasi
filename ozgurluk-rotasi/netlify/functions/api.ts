import { handleApi } from "../../src/api.ts";

/** Netlify fonksiyonu: tüm /api uçları yerel sunucuyla aynı işleyiciden geçer. */
export default async (req: Request): Promise<Response> =>
  (await handleApi(req)) ?? new Response("bulunamadı", { status: 404 });

export const config = { path: "/api/*" };
