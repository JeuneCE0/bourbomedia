// Strip HTML tags from a string (utilisé pour les notes GHL qui peuvent
// venir avec du markup TipTap/Quill : <p>, <br/>, <strong>, <em>, etc.).
//
// Conserve la sémantique des sauts de ligne :
//   <br/> ou <br> → \n
//   </p>          → \n\n (sépare les paragraphes)
//   </li>         → \n
//   <li>          → '- ' (liste à puces basique)
// Décode les entités HTML courantes (&amp;, &lt;, &gt;, &quot;, &apos;, &nbsp;).
// Trim et collapse les sauts de lignes consécutifs.

export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // Block-level → \n
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6])>/gi, '\n\n');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '- ');

  // All other tags → strip
  s = s.replace(/<\/?[^>]+>/g, '');

  // Decode common HTML entities
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")
       .replace(/&apos;/g, "'")
       .replace(/&laquo;/g, '«')
       .replace(/&raquo;/g, '»')
       .replace(/&euro;/g, '€');

  // Collapse 3+ newlines into 2, trim each line
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');

  return s.trim();
}
