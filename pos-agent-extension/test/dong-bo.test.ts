/**
 * MỘT lượt đồng bộ (`chayDongBo`) — `windowFrom` / `windowTo` của từng lô (hợp đồng `docs/pos-agent-api.md` 1.1 §4.4).
 *
 * Luật 1.1: lô `final:true` mang `windowTo` của CẢ LƯỢT (= mốc cuối của mảnh CUỐI), kể cả khi mảnh cuối RỖNG và lô
 * final là lô ĐANG GIỮ của một mảnh 24h SỚM hơn (`windowFrom` giữ của lô). Máy chủ GĐ4 (RV-06) chỉ đóng job tạo
 * ≤ `windowTo` của lô final, và lưu mốc đó làm "dữ liệu đã đọc tới" trên màn Sức khoẻ.
 *
 * Mã TRƯỚC bản vá (RV.3 của GĐ4): lô final = lô đang giữ, mang NGUYÊN `windowTo` của mảnh chứa nó ⇒ lượt nhiều mảnh
 * mà mảnh cuối rỗng gửi `windowTo` sớm hơn job cả chục giờ ⇒ job giữ PENDING ⇒ sale nhận "chưa trả lời kịp", và màn
 * Sức khoẻ in "đã đọc tới" một mốc cũ. Lô `final:false` KHÔNG đổi: chúng mang đúng hai chuỗi đã gửi portal.
 *
 * Mốc là HẰNG (luật 19) — test không đọc đồng hồ.
 */
import { describe, expect, it } from "vitest";
import { chayDongBo, type KetQuaGuiLo, type LoGiaoDich } from "../src/lib/dong-bo";
import type { CuaSo } from "../src/lib/cua-so";
import { dinhDangGioVN } from "../src/lib/gio-vn";
import type { KetQuaMain } from "../src/lib/portal";
import { dongPortal } from "./ho-tro/du-lieu";

const ms = (iso: string) => Date.parse(iso);
const JOB_ID = "cm9posjob0000000000000001";
/** 30 giờ 03 phút ⇒ hai mảnh: [06/10 04:20 → 07/10 04:20] · [07/10 04:20 → 07/10 10:23]. */
const CUA_SO_HAI_MANH: CuaSo = { tu: ms("2026-10-06T04:20:00+07:00"), den: ms("2026-10-07T10:23:00+07:00") };
/** 50 giờ ⇒ ba mảnh: [05/10 08:00 → 06/10 08:00] · [06/10 08:00 → 07/10 08:00] · [07/10 08:00 → 07/10 10:00]. */
const CUA_SO_BA_MANH: CuaSo = { tu: ms("2026-10-05T08:00:00+07:00"), den: ms("2026-10-07T10:00:00+07:00") };

