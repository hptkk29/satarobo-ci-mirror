"use client";

// Hook chọn nhiều cho danh sách khu e-learning. Toàn bộ luật nằm ở `lib/elearning/chon-nhieu.ts` (thuần, có test từng cạnh);
// hook chỉ giữ trạng thái và nối luật vào React.
//
// ⚠️ `idGui` chỉ là TIỆN LỢI giao diện. Server action nhận danh sách id PHẢI kiểm `can()` + `scopedDb` trên TỪNG id — danh
// sách từ client không bao giờ là nguồn tin cậy (scopedDb không che write, CLAUDE.md luật 5).
import { useCallback, useMemo, useState } from "react";
import {
  TRAN_THAO_TAC_HANG_LOAT,
  chonTatCaDangHien,
  doiMotDong,
  idGuiLenServer,
  trangThaiChonTatCa,
  type TrangThaiChonTatCa,
} from "@/lib/elearning/chon-nhieu";

export type ChonNhieu = {
  daChon: ReadonlySet<string>;
  /** Số dòng đang chọn trong số dòng ĐANG HIỂN THỊ (không đếm id đã rời danh sách). */
  soDangChon: number;
  trangThai: TrangThaiChonTatCa;
  /** Lần thao tác gần nhất bị trần cắt — giao diện phải nói "chỉ chọn được n dòng một lượt". */
  chamTran: boolean;
  tran: number;
  laChon: (id: string) => boolean;
  doi: (id: string) => void;
  chonTatCa: () => void;
  boChon: () => void;
  /** Id gửi lên server: giao của tập chọn với dòng đang hiển thị. */
  idGui: string[];
};

export function useChonNhieu(dangHien: readonly string[], tran: number = TRAN_THAO_TAC_HANG_LOAT): ChonNhieu {
  const [daChon, setDaChon] = useState<ReadonlySet<string>>(() => new Set());
  const [chamTran, setChamTran] = useState(false);

  const doi = useCallback(
    (id: string) => {
      const r = doiMotDong(daChon, id, tran);
      setDaChon(r.tap);
      setChamTran(r.chamTran);
    },
    [daChon, tran],
  );

  const chonTatCa = useCallback(() => {
    const r = chonTatCaDangHien(dangHien, daChon, tran);
    setDaChon(r.tap);
    setChamTran(r.biCat);
  }, [dangHien, daChon, tran]);

  const boChon = useCallback(() => {
    setDaChon(new Set());
    setChamTran(false);
  }, []);

  const laChon = useCallback((id: string) => daChon.has(id), [daChon]);

  return useMemo(() => {
    const idGui = idGuiLenServer(dangHien, daChon);
    return {
      daChon,
      soDangChon: idGui.length,
      trangThai: trangThaiChonTatCa(dangHien, daChon),
      chamTran,
      tran,
      laChon,
      doi,
      chonTatCa,
      boChon,
      idGui,
    };
  }, [dangHien, daChon, chamTran, tran, laChon, doi, chonTatCa, boChon]);
}
