// lib/payments/pos/yeu-cau-sai-ma-dang-giu.test.ts — HAI sự thật về yêu cầu "nhập sai mã" (Việc 3) mà nút "Huỷ phiếu thẻ" (Việc 4) hỏi DƯỚI khoá:
// "còn yêu cầu SỐNG không" (`coYeuCauSaiMaDangGiu`) và "yêu cầu MỚI NHẤT là gì" (`yeuCauSaiMaMoiNhat`: trạng thái + lý do từ chối).
//
// LỊCH SỬ: lúc hai nhánh còn làm song song, hai hàm này là THÂN TẠM trả `false` và `[HN4-T2]` `[HN4-T3]` là tripwire (`it.fails` cho tới khi nhánh có
// model `PosSaiMaYeuCau`). Đã NỐI THẬT (docs §7.5-A, F6): hai ca chạy như ca thường, không còn `caGhim`. Số hiệu `[HN4-T4]` (kiểm `ganYeuCauSaiMa` phía màn)
// đã gỡ ở lượt ghép — để trống, đừng tái dùng.
// VIỆC 6 · a2 (chủ dự án chốt 10/10/2026: kế toán từ chối thì sale HUỶ ĐƯỢC phiếu thẻ): hàm `yeuCauSaiMaMoiNhatBiTuChoi` (trả boolean — cổng chặn riêng V4.2) ĐÃ GỠ.
// Máy chủ vẫn cần biết yêu cầu mới nhất để NHẬN RA câu lưu sau từ chối (`laCauLuuTuChoiSaiMa`, huy-phieu-the.ts), nên hàm đọc trả CẢ trạng thái lẫn lý do
// (cùng `orderBy createdAt desc, take 1` mà `CHON_VIEW` của màn dùng). Số hiệu `[HN4-T3]`/`[HN4-T5]` GIỮ, nội dung viết lại.
//
// ⚠️ Ghim đi theo HÀNH VI qua một client giả CÓ NGHĨA — đọc `where.intentId`, `where.trangThai` (bằng / `{ not }`) và `orderBy.createdAt` — KHÔNG grep mã nguồn (grep
// là loại mong manh nhất, CLAUDE.md luật 11). Client giả đáp ba cách đọc hợp lý (`findFirst` · `findMany` · `count`), nên người sửa đổi cách viết truy vấn không làm
// ca đỏ oan; còn đổi NGHĨA (bỏ lọc phiếu, đổi "không phải TU_CHOI" thành "bằng CHO_DUYET", lấy dòng CŨ NHẤT thay vì MỚI NHẤT) thì bảng `[HN4-T5]` đỏ.
// Phép đo trên Postgres thật (cú pháp `not`, thứ tự `createdAt`): `tests/finance/pos-huy-sai-ma.test.ts` `[HN4-DB-13d]`.
import { describe, expect, it } from "vitest";
import * as moDun from "./yeu-cau-sai-ma-dang-giu";
import { coYeuCauSaiMaDangGiu, yeuCauSaiMaMoiNhat } from "./yeu-cau-sai-ma-dang-giu";

type ClientDoc = Parameters<typeof coYeuCauSaiMaDangGiu>[0];

type TrangThai = "CHO_DUYET" | "DANG_GHI" | "DA_GHI_NHAN" | "TU_CHOI";
type Hang = { id: string; intentId: string; trangThai: TrangThai; lyDoTuChoi: string | null; createdAt: Date };
type Loc = {
  where?: { intentId?: string; trangThai?: TrangThai | { not?: TrangThai } };
  orderBy?: { createdAt?: "asc" | "desc" };
};

/** Phiếu thẻ nằm trong `bang` — mọi cách đọc đều lọc theo CÙNG `where`/`orderBy` mà Prisma sẽ áp. */
function clientGia(bang: Hang[]): ClientDoc {
  const loc = (a: Loc): Hang[] => {
    const w = a.where ?? {};
    const ds = bang.filter((r) => {
      if (w.intentId !== undefined && r.intentId !== w.intentId) return false;
      const tt = w.trangThai;
      if (typeof tt === "string" && r.trangThai !== tt) return false;
      if (tt !== undefined && typeof tt === "object" && tt.not !== undefined && r.trangThai === tt.not) return false;
      return true;
    });
    const huong = a.orderBy?.createdAt;
    if (huong) ds.sort((x, y) => (huong === "desc" ? y.createdAt.getTime() - x.createdAt.getTime() : x.createdAt.getTime() - y.createdAt.getTime()));
    return ds;
  };
  const posSaiMaYeuCau = {
    findFirst: async (a: Loc) => loc(a)[0] ?? null,
    findMany: async (a: Loc & { take?: number }) => loc(a).slice(0, a.take ?? Number.MAX_SAFE_INTEGER),
    count: async (a: Loc) => loc(a).length,
  };
  return { posSaiMaYeuCau } as unknown as ClientDoc;
}

