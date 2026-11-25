"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KhoiRong, GhiChu } from "../../_components/ui/trang";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { NHAN_O, NUT_CHINH, NUT_NGUY, NUT_NHO, NUT_PHU, O_NHAP, O_NHAP_GOC } from "../../_components/ui/dieu-khien";
import {
  giaHanLuotGiaoAction,
  thuHoiLuotGiaoAction,
  ghiNhanSuCoAction,
} from "../_actions";

/**
 * EL-05 — LƯỢT GIAO ĐÃ TẠO + ba việc vận hành trên chúng.
 *
 * ⚠️ Ba action `giaHanLuotGiao` · `thuHoiLuotGiao` · `ghiNhanSuCo` được khai từ
 * EL-05 nhưng grep toàn kho ra **0 màn nào gọi**. Người vận hành không có nút gia
 * hạn, không có nút thu hồi, và không có nút "sự cố hệ thống".
 *
 * Cái cuối đắt nhất: QĐ-CDA-15 giao vai trực hỗ trợ cho MỘT người có tên với SLA 4
 * giờ, và quyền bấm "sự cố hệ thống" để gia hạn CẢ lượt giao là công cụ duy nhất
 * của họ. Không có nút thì lời cam kết đó không thi hành được — người học mất hạn
 * vì hệ thống hỏng, và cách duy nhất để cứu là sửa tay trong DB.
 */

export type DongLuotGiao = {
  assignmentId: string;
  tenKhoa: string;
  soNguoi: number;
  soQuaHan: number;
  hanChung: Date | null;
  dong: boolean;
};

type Viec = "gia-han" | "thu-hoi" | "su-co";

export function AssignmentList(props: { ds: DongLuotGiao[] }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState<{ id: string; viec: Viec } | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [themNgay, setThemNgay] = useState("7");
  const [tieuDe, setTieuDe] = useState("");

  const dong = () => {
    setMo(null);
    setLyDo("");
    setTieuDe("");
    setThemNgay("7");
  };

  const chay = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, ok: string) =>
    batDau(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error?.message ?? "Không thực hiện được");
        return;
      }
      toast.success(ok);
      dong();
      router.refresh();
    });

  const duLyDo = lyDo.trim().length >= 10;

  if (props.ds.length === 0) {
    return (
      <KhoiRong
        title="Chưa có lượt giao nào"
        description="Tạo lượt giao bằng trình bốn bước ở phần trên. Lượt giao đã tạo sẽ hiện ở đây để gia hạn, ghi sự cố hoặc thu hồi."
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {props.ds.map((a) => (
        <li key={a.assignmentId} className="px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-foreground">{a.tenKhoa}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {a.soNguoi} người
              {a.soQuaHan > 0 ? (
                <TrangThaiBadge sac="danger">{a.soQuaHan} quá hạn</TrangThaiBadge>
              ) : null}
              {a.hanChung ? `· hạn ${a.hanChung.toLocaleDateString("vi-VN")}` : ""}
              {a.dong ? <TrangThaiBadge sac="muted">Đã đóng</TrangThaiBadge> : null}
            </span>
          </div>

          {mo?.id === a.assignmentId ? (
            <div className="mt-3 space-y-3 rounded-xl border border-border bg-background p-4">
              {mo.viec === "gia-han" ? (
                <label className="block">
                  <span className={NHAN_O}>Thêm bao nhiêu ngày</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={themNgay}
                    onChange={(e) => setThemNgay(e.target.value)}
                    className={`mt-1 ${O_NHAP_GOC} w-28`}
                  />
                </label>
              ) : null}

              {mo.viec === "su-co" ? (
                <label className="block">
                  <span className={NHAN_O}>Sự cố gì</span>
                  <input
                    value={tieuDe}
                    onChange={(e) => setTieuDe(e.target.value)}
                    maxLength={200}
                    placeholder="vd: Mất kết nối kho video 3 giờ sáng 12/9"
                    className={`mt-1 ${O_NHAP}`}
                  />
                </label>
              ) : null}

              <label className="block">
                <span className={NHAN_O}>
                  Lý do (bắt buộc, ít nhất 10 ký tự — đi vào nhật ký kiểm toán)
                </span>
                <input
                  value={lyDo}
                  onChange={(e) => setLyDo(e.target.value)}
                  maxLength={500}
                  className={`mt-1 ${O_NHAP}`}
                />
              </label>

              {mo.viec === "thu-hoi" ? (
                <GhiChu sac="warning">
                  Thu hồi rút người học khỏi khoá. Tiến độ đã có được giữ lại, nhưng
                  khoá sẽ không bao giờ tính là hoàn thành.
                </GhiChu>
              ) : null}
              {mo.viec === "su-co" ? (
                <p className="text-sm text-muted-foreground">
                  Sự cố hệ thống gia hạn CẢ lượt giao, không xét từng người — vì lỗi
                  không phải của ai trong số họ.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  // Khoá nút cho tới khi đủ lý do: máy chủ cũng chặn, nhưng để bấm
                  // được rồi mới báo lỗi là dạy người ta gõ một dấu chấm cho xong.
                  disabled={
                    dangChay ||
                    !duLyDo ||
                    (mo.viec === "su-co" && tieuDe.trim().length < 5)
                  }
                  onClick={() => {
                    // ⚠️ `reason` đi qua tham số THỨ HAI của action, không nằm trong
                    // input: `defineAction` nhận `{ reason }` riêng để ghi vào
                    // `AuditLog`. Nhét vào input là bị Zod `.strict()` từ chối.
                    const pham = {
                      kieu: "LUOT_GIAO" as const,
                      assignmentId: a.assignmentId,
                    };
                    if (mo.viec === "gia-han") {
                      chay(
                        () =>
                          giaHanLuotGiaoAction(
                            { pham, themNgay: Number(themNgay) },
                            { reason: lyDo.trim() },
                          ),
                        "Đã gia hạn",
                      );
                    } else if (mo.viec === "thu-hoi") {
                      chay(
                        () => thuHoiLuotGiaoAction({ pham }, { reason: lyDo.trim() }),
                        "Đã thu hồi",
                      );
                    } else {
                      chay(
                        () =>
                          ghiNhanSuCoAction(
                            {
                              title: tieuDe.trim(),
                              assignmentId: a.assignmentId,
                            },
                            { reason: lyDo.trim() },
                          ),
                        "Đã ghi nhận sự cố và gia hạn cả lượt",
                      );
                    }
                  }}
                  className={mo.viec === "thu-hoi" ? NUT_NGUY : NUT_CHINH}
                >
                  {dangChay ? "Đang chạy…" : "Xác nhận"}
                </button>
                <button type="button" onClick={dong} className={NUT_PHU}>
                  Thôi
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "gia-han" })}
                className={NUT_NHO}
              >
                Gia hạn
              </button>
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "su-co" })}
                className={NUT_NHO}
              >
                Sự cố hệ thống
              </button>
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "thu-hoi" })}
                className={NUT_NHO}
              >
                Thu hồi
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
