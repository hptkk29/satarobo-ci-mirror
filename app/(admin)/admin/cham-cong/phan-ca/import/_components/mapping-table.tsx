// app/(admin)/admin/cham-cong/phan-ca/import/_components/mapping-table.tsx — nối tên trên Sheet
// với tài khoản trong hệ thống, nhóm theo khối.
//
// Vì sao file này tồn tại: đây là bước DUY NHẤT của lượt import mà máy không tự quyết được. Bản cũ
// đổ 19–20 dòng phẳng, không nói dòng nào máy đã nhớ, dòng nào chỉ là phỏng đoán, dòng nào còn
// trống — nên người nhập soát bằng cách rê mắt qua từng ô `<select>`. Cột TRẠNG THÁI làm việc đó
// thay họ, còn hàng nhóm cho biết dòng nào thuộc khối mình KHÔNG có quyền ghi (server sẽ bỏ qua
// và đếm vào `skippedNoPermission`).
//
// Hai điều dễ vỡ:
//  1. KHÔNG phân trang (khai MIEN_TRU ở `components/ui/bang-coverage.test.ts`): cắt trang là giấu
//     mất người chưa ánh xạ, mà đó chính là thứ chặn nút "Áp vào hệ thống".
//  2. `<select>` NATIVE, không phải shadcn `Select` (base-ui): `SelectValue` in giá trị thô —
//     ở đây giá trị là `userId` cuid, người dùng sẽ đọc ra một chuỗi vô nghĩa.
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { PreviewPerson } from "@/lib/cham-cong/import-core";

export type MappingCandidate = { userId: string; label: string; centerCode: string | null };

/** `tone` của StatusPill dùng màu SÁNG (`--state-*`) làm màu CHỮ — trượt AA cho chữ 12px đậm — nên
 *  luôn đè `text-state-*-ink`, đúng như ghi chú trong `status-pill.tsx` và `period-status-pill.tsx`. */
const INK: Record<PillTone, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  brand: "text-primary-ink",
  muted: "",
};

/** Nhãn + tone của cột TRẠNG THÁI. Tính từ LỰA CHỌN HIỆN TẠI, không phải từ gợi ý ban đầu:
 *  người dùng đổi tay xong mà pill vẫn ghi "Đã nhớ" là nói dối họ. */
function trangThai(p: PreviewPerson, chon: string): { text: string; tone: PillTone } {
  if (!chon) return { text: "Chưa ánh xạ", tone: "warning" };
  if (chon === p.rememberedUserId) return { text: "Đã nhớ", tone: "success" };
  const top = p.suggestions[0];
  if (top && top.userId === chon && top.score >= 90) return { text: "Gợi ý ≥90", tone: "info" };
  return { text: "Đã chọn tay", tone: "success" };
}

/** Gộp người theo khối trên Sheet. Người có mặt ở hai khối (CS1 + HO) thành một nhóm riêng —
 *  đúng như Sheet ghi, không tự chọn hộ một khối. */
function nhomTheoKhoi(people: PreviewPerson[]): { key: string; units: string[]; people: PreviewPerson[] }[] {
  const byKey = new Map<string, { key: string; units: string[]; people: PreviewPerson[] }>();
  for (const p of people) {
    const units = p.units.length ? p.units : ["—"];
    const key = units.join(" + ");
    const g = byKey.get(key);
    if (g) g.people.push(p);
    else byKey.set(key, { key, units, people: [p] });
  }
  return [...byKey.values()];
}

