"use client";

// Hai bảng của màn Ghi chú lịch: ma trận Khối × thứ (việc lặp hằng tuần) và danh sách ghi đè theo
// ngày. Hai thứ này khác nhau về PHẠM VI (lặp hằng tuần vs đúng một ngày) nên phải nhìn thấy tách
// bạch — bản cũ trộn chung một bảng phẳng, cột "Khi nào" lúc in "Thứ Ba" lúc in "2026-09-09".
//
// ⚠️ Ghi chú theo NGÀY **không** che ghi chú theo THỨ: cron `runShiftBrief` đọc HỢP của hai loại
// rồi để `mode` quyết định (`lib/cham-cong/brief.ts` — APPEND nối thêm, REPLACE thay toàn bộ,
// SUPPRESS tắt tin). Đừng viết lại thành "ngày thắng thứ" ở bất kỳ câu chữ nào trên màn.
//
// Hai điều dễ vỡ:
//  · Xoá là XOÁ CỨNG và hiện chưa ghi audit ⇒ hai bước xác nhận, có `aria-label` nói rõ xoá cái gì.
//    Bản cũ để thùng rác một cú bấm ngay cạnh nút Sửa.
//  · "Tạm tắt" phải hiện thành CHỮ. Làm mờ dòng (opacity) thì người dùng tưởng màn đang tải, còn
//    cron thì bỏ qua hẳn dòng đó (`isActive: false`) — hai cách hiểu ngược nhau.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarDays, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { BTN_DANGER, BTN_OUTLINE, PILL } from "@/components/admin/cham-cong/classes";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { AUD_LABEL, MODE_LABEL, WD, WD_FULL, WD_LABEL, type NoteBlock, type NoteRow } from "./shared";
import { NoteForm } from "./note-form";

export { AUD_LABEL, MODE_LABEL, WD, WD_FULL, WD_LABEL };
export type { NoteBlock, NoteRow };
import { deleteBriefNoteAction } from "../_actions";


/** Nhãn ngắn cho ô ma trận — ô chỉ rộng ~7rem. */
const AUD_SHORT: Record<NoteRow["audience"], string> = { ALL: "", KINH_DOANH: "KD", GIAO_VIEN: "GV" };

const MODE_TONE: Record<NoteRow["mode"], string> = {
  APPEND: "bg-state-info-soft text-state-info-ink",
  SUPPRESS: "bg-state-danger-soft text-state-danger-ink",
  REPLACE: "bg-state-warning-soft text-state-warning-ink",
};