const t = (phut: number) => new Date(Date.UTC(2026, 9, 9, 3, phut));
/** Dòng bị từ chối mang lý do `lý do <id>` (để biết dòng NÀO được chọn là mới nhất); dòng còn sống không có lý do. */
const hang = (id: string, intentId: string, trangThai: TrangThai, phut: number): Hang => ({
  id,
  intentId,
  trangThai,
  lyDoTuChoi: trangThai === "TU_CHOI" ? `lý do ${id}` : null,
  createdAt: t(phut),
});

/** (đang giữ, trạng thái của yêu cầu MỚI NHẤT, lý do từ chối của nó) — `null` khi phiếu chưa từng có yêu cầu. */
type SuThat = [dangGiu: boolean, moiNhat: TrangThai | null, lyDo: string | null];
const suThat = async (c: ClientDoc, intentId: string): Promise<SuThat> => {
  const moiNhat = await yeuCauSaiMaMoiNhat(c, intentId);
  return [await coYeuCauSaiMaDangGiu(c, intentId), moiNhat?.trangThai ?? null, moiNhat?.lyDoTuChoi ?? null];
};

describe("[HN4-T] hai hàm đọc yêu cầu sai mã — chỗ nối với Việc 3", () => {
  it("[HN4-T1] chữ ký là (client, intentId): máy chủ gọi `(tx, intentId)` DƯỚI khoá", () => {
    for (const f of [coYeuCauSaiMaDangGiu, yeuCauSaiMaMoiNhat]) {
      expect(typeof f).toBe("function");
      expect(f.length).toBe(2);
    }
  });

  it("[HN6-A2-T0] mô-đun chỉ xuất HAI hàm — cờ cũ `yeuCauSaiMaMoiNhatBiTuChoi` ĐÃ GỠ (không để mã chết mời người sau gắn lại cổng chặn riêng)", () => {
    expect(Object.keys(moDun).sort()).toEqual(["coYeuCauSaiMaDangGiu", "yeuCauSaiMaMoiNhat"]);
  });

  // Hành vi ĐÚNG: có một yêu cầu SỐNG (CHO_DUYET) cho phiếu ⇒ true.
  it("[HN4-T2] `coYeuCauSaiMaDangGiu` thấy yêu cầu sống", async () => {
    await expect(coYeuCauSaiMaDangGiu(clientGia([hang("y1", "i1", "CHO_DUYET", 0)]), "i1")).resolves.toBe(true);
  });

  // Hành vi ĐÚNG: yêu cầu MỚI NHẤT của phiếu là TU_CHOI ⇒ trả trạng thái VÀ lý do từ chối của CHÍNH dòng đó.
  it("[HN4-T3] `yeuCauSaiMaMoiNhat` thấy yêu cầu bị từ chối, kèm lý do của nó", async () => {
    await expect(yeuCauSaiMaMoiNhat(clientGia([hang("y1", "i1", "TU_CHOI", 0)]), "i1")).resolves.toEqual({ trangThai: "TU_CHOI", lyDoTuChoi: "lý do y1" });
  });

  it("[HN6-A2-T3b] hình dạng kết quả CHỈ gồm hai trường cần cho `laCauLuuTuChoiSaiMa` (không rò id / giao dịch / người quyết ra khỏi lớp đọc)", async () => {
    const kq = await yeuCauSaiMaMoiNhat(clientGia([hang("y1", "i1", "CHO_DUYET", 0)]), "i1");
    expect(kq).toEqual({ trangThai: "CHO_DUYET", lyDoTuChoi: null });
    expect(Object.keys(kq ?? {}).sort()).toEqual(["lyDoTuChoi", "trangThai"]);
  });

  it("[HN4-T5] bảng sự thật (đang giữ, trạng thái + lý do của yêu cầu MỚI NHẤT) theo lịch sử yêu cầu của MỘT phiếu — và các phiếu khác không lẫn vào", async () => {
    const bang: { ten: string; hang: Hang[]; mong: SuThat }[] = [
      { ten: "chưa từng có yêu cầu", hang: [], mong: [false, null, null] },
      { ten: "một yêu cầu bị từ chối", hang: [hang("a", "i1", "TU_CHOI", 0)], mong: [false, "TU_CHOI", "lý do a"] },
      {
        ten: "bị từ chối rồi gửi lại: dòng MỚI NHẤT còn sống",
        hang: [hang("a", "i1", "TU_CHOI", 0), hang("b", "i1", "CHO_DUYET", 10)],
        mong: [true, "CHO_DUYET", null],
      },
      {
        ten: "thứ tự trong mảng ≠ thứ tự createdAt: dòng sống ghi TRƯỚC nhưng MUỘN hơn vẫn là mới nhất",
        hang: [hang("b", "i1", "CHO_DUYET", 10), hang("a", "i1", "TU_CHOI", 0)],
        mong: [true, "CHO_DUYET", null],
      },
      // VIỆC 6: lý do của dòng MỚI NHẤT — đây là thứ `laCauLuuTuChoiSaiMa` so với câu lưu; lấy nhầm dòng CŨ thì câu lưu của lần từ chối thứ hai không được nhận ra.
      { ten: "bị từ chối HAI lần: lý do là của lần MỚI NHẤT", hang: [hang("a", "i1", "TU_CHOI", 0), hang("b", "i1", "TU_CHOI", 10)], mong: [false, "TU_CHOI", "lý do b"] },
      {
        ten: "bị từ chối HAI lần, thứ tự mảng ngược: vẫn lý do của lần MỚI NHẤT",
        hang: [hang("b", "i1", "TU_CHOI", 10), hang("a", "i1", "TU_CHOI", 0)],
        mong: [false, "TU_CHOI", "lý do b"],
      },
      { ten: "đang chờ duyệt", hang: [hang("a", "i1", "CHO_DUYET", 0)], mong: [true, "CHO_DUYET", null] },
      // VG6: "đang giữ" = `trangThai ≠ TU_CHOI` — CÙNG vị từ hai chỉ mục duy nhất từng phần của Việc 3; DANG_GHI và DA_GHI_NHAN cũng là "giữ".
      { ten: "đang ghi tiền", hang: [hang("a", "i1", "DANG_GHI", 0)], mong: [true, "DANG_GHI", null] },
      { ten: "đã ghi nhận", hang: [hang("a", "i1", "DA_GHI_NHAN", 0)], mong: [true, "DA_GHI_NHAN", null] },
      { ten: "chỉ có yêu cầu của phiếu KHÁC", hang: [hang("a", "i2", "CHO_DUYET", 0), hang("b", "i2", "TU_CHOI", 5)], mong: [false, null, null] },
      {
        ten: "phiếu này bị từ chối, phiếu khác có yêu cầu SỐNG mới hơn — không lẫn",
        hang: [hang("a", "i1", "TU_CHOI", 0), hang("b", "i2", "CHO_DUYET", 20)],
        mong: [false, "TU_CHOI", "lý do a"],
      },
    ];
    for (const b of bang) expect(await suThat(clientGia(b.hang), "i1"), b.ten).toEqual(b.mong);
    // ĐỐI CHỨNG của bộ gá: chính phiếu `i2` của hai dòng cuối cùng thì THẤY yêu cầu của nó.
    expect(await suThat(clientGia([hang("a", "i2", "CHO_DUYET", 0)]), "i2")).toEqual([true, "CHO_DUYET", null]);
  });

  // `[HN4-T4]` (kiểm `ganYeuCauSaiMa`, phía màn) ĐÃ GỠ ở lượt ghép Việc 4 lên Việc 3: hàm đó bị xoá — màn suy các sự thật từ `saiMaYeuCau`
  // (mã số T4 để trống, đừng tái dùng). Hành vi của phép suy do `[HN4-12]` (`huy-phieu-the-view.test.ts`) canh.
});
