"use client";

// Bảng khung ca tuần của MỘT khối: người × 7 thứ (T2 → CN).
//
// Vì sao viết lại: bản cũ xếp chồng bảng của mọi khối, mỗi ô là `<select>` cao 24px chỉ hiện mã
// trần, và một mã đã ngưng trong danh mục làm ô vẽ TRỐNG — người xếp lịch nhìn thấy "chưa xếp"
// rồi xếp đè lên lịch đang chạy. Nay mỗi khối là một thẻ riêng, ô là `ShiftCellPicker` (đúng
// menu của lưới phân ca tháng), và mã đã ngưng vẫn hiện kèm chữ "đã ngưng" thay vì biến mất.
//
// Ba điều dễ vỡ:
//  · Thứ nghỉ (`offDays`) do PAGE đọc từ cấu hình rồi truyền xuống dạng cờ — đừng viết `w === 1`
//    ở đây, ngày nghỉ tuần là tham số vận hành chứ không phải hằng số.
//  · `savePatternCellAction` ghi từng ô một, KHÔNG có hoàn tác: mỗi lần chọn là một vòng server
//    rồi `router.refresh()`. Ô đang chờ bị khoá để không bấm hai lần vào cùng một thứ.
//  · Picker phải bật `hideReason`: `savePatternCellAction` KHÔNG nhận `note` (zod bỏ im lặng),
//    nên nhánh "Chọn kèm lý do…" ở đây là hứa suông.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarRange, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { doiCho } from "@/lib/cham-cong/khung-ca";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { EmptyState } from "@/components/admin/ui/states";
import { BTN_OUTLINE, PILL } from "@/components/admin/cham-cong/classes";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import {
  ShiftCellPicker,
  type ShiftCellCode,
} from "@/components/admin/cham-cong/shift-cell-picker";
import { ShiftCodeChip } from "@/components/cham-cong/ui/shift-code-chip";
import {
  removePersonFromBlockAction,
  reorderBlockAction,
  savePatternCellAction,
} from "../_actions";
import { BulkAddDialog, type Candidate } from "./bulk-add-dialog";

/** Mã ca dùng được cho ô. `isLeave` chỉ để in nhóm trong chú giải — tổng Công/tuần vẫn theo K-01. */
export type PatternCode = {
  code: string;
  name: string;
  timeLabel: string;
  isLeave: boolean;
};

export type PatternPerson = {
  userId: string;
  name: string;
  jobLabel: string | null;
  /** Tên trên file Sheet khi khác tên hệ thống — người đối chiếu file cần thấy. */
  sheetName: string | null;
  byWeekday: Record<number, string | null>;
};

export type PatternBlock = {
  centerId: string;
  label: string;
  canAssign: boolean;
  /** Thứ nghỉ tuần của khối (0 = CN … 6 = T7), từ `shift.weeklyOffDays`. */
  offDays: number[];
  people: PatternPerson[];
};

// `Candidate` khai ở HỘP THOẠI (nơi dùng nó) rồi tái xuất ở đây, để `page.tsx` vẫn nhập
// một chỗ như cũ — một khai báo, hai nơi đọc. Phải `import type` chứ không chỉ
// `export type ... from`: file này cũng dùng tên đó trong props.
export type { Candidate };

/** Thứ Hai đứng đầu tuần làm việc; 0 = Chủ Nhật đứng cuối (khớp `vnWeekday` và cột Sheet). */
const WD = [1, 2, 3, 4, 5, 6, 0];
const WD_LABEL: Record<number, string> = {
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
  0: "CN",
};
const WD_FULL: Record<number, string> = {
  1: "Thứ Hai",
  2: "Thứ Ba",
  3: "Thứ Tư",
  4: "Thứ Năm",
  5: "Thứ Sáu",
  6: "Thứ Bảy",
  0: "Chủ Nhật",
};

/** K-01 (luật Sheet): mọi mã làm việc = 1 công, X/P = nghỉ. Cố ý KHÔNG suy từ `isLeave` — con số
 *  này phải khớp cột tổng của file Sheet mà kế toán đối chiếu. */