/** "2026-09-09" → "09/09/2026". Cắt chuỗi, KHÔNG dựng `new Date` (bẫy lệch một ngày theo múi giờ). */
function ngayVN(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function NoteManager({
  rows,
  blocks,
  gioGui,
}: {
  rows: NoteRow[];
  blocks: NoteBlock[];
  /** "19:00" — giờ gửi tin của khối đang xem, để câu chữ khớp cấu hình thật. */
  gioGui: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NoteRow | null>(null);
  const [preset, setPreset] = useState<{ centerId: string; weekday: number | null } | null>(null);
  // Đếm số lần mở form: dùng làm `key` để mỗi lần mở là một form MỚI. Không có nó, mở lại đúng ô
  // cũ sẽ thấy chữ của lần trước (form giữ state trong `useState`, `key` không đổi ⇒ không remount).
  const [lanMo, setLanMo] = useState(0);

  const editable = blocks.filter((b) => b.canAssign);
  const theoThu = rows.filter((r) => r.date === null);
  const theoNgay = rows.filter((r) => r.date !== null);

  function moThem(centerId: string, weekday: number | null) {
    setEditing(null);
    setPreset({ centerId, weekday });
    setLanMo((n) => n + 1);
    setOpen(true);
  }
  function moSua(row: NoteRow) {
    setPreset(null);
    setEditing(row);
    setLanMo((n) => n + 1);
    setOpen(true);
  }
  function xoa(row: NoteRow) {
    start(async () => {
      const r = await deleteBriefNoteAction(row.id);
      setConfirmId(null);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã xoá ghi chú");
      router.refresh();
    });
  }

  /** Chuỗi mô tả một ghi chú, dùng cho `title` và `aria-label` của nút xoá. */
  const moTa = (r: NoteRow) =>
    `${r.date ? `ngày ${ngayVN(r.date)}` : WD_FULL[r.weekday ?? 0]} · ${r.centerLabel} · ${MODE_LABEL[r.mode]}`;

  const nhan = (r: NoteRow) => (
    <>
      {AUD_SHORT[r.audience] && (
        <span className={cn(PILL, "bg-muted text-muted-foreground")}>{AUD_SHORT[r.audience]}</span>
      )}
      {r.mode !== "APPEND" && <span className={cn(PILL, MODE_TONE[r.mode])}>{MODE_LABEL[r.mode]}</span>}
      {!r.isActive && <span className={cn(PILL, "bg-muted text-muted-foreground")}>Tạm tắt</span>}
    </>
  );

  return (
    <>
      {/* `min-w-0` trên CẢ HAI ô lưới, không phải trang trí: ô lưới mặc định `min-width:auto`, mà ô
          trái chứa bảng `min-w-[820px]` ⇒ nó từ chối co xuống dưới 820px, `overflow-x` của
          PhanTrangBang không bao giờ kích hoạt, và toàn bộ phần thiếu bị lấy từ ô phải — cột
          "Ghi đè theo ngày" teo còn ~60px, chữ rơi mỗi dòng một từ (đo trên test 06/09). */}
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <SectionCard title="Việc cố định theo thứ" icon={CalendarDays} className="min-w-0">
          <PhanTrangBang cuonNgang tenDonVi="khối" khoaGhiNho="ghi-chu-thu">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th scope="col" className={cn(adminTh, "px-3 py-2")}>
                    Khối
                  </th>
                  {WD.map((w) => (
                    <th key={w} scope="col" className={cn(adminTh, "px-1 py-2 text-center")} title={WD_FULL[w]}>
                      {WD_LABEL[w]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.id} className={adminTr}>
                    {/* `max-w` + `truncate` phải nằm trên phần tử BÊN TRONG ô: bảng auto-layout bỏ
                        qua max-width trên `<td>`, mà `adminTd` lại có `whitespace-nowrap` ⇒ ô nở ra
                        kéo trượt cả bảng thay vì cắt chữ. */}
                    <td className={cn(adminTd, "px-3 py-2 align-top font-medium")} title={b.label}>
                      <span className="flex max-w-[12rem] items-center gap-1.5">
                        <span className="truncate">{b.label}</span>
                        {!b.canAssign && (
                          <span className={cn(PILL, "bg-muted text-muted-foreground")}>Chỉ xem</span>
                        )}
                      </span>
                    </td>
                    {WD.map((w) => {
                      const cells = theoThu.filter((r) => r.centerId === b.id && r.weekday === w);
                      return (
                        <td key={w} className="min-w-[7rem] px-1 py-1.5 align-top">
                          {cells.map((r) =>
                            b.canAssign ? (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => moSua(r)}
                                title={`${moTa(r)} — bấm để sửa`}
                                className="mb-1 block w-full rounded-md border border-border bg-card px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted"
                              >
                                <span className="line-clamp-2 text-foreground">
                                  {r.mode === "SUPPRESS" && !r.text ? "Không gửi tin hôm đó" : r.text}
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1">{nhan(r)}</span>
                              </button>
                            ) : (
                              <div
                                key={r.id}
                                title={moTa(r)}
                                className="mb-1 rounded-md border border-border bg-card px-1.5 py-1 text-xs"
                              >
                                <span className="line-clamp-2 text-foreground">
                                  {r.mode === "SUPPRESS" && !r.text ? "Không gửi tin hôm đó" : r.text}
                                </span>
                                <span className="mt-1 flex flex-wrap gap-1">{nhan(r)}</span>
                              </div>
                            ),
                          )}
                          {b.canAssign && (
                            <button
                              type="button"
                              onClick={() => moThem(b.id, w)}
                              aria-label={`Thêm việc ${WD_FULL[w]} cho ${b.label}`}
                              title={`Thêm việc ${WD_FULL[w]} cho ${b.label}`}
                              className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <Plus aria-hidden className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
          {theoThu.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Chưa có việc cố định nào — tin nhắc lúc <span className="tabular-nums">{gioGui}</span> chỉ gồm lịch ca.
            </p>
          )}
        </SectionCard>

        <SectionCard
          className="min-w-0"
          title="Ghi đè theo ngày"
          icon={CalendarClock}
          actions={
            editable.length > 0 ? (
              <button type="button" className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")} onClick={() => moThem(editable[0].id, null)}>
                <Plus aria-hidden className="h-4 w-4" />
                Thêm ghi đè
              </button>
            ) : null
          }
        >
          {theoNgay.length === 0 ? (
            // Trạng thái rỗng NẰM TRONG SectionCard ⇒ không dùng `EmptyState` (nó tự mang vỏ thẻ,
            // lồng vào đây thành hai lớp viền trên cùng một nền).
            <p className="py-8 text-center text-sm text-muted-foreground">
              Chưa có ghi đè theo ngày. Ghi đè dùng cho ngày họp đột xuất, nghỉ bù, hoặc ngày không gửi
              tin — nó được gửi CÙNG việc cố định của thứ đó, trừ khi chọn cách gửi “Thay toàn bộ”.
            </p>
          ) : (
            <PhanTrangBang cuonNgang tenDonVi="ghi chú" khoaGhiNho="ghi-chu-ngay">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border bg-muted/40">
                  {/* Bảng DANH SÁCH bình thường ⇒ giữ mật độ chuẩn của `adminTh`/`adminTd`, đừng đè
                      `px-3 py-2` như lưới Khối × thứ ở trên (bảng này nằm cùng ConfigTabs với 5 bảng
                      danh sách khác, đặc hơn là nhìn thấy ngay khi lật tab). */}
                  <tr>
                    <th scope="col" className={adminTh}>
                      Ngày
                    </th>
                    <th scope="col" className={adminTh}>
                      Khối
                    </th>
                    <th scope="col" className={adminTh}>
                      Cách gửi
                    </th>
                    <th scope="col" className={adminTh}>
                      Gửi cho
                    </th>
                    <th scope="col" className={adminTh}>
                      Nội dung
                    </th>
                    <th scope="col" className={cn(adminTh, "text-right")}>
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {theoNgay.map((r) => {
                    const block = blocks.find((b) => b.id === r.centerId);
                    return (
                      <tr key={r.id} className={adminTr}>
                        <td className={cn(adminTd, "font-medium tabular-nums")}>{ngayVN(r.date!)}</td>
                        <td className={adminTd} title={r.centerLabel}>
                          <span className="block max-w-[10rem] truncate">{r.centerLabel}</span>
                        </td>
                        <td className={adminTd}>
                          <span className={cn(PILL, MODE_TONE[r.mode])}>{MODE_LABEL[r.mode]}</span>
                          {!r.isActive && (
                            <span className={cn(PILL, "ml-1.5 bg-muted text-muted-foreground")}>Tạm tắt</span>
                          )}
                        </td>
                        <td className={cn(adminTd, "text-muted-foreground")}>{AUD_LABEL[r.audience]}</td>
                        <td className={adminTd} title={r.text}>
                          <span className="block max-w-[20rem] truncate">
                            {r.text || <span className="text-muted-foreground">(không có nội dung)</span>}
                          </span>
                        </td>
                        <td className={cn(adminTd, "text-right")}>
                          {block?.canAssign ? (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                                onClick={() => moSua(r)}
                                aria-label={`Sửa ghi chú ${moTa(r)}`}
                              >
                                Sửa
                              </button>
                              {confirmId === r.id ? (
                                <button
                                  type="button"
                                  className={cn(BTN_DANGER, "h-8 px-3 text-xs")}
                                  disabled={pending}
                                  onClick={() => xoa(r)}
                                  aria-label={`Xác nhận xoá vĩnh viễn ghi chú ${moTa(r)}`}
                                >
                                  Xoá hẳn?
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                                  disabled={pending}
                                  onClick={() => setConfirmId(r.id)}
                                  aria-label={`Xoá ghi chú ${moTa(r)}`}
                                >
                                  <Trash2 aria-hidden className="h-4 w-4" />
                                  Xoá
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Chỉ xem</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </SectionCard>
      </div>

      {editable.length > 0 && (
        <NoteForm
          key={`${lanMo}:${editing?.id ?? "moi"}`}
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) setConfirmId(null);
          }}
          blocks={editable}
          value={editing}
          preset={preset}
          gioGui={gioGui}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
