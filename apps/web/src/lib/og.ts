// This file is part of the Vercel function api/invite.ts, which Vercel compiles
// file by file without bundling: no Vite aliases (`@convex/…`), no extensionless
// imports, and nothing from the app (`format.ts`, `i18n/ar.ts`). Keep it that way;
// invite.node.test.ts loads the compiled closure in plain Node.
import { toWesternDigits } from "../../../../convex/lib/digits.js";

// A fixed zone: the function runs in UTC on Vercel, which would shift the day.
const dateFormat = new Intl.DateTimeFormat("ar", {
  day: "numeric",
  month: "long",
  timeZone: "Asia/Dubai",
});

/** What `GET /api/preview` returns; mirrors `PreviewData` in convex/preview.ts. */
export type PreviewData = {
  name: string | null;
  createdAt: number;
  done: number;
  round: number;
  inviterName: string | null;
};

export type OgTags = {
  title: string;
  description: string;
  image: string;
  url: string;
};

const BRAND = "وِردك";
const GENERIC_DESCRIPTION = "نختم القرآن معاً، كل واحد يأخذ جزءاً.";

/** WhatsApp ignores a relative image path, so resolve against the page. A page URL that is not absolute leaves the path relative. */
function absoluteImage(pageUrl: string): string {
  try {
    return new URL("/og.png", pageUrl).href;
  } catch {
    return "/og.png";
  }
}

/** The Open Graph values for an invite link; `null` gives the generic ones. */
export function previewTags(p: PreviewData | null, pageUrl: string): OgTags {
  const image = absoluteImage(pageUrl);
  if (p === null) {
    return {
      title: BRAND,
      description: GENERIC_DESCRIPTION,
      image,
      url: pageUrl,
    };
  }
  // Same wording as `t.khatma.untitled` in i18n/ar.ts; change both together.
  const name =
    p.name ?? `ختمة ${toWesternDigits(dateFormat.format(p.createdAt))}`;
  const progress = `تمّ ${toWesternDigits(p.done)} من 30 جزءاً · الختمة ${toWesternDigits(p.round)}`;
  return {
    title: `${name} · ${BRAND}`,
    description:
      p.inviterName === null ? progress : `${progress} · دعاك ${p.inviterName}`,
    image,
    url: pageUrl,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BLOCK = /<!--og:start-->[\s\S]*?<!--og:end-->/;

/** Replaces the `<!--og:start-->…<!--og:end-->` block of `index.html` with the tags. */
export function injectOg(html: string, tags: OgTags): string {
  const meta = (property: string, content: string) =>
    `<meta property="${property}" content="${escapeHtml(content)}" />`;
  const block = [
    "<!--og:start-->",
    `<title>${escapeHtml(tags.title)}</title>`,
    meta("og:title", tags.title),
    meta("og:description", tags.description),
    meta("og:image", tags.image),
    meta("og:url", tags.url),
    meta("og:type", "website"),
    meta("og:locale", "ar_AR"),
    "<!--og:end-->",
  ].join("\n    ");
  // A function replacer: the block has `$` sequences that a string would expand.
  return html.replace(BLOCK, () => block);
}
