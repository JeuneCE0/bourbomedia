import { NextRequest, NextResponse } from 'next/server';
import { supaFetch } from '@/lib/supabase';
import { sendSlackNotification } from '@/lib/slack';

// Cron qui surveille la table error_logs et alert sur Slack si des erreurs
// sont apparues depuis le dernier check. Frequency : toutes les 15 minutes
// (cf. vercel.json). On stocke le dernier timestamp checké en mémoire ;
// fallback sur "now - interval" si premier appel.
//
// Pourquoi pas Realtime / webhook : Vercel ne supporte pas les long-running
// listeners sur les serverless functions, et on veut un cron simple plutôt
// qu'un service dédié. 15 min est un bon compromis entre fraîcheur (pas
// trop tard pour réagir sur un crash en prod) et coût (1/96 du quota cron
// quotidien).

// Mémoire entre invocations sur la même instance Vercel — perdue à chaque
// cold start (ce qui re-déclenche un alert sur le dernier batch, mais
// 15min de recouvrement maxi, acceptable).
let lastCheckedAt: string | null = null;

const ALERT_THRESHOLD = 1; // alerter dès qu'il y a au moins 1 nouvelle erreur

export async function GET(req: NextRequest) {
  // Auth Vercel cron : header x-vercel-cron est présent UNIQUEMENT si
  // l'appel vient bien du système cron Vercel. Si le header est absent
  // (ex: appel manuel), on accepte que si le secret CRON_SECRET match.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const secret = req.nextUrl.searchParams.get('secret');
  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const since = lastCheckedAt
    || new Date(Date.now() - 15 * 60_000).toISOString();
  const checkedAt = new Date().toISOString();

  try {
    const r = await supaFetch(
      `error_logs?created_at=gte.${encodeURIComponent(since)}&select=source,message,digest,url,client_token_prefix,created_at,metadata&order=created_at.desc&limit=20`,
      {}, true,
    );
    if (!r.ok) {
      return NextResponse.json({ error: 'fetch failed' }, { status: 500 });
    }
    const errors: Array<{
      source: string;
      message: string | null;
      digest: string | null;
      url: string | null;
      client_token_prefix: string | null;
      created_at: string;
      metadata: Record<string, unknown> | null;
    }> = await r.json();

    if (errors.length < ALERT_THRESHOLD) {
      lastCheckedAt = checkedAt;
      return NextResponse.json({ ok: true, newErrors: 0, since });
    }

    // Group par signature pour éviter de spammer (1 ligne par pattern unique).
    const grouped = new Map<string, { count: number; sample: typeof errors[0] }>();
    for (const e of errors) {
      const sig = e.digest || (e.message?.slice(0, 100) || 'unknown');
      const existing = grouped.get(sig);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(sig, { count: 1, sample: e });
      }
    }

    const groups = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
    const totalUnique = groups.length;
    const totalCount = errors.length;

    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🪲 ${totalCount} erreur${totalCount > 1 ? 's' : ''} runtime (${totalUnique} pattern${totalUnique > 1 ? 's' : ''})`, emoji: true },
      },
    ];

    for (const g of groups.slice(0, 5)) {
      const e = g.sample;
      const sourceTag = e.source === 'server' ? '🖥️ server' : '🌐 client';
      const xN = g.count > 1 ? ` ×${g.count}` : '';
      const message = (e.message || e.digest || '(pas de message)').slice(0, 200);
      const url = e.url ? `\n_<${e.url}>_` : '';
      const tokenInfo = e.client_token_prefix ? `\nToken préfixe: \`${e.client_token_prefix}…\`` : '';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${sourceTag}${xN}*\n\`\`\`${message}\`\`\`${url}${tokenInfo}`,
        },
      });
    }

    if (groups.length > 5) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_+ ${groups.length - 5} autres patterns — voir /dashboard/errors_` }],
      });
    } else {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '_Voir le détail sur /dashboard/errors_' }],
      });
    }

    await sendSlackNotification({
      text: `🪲 ${totalCount} erreur${totalCount > 1 ? 's' : ''} runtime sur bourbomedia`,
      blocks: blocks as never,
    });

    lastCheckedAt = checkedAt;
    return NextResponse.json({
      ok: true,
      newErrors: totalCount,
      uniquePatterns: totalUnique,
      since,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
