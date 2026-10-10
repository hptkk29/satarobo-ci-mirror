// lib/cham-cong/name-match.ts — Gợi ý ghép tên trên Sheet ("Mr Phúc", "Thầy Khôi", "Lê Khôi")
// với hồ sơ nhân sự. THUẦN. S-37: prod có 0/21 User.phone và 5/20 Employee.phone ⇒ ghép theo
// TÊN là chính, người vận hành xác nhận một lần trên màn import, hệ thống nhớ qua
// ShiftWeeklyPattern.sheetName. Hàm này chỉ GỢI Ý, không tự quyết.

export type NameCandidate = {
  userId: string;
  employeeId: string | null;
  fullName: string; // Employee.fullName (ưu tiên) hoặc User.name
  userName: string | null;
  phone: string | null;
  centerCode: string | null; // "CS1" | "CS2" | null (HO)
};

export type NameSuggestion = { userId: string; score: number; reason: string };

const HONORIFICS = /^(mr|ms|mrs|thầy|thay|cô|co|anh|chị|chi|em|bác|bac|ông|ong|bà|ba)\s+/i;

/** Bỏ dấu, hoa/thường, gọn khoảng trắng. "Hoàng Trà My" → "hoang tra my". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Mr Phúc" → "phuc"; "Cô Trà My" → "tra my"; "Lê Khôi" → "khoi" (tên gọi = phần sau họ). */
export function callName(s: string): string {
  const n = normalizeName(s.replace(HONORIFICS, ""));
  const hadHonorific = HONORIFICS.test(s.trim());
  if (hadHonorific) return n; // "Mr Phúc" / "Cô Trà My" đã là tên gọi
  const parts = n.split(" ");
  return parts.length >= 2 ? parts.slice(1).join(" ") : n;
}

function lastToken(s: string): string {
  const parts = normalizeName(s).split(" ");
  return parts[parts.length - 1] ?? "";
}

export function suggestCandidates(
  row: { displayName: string; fullName: string; unit?: string | null; phone?: string | null },
  candidates: readonly NameCandidate[],
): NameSuggestion[] {
  const full = normalizeName(row.fullName);
  const disp = normalizeName(row.displayName);
  const call = callName(row.displayName);
  const dispHasHonorific = HONORIFICS.test(row.displayName.trim());
  const out: NameSuggestion[] = [];
  for (const c of candidates) {
    const cFull = normalizeName(c.fullName);
    const cUser = c.userName ? normalizeName(c.userName) : "";
    let score = 0;
    let reason = "";
    if (row.phone && c.phone && row.phone.replace(/\D/g, "") === c.phone.replace(/\D/g, "")) {
      score = 100;
      reason = "trùng SĐT";
    } else if (full && (cFull === full || cUser === full)) {
      score = 95;
      reason = "trùng họ tên đầy đủ";
    } else if (disp && (cFull === disp || cUser === disp)) {
      score = 90;
      reason = "trùng tên hiển thị";
    } else if (call && cFull.endsWith(" " + call)) {
      score = dispHasHonorific ? 60 : 50;
      reason = `họ tên kết thúc bằng "${call}"`;
    } else if (call && lastToken(c.fullName) === lastToken(call)) {
      score = 35;
      reason = "trùng tên gọi";
    }
    if (score === 0) continue;
    if (row.unit && c.centerCode && row.unit !== "HO" && c.centerCode === row.unit) score += 5;
    if (row.unit === "HO" && c.centerCode === null) score += 5;
    out.push({ userId: c.userId, score, reason });
  }
  return out.sort((a, b) => b.score - a.score);
}
