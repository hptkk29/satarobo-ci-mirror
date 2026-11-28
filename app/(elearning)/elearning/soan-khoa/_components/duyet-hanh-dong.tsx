"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { vongDoiKhoaAction } from "../../chuong-trinh/_actions";
import { NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";

/**
 * Nút DUYỆT / TRẢ LẠI / XUẤT BẢN của màn duyệt — gọi ĐÚNG action vòng đời của trình soạn (`vongDoiKhoaAction`), cùng cổng quyền
 * `elearning:content:publish`, cùng yêu cầu lý do. Không có logic trạng thái riêng: nút nào hiện do TRẠNG THÁI PHIÊN BẢN
 * (server truyền xuống) và `coQuyen`; server vẫn là bên từ chối.
 *
 * ⚠️ Không có chặn "người soạn ≠ người duyệt" ở đây: đó là quyết định Q11 chưa chốt (BLOCKERS B-05) — màn chỉ NÓI người gửi duyệt là ai.
 */
export function DuyetHanhDong(props: {
  courseId: string;
  trangThai: "PENDING_REVIEW" | "APPROVED";
  coQuyen: boolean;
  /** Còn lỗi dàn bài ⇒ khoá nút Duyệt/Xuất bản (server cũng chặn). */
  conLoi: boolean;
}) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [lyDo, setLyDo] = useState("");

  if (!props.coQuyen) {
    return (
      <p role="note" className="rounded-xl border border-border bg-muted px-4 py-3 text-sm">
        Bạn xem được bản này nhưng không có quyền duyệt/xuất bản. Nhờ người có quyền “xuất bản khoá” của phòng Đào tạo.
      </p>
    );
  }

  const goi = (hanhDong: "DUYET" | "TRA_LAI" | "XUAT_BAN") =>
    chuyen(async () => {
      const r = await vongDoiKhoaAction({ courseId: props.courseId, hanhDong }, { reason: lyDo.trim() });
      if (r.ok) {
        toast.success(hanhDong === "DUYET" ? "Đã duyệt" : hanhDong === "TRA_LAI" ? "Đã trả lại nháp" : "Đã xuất bản");
        setLyDo("");
        router.refresh();
      } else {
        toast.error(r.error.message);
      }
    });

  const khoa = dangChay || lyDo.trim().length === 0;
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="ly-do-duyet" className={NHAN_O}>
          Lý do / ghi chú (bắt buộc)
        </label>
        <textarea
          id="ly-do-duyet"
          value={lyDo}
          onChange={(e) => setLyDo(e.target.value)}
          rows={3}
          placeholder="Vì sao duyệt, trả lại hay xuất bản bản này…"
          className={O_NHAP_VAN_BAN}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {props.trangThai === "PENDING_REVIEW" ? (
          <button type="button" disabled={khoa || props.conLoi} onClick={() => goi("DUYET")} className={NUT_CHINH}>
            Duyệt
          </button>
        ) : null}
        {props.trangThai === "APPROVED" ? (
          <button type="button" disabled={khoa || props.conLoi} onClick={() => goi("XUAT_BAN")} className={NUT_CHINH}>
            Xuất bản
          </button>
        ) : null}
        <button type="button" disabled={khoa} onClick={() => goi("TRA_LAI")} className={NUT_PHU}>
          Trả lại nháp
        </button>
      </div>
      {props.trangThai === "PENDING_REVIEW" ? (
        <p className="text-[13px] text-muted-foreground">Duyệt xong khoá sang “Đã duyệt”, chưa tự xuất bản.</p>
      ) : null}
    </div>
  );
}
