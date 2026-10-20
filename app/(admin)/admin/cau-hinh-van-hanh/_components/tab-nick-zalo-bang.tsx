"use client";

// Bảng giao nick Zalo — NHIỀU NGƯỜI MỘT NICK, MỖI NGƯỜI MỘT MỨC (24/09/2026).
//
// ── VÌ SAO BẢNG CHỈ TÓM TẮT, CÒN SỬA THÌ TRONG HỘP THOẠI ─────────────────────────────
// Một ô `<Select>` trên dòng bảng diễn tả được "một người". Nó KHÔNG diễn tả được "hai
// người, mỗi người một mức" — và cách duy nhất để nhét vừa là cho dòng cao lên, phá mật
// độ 44px của DESIGN.md ngay trên màn có nhiều bảng khác.
//
// Nên bảng in CÂU TÓM TẮT (đọc lướt được, đúng thứ người ta cần khi mở màn: "nick này ai
// đang giữ"), và nút Sửa mở hộp thoại có đủ chỗ cho danh sách đầy đủ + ba mức.
//
// ── THÊM NGƯỜI RỒI MỚI PHÂN QUYỀN (chủ dự án chốt 24/09) ─────────────────────────────
// Hộp thoại KHÔNG liệt kê sẵn mọi nhân sự của cơ sở với ô "Không giao": một cơ sở có vài
// chục người, và 90% dòng sẽ mãi mãi là "Không giao" — người dùng phải cuộn qua chúng
// mỗi lần. Thay vào đó: danh sách NGƯỜI ĐANG GIỮ ở trên (đổi mức, gỡ), và một ô TÌM
// KIẾM ở dưới để thêm người. Thêm xong mới chọn mức.
//
// ── 🔴 HỘP THOẠI ĐẶT CẢ TẬP, KHÔNG PHẢI THÊM/BỚT TỪNG DÒNG ──────────────────────────
// Bấm Lưu là gửi TOÀN BỘ danh sách; ai không còn trong đó thì bị gỡ. Đó là vì vế GỠ
// (người nghỉ việc, đổi ca) là vế không ai nhớ bấm, và hỏng thì không có triệu chứng —
// người không còn phận sự vẫn đọc chat khách.
//
// ── 🔴 QUẢN LÝ CƠ SỞ CŨNG LÀ MỘT DÒNG NHƯ MỌI NGƯỜI (chủ dự án ĐẢO 24/09) ────────────
// Bản trước hiện họ ở một khối ghi chú xám "không gỡ ở đây được", vì họ có `admin` tự
// động. Chủ dự án chốt lại: *"quản lý phân quyền của QLCS ở đây luôn chứ"* — nên nhánh
// tự động đã bị gỡ khỏi `pham-vi-nick.ts` và họ thêm/gỡ/đổi mức như mọi người.
//
// Hệ quả ĐÃ ĐƯỢC CÂN NHẮC và phải NÓI RA trên màn: gỡ quản lý khỏi một nick thì họ
// không còn đọc được chat của nick đó. Nick CHƯA giao ai thì họ vẫn thấy (nằm trong
// `VAI_DUOC_CAP_NICK`), nhưng nick đã giao cho tư vấn viên thì mất hẳn.
//
// ── 🔴 LỖI ĐÃ SỬA: giá trị nội bộ rò ra ô chọn ───────────────────────────────────────
// Bản 24/09 dùng `<Select value={CHUA_GIAO}>` với `CHUA_GIAO = "__chua-giao__"`, và ô
// hiện đúng chuỗi ấy cho người dùng đọc. Nguyên nhân: `SelectValue` render GIÁ TRỊ khi
// không khớp được nhãn của một `SelectItem` nào.
//
// Cách sửa KHÔNG phải là đổi chuỗi sentinel cho đẹp hơn — chuỗi nào cũng sai, vì đó là
// mã nội bộ. Ở đây dùng `<SelectValue>` có CON để tự render nhãn: nhãn luôn do ta quyết,
// không bao giờ rơi về giá trị thô. Khoá bằng ca `[NZ-01]`.
//
// ── Mật độ và màu theo DESIGN.md ─────────────────────────────────────────────────────
// `adminTh`/`adminTd`/`adminTr` cho dòng 44px và `whitespace-nowrap` trên CẢ `th` lẫn
// `td` — đó là thứ duy nhất chặn chiều cao dòng nhảy loạn với tên tiếng Việt dài.
// Trạng thái đi qua `StatusPill` (thang ngữ nghĩa riêng, KHÔNG mượn màu thương hiệu).
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import {
  MUC_QUYEN,
  NHAN_MUC,
  MUC_MAC_DINH_CHUA_GIAO,
  docMucQuyen,
  type MucQuyen,
} from "@/lib/integrations/zalocrm/pham-vi-nick";
import { giaoNickAction } from "../actions";

