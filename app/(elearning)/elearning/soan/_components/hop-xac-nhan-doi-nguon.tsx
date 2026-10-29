"use client";

import { useId, useState } from "react";
import { LY_DO_TOI_DA, LY_DO_TOI_THIEU, kiemLyDoDoiNguon } from "@/lib/elearning/video-doi-nguon-rule";
// Chỉ KIỂU — xoá sạch lúc biên dịch, không kéo mã chỉ-server vào thành phần client.
import type { KetQuaXemTruoc } from "@/lib/elearning/video-doi-nguon";

/**
 * Nhãn nút xác nhận: chỉ nói 'bắt đầu lại tiến độ' khi CÓ lượt đang học bị đặt lại. Khoá đã xuất bản nhưng chưa ai xem thì nói thẳng là chỉ đổi video
 * (nhãn nói dối là lời hứa suông — luật 12).
 */
export function nhanNutDoiVideo(xt: Pick<KetQuaXemTruoc, "tacDong">): string {
  return xt.tacDong.ghiDanhDangHoc > 0 ? "Đổi video và bắt đầu lại tiến độ" : "Đổi video";
}

/** Câu báo thành công, cùng một nguồn với nhãn nút. */
export function thongBaoDaDoiVideo(xt: Pick<KetQuaXemTruoc, "tacDong"> | null): string {
  return xt && xt.tacDong.ghiDanhDangHoc > 0
    ? "Đã đổi video của bài; tiến độ của người đang học được bắt đầu lại, lịch sử cũ được giữ"
    : "Đã đổi video của bài";
}

/**
 * HỘP XEM TRƯỚC TÁC ĐỘNG + LÝ DO + XÁC NHẬN khi ĐỔI video của một bài đã có nguồn.
 *
 * Dùng chung cho hai form (tải MP4 / dán link YouTube) để chữ, ô nhập và điều kiện bấm không lệch nhau.
 *
 * ⚠️ Đây là CHỖ HIỆN, không phải cổng. Cổng thật nằm ở server (`doiNguonBaiVideo`): quyền xuất bản, lý do, và chuỗi xác nhận
 * ký gắn với nội dung + tập người học bị ảnh hưởng. Hộp này chỉ (1) cho người soạn đọc số liệu do SERVER đếm, (2) thu lý do
 * (5–500 ký tự), (3) giữ nút xác nhận tắt cho tới khi đủ điều kiện, và (4) không vẽ nút khi thiếu quyền.
 */
export function HopXacNhanDoiNguon(props: {
  xt: KetQuaXemTruoc;
  dangLuu: boolean;
  /** Lần lưu trước bị từ chối vì người học bị ảnh hưởng đã đổi từ lúc xem trước — đây là bản xem trước MỚI. */
  daDoiTapNguoiHoc: boolean;
  /** Lỗi chính sách của lần lưu trước (lý do, hết hạn…), hiện ngay trong hộp. */
  loi: string | null;
  /** Lý do người soạn đã gõ ở lần trước — giữ lại khi hộp dựng MỚI (chỉ ô tick xác nhận bị xoá: nó phải gắn với số liệu MỚI). */
  lyDoBanDau?: string;
  onXacNhan: (lyDo: string) => void;
  onHuy: () => void;
}) {
  const id = useId();
  const [lyDo, setLyDo] = useState(props.lyDoBanDau ?? "");
  const [daTick, setDaTick] = useState(false);
  const { xt } = props;

  const lyDoOk = kiemLyDoDoiNguon(lyDo).ok;
  // Thiếu quyền xuất bản mà việc đổi đòi quyền đó (khoá đã xuất bản / đã có người học): không có chuỗi, không có nút.
  // Server quyết định việc đổi có đòi quyền xuất bản không (`yeuCauQuyenXuatBan`) — người thiếu quyền nhận số liệu RỖNG nên không tự suy
  // được từ số lượt học.
  const thieuQuyen = xt.yeuCauQuyenXuatBan && !xt.coQuyenXuatBan;
  const canTick = xt.yeuCauXacNhan;
  const duDieuKien = !thieuQuyen && lyDoOk && (!canTick || daTick) && (!canTick || xt.xacNhanToken != null);

  return (
    <div
      role="alertdialog"
      aria-labelledby={`${id}-tieu-de`}
      data-testid="xac-nhan-doi-video"
      className="space-y-3 rounded-lg border border-state-warning/40 bg-state-warning-soft p-3"
    >
      <p id={`${id}-tieu-de`} className="text-sm font-semibold text-foreground">
        {xt.khoaDaXuatBan ? "Đổi video của bài trong khoá đã xuất bản?" : "Đổi video của bài này?"}
      </p>

      {props.daDoiTapNguoiHoc && (
        <p role="alert" data-testid="doi-tap-nguoi-hoc" className="text-sm font-medium text-state-danger-ink">
          Người học bị ảnh hưởng đã thay đổi kể từ lần xem trước — đây là số liệu mới. Đọc lại rồi xác nhận lại.
        </p>
      )}

      {xt.thongBao && <p className="text-sm text-foreground">{xt.thongBao}</p>}

      {thieuQuyen ? (
        <p role="alert" data-testid="thieu-quyen-doi-video" className="text-sm text-state-danger-ink">
          Bạn không có quyền xuất bản nội dung nên không đổi được video của bài này. Nhờ người có quyền xuất bản (phòng Đào tạo).
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor={`${id}-ly-do`} className="block text-sm font-medium text-foreground">
              Lý do đổi video
            </label>
            <textarea
              id={`${id}-ly-do`}
              data-testid="ly-do-doi-video"
              value={lyDo}
              maxLength={LY_DO_TOI_DA}
              rows={2}
              disabled={props.dangLuu}
              onChange={(e) => setLyDo(e.target.value)}
              aria-describedby={`${id}-dem`}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
            />
            <p id={`${id}-dem`} className="text-xs text-muted-foreground">
              {lyDo.trim().length}/{LY_DO_TOI_DA} ký tự (tối thiểu {LY_DO_TOI_THIEU}). Lý do được ghi vào lịch sử, không nhập mã hay link video.
            </p>
          </div>

          {canTick && (
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                data-testid="tick-xac-nhan-doi-video"
                checked={daTick}
                disabled={props.dangLuu}
                onChange={(e) => setDaTick(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>Tôi đã đọc tác động ở trên và xác nhận đổi video.</span>
            </label>
          )}
        </>
      )}

      {props.loi && (
        <p role="alert" data-testid="loi-doi-video" className="text-sm text-state-danger-ink">
          {props.loi}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!thieuQuyen && (
          <button
            type="button"
            data-testid="nut-xac-nhan-doi-video"
            onClick={() => props.onXacNhan(lyDo.trim())}
            disabled={props.dangLuu || !duDieuKien}
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {props.dangLuu ? "Đang đổi…" : nhanNutDoiVideo(xt)}
          </button>
        )}
        <button
          type="button"
          onClick={props.onHuy}
          disabled={props.dangLuu}
          className="inline-flex min-h-10 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Không đổi
        </button>
      </div>
    </div>
  );
}
