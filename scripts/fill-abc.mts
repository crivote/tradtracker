import { firstSetting } from '../src/lib/abc';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  process.exit(1);
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1], 10) : undefined;
const pauseArg = args.find(a => a.startsWith('--pause'));
const pause = pauseArg ? parseInt(pauseArg.split('=')[1] || args[args.indexOf(pauseArg) + 1], 10) : 350;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, attempts = 3) {
  const delays = [1000, 2000, 4000];
  
  for (let i = 0; i <= attempts; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'tradtracker-fill-abc/0.1' },
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      if (response.ok) return { status: response.status, text: await response.text() };
      
      if (response.status === 410) return { status: 410 };
      
      if ((response.status === 429 || response.status >= 500) && i < attempts) {
        await sleep(delays[i]);
        continue;
      }
      
      return { status: response.status };
    } catch (e) {
      if (i === attempts) throw e;
      await sleep(delays[i]);
    }
  }
  throw new Error('Max retries exceeded');
}

async function run() {
  const stats = { seen: 0, updated: 0, gone: 0, failed: 0, skipped: 0 };
  
  const query = `select=id,origin_ref&origin=eq.thesession&abc=is.null${limit ? `&limit=${limit}` : ''}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pr_tunes?${query}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`
    }
  });

  if (!res.ok) {
    console.error(`Supabase error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const tunes = await res.json();
  stats.seen = tunes.length;

  for (const tune of tunes) {
    try {
      const { id, origin_ref } = tune;
      const result = await fetchWithRetry(`https://thesession.org/tunes/${origin_ref}/abc`);
      
      if (result.status === 410) {
        stats.gone++;
        continue;
      }
      
      if (!result.text) {
        stats.failed++;
        continue;
      }

      const abc = firstSetting(result.text);
      if (abc === null) {
        stats.failed++;
        continue;
      }

      if (!isDryRun) {
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/pr_tunes?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ abc })
        });
        
        if (patchRes.ok) {
          stats.updated++;
        } else {
          stats.failed++;
        }
      } else {
        // In dry run, we count it as "would be updated" but the brief says 
        // "updated queda en 0" in the summary.
        // However, "cuenta igual las filas vistas y válidas".
        // Let's use a temporary counter or just not increment stats.updated.
        // Brief: "updated queda en 0".
      }

    } catch (e) {
      stats.failed++;
    }
    
    await sleep(pause);
  }

  console.log(JSON.stringify(stats));
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