function congTuan(p: PatternPerson): number {
  return Object.values(p.byWeekday).filter((c) => !!c && c !== "X" && c !== "P")
    .length;
}

export function PatternGrid({
  blocks,
  codes,
  candidates,
}: {
  blocks: PatternBlock[];
  codes: PatternCode[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  // Xác nhận 2 bước cho việc GỠ — khoá theo `${centerId}|${userId}`, đúng khuôn
  // confirm-delete của admin. Không dùng `confirm()`: hộp thoại trình duyệt chặn mọi
  // sự kiện và không nói được câu dài mà thao tác này BẮT BUỘC phải nói.
  const [xacNhanGo, setXacNhanGo] = useState<string | null>(null);

  // Danh mục cho menu ô — cùng khuôn với lưới phân ca tháng. `place` để trống có chủ đích:
  // khung ca là mẫu tuần của MỘT khối nên "nơi làm" không thêm thông tin, và `PatternCode`
  // (đặc tả §3.4) không mang trường đó.
  const cellCodes: ShiftCellCode[] = useMemo(
    () =>
      codes.map((c) => ({
        code: c.code,
        name: c.name,
        timeLabel: c.timeLabel,
        place: "",
        isLeave: c.isLeave,
      })),
    [codes],
  );

  function doiO(
    block: PatternBlock,
    person: PatternPerson,
    weekday: number,
    code: string,
  ) {
    const key = `${block.centerId}-${person.userId}-${weekday}`;
    setBusy(key);
    start(async () => {
      const r = await savePatternCellAction({
        userId: person.userId,
        centerId: block.centerId,
        weekday,
        code: code || null,
        sheetName: person.sheetName ?? undefined,
        jobLabel: person.jobLabel ?? undefined,
      });
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        code
          ? `${person.name}: ${WD_FULL[weekday]} → ca ${code}`
          : `${person.name}: bỏ ca ${WD_FULL[weekday]}`,
      );
      router.refresh();
    });
  }

  function doiThuTu(
    block: PatternBlock,
    person: PatternPerson,
    huong: "len" | "xuong",
  ) {
    const hienTai = block.people.map((x) => x.userId);
    const moi = doiCho(hienTai, person.userId, huong);
    // Ngoài rìa: `doiCho` trả bản sao nguyên vẹn. Đừng gửi lượt ghi vô nghĩa.
    if (moi.join("|") === hienTai.join("|")) return;
    setBusy(`sap:${block.centerId}`);
    start(async () => {
      const r = await reorderBlockAction({
        centerId: block.centerId,
        userIds: moi,
      });
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      router.refresh();
    });
  }

  function goNguoi(block: PatternBlock, person: PatternPerson) {
    const key = `${block.centerId}|${person.userId}`;
    // Bấm lần một: hiện lời cảnh báo + đổi nút thành "Xác nhận gỡ". Bấm lần hai mới ghi.
    if (xacNhanGo !== key) {
      setXacNhanGo(key);
      return;
    }
    setXacNhanGo(null);
    setBusy(`go:${key}`);
    start(async () => {
      const r = await removePersonFromBlockAction({
        userId: person.userId,
        centerId: block.centerId,
      });
      setBusy(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã gỡ ${person.name} khỏi khung ca ${block.label}. Nhân sự và lịch đã sinh vẫn giữ nguyên — thêm lại là lịch tuần cũ sống lại.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {codes.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">
            Mã ca đang dùng
          </span>
          {codes.map((c) => (
            <span key={c.code} className="inline-flex items-center gap-1.5">
              <ShiftCodeChip code={c.code} size="sm" />
              {c.name}
              {c.timeLabel && (
                <span className="tabular-nums">· {c.timeLabel}</span>
              )}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Danh mục mã ca đang trống — khai mã ở tab <b>Mã ca</b> trước, chưa có
          mã thì không xếp được khung ca.
        </p>
      )}

      {blocks.map((b) => {
        const off = new Set(b.offDays);
        const dsThem = candidates.filter(
          (c) => !b.people.some((p) => p.userId === c.userId),
        );
        return (
          <SectionCard
            key={b.centerId}
            title={b.label}
            icon={CalendarRange}
            actions={
              b.canAssign ? (
                <BulkAddDialog
                  centerId={b.centerId}
                  blockLabel={b.label}
                  candidates={dsThem}
                  disabled={pending}
                />
              ) : (
                <span
                  className={cn(PILL, "bg-muted text-muted-foreground")}
                  title="Sửa khung ca cần quyền hr_attendance:assign tại khối này"
                >
                  Chỉ xem
                </span>
              )
            }
          >
            {b.people.length === 0 ? (
              <EmptyState
                title={`${b.label} chưa có ai trong khung ca`}
                description={
                  b.canAssign
                    ? "Bấm Thêm nhân sự ở góc trên để chọn nhiều người một lượt — sau đó chọn mã ca cho từng thứ."
                    : "Khối này chưa có lịch tuần cố định. Người xếp lịch của khối sẽ thêm nhân sự vào đây."
                }
              />
            ) : (
              <PhanTrangBang
                cuonNgang
                tenDonVi="người"
                khoaGhiNho={`khung-ca:${b.centerId}`}
                soDongMacDinh={20}
              >
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="border-b border-border bg-muted/40">
                    <tr>
                      <th scope="col" className={cn(adminTh, "px-3 py-2")}>
                        Nhân sự
                      </th>
                      {WD.map((w) => (
                        <th
                          key={w}
                          scope="col"
                          className={cn(
                            adminTh,
                            "px-1 py-2 text-center",
                            off.has(w) && "bg-muted",
                          )}
                          title={
                            off.has(w)
                              ? `${WD_FULL[w]} — ngày nghỉ tuần của khối`
                              : WD_FULL[w]
                          }
                        >
                          {WD_LABEL[w]}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className={cn(adminTh, "px-3 py-2 text-right")}
                      >
                        Công/tuần
                      </th>
                      {b.canAssign && (
                        <th
                          scope="col"
                          className={cn(adminTh, "px-2 py-2 text-right")}
                        >
                          <span className="sr-only">
                            Sắp thứ tự và gỡ khỏi khung ca
                          </span>
                        </th>
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {b.people.map((p, iNguoi) => (
                      <tr key={p.userId} className={adminTr}>
                        <td
                          className={cn(adminTd, "px-3 py-1.5 font-medium")}
                          title={[
                            p.name,
                            p.sheetName && p.sheetName !== p.name
                              ? `Sheet: ${p.sheetName}`
                              : null,
                            p.jobLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        >
                          {/* `max-w` + `truncate` phải ở SPAN: bảng auto-layout bỏ qua max-width
                              trên `<td>`, còn `adminTd` có sẵn `whitespace-nowrap` ⇒ ô không cắt
                              chữ mà nở ra kéo cả cột. */}
                          <span className="block max-w-[15rem] truncate">
                            {p.name}
                            {p.jobLabel && (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                · {p.jobLabel}
                              </span>
                            )}
                          </span>
                        </td>

                        {WD.map((w) => {
                          const cur = p.byWeekday[w] ?? "";
                          const key = `${b.centerId}-${p.userId}-${w}`;
                          const nhan = `${p.name} · ${WD_FULL[w]}`;
                          // Mã đã ngưng trong danh mục vẫn phải hiện: bỏ nó khỏi danh sách là ô
                          // vẽ trống và người xếp lịch tưởng thứ đó chưa có ca.
                          const laMaNgung =
                            !!cur && !codes.some((c) => c.code === cur);
                          const dsMa = laMaNgung
                            ? [
                                ...cellCodes,
                                {
                                  code: cur,
                                  name: "Mã đã ngưng",
                                  timeLabel: "",
                                  place: "",
                                },
                              ]
                            : cellCodes;
                          return (
                            <td
                              key={w}
                              className={cn(
                                "px-1 py-1.5",
                                off.has(w) && "bg-muted",
                              )}
                            >
                              {/* Nút của picker là khối `w-12`; cột thứ rộng hơn thế nên phải
                                  canh giữa bằng flex, `text-center` không với tới nó. */}
                              <span className="flex justify-center">
                                {b.canAssign ? (
                                  <ShiftCellPicker
                                    value={cur || null}
                                    codes={dsMa}
                                    hideReason
                                    busy={pending && busy === key}
                                    triggerLabel={`Chọn ca cho ${nhan}`}
                                    menuTitle={nhan}
                                    onPick={(code) => doiO(b, p, w, code ?? "")}
                                  />
                                ) : (
                                  <span
                                    className="inline-flex h-8 w-12 items-center justify-center"
                                    title={`${nhan}: chỉ xem`}
                                  >
                                    <ShiftCodeChip
                                      code={cur || null}
                                      size="sm"
                                    />
                                  </span>
                                )}
                              </span>
                            </td>
                          );
                        })}

                        <td
                          className={cn(
                            adminTd,
                            "px-3 py-1.5 text-right font-semibold tabular-nums",
                          )}
                        >
                          {congTuan(p)}
                        </td>

                        {b.canAssign && (
                          <td className={cn(adminTd, "px-2 py-1.5 text-right")}>
                            {/* Lên/xuống thay vì kéo–thả: kéo–thả cần thư viện mới (phải
                                hỏi trước), và trên bảng cuộn ngang thì nó khó dùng hơn
                                hai nút. Nút ở rìa bị vô hiệu để không sinh lượt ghi rỗng. */}
                            <button
                              type="button"
                              className={cn(BTN_OUTLINE, "px-2")}
                              disabled={pending || iNguoi === 0}
                              onClick={() => doiThuTu(b, p, "len")}
                              title={`Đưa ${p.name} lên một bậc`}
                            >
                              <ArrowUp aria-hidden className="h-4 w-4" />
                              <span className="sr-only">Lên một bậc</span>
                            </button>
                            <button
                              type="button"
                              className={cn(BTN_OUTLINE, "ml-1 px-2")}
                              disabled={
                                pending || iNguoi === b.people.length - 1
                              }
                              onClick={() => doiThuTu(b, p, "xuong")}
                              title={`Đưa ${p.name} xuống một bậc`}
                            >
                              <ArrowDown aria-hidden className="h-4 w-4" />
                              <span className="sr-only">Xuống một bậc</span>
                            </button>
                            <button
                              type="button"
                              className={cn(
                                BTN_OUTLINE,
                                "ml-1 whitespace-nowrap",
                                xacNhanGo === `${b.centerId}|${p.userId}` &&
                                  "border-state-danger text-state-danger-ink",
                              )}
                              disabled={pending}
                              onClick={() => goNguoi(b, p)}
                              onBlur={() =>
                                setXacNhanGo((k) =>
                                  k === `${b.centerId}|${p.userId}` ? null : k,
                                )
                              }
                              /* Câu này là chỗ DUY NHẤT nói rõ ranh giới của thao tác.
                                 "Xoá" ở màn nhân sự nghĩa khác hẳn — người vận hành sẽ
                                 đọc nhãn nút chứ không đọc tài liệu. */
                              title={
                                xacNhanGo === `${b.centerId}|${p.userId}`
                                  ? `Bấm lần nữa để gỡ ${p.name} khỏi khung ca ${b.label}. Hồ sơ nhân sự KHÔNG bị xoá, lịch tháng đã sinh giữ nguyên, và thêm lại thì lịch tuần cũ sống lại.`
                                  : `Gỡ ${p.name} khỏi khung ca của ${b.label} — không xoá nhân sự`
                              }
                            >
                              <UserMinus aria-hidden className="h-4 w-4" />
                              {xacNhanGo === `${b.centerId}|${p.userId}`
                                ? "Xác nhận gỡ khỏi khung ca"
                                : "Gỡ khỏi khối"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </PhanTrangBang>
            )}
          </SectionCard>
        );
      })}
    </div>
  );
}
