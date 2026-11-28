"use client";

// components/admin/nguon-hoa-hong/chon-lead-hang-cho.tsx — TICK CHỌN LEAD của HÀNG CHỜ NGUỒN + thanh «Gán nguồn hàng loạt».
//
// Ba mảnh dùng chung một trạng thái chọn (context):
//   · `ChonLeadProvider` — giữ tập id đã tick, vẽ THANH HÀNH ĐỘNG phía trên bảng (chỉ khi đã tick ít nhất một lead) và mở hộp thoại gán;
//   · `OChonTatCa`       — ô tick ở đầu bảng: chọn / bỏ chọn cả TRANG đang xem (trạng thái lưng chừng khi chọn một phần);
//   · `OChonLead`        — ô tick của MỘT dòng.
// Bảng là Server Component; các mảnh này là client và được truyền xuống làm `children`/thành phần con, nên bảng vẫn dựng ở máy chủ.
//
// ── Nút nói thật (luật 12) ──────────────────────────────────────────────────────────────────────────────
// Trang CHỈ dựng provider + cột tick khi người xem có đúng khoá mà action kiểm (`sources:manage`) ∧ còn nguồn gán chung được. Không có quyền ⇒ không có ô tick nào (không phải ô tick rồi bấm mới báo lỗi).
// Dòng là vùng bấm (mở Sheet «Gán nguồn» cho MỘT lead) nên ô tick phải nằm TRÊN lớp phủ của dòng (`z-10`) và không để cú bấm lọt xuống dòng.
//
// «Chọn cả N lead theo bộ lọc» (xuyên nhiều trang) chỉ hiện khi đã tick hết trang này mà bộ lọc còn nhiều lead hơn; khi đó phạm vi gửi đi là CẢ BỘ LỌC (`loc`), không phải danh sách id.
// Chọn bị đặt lại khi đổi bộ lọc / trang / cơ sở: trang gắn `key` theo ba thứ đó.
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { KetQuaGanHangLoatAction, NguonChoHangLoat, PhamViGan } from "@/lib/nguon/gan-nguon-hang-loat-nhan";
import { NHAN_LY_DO, type LyDoHangCho } from "@/lib/nguon/nhan-hien-thi";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, NUT_NHO } from "./classes";
import { HopGanNguonHangLoat } from "./gan-nguon-hang-loat";
import { soVN } from "./nhan-nguon";

type Chay = (i: { groupId: string; lyDo: string; coSoId: string | null; pham: PhamViGan; conTro: string | null; chiXem: boolean }) => Promise<KetQuaGanHangLoatAction>;

type Chon = {
  daChon: ReadonlySet<string>;
  trangIds: readonly string[];
  bat: (id: string, chon: boolean) => void;
  chonTrang: (chon: boolean) => void;
};
const Ctx = createContext<Chon | null>(null);

function useChonLead(): Chon {
  const c = useContext(Ctx);
  if (!c) throw new Error("OChonLead/OChonTatCa phải nằm trong ChonLeadProvider");
  return c;
}

