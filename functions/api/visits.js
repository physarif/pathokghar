// functions/api/visits.js — Cloudflare Pages Function
// GET /api/visits          -> কাউন্ট বাড়িয়ে বর্তমান সংখ্যা রিটার্ন করে
// GET /api/visits?count=0  -> শুধু বর্তমান সংখ্যা রিটার্ন করে, বাড়ায় না
//
// প্রয়োজনীয় সেটআপ (Cloudflare dashboard):
// 1. Workers & Pages > KV > Create namespace (নাম যা খুশি, যেমন "pathokghar-visits")
// 2. আপনার Pages প্রজেক্ট > Settings > Functions > KV namespace bindings
//    Variable name: VISITS_KV   ->   বানানো namespace সিলেক্ট করুন
//    (Production ও Preview দুই environment-এই বাইন্ড করুন)

export async function onRequestGet(context) {
  const { env, request } = context;
  const kv = env.VISITS_KV;

  if (!kv) {
    return new Response(
      JSON.stringify({ error: 'VISITS_KV binding পাওয়া যায়নি। Cloudflare Pages settings-এ KV bind করুন।' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const shouldCount = url.searchParams.get('count') !== '0';

  // বাংলাদেশ সময় অনুযায়ী আজকের তারিখ (YYYY-MM-DD)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  const dailyKey = 'daily:' + today;

  let [totalStr, dailyStr] = await Promise.all([kv.get('total'), kv.get(dailyKey)]);
  let total = parseInt(totalStr, 10) || 0;
  let daily = parseInt(dailyStr, 10) || 0;

  if (shouldCount) {
    total += 1;
    daily += 1;
    await Promise.all([
      kv.put('total', String(total)),
      kv.put(dailyKey, String(daily), { expirationTtl: 60 * 60 * 24 * 30 }), // ৩০ দিন পর পুরনো daily key মুছে যাবে
    ]);
  }

  return new Response(JSON.stringify({ total, today: daily }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
