"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
      <p className="rounded-md bg-muted px-3 py-2 text-sm">
        Chưa có lượt giao nào. Tạo lượt giao ở phần trên.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {props.ds.map((a) => (
        <li key={a.assignmentId} className="rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{a.tenKhoa}</span>
            <span className="text-xs text-muted-foreground">
              {a.soNguoi} người
              {a.soQuaHan > 0 ? (
                <span className="ml-1 font-medium text-red-600">
                  · {a.soQuaHan} quá hạn
                </span>
              ) : null}
              {a.hanChung ? ` · hạn ${a.hanChung.toLocaleDateString("vi-VN")}` : ""}
              {a.dong ? " · đã đóng" : ""}
            </span>
          </div>

          {mo?.id === a.assignmentId ? (
            <div className="mt-2 space-y-2 rounded-md border p-3">
              {mo.viec === "gia-han" ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Thêm bao nhiêu ngày</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={themNgay}
                    onChange={(e) => setThemNgay(e.target.value)}
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
              ) : null}

              {mo.viec === "su-co" ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Sự cố gì</span>
                  <input
                    value={tieuDe}
                    onChange={(e) => setTieuDe(e.target.value)}
                    maxLength={200}
                    placeholder="vd: Mất kết nối kho video 3 giờ sáng 12/9"
                    className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                  />
                </label>
              ) : null}

              <label className="block text-xs">
                <span className="text-muted-foreground">
                  Lý do (bắt buộc, ít nhất 10 ký tự — đi vào nhật ký kiểm toán)
                </span>
                <input
                  value={lyDo}
                  onChange={(e) => setLyDo(e.target.value)}
                  maxLength={500}
                  className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                />
              </label>

              {mo.viec === "thu-hoi" ? (
                <p className="text-xs text-amber-800">
                  Thu hồi rút người học khỏi khoá. Tiến độ đã có được giữ lại, nhưng
                  khoá sẽ không bao giờ tính là hoàn thành.
                </p>
              ) : null}
              {mo.viec === "su-co" ? (
                <p className="text-xs text-muted-foreground">
                  Sự cố hệ thống gia hạn CẢ lượt giao, không xét từng người — vì lỗi
                  không phải của ai trong số họ.
                </p>
              ) : null}

              <div className="flex gap-2">
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
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  {dangChay ? "Đang chạy…" : "Xác nhận"}
                </button>
                <button
                  type="button"
                  onClick={dong}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  Thôi
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "gia-han" })}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Gia hạn
              </button>
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "su-co" })}
                className="rounded-md border px-2 py-1 text-xs"
              >
                Sự cố hệ thống
              </button>
              <button
                type="button"
                onClick={() => setMo({ id: a.assignmentId, viec: "thu-hoi" })}
                className="rounded-md border px-2 py-1 text-xs"
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
