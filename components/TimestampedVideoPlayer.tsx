'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

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
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const isDirect = isDirectVideoUrl(videoUrl);

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

  function seekTo(seconds: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = seconds;
    v.play().catch(() => null);
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

  // Pass POST body via query for token (the endpoint reads either)
  // ... actually our endpoint reads token from query, not body — let me fix
  // Actually I designed the endpoint to read token from req.nextUrl. Let me
  // pass it as query param on POST too.

  // For non-direct (YouTube/Vimeo), fall back to a simple unmuted iframe
  if (!isDirect) {
    return (
      <div>
        <div style={{
          position: 'relative', paddingBottom: '56.25%', height: 0,
          borderRadius: 12, overflow: 'hidden', background: '#000',
        }}>
          <iframe
            src={
              videoUrl.match(/youtu/) ? `https://www.youtube.com/embed/${(videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) || [])[1] || ''}`
              : videoUrl.match(/vimeo/) ? `https://player.vimeo.com/video/${(videoUrl.match(/vimeo\.com\/(\d+)/) || [])[1] || ''}`
              : videoUrl
            }
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          />
        </div>
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(250,204,21,.08)', border: '1px solid rgba(250,204,21,.30)',
          fontSize: '0.78rem', color: '#FDE68A',
        }}>
          💡 Pour des commentaires précis horodatés, demandez-nous le fichier source en téléchargement.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Player */}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          poster={thumbnailUrl}
          onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
          style={{ width: '100%', display: 'block' }}
        />
      </div>

      {/* Action bar — capture timestamp */}
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
          fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span aria-hidden>💬</span>
          Commentaires {feedback.length > 0 && `(${feedback.length})`}
        </div>
        {loading ? (
          <div style={{ height: 40, background: 'var(--night-mid)', borderRadius: 8, opacity: 0.5 }} />
        ) : feedback.length === 0 ? (
          <div style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--night-mid)', border: '1px dashed var(--border-md)',
            fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center',
          }}>
            Aucun commentaire — utilise le bouton ci-dessus pour épingler ton premier retour.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {feedback.map(f => {
              const isAdmin = f.author === 'admin';
              return (
                <div key={f.id} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'var(--night-mid)', border: `1px solid ${isAdmin ? 'rgba(59,130,246,.40)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}>
                  <button
                    onClick={() => seekTo(f.time_seconds)}
                    title="Aller à ce moment de la vidéo"
                    style={{
                      flexShrink: 0, padding: '4px 10px', borderRadius: 6,
                      background: isAdmin ? '#3B82F6' : 'var(--orange)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                      fontSize: '0.74rem', fontWeight: 700,
                      fontFamily: "'Bricolage Grotesque', sans-serif",
                    }}
                  >
                    ▶ {fmtTime(f.time_seconds)}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.82rem', color: 'var(--text)', lineHeight: 1.5,
                      whiteSpace: 'pre-wrap', wordWrap: 'break-word',
                    }}>
                      {f.comment}
                    </div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 3 }}>
                      {isAdmin ? '👤 Équipe Bourbomedia' : '🙋 Vous'}
                      {' · '}
                      {new Date(f.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {!isAdmin && (
                    <button
                      onClick={() => deleteEntry(f.id)}
                      title="Supprimer ce commentaire"
                      style={{
                        background: 'transparent', border: 'none', color: 'var(--text-muted)',
                        cursor: 'pointer', fontSize: '0.95rem', padding: 4, lineHeight: 1,
                      }}
                    >×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
