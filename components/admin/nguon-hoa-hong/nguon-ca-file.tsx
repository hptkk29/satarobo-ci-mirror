"use client";

// components/admin/nguon-hoa-hong/nguon-ca-file.tsx — «NGUỒN CỦA CẢ FILE» của hai màn nhập Excel lead (chủ dự án chốt 28/10/2026).
//
// Cùng ô chọn nguồn với `/nhap-khach-hang` (`ChonNguonFields`) và cùng luật kiểm (`dungNguonChonGui` → `kiemFormChonNguon`), nhưng đặt ở ĐẦU màn và áp cho MỌI dòng của file.
// Bắt buộc khi module Nguồn BẬT (`nguon !== null`); `nguon === null` (module TẮT) ⇒ không vẽ gì, không chặn gì — hành vi cũ.
//
// ⚠️ Đây là cổng GIAO DIỆN. Cổng thật là `docVaEpNguonCaFile` ở hai route nhập (`lib/nguon/nguon-ca-file.ts`) — request thiếu lựa chọn vẫn bị máy chủ từ chối.
import { useState } from "react";
import { dungNguonChonGui, type NguonChonGui, type TruongLoiForm } from "@/lib/nguon/chon-nguon";
import { GHI_CHU_MOT_FILE_MOT_NGUON } from "@/lib/nguon/nguon-ca-file-ghi-chu";
import type { NguonChoFormNhap } from "@/lib/nguon/nguon-cho-form-nhap";
import { CHUA_CHON_NGUON, ChonNguonFields, type TrangThaiChonNguon } from "./chon-nguon-fields";

/** Câu hiện cạnh nút nhập khi chưa có lựa chọn hợp lệ. Một chỗ — màn nhập sự kiện và màn «đã đăng ký» nói cùng một câu. */
export const CAU_CHUA_CHON_NGUON_CA_FILE = "Chọn «Nguồn của cả file» (và người giới thiệu nếu nguồn yêu cầu) trước khi nhập.";

export type TrangThaiNguonCaFile = {
  /** Trạng thái ô chọn (nhóm · người · giải trình) — đưa thẳng vào `<KhoiNguonCaFile value>`. */
  chon: TrangThaiChonNguon;
  setChon: (v: TrangThaiChonNguon) => void;
  /** Lựa chọn ĐÃ KIỂM, đúng hình máy chủ nhận. `null` = chưa chọn / còn lỗi / module TẮT (không có ô). */
  nguonChon: NguonChonGui | null;
  /** Lỗi theo ô — chỉ hiện sau khi người nhập ĐÃ bấm chọn một nguồn (chưa chọn gì thì chỉ có câu nhắc, không tô đỏ cả màn). */
  loi: Partial<Record<TruongLoiForm, string>>;
  /** Có chuỗi ⇒ màn PHẢI khoá nút nhập và in chuỗi này cạnh nút. `undefined` ⇒ được nhập (hoặc module TẮT). */
  khongChoNhap: string | undefined;
};

/** Trạng thái ô «Nguồn của cả file» của một màn nhập. `nguon === null` (module TẮT) ⇒ luôn `khongChoNhap: undefined`, `nguonChon: null`. */
export function useNguonCaFile(nguon: NguonChoFormNhap | null): TrangThaiNguonCaFile {
  const [chon, setChon] = useState<TrangThaiChonNguon>(CHUA_CHON_NGUON);
  if (nguon === null) return { chon, setChon, nguonChon: null, loi: {}, khongChoNhap: undefined };
  const kq = dungNguonChonGui(nguon.danhMuc, chon);
  return {
    chon,
    setChon,
    nguonChon: kq.nguonChon,
    loi: chon.nhomId === null ? {} : kq.loi,
    khongChoNhap: kq.nguonChon ? undefined : CAU_CHUA_CHON_NGUON_CA_FILE,
  };
}

export function KhoiNguonCaFile({
  nguon,
  state,
  disabled = false,
  idPrefix,
  moTa,
}: {
  nguon: NguonChoFormNhap | null;
  state: TrangThaiNguonCaFile;
  disabled?: boolean;
  idPrefix: string;
  /** Câu giải thích ngắn dưới tiêu đề (mỗi màn nói theo ngữ cảnh của mình). */
  moTa?: string;
}) {
  if (nguon === null) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="nguon-ca-file" aria-labelledby={`${idPrefix}-tieu-de`}>
      <h2 id={`${idPrefix}-tieu-de`} className="text-base font-semibold text-foreground">
        Nguồn của cả file <span className="text-state-danger-ink">*</span>
      </h2>
      <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">
        {moTa ??
          "Chọn MỘT nguồn áp cho mọi dòng mới của file, giống ô nguồn ở màn Nhập khách hàng. Lead đã có trong CRM giữ nguyên nguồn gốc."}
      </p>
      <div className="mt-4">
        <ChonNguonFields idPrefix={idPrefix} nhom={nguon.danhMuc} value={state.chon} onChange={state.setChon} errors={state.loi} disabled={disabled} />
      </div>
      {/* Ghi chú IN ĐẬM, luôn hiện (không tooltip, không ẩn): một file = một nguồn + một người giới thiệu. */}
      <p className="mt-4 max-w-[70ch] text-sm font-semibold text-foreground" data-testid="nguon-ca-file-ghi-chu">
        {GHI_CHU_MOT_FILE_MOT_NGUON}
      </p>
    </section>
  );
}