/** Portal giả ở mức lệnh: lọc dòng theo cửa sổ mảnh (chuỗi giờ VN, hai đầu bao gồm), phân trang theo `pageIndex`. */
function portalTheoCuaSo(rows: Array<Record<string, unknown>>, coTrang = 50) {
  const goi: Array<{ tu: string; den: string; pageIndex: number }> = [];
  const goiTrang = async (manh: CuaSo, pageIndex: number): Promise<KetQuaMain> => {
    const tu = dinhDangGioVN(manh.tu);
    const den = dinhDangGioVN(manh.den);
    goi.push({ tu, den, pageIndex });
    const loc = rows.filter((r) => {
      const t = String(r.transaction_time).replace(/\//g, "-");
      return t >= tu && t <= den;
    });
    return {
      loai: "TRANG",
      httpStatus: 200,
      rows: loc.slice(pageIndex * coTrang, (pageIndex + 1) * coTrang),
      totalItems: loc.length,
      pageIndex,
      dauHeader: null,
    };
  };
  return { goi, goiTrang };
}

function nhanHet() {
  const daGui: LoGiaoDich[] = [];
  const guiLo = async (lo: LoGiaoDich): Promise<KetQuaGuiLo> => {
    daGui.push(structuredClone(lo));
    return { ok: true, data: { rejected: [], errors: [], jobsDone: lo.jobIds.length } };
  };
  return { daGui, guiLo };
}

const tom = (ds: LoGiaoDich[]) => ds.map((l) => [l.batchIndex, l.final, l.windowFrom, l.windowTo, l.jobIds.length, l.transactions.length]);

function dongLuc(gio: string, i: number): Record<string, unknown> {
  return dongPortal({ transaction_id: `TXN2026100${String(10_000 + i)}`, transaction_time: gio });
}

describe("[EXT-DB] lô final mang windowTo của CẢ LƯỢT (hợp đồng 1.1 §4.4)", () => {
  it("[EXT-DB-01] hai mảnh, mảnh CUỐI rỗng ⇒ lô final (lô đang giữ của mảnh 1) mang windowTo = mốc cuối CẢ LƯỢT; windowFrom giữ của lô", async () => {
    const p = portalTheoCuaSo([dongLuc("2026/10/06 09:00:00", 1)]);
    const s = nhanHet();
    const kq = await chayDongBo({ cuaSo: CUA_SO_HAI_MANH, jobIds: [JOB_ID], syncId: "sync-db-01", goiTrang: p.goiTrang, guiLo: s.guiLo });
    expect(kq.ok).toBe(true);
    // portal được hỏi đúng hai mảnh (mảnh cuối trả 0 dòng)
    expect(p.goi.map((g) => [g.tu, g.den])).toEqual([
      ["2026-10-06 04:20:00", "2026-10-07 04:20:00"],
      ["2026-10-07 04:20:00", "2026-10-07 10:23:00"],
    ]);
    expect(tom(s.daGui)).toEqual([[0, true, "2026-10-06 04:20:00", "2026-10-07 10:23:00", 1, 1]]);
    expect(s.daGui[0].jobIds).toEqual([JOB_ID]);
  });

  it("[EXT-DB-02] lô final:false giữ ĐÚNG hai chuỗi đã gửi portal của mảnh nó; lô final (mảnh sớm, hai mảnh sau rỗng) ⇒ windowTo cả lượt; lượt 0 dòng ⇒ một lô final rỗng, windowTo cả lượt", async () => {
    const ds = Array.from({ length: 60 }, (_, i) => dongLuc(`2026/10/05 ${String(9 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`, i));
    const p = portalTheoCuaSo(ds);
    const s = nhanHet();
    const kq = await chayDongBo({ cuaSo: CUA_SO_BA_MANH, jobIds: [JOB_ID], syncId: "sync-db-02", goiTrang: p.goiTrang, guiLo: s.guiLo });
    expect(kq.ok).toBe(true);
    expect(tom(s.daGui)).toEqual([
      [0, false, "2026-10-05 08:00:00", "2026-10-06 08:00:00", 0, 50], // final:false — đúng mảnh đã gửi portal
      [1, true, "2026-10-05 08:00:00", "2026-10-07 10:00:00", 1, 10], // final — cận trên CẢ lượt
    ]);

    const rong = nhanHet();
    const kq0 = await chayDongBo({ cuaSo: CUA_SO_BA_MANH, jobIds: [JOB_ID], syncId: "sync-db-02b", goiTrang: portalTheoCuaSo([]).goiTrang, guiLo: rong.guiLo });
    expect(kq0.ok).toBe(true);
    expect(rong.daGui).toHaveLength(1);
    expect(rong.daGui[0]).toMatchObject({ final: true, windowTo: "2026-10-07 10:00:00", jobIds: [JOB_ID], transactions: [] });

    // đối chứng: dòng ở mảnh CUỐI ⇒ lô final vốn đã mang mốc cuối của mảnh cuối (đúng cả trước bản vá)
    const cuoi = nhanHet();
    await chayDongBo({
      cuaSo: CUA_SO_BA_MANH,
      jobIds: [],
      syncId: "sync-db-02c",
      goiTrang: portalTheoCuaSo([dongLuc("2026/10/07 09:30:00", 1)]).goiTrang,
      guiLo: cuoi.guiLo,
    });
    expect(tom(cuoi.daGui)).toEqual([[0, true, "2026-10-07 08:00:00", "2026-10-07 10:00:00", 0, 1]]);
  });

  it("[EXT-DB-03] lô final gửi LẠI sau 400 trỏ một dòng (đường bỏ dòng, máy chủ 1.0) vẫn mang windowTo cả lượt (jobIds bỏ — RV5); lượt HỎNG ở mảnh cuối ⇒ lô đang giữ đi final:false với cửa sổ của CHÍNH mảnh nó (không khai mốc cả lượt)", async () => {
    const p = portalTheoCuaSo([dongLuc("2026/10/06 09:00:00", 1), dongLuc("2026/10/06 09:05:00", 2)]);
    const daGui: LoGiaoDich[] = [];
    let lan = 0;
    const guiLo = async (lo: LoGiaoDich): Promise<KetQuaGuiLo> => {
      daGui.push(structuredClone(lo));
      if (lan++ === 0) return { ok: false, ma: "PAYLOAD_INVALID", httpStatus: 400, field: "transactions[1].store_code" };
      return { ok: true, data: { rejected: [], errors: [], jobsDone: 0 } };
    };
    const kq = await chayDongBo({ cuaSo: CUA_SO_HAI_MANH, jobIds: [JOB_ID], syncId: "sync-db-03", goiTrang: p.goiTrang, guiLo });
    expect(kq).toMatchObject({ ok: true, dongBiBo: 1 });
    expect(tom(daGui)).toEqual([
      [0, true, "2026-10-06 04:20:00", "2026-10-07 10:23:00", 1, 2],
      [0, true, "2026-10-06 04:20:00", "2026-10-07 10:23:00", 0, 1],
    ]);

    // Hỏng ở mảnh cuối: KHÔNG có lô final; lô đang giữ đi final:false, mang đúng mảnh 1 — không hứa "đã đọc tới" cả lượt.
    const hong = nhanHet();
    const goiHong = async (manh: CuaSo, pageIndex: number): Promise<KetQuaMain> =>
      manh.tu === CUA_SO_HAI_MANH.tu
        ? p.goiTrang(manh, pageIndex)
        : { loai: "LOI", ma: "PORTAL_HTTP_ERROR", httpStatus: 500, dauHeader: null };
    const kqHong = await chayDongBo({ cuaSo: CUA_SO_HAI_MANH, jobIds: [JOB_ID], syncId: "sync-db-03b", goiTrang: goiHong, guiLo: hong.guiLo });
    expect(kqHong.ok).toBe(false);
    expect(tom(hong.daGui)).toEqual([[0, false, "2026-10-06 04:20:00", "2026-10-07 04:20:00", 0, 2]]);
  });
});

describe("[EXT-DB] đường bỏ dòng (400 trỏ một dòng — máy chủ 1.0) không bao giờ bỏ TÍN HIỆU HỦY", () => {
  /**
   * Máy chủ 1.1 GIỮ LẠI thanh toán cùng RRN khi THẤY dòng hủy/hoàn bị từ chối trong cùng lô (RVG-02 của GĐ4) — nhưng
   * dòng extension tự bỏ thì máy chủ không bao giờ thấy. Bỏ dòng HỦY rồi gửi lại lô = thanh toán cùng RRN vào sổ MỘT
   * MÌNH ⇒ thu tiền cho lần quẹt ĐÃ HỦY trên máy. Mã TRƯỚC bản vá (RV5): bỏ BẤT KỲ dòng nào `error.field` trỏ tới.
   */
  const RRN = "628099990701";
  const MA_TT = "TXN20261006000701";
  const MA_HUY = "TXN20261006000702";
  const thanhToan = () => dongPortal({ transaction_id: MA_TT, transaction_time: "2026/10/06 09:00:00", card_transaction_id: RRN });

  /** Máy chủ 1.0 giả: 400 PAYLOAD_INVALID trỏ dòng mang mã `ma` (khi còn trong lô); lô không còn dòng đó ⇒ nhận. */
  function mayChu10TroVao(ma: string) {
    const daGui: LoGiaoDich[] = [];
    const guiLo = async (lo: LoGiaoDich): Promise<KetQuaGuiLo> => {
      daGui.push(structuredClone(lo));
      const i = lo.transactions.findIndex((r) => r.transaction_id === ma);
      if (i >= 0) return { ok: false, ma: "PAYLOAD_INVALID", httpStatus: 400, field: `transactions[${i}].store_code` };
      return { ok: true, data: { rejected: [], errors: [], jobsDone: lo.jobIds.length } };
    };
    return { daGui, guiLo };
  }

  it("[EXT-DB-04] 400 trỏ dòng VOID · REFUND · loại lạ · thiếu loại ⇒ DỪNG lượt (không lô final, không gửi lại lô thiếu dòng đó); đối chứng: 400 trỏ dòng THANH TOÁN vẫn bỏ được (RV5) và lượt đó không mang jobIds", async () => {
    for (const loai of ["VOID", "REFUND", "ADJUSTMENT", null]) {
      const huy = dongPortal({ transaction_id: MA_HUY, transaction_type: loai, transaction_time: "2026/10/06 09:01:00", card_transaction_id: RRN });
      const s = mayChu10TroVao(MA_HUY);
      const kq = await chayDongBo({
        cuaSo: CUA_SO_HAI_MANH,
        jobIds: [JOB_ID],
        syncId: `sync-db-04-${String(loai)}`,
        goiTrang: portalTheoCuaSo([thanhToan(), huy]).goiTrang,
        guiLo: s.guiLo,
      });
      expect(kq, String(loai)).toMatchObject({ ok: false, loi: { nguon: "SATAROBO", ma: "PAYLOAD_INVALID", httpStatus: 400 } });
      // đúng MỘT lần gửi, và lần đó MANG dòng hủy — không lô nào đưa thanh toán tới máy chủ mà thiếu tín hiệu hủy
      expect(s.daGui.map((l) => l.transactions.map((r) => r.transaction_id)), String(loai)).toEqual([[MA_TT, MA_HUY]]);
    }

    // đối chứng: 400 trỏ dòng THANH TOÁN ⇒ bỏ đúng dòng đó, gửi lại lô (RV5); lượt chưa trọn KHÔNG mang jobIds
    const huy = dongPortal({ transaction_id: MA_HUY, transaction_type: "VOID", transaction_time: "2026/10/06 09:01:00", card_transaction_id: RRN });
    const s = mayChu10TroVao(MA_TT);
    const kq = await chayDongBo({
      cuaSo: CUA_SO_HAI_MANH,
      jobIds: [JOB_ID],
      syncId: "sync-db-04-tt",
      goiTrang: portalTheoCuaSo([thanhToan(), huy]).goiTrang,
      guiLo: s.guiLo,
    });
    expect(kq).toMatchObject({ ok: true, dongBiBo: 1 });
    expect(s.daGui.map((l) => [l.final, l.jobIds.length, l.transactions.map((r) => r.transaction_id)])).toEqual([
      [true, 1, [MA_TT, MA_HUY]],
      [true, 0, [MA_HUY]],
    ]);
  });
});