const NHAN_TRANG_THAI: Record<string, { chu: string; tone: PillTone }> = {
  CONNECTED: { chu: "Đang kết nối", tone: "success" },
  DISCONNECTED: { chu: "Mất kết nối", tone: "danger" },
  UNKNOWN: { chu: "Chưa rõ", tone: "muted" },
};

export type DongNickZalo = {
  zcrmAccountId: string;
  displayName: string | null;
  status: string;
  centerId: string | null;
  centerName: string | null;
  /** Người ĐƯỢC GIAO (không gồm quản lý cơ sở — họ có quyền tự động). */
  giao: { sataUserId: string; ten: string; mucQuyen: string }[];
};

export type NguoiNhan = {
  id: string;
  ten: string;
  email: string | null;
  /** Quản lý cơ sở — NHÃN, không phải quyền. */
  laQuanLy: boolean;
  /** Neo ở đơn vị cấp trên (Hội sở) — không phải người của cơ sở này. */
  laHoiSo: boolean;
  /** Vai của họ có mở được ZaloCRM không — xem `NguoiNhanDuoc.dungDuocZalocrm`. */
  dungDuocZalocrm: boolean;
};

export function BangNickZalo({
  rows,
  nguoiTheoCoSo,
}: {
  rows: DongNickZalo[];
  nguoiTheoCoSo: Record<string, NguoiNhan[]>;
}) {
  const [dangMo, datDangMo] = useState<string | null>(null);
  const nickDangMo = rows.find((r) => r.zcrmAccountId === dangMo) ?? null;

  return (
    <div className="space-y-3">
      {/* KHÔNG lặp lại câu mô tả của tab. `moTa` trong `TAB_CAU_HINH` đã in ngay phía trên
          bảng này — viết lại nó ở đây là bắt người dùng đọc hai lần cùng một câu. Chỉ giữ
          mẩu tin mà mô tả tab KHÔNG nói: độ trễ có hiệu lực. */}
      <p className="text-sm text-muted-foreground">
        Thay đổi có hiệu lực trong vòng <strong className="font-medium text-foreground">5 phút</strong>.
      </p>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className={adminTh}>Nick</th>
              <th className={adminTh}>Cơ sở</th>
              <th className={adminTh}>Trạng thái</th>
              <th className={adminTh}>Đang giao cho</th>
              <th className={`${adminTh} w-px text-right`}>
                <span className="sr-only">Hành động</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const nguoi = r.centerId ? (nguoiTheoCoSo[r.centerId] ?? []) : [];
              // Quản lý cơ sở nay cũng giao tay được, nên KHÔNG trừ họ ra khi đếm.
              // Trừ ra là một cơ sở chỉ có quản lý sẽ thấy nút xám mà không hiểu vì sao.
              const khoa = !r.centerId || nguoi.length === 0;
              const tt = NHAN_TRANG_THAI[r.status] ?? NHAN_TRANG_THAI.UNKNOWN!;

              return (
                <tr key={r.zcrmAccountId} className={adminTr}>
                  <td className={adminTd}>
                    {r.displayName ? (
                      <span className="font-medium">{r.displayName}</span>
                    ) : (
                      // Nói VÌ SAO trống, không chỉ "(chưa có tên)". Tên về từ Zalo CRM khi
                      // nick kết nối lần đầu; trước đó Sata chỉ có mã tài khoản.
                      <span className="text-muted-foreground">
                        Chưa có tên — nick chưa kết nối lần nào
                      </span>
                    )}
                  </td>
                  <td className={adminTd}>
                    {r.centerName ?? <span className="text-muted-foreground">Chưa gắn cơ sở</span>}
                  </td>
                  <td className={adminTd}>
                    <StatusPill tone={tt.tone}>{tt.chu}</StatusPill>
                  </td>
                  <td className={adminTd}>
                    <TomTat giao={r.giao} />
                  </td>
                  <td className={`${adminTd} text-right`}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={khoa}
                      onClick={() => datDangMo(r.zcrmAccountId)}
                      aria-label={`Sửa người được giao nick ${r.displayName ?? r.zcrmAccountId}`}
                      // Nút xám mà không nói vì sao là câu đố. Nêu ĐÚNG lý do, vì hai lý
                      // do cần hai hành động khác hẳn nhau (ánh xạ cơ sở ↔ gán vai).
                      title={
                        !r.centerId
                          ? "Nick chưa gắn cơ sở nên chưa giao được."
                          : khoa
                            ? "Cơ sở này chưa có nhân sự nào."
                            : undefined
                      }
                    >
                      Sửa
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nickDangMo ? (
        <HopThoaiGiao
          key={nickDangMo.zcrmAccountId}
          nick={nickDangMo}
          nguoi={nickDangMo.centerId ? (nguoiTheoCoSo[nickDangMo.centerId] ?? []) : []}
          dong={() => datDangMo(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Câu tóm tắt trên dòng bảng.
 *
 * 🔴 Rỗng ra "Cả cơ sở dùng chung", KHÔNG phải "chưa giao" hay một ô trống: đó là SỰ
 * THẬT về hành vi, còn hai cách nói kia đọc như một việc còn bỏ dở và người vận hành sẽ
 * đi "sửa" một thứ đang đúng.
 */
function TomTat({ giao }: { giao: DongNickZalo["giao"] }) {
  if (giao.length === 0) {
    return <span className="text-muted-foreground">Cả cơ sở dùng chung</span>;
  }
  const day = giao.map((g) => `${g.ten} — ${NHAN_MUC[docMucQuyen(g.mucQuyen)]}`).join(", ");
  return (
    // `title` để đọc được đủ khi bị cắt: dòng 44px + `whitespace-nowrap` nghĩa là ba
    // người trở lên chắc chắn tràn, và một câu bị cắt không dấu hiệu là một câu nói dối.
    <span className="block max-w-[320px] truncate" title={day}>
      {giao.map((g, i) => (
        <span key={g.sataUserId}>
          {i > 0 ? ", " : ""}
          {g.ten}
          <span className="text-muted-foreground"> — {NHAN_MUC[docMucQuyen(g.mucQuyen)]}</span>
        </span>
      ))}
    </span>
  );
}

function HopThoaiGiao({
  nick,
  nguoi,
  dong,
}: {
  nick: DongNickZalo;
  nguoi: NguoiNhan[];
  dong: () => void;
}) {
  const [dangCho, batDau] = useTransition();
  // MỌI người của cơ sở vào chung một danh sách — kể cả quản lý cơ sở (đảo 24/09).
  const theoId = new Map(nguoi.map((n) => [n.id, n]));

  // Trạng thái = danh sách ĐANG GIỮ, theo đúng thứ tự người dùng nhìn thấy. Dòng giao
  // cho người không còn trong danh sách hợp lệ (đã rời cơ sở) bị bỏ ngay khi mở: giữ nó
  // là in một cái tên rồi lặng lẽ gỡ lúc Lưu.
  const [danhSach, datDanhSach] = useState<{ id: string; muc: MucQuyen }[]>(() =>
    nick.giao
      .filter((g) => theoId.has(g.sataUserId))
      .map((g) => ({ id: g.sataUserId, muc: docMucQuyen(g.mucQuyen) })),
  );

  const daCo = new Set(danhSach.map((d) => d.id));
  const conLai = nguoi.filter((n) => !daCo.has(n.id));
  const quanLyChuaThem = conLai.filter((n) => n.laQuanLy);

  function them(id: string | null) {
    if (!id || daCo.has(id)) return;
    // Mức mở sẵn: quản lý cơ sở ⇒ `admin` (việc của họ là quản lý nick), người khác ⇒
    // `chat`. Chỉ là giá trị MỞ SẴN, hiện ngay trên màn và đổi được — không phải một
    // luật ngầm: luật ngầm là thứ vừa bị gỡ khỏi `pham-vi-nick.ts`.
    const n = theoId.get(id);
    datDanhSach((d) => [...d, { id, muc: n?.laQuanLy ? "admin" : MUC_MAC_DINH_CHUA_GIAO }]);
  }

  function luu() {
    const giao = danhSach.map((d) => ({ sataUserId: d.id, mucQuyen: d.muc }));
    batDau(async () => {
      const kq = await giaoNickAction({ zcrmAccountId: nick.zcrmAccountId, giao });
      if (kq.ok) {
        toast.success(
          giao.length === 0
            ? "Đã gỡ hết — cả cơ sở lại dùng chung nick này."
            : `Đã giao cho ${giao.length} người. Có hiệu lực trong vòng 5 phút.`,
        );
        dong();
      } else {
        // KHÔNG đóng hộp thoại khi lỗi: đóng là xoá mất thứ người dùng vừa chọn, và họ
        // phải dựng lại từ đầu để thử tiếp.
        toast.error(kq.error ?? "Không lưu được");
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(mo) => {
        if (!mo && !dangCho) dong();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Giao nick {nick.displayName ?? nick.zcrmAccountId}</DialogTitle>
          <DialogDescription>
            {nick.centerName ? `Cơ sở ${nick.centerName}. ` : ""}
            Thêm người vào nick rồi chọn mức cho từng người. Ai bị gỡ khỏi danh sách sẽ
            mất quyền trên nick này.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[45vh] space-y-1 overflow-y-auto">
          {danhSach.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              Chưa giao cho ai — cả cơ sở đang dùng chung nick này.
            </p>
          ) : (
            danhSach.map((d) => {
              const n = theoId.get(d.id);
              if (!n) return null;
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{n.ten}</span>
                      {/* Nhãn, KHÔNG phải quyền — quản lý cơ sở nay cũng phải được giao
                          thì mới có quyền trên nick đã giao. Hiện ra để người bấm biết
                          mình đang gỡ ai. */}
                      {n.laQuanLy ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          quản lý cơ sở
                        </span>
                      ) : null}
                      {n.laHoiSo ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          hội sở
                        </span>
                      ) : null}
                    </div>
                    {/* Nói THẬT: thêm được, nhưng chưa có tác dụng. Giấu đi là dựng một
                        nút bấm xong không có gì xảy ra (luật 12). */}
                    {n.dungDuocZalocrm ? (
                      n.email ? (
                        <div className="truncate text-xs text-muted-foreground">{n.email}</div>
                      ) : null
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-state-warning-ink">
                        <TriangleAlertIcon className="size-3 shrink-0" aria-hidden />
                        <span>Vai của người này chưa mở được Zalo CRM</span>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Select
                      value={d.muc}
                      disabled={dangCho}
                      onValueChange={(v) =>
                        datDanhSach((ds) =>
                          ds.map((x) => (x.id === d.id ? { ...x, muc: docMucQuyen(v) } : x)),
                        )
                      }
                    >
                      <SelectTrigger className="w-[180px]" aria-label={`Mức của ${n.ten}`}>
                        {/* CON của `SelectValue` — chặn đường rơi về giá trị thô. */}
                        <SelectValue>{NHAN_MUC[d.muc]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {MUC_QUYEN.map((m) => (
                          <SelectItem key={m} value={m}>
                            {NHAN_MUC[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={dangCho}
                      aria-label={`Gỡ ${n.ten} khỏi nick`}
                      onClick={() => datDanhSach((ds) => ds.filter((x) => x.id !== d.id))}
                    >
                      <XIcon className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Ô THÊM NGƯỜI — `Combobox` tìm kiếm KHÔNG DẤU: một cơ sở có vài chục nhân sự,
            và gõ "loc" phải ra "Ms Lộc". */}
        <Combobox
          options={conLai.map((n) => ({
            value: n.id,
            // Nhãn nói ĐỦ hai chuyện: người này ở đâu, và vai của họ đã mở được chưa.
            // Thiếu vế đầu thì thêm nhầm một người hội sở vào nick cơ sở mà không biết.
            label: [
              n.ten,
              n.laHoiSo ? "hội sở" : null,
              n.dungDuocZalocrm ? null : "vai chưa mở được Zalo CRM",
            ]
              .filter(Boolean)
              .join(" — "),
          }))}
          value={null}
          onValueChange={them}
          disabled={dangCho || conLai.length === 0}
          placeholder={
            conLai.length === 0
              ? "Đã thêm hết nhân sự của cơ sở"
              : "Thêm người — gõ tên để tìm…"
          }
          emptyText="Không có ai khớp"
        />

        {/* 🔴 Quản lý cơ sở KHÔNG còn quyền tự động (đảo 24/09). Danh sách có người mà
            quản lý lại không có tên trong đó nghĩa là họ MẤT tầm nhìn nick này — một
            hệ quả thật, nên màn phải nói ra ngay lúc nó sắp xảy ra, không phải để người
            ta phát hiện lúc sếp hỏi "sao tôi không thấy chat của khách". */}
        {danhSach.length > 0 && quanLyChuaThem.length > 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-state-warning-bg px-3 py-2 text-xs text-state-warning-ink">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              <strong className="font-medium">
                {quanLyChuaThem.map((n) => n.ten).join(", ")}
              </strong>{" "}
              đang quản lý cơ sở này nhưng KHÔNG có trong danh sách — sẽ không đọc được
              chat của nick này. Thêm vào nếu muốn họ theo dõi.
            </span>
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {danhSach.length === 0
            ? "Chưa giao cho ai ⇒ cả cơ sở dùng chung nick này."
            : `Giao cho ${danhSach.length} người ⇒ chỉ họ (và quản lý cơ sở) thấy nick này.`}
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={dong} disabled={dangCho}>
            Huỷ
          </Button>
          <Button type="button" onClick={luu} disabled={dangCho}>
            {dangCho ? "Đang lưu…" : "Lưu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
