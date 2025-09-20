// lib/common.js
export const KEYS = {
  SETTINGS: "settings",
  BASE_DIR_HANDLE: "baseDirHandle",
  PENDING: "pending"
};

export const DEFAULT_SETTINGS = {
  baseDirGranted: false,
  captureEA: false,
  captureExt: false,
  disableEAAlways: false,
  disableEATodayUntil: 0,
  ttlMinutes: 60,
  resumeMaxMB: 20,
  panelPos: "br"
};

export function ymdParts(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth()+1).padStart(2,"0");
  const dd = String(date.getDate()).padStart(2,"0");
  return { yyyy, mm, dd, ymd: `${yyyy}-${mm}-${dd}` };
}

export function sanitizeLabel(s, fallback) {
  const repl = (s || "").toString().trim()
    .replace(/[\/\\:\?\*"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[-–—]+/g, "-")
    .replace(/\s*[-|•:@]\s*/g, "-")
    .slice(0, 60)
    .replace(/[\. ]+$/g, "");
  return repl || fallback;
}

export function fingerprint({ domain, company, role, jobId }) {
  const d = (domain || "").toLowerCase();
  const c = (company || "").toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const r = (role || "").toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  const j = (jobId || "").toLowerCase();
  return [d, c, r, j].join("|");
}

export function buildLabelsFromContext(ctx) {
  try {
    const u = new URL(ctx.url || "");
    const host = u.hostname || "";
    const baseCompany = ctx.company || hostToCompany(host);
    const companyLabel = sanitizeLabel(baseCompany, "UnknownCompany");
    const roleLabel = sanitizeLabel(
      ctx.role ||
        titleToRole(document?.title) ||
        urlToReq(ctx.url) ||
        `Untitled-${shortId()}`,
      `Untitled-${shortId()}`
    );
    return { companyLabel, roleLabel };
  } catch {
    return {
      companyLabel: sanitizeLabel(ctx.company, "UnknownCompany"),
      roleLabel: sanitizeLabel(ctx.role || `Untitled-${shortId()}`, `Untitled-${shortId()}`)
    };
  }
}

function hostToCompany(host) {
  const parts = (host || "").split(".").filter(Boolean);
  const base = parts.length > 1 ? parts[parts.length-2] : parts[0] || "";
  return base ? base[0].toUpperCase() + base.slice(1) : "UnknownCompany";
}

function titleToRole(title) {
  if (!title) return "";
  const m = title.split(/[-|•:@]/)[0];
  return m ? m.trim() : "";
}

function urlToReq(url) {
  if (!url) return "";
  const r = url.match(/(jobs|job|req|requisition)[^\d]*(\d{4,})/i);
  return r ? `Req${r[2]}` : "";
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}