export function ChonLeadProvider({
  trangIds,
  tong,
  lyDo,
  coSoId,
  phamViNhan,
  nguon,
  chay,
  children,
}: {
  /** `Lead.id` của các dòng ĐANG HIỆN (một trang). */
  trangIds: readonly string[];
  /** Tổng lead của bộ lọc hiện tại (mọi trang). */
  tong: number;
  /** Bộ lọc vấn đề đang xem; null = mọi vấn đề. */
  lyDo: LyDoHangCho | null;
  coSoId: string | null;
  /** «CS2 — 114 Hoàng Diệu» / «phạm vi của bạn» — để in lên hộp thoại. */
  phamViNhan: string;
  nguon: NguonChoHangLoat[];
  /** Tiêm hàm gọi máy chủ (test); mặc định là action thật trong hộp thoại. */
  chay?: Chay;
  children: ReactNode;
}) {
  const router = useRouter();
  const [daChon, setDaChon] = useState<ReadonlySet<string>>(new Set());
  const [theoLoc, setTheoLoc] = useState(false);
  const [mo, setMo] = useState(false);

  const bat = (id: string, chon: boolean) => {
    setTheoLoc(false);
    setDaChon((cu) => {
      const moi = new Set(cu);
      if (chon) moi.add(id);
      else moi.delete(id);
      return moi;
    });
  };
  const chonTrang = (chon: boolean) => {
    setTheoLoc(false);
    setDaChon(chon ? new Set(trangIds) : new Set());
  };
  const boChon = () => {
    setTheoLoc(false);
    setDaChon(new Set());
  };

  const soTick = daChon.size;
  const cungTrangHet = soTick > 0 && trangIds.every((id) => daChon.has(id));
  const coTheChonCaLoc = !theoLoc && cungTrangHet && tong > trangIds.length;
  const soLead = theoLoc ? tong : soTick;
  const tenLoc = lyDo === null ? "đang cần xử lý nguồn" : `«${NHAN_LY_DO[lyDo]}»`;

  return (
    <Ctx.Provider value={{ daChon, trangIds, bat, chonTrang }}>
      {(soTick > 0 || theoLoc) && (
        <div
          role="region"
          aria-label="Lead đã chọn"
          className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary bg-primary-soft px-4 py-2.5 text-sm text-primary-ink shadow-sm"
        >
          <span aria-live="polite" className="font-semibold">
            {theoLoc ? `Đã chọn cả ${soVN(tong)} lead ${tenLoc}` : `Đã chọn ${soVN(soTick)} lead`}
          </span>
          {coTheChonCaLoc && (
            <button type="button" onClick={() => setTheoLoc(true)} className="font-medium underline underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring">
              Chọn cả {soVN(tong)} lead {tenLoc}
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button type="button" onClick={boChon} className={cn(BTN_OUTLINE, NUT_NHO)}>
              Bỏ chọn
            </button>
            <button type="button" onClick={() => setMo(true)} className={cn(BTN_PRIMARY, NUT_NHO)}>
              Gán nguồn hàng loạt
            </button>
          </span>
        </div>
      )}
      {mo && (
        <HopGanNguonHangLoat
          chay={chay}
          view={{
            soLead,
            pham: theoLoc ? { kieu: "loc", lyDo } : { kieu: "ids", ids: [...daChon] },
            coSoId,
            moTa: theoLoc ? `${soVN(tong)} lead ${tenLoc} ở ${phamViNhan}.` : `${soVN(soTick)} lead đã chọn ở ${phamViNhan}.`,
            nguon,
          }}
          khiDong={(coDoi) => {
            setMo(false);
            if (coDoi) {
              boChon();
              router.refresh();
            }
          }}
        />
      )}
      {children}
    </Ctx.Provider>
  );
}

const O_TICK = "relative z-10 h-4 w-4 cursor-pointer accent-primary focus-visible:ring-2 focus-visible:ring-ring";

export function OChonLead({ leadId, ten }: { leadId: string; ten: string }) {
  const c = useChonLead();
  return (
    <input
      type="checkbox"
      aria-label={`Chọn ${ten}`}
      checked={c.daChon.has(leadId)}
      onChange={(e) => c.bat(leadId, e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={O_TICK}
    />
  );
}

export function OChonTatCa() {
  const c = useChonLead();
  const soChon = c.trangIds.filter((id) => c.daChon.has(id)).length;
  const het = c.trangIds.length > 0 && soChon === c.trangIds.length;
  return (
    <input
      type="checkbox"
      aria-label="Chọn cả trang này"
      checked={het}
      // Trạng thái lưng chừng: thuộc tính DOM, không có prop React — đặt qua ref.
      ref={(el) => {
        if (el) el.indeterminate = soChon > 0 && !het;
      }}
      onChange={(e) => c.chonTrang(e.target.checked)}
      className={O_TICK}
    />
  );
}
