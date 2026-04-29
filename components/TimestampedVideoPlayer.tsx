'use client';

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';

interface FeedbackEntry {
  id: string;
  time_seconds: number;
  comment: string;
  author: 'client' | 'admin';
  created_at: string;
  resolved?: boolean;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

const frameBtnStyle: CSSProperties = {
  padding: '5px 10px', borderRadius: 6,
  background: 'var(--night-mid)', border: '1px solid var(--border-md)',
  color: 'var(--text)', fontSize: '0.74rem', fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
  fontFamily: "'Bricolage Grotesque', sans-serif",
};

// Parse "1:23", "01:23", "83" (= 1:23) → secondes. Renvoie null si invalide.
function parseTimeInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const colon = t.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (colon) {
    const m = Number(colon[1]); const s = Number(colon[2]);
    if (Number.isFinite(m) && Number.isFinite(s)) return m * 60 + s;
  }
  const num = Number(t);
  if (Number.isFinite(num) && num >= 0) return num;
  return null;
}

export default function TimestampedVideoPlayer({
  videoId,
  videoUrl,
  thumbnailUrl,
  token,
}: {
  videoId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  token: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const isDirect = isDirectVideoUrl(videoUrl);
  // Avance d'une frame ≈ 1/30s — les .mp4 livrés sont à 30fps standard.
  const FRAME = 1 / 30;

  const load = useCallback(() => {
    fetch(`/api/videos/feedback?token=${token}&video_id=${videoId}`)
      .then(r => r.ok ? r.json() : { feedback: [] })
      .then(d => setFeedback(d.feedback || []))
      .finally(() => setLoading(false));
  }, [token, videoId]);

  useEffect(() => { load(); }, [load]);

  function captureCurrentTime() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setDraftTime(v.currentTime);
  }

  function step(deltaSeconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const max = Number.isFinite(v.duration) ? v.duration : Number.MAX_SAFE_INTEGER;
    v.currentTime = Math.max(0, Math.min(max, v.currentTime + deltaSeconds));
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => null);
    else v.pause();
  }

  async function toggleResolved(entry: FeedbackEntry) {
    const r = await fetch('/api/videos/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, video_id: videoId, entry_id: entry.id, resolved: !entry.resolved }),
    });
    if (r.ok) {
      const d = await r.json();
      setFeedback(d.feedback || []);
    }
  }

  // Raccourcis clavier façon frame.io — uniquement en mode direct, et désactivés
  // si le focus est dans un input/textarea (évite de bloquer la saisie de texte).
  useEffect(() => {
    if (!isDirect) return;
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt?.isContentEditable) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowLeft')  { e.preventDefault(); step(e.shiftKey ? -FRAME : -5); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ?  FRAME :  5); }
      else if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        captureCurrentTime();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirect]);

  function seekTo(seconds: number) {
    const v = videoRef.current;
    if (v) {
      v.currentTime = seconds;
      v.play().catch(() => null);
      return;
    }
    // YouTube/Vimeo : pas de SDK chargé — on tente postMessage standard.
    // Marche pour Vimeo (toujours) et YouTube si enablejsapi est actif.
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[src*="youtube.com/embed"], iframe[src*="player.vimeo.com"]');
    if (!iframe?.contentWindow) return;
    const isVimeo = (iframe.src || '').includes('vimeo');
    const msg = isVimeo
      ? JSON.stringify({ method: 'setCurrentTime', value: seconds })
      : JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] });
    try { iframe.contentWindow.postMessage(msg, '*'); } catch { /* tolerate */ }
  }

  async function submitComment() {
    if (draftTime === null || !draftComment.trim()) return;
    setSubmitting(true);
    try {
      const r = await fetch('/api/videos/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          video_id: videoId,
          time_seconds: draftTime,
          comment: draftComment.trim(),
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setFeedback(d.feedback || []);
        setDraftComment('');
        setDraftTime(null);
      }
    } finally { setSubmitting(false); }
  }

  async function deleteEntry(id: string) {
    const r = await fetch('/api/videos/feedback', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, video_id: videoId, entry_id: id }),
    });
    if (r.ok) {
      const d = await r.json();
      setFeedback(d.feedback || []);
    }
  }

  return (
    <div>
      {/* Player — direct video element if possible, else hosted iframe */}
      {isDirect ? (
        <>
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              poster={thumbnailUrl}
              onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
              onLoadedMetadata={e => setDuration((e.target as HTMLVideoElement).duration || 0)}
              style={{ width: '100%', display: 'block' }}
            />
          </div>

          {/* Timeline frame.io-style — pastilles cliquables par commentaire */}
          {duration > 0 && feedback.length > 0 && (
            <div
              role="presentation"
              title="Pastilles : commentaires épinglés. Curseur orange : position actuelle."
              style={{
                position: 'relative', height: 18, marginTop: 8,
                paddingTop: 6, paddingBottom: 6,
              }}
            >
              <div style={{
                position: 'absolute', top: '50%', left: 0, right: 0, height: 4,
                background: 'var(--border)', borderRadius: 999, transform: 'translateY(-50%)',
              }} />
              {/* Curseur de lecture */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${Math.min(100, (currentTime / duration) * 100)}%`,
                width: 2, background: 'var(--orange)',
                transform: 'translateX(-1px)', borderRadius: 999,
                transition: 'left .12s linear',
              }} />
              {/* Pastilles commentaires */}
              {feedback.map(f => {
                const left = Math.min(100, Math.max(0, (f.time_seconds / duration) * 100));
                const isActive = Math.abs(f.time_seconds - currentTime) < 0.6;
                const color = f.resolved
                  ? 'var(--green)'
                  : (f.author === 'admin' ? '#3B82F6' : 'var(--orange)');
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => seekTo(f.time_seconds)}
                    title={`${fmtTime(f.time_seconds)} — ${f.comment.slice(0, 80)}${f.comment.length > 80 ? '…' : ''}${f.resolved ? ' (résolu)' : ''}`}
                    style={{
                      position: 'absolute', top: '50%', left: `${left}%`,
                      transform: `translate(-50%, -50%) scale(${isActive ? 1.3 : 1})`,
                      width: 12, height: 12, borderRadius: '50%',
                      background: color, opacity: f.resolved ? 0.55 : 1,
                      border: isActive ? '2px solid #fff' : '2px solid var(--night)',
                      cursor: 'pointer', padding: 0,
                      transition: 'transform .12s ease',
                      boxShadow: isActive ? `0 0 0 4px ${color}40` : 'none',
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Frame stepping — précision frame.io */}
          <div style={{
            marginTop: 8, padding: '6px 10px', borderRadius: 10,
            background: 'var(--night-card)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, marginRight: 4 }}>
              ⌨️ Espace = play · ←/→ = ±5s · Maj+←/→ = ±1 frame · C = commenter
            </span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={() => step(-5)} title="-5 secondes (←)" style={frameBtnStyle}>−5s</button>
            <button type="button" onClick={() => step(-FRAME)} title="-1 frame (Maj+←)" style={frameBtnStyle}>◀ frame</button>
            <button type="button" onClick={togglePlay} title="Play/Pause (Espace)" style={{ ...frameBtnStyle, background: 'var(--orange)', color: '#fff', borderColor: 'var(--orange)' }}>⏯</button>
            <button type="button" onClick={() => step(FRAME)} title="+1 frame (Maj+→)" style={frameBtnStyle}>frame ▶</button>
            <button type="button" onClick={() => step(5)} title="+5 secondes (→)" style={frameBtnStyle}>+5s</button>
          </div>
        </>
      ) : (
        <div style={{
          position: 'relative', paddingBottom: '56.25%', height: 0,
          borderRadius: 12, overflow: 'hidden', background: '#000',
        }}>
          <iframe
            src={
              videoUrl.match(/youtu/)
                // enablejsapi=1 permet le seekTo via postMessage (cf. seekTo plus haut).
                ? `https://www.youtube.com/embed/${(videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) || [])[1] || ''}?enablejsapi=1`
                : videoUrl.match(/vimeo/) ? `https://player.vimeo.com/video/${(videoUrl.match(/vimeo\.com\/(\d+)/) || [])[1] || ''}`
                : videoUrl
            }
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
      )}

      {/* Action bar — capture timestamp (auto pour direct, manuel sinon) */}
      {isDirect ? (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: 'var(--night-mid)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{
            fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
            fontSize: '1rem', color: 'var(--orange)', minWidth: 60,
          }}>
            {fmtTime(currentTime)}
          </span>
          <button
            type="button"
            onClick={captureCurrentTime}
            style={{
              padding: '7px 14px', borderRadius: 8,
              background: 'var(--orange)', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
            }}
          >
            💬 Commenter à {fmtTime(currentTime)}
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flex: 1 }}>
            Pause à un moment précis pour ajouter un retour ciblé
          </span>
        </div>
      ) : (
        <ManualTimestampBar onPick={t => setDraftTime(t)} />
      )}

      {/* Draft form (visible after capture) */}
      {draftTime !== null && (
        <div style={{
          marginTop: 10, padding: '14px 16px', borderRadius: 12,
          background: 'rgba(232,105,43,.08)', border: '1px solid rgba(232,105,43,.40)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 999,
              background: 'var(--orange)', color: '#fff',
              fontSize: '0.74rem', fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif",
            }}>
              📍 {fmtTime(draftTime)}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-mid)' }}>
              Votre remarque sera épinglée à ce moment de la vidéo
            </span>
          </div>
          <textarea
            value={draftComment}
            onChange={e => setDraftComment(e.target.value)}
            placeholder="Ex : le titre est trop long, on pourrait le raccourcir..."
            rows={3}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', padding: '10px 12px',
              borderRadius: 8, background: 'var(--night-mid)',
              border: '1px solid var(--border-md)', color: 'var(--text)',
              fontSize: '0.88rem', fontFamily: 'inherit', resize: 'vertical', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button
              onClick={() => { setDraftTime(null); setDraftComment(''); }}
              disabled={submitting}
              style={{
                padding: '7px 14px', borderRadius: 8, background: 'transparent',
                border: '1px solid var(--border-md)', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '0.8rem',
              }}
            >Annuler</button>
            <button
              onClick={submitComment}
              disabled={submitting || !draftComment.trim()}
              style={{
                padding: '7px 14px', borderRadius: 8,
                background: 'var(--orange)', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                opacity: submitting || !draftComment.trim() ? 0.5 : 1,
              }}
            >
              {submitting ? '⏳' : '📌'} Épingler le commentaire
            </button>
          </div>
        </div>
      )}

      {/* Comments list */}
      <div style={{ marginTop: 14 }}>
        <div style={{
          marginBottom: 8, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
        }}>
          <div style={{
            fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span aria-hidden>💬</span>
            Retours
            {feedback.length > 0 && (() => {
              const open = feedback.filter(f => !f.resolved).length;
              const done = feedback.length - open;
              return (
                <span style={{ fontWeight: 600, color: 'var(--text-mid)' }}>
                  ({open} à traiter{done > 0 ? ` · ${done} résolu${done > 1 ? 's' : ''}` : ''})
                </span>
              );
            })()}
          </div>
          {feedback.some(f => f.resolved) && (
            <label style={{
              fontSize: '0.7rem', color: 'var(--text-mid)', display: 'flex',
              alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={showResolved}
                onChange={e => setShowResolved(e.target.checked)}
                style={{ accentColor: 'var(--orange)' }}
              />
              Afficher les résolus
            </label>
          )}
        </div>
        {loading ? (
          <div style={{ height: 40, background: 'var(--night-mid)', borderRadius: 8, opacity: 0.5 }} />
        ) : feedback.length === 0 ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
            fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center',
          }}>
            Aucun retour — utilise le bouton ci-dessus pour épingler ton premier commentaire.
          </div>
        ) : (() => {
          const visible = feedback
            .filter(f => showResolved || !f.resolved)
            // Tri par timecode (chronologique vidéo) — mêmes ordre que les pastilles.
            .slice()
            .sort((a, b) => a.time_seconds - b.time_seconds);
          if (visible.length === 0) {
            return (
              <div style={{
                padding: '12px 14px', borderRadius: 10,
                background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
                fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center',
              }}>
                🎉 Tous les retours sont résolus — coche « Afficher les résolus » pour les revoir.
              </div>
            );
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visible.map(f => {
                const isAdmin = f.author === 'admin';
                const isActive = isDirect && Math.abs(f.time_seconds - currentTime) < 0.6;
                const canMutate = !isAdmin; // côté client : toggle/delete uniquement ses propres entrées
                return (
                  <div key={f.id} style={{
                    padding: '10px 12px', borderRadius: 10,
                    background: isActive ? 'rgba(232,105,43,.10)' : 'var(--night-mid)',
                    border: `1px solid ${isActive ? 'var(--orange)' : (isAdmin ? 'rgba(59,130,246,.40)' : 'var(--border)')}`,
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    opacity: f.resolved ? 0.65 : 1,
                    transition: 'background .15s, border-color .15s',
                  }}>
                    <button
                      onClick={() => seekTo(f.time_seconds)}
                      title="Aller à ce moment de la vidéo"
                      style={{
                        flexShrink: 0, padding: '4px 10px', borderRadius: 6,
                        background: f.resolved ? 'var(--green)' : (isAdmin ? '#3B82F6' : 'var(--orange)'),
                        color: '#fff',
                        border: 'none', cursor: 'pointer',
                        fontSize: '0.74rem', fontWeight: 700,
                        fontFamily: "'Bricolage Grotesque', sans-serif",
                      }}
                    >
                      {f.resolved ? '✓' : '▶'} {fmtTime(f.time_seconds)}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5,
                        whiteSpace: 'pre-wrap', wordWrap: 'break-word',
                        textDecoration: f.resolved ? 'line-through' : 'none',
                      }}>
                        {f.comment}
                      </div>
                      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 3 }}>
                        {isAdmin ? '👤 Équipe Bourbomedia' : '🙋 Vous'}
                        {' · '}
                        {new Date(f.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {f.resolved && ' · résolu'}
                      </div>
                    </div>
                    {canMutate && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => toggleResolved(f)}
                          title={f.resolved ? 'Rouvrir ce retour' : 'Marquer comme résolu'}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${f.resolved ? 'var(--green)' : 'var(--border-md)'}`,
                            color: f.resolved ? 'var(--green)' : 'var(--text-muted)',
                            cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700,
                            padding: '4px 8px', borderRadius: 6, lineHeight: 1,
                          }}
                        >
                          {f.resolved ? '↺' : '✓'}
                        </button>
                        <button
                          onClick={() => deleteEntry(f.id)}
                          title="Supprimer ce commentaire"
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', fontSize: '0.95rem', padding: 4, lineHeight: 1,
                          }}
                        >×</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// Pour les vidéos hostées (YouTube / Vimeo / GHL CDN), on ne peut pas lire
// l'horodatage automatiquement. L'utilisateur tape le timecode (MM:SS) qu'il
// voit dans le player du fournisseur, puis clique pour ouvrir le draft form.
function ManualTimestampBar({ onPick }: { onPick: (seconds: number) => void }) {
  const [raw, setRaw] = useState('');
  const parsed = parseTimeInput(raw);
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 10,
      background: 'var(--night-mid)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <input
        type="text"
        inputMode="numeric"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        placeholder="1:23"
        aria-label="Timecode (MM:SS)"
        onKeyDown={e => { if (e.key === 'Enter' && parsed !== null) { onPick(parsed); setRaw(''); } }}
        style={{
          padding: '7px 10px', borderRadius: 8, width: 90,
          background: 'var(--night-card)', border: '1px solid var(--border-md)',
          color: 'var(--text)', fontSize: '0.95rem', fontWeight: 700,
          fontFamily: "'Bricolage Grotesque', sans-serif", textAlign: 'center',
          outline: 'none',
        }}
      />
      <button
        type="button"
        onClick={() => { if (parsed !== null) { onPick(parsed); setRaw(''); } }}
        disabled={parsed === null}
        style={{
          padding: '7px 14px', borderRadius: 8,
          background: 'var(--orange)', color: '#fff', border: 'none',
          cursor: parsed === null ? 'not-allowed' : 'pointer',
          fontSize: '0.82rem', fontWeight: 700,
          opacity: parsed === null ? 0.5 : 1,
        }}
      >
        💬 Commenter à ce moment
      </button>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flex: 1, minWidth: 200 }}>
        Mettez la vidéo en pause, lisez le timecode (ex&nbsp;: <strong>1:23</strong>) et tapez-le ici
      </span>
    </div>
  );
}
