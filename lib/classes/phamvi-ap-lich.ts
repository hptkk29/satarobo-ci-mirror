// lib/classes/phamvi-ap-lich.ts — THUẦN: "áp lịch mới cho BUỔI NÀO". T03 (07/10/2026), quyết định mục 2 của chủ dự án:
// sửa khung lịch phải có phạm vi áp dụng, không mặc định "tất cả".
//
//   TU_NGAY               Từ ngày X trở đi              (cách duy nhất có từ trước T03 — ô "áp dụng từ ngày")
//   TU_BUOI_NAY           Buổi này và các buổi sau      (mốc = ngày của buổi được chọn)
//   CHI_BUOI_NAY          Chỉ buổi này                  (mọi buổi KHÁC coi như khoá ⇒ chỉ buổi này nhận ngày mới)
//   TOAN_BO_CHUA_DIEN_RA  Toàn bộ buổi chưa diễn ra     (mốc = buổi chưa diễn ra đầu tiên; buổi đã qua giờ ⇒ khoá)
//
// Hàm này CHỈ quy phạm vi về hai thứ mà bộ lập kế hoạch hiểu: một MỐC (`applyFrom`, 00:00 giờ VN) và một tập buổi bị loại
// khỏi phạm vi (`ngoaiPhamVi`, kèm lý do — bộ lập kế hoạch coi chúng như buổi khoá: giữ ngày, chiếm ngày). Nhờ vậy thuật
// toán rải ngày (`assignPhasedDates`) không phải biết gì về phạm vi, và giữ nguyên các bảo đảm thứ tự đã có.
import { vnStartOfDay, vnYmd } from "@/lib/time/vn";

export type PhamViApLich =
  /** `ngay` = 00:00 giờ VN (dựng bằng `parseVnYmd`, KHÔNG `new Date(chuỗi)`). */
  | { loai: "TU_NGAY"; ngay: Date }
  | { loai: "TU_BUOI_NAY"; sessionId: string }
  | { loai: "CHI_BUOI_NAY"; sessionId: string }
  | { loai: "TOAN_BO_CHUA_DIEN_RA" };

export type BuoiChoPhamVi = { id: string; date: Date; status: string };

export type KetQuaPhamVi =
  | {
      ok: true;
      /** Mốc áp dụng, 00:00 giờ VN. */
      applyFrom: Date;
      /** Buổi nằm TRONG khoảng từ mốc nhưng NGOÀI phạm vi đã chọn → lý do hiển thị cho người dùng. */
      ngoaiPhamVi: Map<string, string>;
    }
  | { ok: false; error: string };

/**
 * Quy phạm vi về (mốc, tập buổi bị loại). `now` BẮT BUỘC: "chưa diễn ra" là so với một thời điểm cụ thể, và nơi gọi
 * phải tự truyền (luật 19 — test không được đọc đồng hồ thật).
 */
export function giaiPhamVi(phamVi: PhamViApLich, ctx: { now: Date; buoi: readonly BuoiChoPhamVi[] }): KetQuaPhamVi {
  const ngoai = new Map<string, string>();
  const dang = ctx.buoi.filter((b) => b.status !== "CANCELLED");

  switch (phamVi.loai) {
    case "TU_NGAY":
      return { ok: true, applyFrom: phamVi.ngay, ngoaiPhamVi: ngoai };

    case "TU_BUOI_NAY": {
      const b = ctx.buoi.find((x) => x.id === phamVi.sessionId);
      if (!b) return { ok: false, error: "Buổi học không thuộc lớp này." };
      if (b.status === "CANCELLED") return { ok: false, error: "Buổi này đã huỷ — chọn một buổi còn hiệu lực." };
      return { ok: true, applyFrom: vnStartOfDay(b.date), ngoaiPhamVi: ngoai };
    }

    case "CHI_BUOI_NAY": {
      const b = ctx.buoi.find((x) => x.id === phamVi.sessionId);
      if (!b) return { ok: false, error: "Buổi học không thuộc lớp này." };
      if (b.status === "CANCELLED") return { ok: false, error: "Buổi này đã huỷ — chọn một buổi còn hiệu lực." };
      const tu = vnStartOfDay(b.date);
      const tuKey = vnYmd(tu);
      for (const x of dang) {
        if (x.id !== b.id && vnYmd(x.date) >= tuKey) ngoai.set(x.id, "ngoài phạm vi áp dụng (chỉ áp cho buổi đã chọn)");
      }
      return { ok: true, applyFrom: tu, ngoaiPhamVi: ngoai };
    }

    case "TOAN_BO_CHUA_DIEN_RA": {
      const chua = dang.filter((x) => x.date.getTime() > ctx.now.getTime()).sort((a, b) => a.date.getTime() - b.date.getTime());
      if (chua.length === 0) return { ok: false, error: "Lớp không còn buổi nào chưa diễn ra." };
      const tu = vnStartOfDay(chua[0]!.date);
      const tuKey = vnYmd(tu);
      for (const x of dang) {
        // Buổi CÙNG NGÀY mốc nhưng đã qua giờ: kể là đã diễn ra, không được kéo đi.
        if (x.date.getTime() <= ctx.now.getTime() && vnYmd(x.date) >= tuKey) ngoai.set(x.id, "đã diễn ra");
      }
      return { ok: true, applyFrom: tu, ngoaiPhamVi: ngoai };
    }
  }
}