export function MappingTable({
  people,
  candidates,
  mapping,
  onPick,
  allowedUnits,
  blockLabels,
  disabled = false,
}: {
  people: PreviewPerson[];
  candidates: MappingCandidate[];
  mapping: Record<string, string>;
  onPick: (displayName: string, userId: string) => void;
  /** Mã khối người dùng có `hr_attendance:assign` (từ `preview.centers`). */
  allowedUnits: string[];
  /** Mã khối → nhãn đầy đủ ("CS1" → "CS1 · Trụ sở"). Thiếu thì in mã trần. */
  blockLabels: Record<string, string>;
  disabled?: boolean;
}) {
  const labelOf = new Map(candidates.map((c) => [c.userId, c.label]));
  const groups = nhomTheoKhoi(people);
  const allowed = new Set(allowedUnits);

  return (
    // Không phân trang, nhưng VẪN phải có vùng cuộn RIÊNG: ô `<select>` rộng 16rem × 4 cột vượt
    // 375px, không có `overflow-x-auto` thì cả trang trượt ngang thay vì mình cái bảng.
    //
    // KHÔNG dựng vỏ thẻ (`rounded-xl border bg-card`) ở đây: người gọi duy nhất là SectionCard
    // "Ánh xạ tên…" của import-wizard, vốn đã có viền + nền — thêm một lớp nữa đọc thành thẻ lồng thẻ.
    //
    // `relative` KHÔNG thừa: `sr-only` là `position:absolute`, vùng cuộn không định vị thì nó neo
    // vào khối chứa của TRANG và kéo `<body>` trượt ngang.
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th scope="col" className={adminTh}>
              Tên trên Sheet
            </th>
            <th scope="col" className={adminTh}>
              Vai
            </th>
            <th scope="col" className={adminTh}>
              Trạng thái
            </th>
            <th scope="col" className={adminTh}>
              Nhân sự trong hệ thống
            </th>
          </tr>
        </thead>
        {/* ĐÚNG MỘT tbody: hàng nhóm nằm TRONG thân bảng, không phải một tbody riêng. */}
        <tbody>
          {groups.map((g) => {
            const boQua = !g.units.some((u) => allowed.has(u));
            const ten = g.units.map((u) => blockLabels[u] ?? u).join(" + ");
            return [
              <tr key={`g-${g.key}`} className="border-b border-border">
                <td colSpan={4} className="bg-muted/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="mr-2">{ten}</span>
                  <span className="font-normal normal-case tabular-nums">{g.people.length} người</span>
                  {boQua && (
                    <span className={cn(PILL, "ml-2 bg-muted normal-case text-muted-foreground")}>
                      sẽ bỏ qua — bạn không phân ca ở khối này
                    </span>
                  )}
                </td>
              </tr>,
              ...g.people.map((p) => {
                const chon = mapping[p.displayName] ?? "";
                const st = trangThai(p, chon);
                const goiY = p.suggestions
                  .slice(0, 2)
                  .map((s) => `${labelOf.get(s.userId) ?? "?"} (${s.reason})`)
                  .join(" · ");
                return (
                  <tr key={p.displayName} className={adminTr}>
                    <td className={cn(adminTd, "max-w-[14rem]")}>
                      <span className="block truncate font-medium" title={p.displayName}>
                        {p.displayName}
                      </span>
                      {p.fullName !== p.displayName && (
                        <span className="block truncate text-xs text-muted-foreground" title={p.fullName}>
                          {p.fullName}
                        </span>
                      )}
                    </td>
                    <td className={cn(adminTd, "text-muted-foreground")} title={p.role}>
                      <span className="block max-w-[10rem] truncate">{p.role || "—"}</span>
                    </td>
                    <td className={adminTd}>
                      <StatusPill tone={st.tone} className={INK[st.tone]}>{st.text}</StatusPill>
                      {!chon && goiY && (
                        <span className="mt-1 block max-w-[16rem] truncate text-xs text-muted-foreground" title={goiY}>
                          Gợi ý: {goiY}
                        </span>
                      )}
                    </td>
                    <td className={adminTd}>
                      <select
                        className={cn(FIELD, "w-64 max-w-full")}
                        aria-label={`Nhân sự khớp với ${p.displayName}`}
                        aria-invalid={chon ? undefined : true}
                        disabled={disabled}
                        value={chon}
                        onChange={(e) => onPick(p.displayName, e.target.value)}
                      >
                        <option value="">— chưa ánh xạ —</option>
                        {candidates.map((c) => (
                          <option key={c.userId} value={c.userId}>
                            {c.label}
                            {c.centerCode ? ` (${c.centerCode})` : " (HO)"}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              }),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
