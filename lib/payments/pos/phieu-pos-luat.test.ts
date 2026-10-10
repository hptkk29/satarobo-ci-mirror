// Ca [POS1-QD-*] · [POS1-UI-02] — LUẬT trạng thái phiếu thu thẻ (`quyetPhieuPos`) + dựng view
// (`dungPhieuPosView`). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §1.4 (vòng đời), §4.5 (bảng quyết), §7.1 (hiển thị).
// Ba luật đắt nhất, mỗi luật có ca riêng:
//   · SỰ THẬT VỀ TIỀN THẮNG — giao dịch đọc lại trong khoá đã MATCHED vào ĐÚNG phiếu gộp ⇒ DA_THU,
//     kể cả phiếu đã HET_HAN/HUY (`[POS1-QD-16]`);
//   · KẾT QUẢ YẾU KHÔNG ĐÈ — NOT_FOUND/FAILED/PROVIDER_ERROR không đổi phiếu ĐÓNG và không ghi đè
//     kết quả của nó (`[POS1-QD-15]`) — chặn ca "nút tính NOT_FOUND trước khi import commit, ghi
//     sau khi IMPORT đã đặt DA_THU";
//   · LỆCH SỐ ≠ LÝ DO KHÁC — `LECH_SO` của `thuTheoPhieuGop` ra LECH_TIEN, không gộp vào CAN_XU_LY
//     (`[POS1-QD-05]`).
import { describe, it, expect } from "vitest";
import type { PosIntentStatus } from "@prisma/client";
import {
  BAO_ADMIN_SAU_MS,
  chonPhieuPosHienThi,
  dungPhieuPosView,
  laPhieuMo,
  lyDoKhongBaoAdmin,
  quyetPhieuPos,
  type DauVaoQuyetPos,
} from "./phieu-pos-luat";

const TAO = new Date("2026-10-06T09:00:00Z");
const QUET = new Date("2026-10-06T10:31:35Z");

const PAID = { kind: "PAID" as const, providerTxnId: "FT26279000001", amount: 6_732_000 };

function vao(p: Partial<DauVaoQuyetPos> & Pick<DauVaoQuyetPos, "hienTai" | "kq" | "tien">): DauVaoQuyetPos {
  return {
    bt: null,
    coMaDuyNhat: true,
    btCuaPhieuKhac: false,
    code5: "K7M2N",
    taoLuc: TAO,
    soTienMay: 6_732_000,
    gioQuet: QUET,
    ...p,
  };
}

const DA_CHIA = { loai: "DA_CHIA" as const, btId: "bt1", billId: "b1", orderId: "o1" };
const MATCHED_DUNG = { status: "MATCHED" as const, vaoDungPhieu: true };
const MATCHED_KHAC = { status: "MATCHED" as const, vaoDungPhieu: false };
const CHO = { status: "UNMATCHED" as const, vaoDungPhieu: false };
const BO = { status: "IGNORED" as const, vaoDungPhieu: false };

const DONG: PosIntentStatus[] = ["DA_THU", "LECH_TIEN", "CAN_XU_LY"];

describe("[POS1-QD] quyetPhieuPos — bảng §4.5", () => {
  it("laPhieuMo: chỉ CHO_QUET + THAT_BAI là MỞ (khớp chỉ mục từng phần `…_mo_key`)", () => {
    const mo = (["CHO_QUET", "THAT_BAI", "DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"] as const).filter(laPhieuMo);
    expect(mo).toEqual(["CHO_QUET", "THAT_BAI"]);
  });

  it("[POS1-QD-01] PAID + DA_CHIA + tiền vào đúng phiếu ⇒ DA_THU, nhận giao dịch, câu 'Đã thu'", () => {
    const q = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: DA_CHIA, bt: MATCHED_DUNG }));
    expect(q).toMatchObject({ status: "DA_THU", ghiKetQua: true, nhanBt: true, baoAdmin: null });
    expect(q.ketLuan).toEqual({ loai: "DA_THU", soTien: 6_732_000, luc: QUET, daGhiTruoc: false, giaoDichKhac: 0 });
  });

  it("[POS1-QD-02] PAID_AMOUNT_MISMATCH mà hệ thống chia ĐÚNG ⇒ vẫn DA_THU (T3: provider chỉ BÁO, số do hệ quyết)", () => {
    const q = quyetPhieuPos(vao({ hienTai: "THAT_BAI", kq: { ...PAID, kind: "PAID_AMOUNT_MISMATCH" }, tien: DA_CHIA, bt: MATCHED_DUNG }));
    expect(q.status).toBe("DA_THU");
  });

  it("[POS1-QD-03] TRUNG / đã khớp từ trước (DA_KHOA MATCHED vào đúng phiếu) ⇒ DA_THU 'đã ghi trước'", () => {
    const q = quyetPhieuPos(
      vao({ hienTai: "CHO_QUET", kq: { ...PAID, giaoDichKhac: 2 }, tien: { loai: "DA_KHOA", btId: "bt1", trangThaiBt: "MATCHED", huySauGhiNhan: false }, bt: MATCHED_DUNG }),
    );
    expect(q.status).toBe("DA_THU");
    expect(q.ketLuan).toMatchObject({ loai: "DA_THU", daGhiTruoc: true, giaoDichKhac: 2 });
  });

  it("[POS1-QD-04] giao dịch MATCHED nhưng phân bổ trỏ CHỖ KHÁC (gắn tay) ⇒ CAN_XU_LY, nhận giao dịch", () => {
    const q = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: { loai: "DA_KHOA", btId: "bt1", trangThaiBt: "MATCHED", huySauGhiNhan: false }, bt: MATCHED_KHAC }));
    expect(q.status).toBe("CAN_XU_LY");
    expect(q.nhanBt).toBe(true);
    expect(q.ketLuan).toMatchObject({ loai: "CAN_XU_LY", soTienMay: 6_732_000 });
    expect(q.ketLuan?.loai === "CAN_XU_LY" && q.ketLuan.lyDo).toMatch(/khoản khác/);
  });

  it("[POS1-QD-05] CHO_TAY LECH_SO ⇒ LECH_TIEN (KHÔNG gộp vào CAN_XU_LY), mang số máy + số phiếu", () => {
    const q = quyetPhieuPos(
      vao({
        hienTai: "CHO_QUET",
        kq: { ...PAID, amount: 6_000_000 },
        soTienMay: 6_000_000,
        tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "LECH_SO", ghiChu: "[LECH_SO] …", conPhaiThu: 6_732_000 },
        bt: CHO,
      }),
    );
    expect(q).toMatchObject({ status: "LECH_TIEN", nhanBt: true, baoAdmin: null });
    expect(q.ketLuan).toEqual({ loai: "LECH_TIEN", soTienMay: 6_000_000, soTienPhieu: 6_732_000 });
  });

  it("[POS1-QD-06] CHO_TAY KHAC (quẹt chéo / máy chưa khai / phiếu đã đóng…) ⇒ CAN_XU_LY + lý do, nhận giao dịch khi đúng một mã", () => {
    const lyDo = "Máy POS thuộc CS2 nhưng mã K7M2N là phiếu của đơn ở cơ sở khác — không tự khớp quẹt chéo";
    const q = quyetPhieuPos(
      vao({ hienTai: "CHO_QUET", kq: PAID, tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "KHAC", ghiChu: lyDo, conPhaiThu: null }, bt: CHO }),
    );
    expect(q).toMatchObject({ status: "CAN_XU_LY", nhanBt: true });
    expect(q.ketLuan).toEqual({ loai: "CAN_XU_LY", soTienMay: 6_732_000, lyDo });
  });

  it("[POS1-QD-07] D2: ghi chú 2 mã ⇒ CAN_XU_LY nhưng KHÔNG nhận giao dịch (không phải giao dịch 'của' phiếu này)", () => {
    const q = quyetPhieuPos(
      vao({
        hienTai: "CHO_QUET",
        kq: PAID,
        coMaDuyNhat: false,
        tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "KHAC", ghiChu: "Ghi chú có 2 mã phiếu: K7M2N, QHKMN", conPhaiThu: null },
        bt: CHO,
      }),
    );
    expect(q.status).toBe("CAN_XU_LY");
    expect(q.nhanBt).toBe(false);
  });

  it("[POS1-QD-08] hoàn MỘT PHẦN / giao dịch đã bị BỎ QUA ⇒ CAN_XU_LY 'hỏi kế toán trước khi cho quẹt lại'", () => {
    for (const tien of [
      { loai: "CHAN_HOAN_MOT_PHAN" as const, btId: "bt1", lyDo: "Hoàn một phần" },
      { loai: "DA_KHOA" as const, btId: "bt1", trangThaiBt: "IGNORED" as const, huySauGhiNhan: false },
    ]) {
      const q = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien, bt: BO }));
      expect(q.status, tien.loai).toBe("CAN_XU_LY");
      expect(q.ketLuan?.loai === "CAN_XU_LY" && q.ketLuan.lyDo, tien.loai).toMatch(/hỏi kế toán trước khi cho quẹt lại/);
    }
  });

  it("[POS1-QD-09] BO_QUA (thất bại / hủy TOÀN PHẦN) ⇒ phiếu mở thành THAT_BAI, không nhận giao dịch; phiếu đóng giữ nguyên", () => {
    const q = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: { loai: "BO_QUA", btId: "bt1", lyDo: "Giao dịch đã bị hủy/hoàn" }, bt: BO }));
    expect(q).toMatchObject({ status: "THAT_BAI", nhanBt: false, ghiKetQua: true });
    expect(q.ketLuan).toMatchObject({ loai: "THAT_BAI", nhom: "DA_HUY_TREN_MAY" });
    // File ghi "Thất bại" (luật 1) dù provider báo PAID ⇒ thất bại thường, KHÔNG nói "đã hủy toàn bộ".
    const thatBai = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: { loai: "BO_QUA", btId: null, lyDo: "Giao dịch Thất bại" }, bt: null }));
    expect(thatBai.status).toBe("THAT_BAI");
    expect(thatBai.ketLuan).toMatchObject({ loai: "THAT_BAI", nhom: "KHAC" });
    const dong = quyetPhieuPos(vao({ hienTai: "LECH_TIEN", kq: PAID, tien: { loai: "BO_QUA", btId: null, lyDo: "x" }, bt: null }));
    expect(dong).toMatchObject({ status: "LECH_TIEN", ghiKetQua: false, ketLuan: null });
  });

  it("[POS1-QD-10] pha tiền NÉM ⇒ GIỮ trạng thái, báo admin, câu 'ĐỪNG cho khách quẹt lại'", () => {
    const q = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: { loai: "CHUA_XAC_DINH" }, bt: null }));
    expect(q).toMatchObject({ status: "CHO_QUET", nhanBt: false, baoAdmin: "CHUA_XAC_DINH" });
    expect(q.ketLuan).toEqual({ loai: "CHUA_XAC_DINH" });
  });

  it("[POS1-QD-11] FAILED ⇒ phiếu mở thành THAT_BAI (vẫn mở — quẹt lại được), mang nhóm lý do", () => {
    for (const hienTai of ["CHO_QUET", "THAT_BAI"] as const) {
      const q = quyetPhieuPos(vao({ hienTai, kq: { kind: "FAILED", reasonCode: "51" }, tien: { loai: "KHONG_DOI_TIEN" } }));
      expect(q).toMatchObject({ status: "THAT_BAI", ghiKetQua: true, nhanBt: false, baoAdmin: null });
      expect(q.ketLuan).toEqual({ loai: "THAT_BAI", maLoi: "51", nhom: "THE_TU_CHOI" });
      expect(laPhieuMo(q.status)).toBe(true);
    }
  });

  it("[POS1-QD-12] NOT_FOUND ⇒ giữ CHO_QUET, ghi kết quả, nút Báo admin mở sau 10 phút kể từ lúc tạo", () => {
    const q = quyetPhieuPos(
      vao({
        hienTai: "CHO_QUET",
        kq: { kind: "NOT_FOUND", duLieuCapNhatLuc: "2026-10-06T16:05:00+07:00", gdMoiNhatLuc: null },
        tien: { loai: "KHONG_DOI_TIEN" },
      }),
    );
    expect(q).toMatchObject({ status: "CHO_QUET", ghiKetQua: true, baoAdmin: null });
    expect(q.ketLuan).toEqual({
      loai: "CHUA_THAY",
      code5: "K7M2N",
      duLieuLuc: new Date("2026-10-06T09:05:00Z"),
      gdMoiNhatLuc: null,
      taoLuc: TAO,
      baoAdminTuLuc: new Date(TAO.getTime() + BAO_ADMIN_SAU_MS),
    });
    expect(BAO_ADMIN_SAU_MS).toBe(10 * 60_000);
  });

  it("[POS1-QD-13] CANCELLED_AFTER_PAID (D7) ⇒ không đụng tiền: DA_THU giữ + cảnh báo; phiếu mở ⇒ CAN_XU_LY", () => {
    const kq = { kind: "CANCELLED_AFTER_PAID" as const, providerTxnId: "FT26279000001", amount: 6_732_000 };
    const daThu = quyetPhieuPos(vao({ hienTai: "DA_THU", kq, tien: { loai: "KHONG_DOI_TIEN" } }));
    expect(daThu).toMatchObject({ status: "DA_THU", nhanBt: false, ghiKetQua: true });
    expect(daThu.ketLuan).toEqual({ loai: "HUY_SAU_THU", soTien: 6_732_000 });
    expect(quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq, tien: { loai: "KHONG_DOI_TIEN" } })).status).toBe("CAN_XU_LY");
  });

  it("[POS1-QD-14] PROVIDER_ERROR ⇒ giữ, BÁO ADMIN; phiếu mở ghi kết quả, phiếu đóng giữ câu cũ", () => {
    const kq = { kind: "PROVIDER_ERROR" as const, reasonCode: "TCB_FILE_DB" };
    const mo = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq, tien: { loai: "KHONG_DOI_TIEN" } }));
    expect(mo).toMatchObject({ status: "CHO_QUET", ghiKetQua: true, baoAdmin: "LOI_KET_NOI" });
    expect(mo.ketLuan).toEqual({ loai: "LOI_KET_NOI", maLoi: "TCB_FILE_DB" });
    const dong = quyetPhieuPos(vao({ hienTai: "DA_THU", kq, tien: { loai: "KHONG_DOI_TIEN" } }));
    expect(dong).toMatchObject({ status: "DA_THU", ghiKetQua: false, baoAdmin: "LOI_KET_NOI", ketLuan: null });
  });

  it("[POS1-QD-15] KẾT QUẢ YẾU không đổi phiếu ĐÓNG và không đè kết quả của nó", () => {
    const yeu = [
      { kind: "NOT_FOUND" as const },
      { kind: "FAILED" as const, reasonCode: "USER_CANCELLED" },
      { kind: "PROVIDER_ERROR" as const, reasonCode: "TCB_FILE_DB" },
    ];
    for (const hienTai of [...DONG, "HET_HAN", "HUY"] as PosIntentStatus[]) {
      for (const kq of yeu) {
        const q = quyetPhieuPos(vao({ hienTai, kq, tien: { loai: "KHONG_DOI_TIEN" } }));
        expect(q.status, `${hienTai} × ${kq.kind}`).toBe(hienTai);
        expect(q.ghiKetQua, `${hienTai} × ${kq.kind}`).toBe(false);
        expect(q.ketLuan, `${hienTai} × ${kq.kind}`).toBeNull();
        expect(q.nhanBt).toBe(false);
      }
    }
  });

  it("[POS1-QD-16] phiếu đã bị THAY (HET_HAN/HUY): chỉ lên DA_THU khi tiền vào đúng phiếu; ca khác giữ + KHÔNG nhận giao dịch", () => {
    for (const hienTai of ["HET_HAN", "HUY"] as const) {
      expect(quyetPhieuPos(vao({ hienTai, kq: PAID, tien: DA_CHIA, bt: MATCHED_DUNG })).status, hienTai).toBe("DA_THU");
      const q = quyetPhieuPos(
        vao({ hienTai, kq: PAID, tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "KHAC", ghiChu: "x", conPhaiThu: null }, bt: CHO }),
      );
      expect(q.status, hienTai).toBe(hienTai);
      expect(q.nhanBt, `${hienTai} không nhận giao dịch — để phiếu MỚI còn thấy nó`).toBe(false);
      const lech = quyetPhieuPos(
        vao({ hienTai, kq: PAID, tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "LECH_SO", ghiChu: "x", conPhaiThu: 1 }, bt: CHO }),
      );
      expect(lech.status).toBe(hienTai);
      expect(lech.nhanBt).toBe(false);
    }
  });

  it("[POS1-QD-17] giao dịch ĐANG thuộc phiếu POS KHÁC ⇒ không nhận (một giao dịch tối đa một phiếu)", () => {
    const q = quyetPhieuPos(
      vao({ hienTai: "CHO_QUET", kq: PAID, btCuaPhieuKhac: true, tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "KHAC", ghiChu: "x", conPhaiThu: null }, bt: CHO }),
    );
    expect(q.nhanBt).toBe(false);
    const daThu = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, btCuaPhieuKhac: true, tien: DA_CHIA, bt: MATCHED_DUNG }));
    expect(daThu.nhanBt).toBe(false);
    expect(daThu.status, "không nhân đôi DA_THU cho một lần quẹt").toBe("CHO_QUET");
  });

  it("[POS1-QD-18] DA_THU mà giao dịch đang giữ KHÔNG còn MATCHED (kế toán gỡ gắn) ⇒ CAN_XU_LY; LECH_TIEN chờ tay ⇒ giữ", () => {
    const go = quyetPhieuPos(
      vao({
        hienTai: "DA_THU",
        kq: PAID,
        tien: { loai: "CHO_TAY", btId: "bt1", lyDo: "KHAC", ghiChu: "Đã gỡ gắn — xử lý tay (import lại không tự khớp)", conPhaiThu: null },
        bt: CHO,
      }),
    );
    expect(go.status).toBe("CAN_XU_LY");
    const giuCho = quyetPhieuPos(vao({ hienTai: "LECH_TIEN", kq: PAID, tien: { loai: "DA_KHOA", btId: "bt1", trangThaiBt: null, huySauGhiNhan: false }, bt: CHO }));
    expect(giuCho.status).toBe("LECH_TIEN");
  });
});

describe("[POS1-VA] rà đối kháng 06/10/2026 — luật phiếu", () => {
  it("[POS1-VA-QD-01] NOT_FOUND kèm trangThaiTreo (dòng 'Đang xử lý') ⇒ GIỮ phiếu mở, câu 'đang chờ ngân hàng', KHÔNG THAT_BAI", () => {
    for (const hienTai of ["CHO_QUET", "THAT_BAI"] as const) {
      const q = quyetPhieuPos(
        vao({ hienTai, kq: { kind: "NOT_FOUND", trangThaiTreo: "DANG_XU_LY" }, tien: { loai: "KHONG_DOI_TIEN" } }),
      );
      expect(q).toMatchObject({ status: hienTai, ghiKetQua: true, nhanBt: false, baoAdmin: null });
      expect(q.ketLuan).toEqual({ loai: "DANG_CHO_NGAN_HANG", code5: "K7M2N", maTrangThai: "DANG_XU_LY" });
    }
    // Đối chứng: NOT_FOUND trơn vẫn là CHUA_THAY.
    const tron = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: { kind: "NOT_FOUND" }, tien: { loai: "KHONG_DOI_TIEN" } }));
    expect(tron.ketLuan?.loai).toBe("CHUA_THAY");
    // Phiếu ĐÓNG nhận kết quả treo ⇒ không đổi gì (kết quả yếu không đè).
    const dong = quyetPhieuPos(
      vao({ hienTai: "DA_THU", kq: { kind: "NOT_FOUND", trangThaiTreo: "DANG_XU_LY" }, tien: { loai: "KHONG_DOI_TIEN" } }),
    );
    expect(dong).toMatchObject({ status: "DA_THU", ghiKetQua: false, ketLuan: null });
  });

  it("[POS1-VA-QD-02] giao dịch ĐÃ KHOÁ vào đúng phiếu mà mang tín hiệu HỦY/HOÀN sau ghi nhận ⇒ HUY_SAU_THU (D7), không báo xanh", () => {
    const huy = { loai: "DA_KHOA" as const, btId: "bt1", trangThaiBt: "MATCHED" as const, huySauGhiNhan: true };
    const daThu = quyetPhieuPos(vao({ hienTai: "DA_THU", kq: PAID, tien: huy, bt: MATCHED_DUNG }));
    expect(daThu).toMatchObject({ status: "DA_THU", ghiKetQua: true, nhanBt: false });
    expect(daThu.ketLuan).toEqual({ loai: "HUY_SAU_THU", soTien: 6_732_000 });
    const mo = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: huy, bt: MATCHED_DUNG }));
    expect(mo).toMatchObject({ status: "CAN_XU_LY", nhanBt: false });
    expect(mo.ketLuan?.loai).toBe("HUY_SAU_THU");
    // Đối chứng dương: không tín hiệu ⇒ DA_THU như cũ.
    const sach = quyetPhieuPos(vao({ hienTai: "CHO_QUET", kq: PAID, tien: { ...huy, huySauGhiNhan: false }, bt: MATCHED_DUNG }));
    expect(sach.status).toBe("DA_THU");
    expect(sach.ketLuan?.loai).toBe("DA_THU");
  });
});

describe("[POS1-UI-02] dungPhieuPosView — hiển thị suy từ sự thật, số GÕ VÀO MÁY là còn phải thu HIỆN TẠI", () => {
  const NOW = new Date("2026-10-06T10:00:00Z");
  const base = {
    id: "i1",
    code5: "K7M2N",
    amount: 6_732_000,
    status: "CHO_QUET" as PosIntentStatus,
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 3_600_000),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: { id: "m1", maThietBi: "SP_GINI_X990", maQuay: "QTT45XWQT", ten: null },
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }, { paymentRequestId: "pr2" }] },
    coGiaoDichChoTay: false,
  };
  const phieuMo = {
    billId: "b1",
    tongTien: 3_564_000,
    dong: [{ paymentRequestId: "pr2", installmentNo: 1, ten: "Bé B", soTien: 3_564_000 }],
  };

  it("số GÕ VÀO MÁY = còn phải thu HIỆN TẠI (không phải số lúc tạo); dòng đợt + máy", () => {
    const v = dungPhieuPosView({ intent: base, phieuMo, now: NOW });
    expect(v.soTienLucTao).toBe(6_732_000);
    expect(v.soTienPhaiThu).toBe(3_564_000);
    expect(v.dongDot).toEqual([{ nhan: "Bé B", soTien: 3_564_000 }]);
    expect(v.may).toEqual({ id: "m1", nhan: "QTT45XWQT" });
    expect(v.hienThi).toBe("CHO_QUET");
    expect(v.duocKiemTra).toBe(true);
    expect(v.baoAdminTuLuc).toBe("2026-10-06T16:10:00+07:00");
  });

  it("phiếu gộp KHÔNG còn mở mà phiếu POS còn mở ⇒ PHIEU_DA_DONG (vẫn cho Kiểm tra); số phải thu null", () => {
    const v = dungPhieuPosView({ intent: { ...base, paymentBill: { ...base.paymentBill, status: "PAID" } }, phieuMo: null, now: NOW });
    expect(v.hienThi).toBe("PHIEU_DA_DONG");
    expect(v.soTienPhaiThu).toBeNull();
    expect(v.duocKiemTra).toBe(true);
  });

  it("mở + quá hạn ⇒ HET_HAN (vẫn cho Kiểm tra)", () => {
    const v = dungPhieuPosView({ intent: base, phieuMo, now: new Date(base.expiresAt.getTime() + 1) });
    expect(v.hienThi).toBe("HET_HAN");
    expect(v.duocKiemTra).toBe(true);
  });

  it("DA_THU mà giao dịch không còn MATCHED ⇒ KE_TOAN_DA_GO; LECH_TIEN mà đã MATCHED vào phiếu ⇒ KE_TOAN_DA_GHI", () => {
    const go = dungPhieuPosView({
      intent: { ...base, status: "DA_THU", bankTransaction: { status: "UNMATCHED", allocations: [] } },
      phieuMo: null,
      now: NOW,
    });
    expect(go.hienThi).toBe("KE_TOAN_DA_GO");
    const ghi = dungPhieuPosView({
      intent: { ...base, status: "LECH_TIEN", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } },
      phieuMo: null,
      now: NOW,
    });
    expect(ghi.hienThi).toBe("KE_TOAN_DA_GHI");
    const daThu = dungPhieuPosView({
      intent: { ...base, status: "DA_THU", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } },
      phieuMo: null,
      now: NOW,
    });
    expect(daThu.hienThi).toBe("DA_THU");
  });

  it("HUY ⇒ không cho Kiểm tra", () => {
    const v = dungPhieuPosView({ intent: { ...base, status: "HUY" }, phieuMo: null, now: NOW });
    expect(v.hienThi).toBe("HUY");
    expect(v.duocKiemTra).toBe(false);
  });

  it("[POS1-UI-02b] trường cho ô dòng đợt: phiếu gộp nào, có thuộc phiếu ĐANG MỞ không, T21 chờ kế toán", () => {
    const v = dungPhieuPosView({ intent: base, phieuMo, now: NOW });
    expect(v.paymentRequestIds).toEqual(["pr1", "pr2"]);
    expect(v.cuaPhieuDangMo).toBe(true);
    expect(v.choKeToan).toBe(false);
    expect(dungPhieuPosView({ intent: base, phieuMo: { ...phieuMo, billId: "b9" }, now: NOW }).cuaPhieuDangMo).toBe(false);
    expect(dungPhieuPosView({ intent: base, phieuMo: null, now: NOW }).cuaPhieuDangMo).toBe(false);

    // T21 — ĐÚNG điều kiện cổng máy chủ (`taoPhieuPosTrongKhoa`): LECH_TIEN/CAN_XU_LY + giao dịch UNMATCHED.
    const cho = { status: "UNMATCHED", allocations: [] };
    for (const s of ["LECH_TIEN", "CAN_XU_LY"] as const) {
      expect(dungPhieuPosView({ intent: { ...base, status: s, bankTransaction: cho }, phieuMo, now: NOW }).choKeToan).toBe(true);
    }
    // Đối chứng: kế toán đã hoàn (IGNORED) / đã gắn (MATCHED) / chưa có giao dịch ⇒ không chặn.
    expect(dungPhieuPosView({ intent: { ...base, status: "LECH_TIEN", bankTransaction: { status: "IGNORED", allocations: [] } }, phieuMo, now: NOW }).choKeToan).toBe(false);
    expect(dungPhieuPosView({ intent: { ...base, status: "LECH_TIEN", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] } }, phieuMo, now: NOW }).choKeToan).toBe(false);
    expect(dungPhieuPosView({ intent: { ...base, status: "DA_THU", bankTransaction: cho }, phieuMo, now: NOW }).choKeToan).toBe(false);
  });

  it("[POS1-UI-02c] mức độ hiển thị + kết quả gần nhất (nút Báo admin hỏi CÙNG hàm cổng máy chủ)", () => {
    expect(dungPhieuPosView({ intent: base, phieuMo, now: NOW }).mucDo).toBe("thong_tin");
    expect(dungPhieuPosView({ intent: { ...base, lastResultKind: "PROVIDER_ERROR" }, phieuMo, now: NOW }).mucDo).toBe("loi");
    expect(dungPhieuPosView({ intent: { ...base, status: "THAT_BAI" }, phieuMo, now: NOW }).mucDo).toBe("loi");
    const daThu = { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] };
    expect(dungPhieuPosView({ intent: { ...base, status: "DA_THU", bankTransaction: daThu }, phieuMo: null, now: NOW }).mucDo).toBe("thanh_cong");
    expect(dungPhieuPosView({ intent: { ...base, status: "LECH_TIEN" }, phieuMo: null, now: NOW }).mucDo).toBe("canh_bao");
    expect(dungPhieuPosView({ intent: { ...base, status: "DA_THU" }, phieuMo: null, now: NOW }).mucDo).toBe("canh_bao");
    const v = dungPhieuPosView({ intent: { ...base, lastResultKind: "NOT_FOUND" }, phieuMo, now: NOW });
    expect(v.ketQuaGanNhat).toBe("NOT_FOUND");
    expect(v.taoLuc).toBe("2026-10-06T16:00:00+07:00");
  });
});

describe("[POS1-VA-UI] rà đối kháng 06/10/2026 — hiển thị", () => {
  const NOW = new Date("2026-10-06T10:00:00Z");
  const CAU_DA_THU = "Đã thu 6.732.000đ lúc 17:31 — đã ghi nhận, chờ kế toán xác nhận.";
  const base = {
    id: "i1",
    code5: "K7M2N",
    amount: 6_732_000,
    status: "CHO_QUET" as PosIntentStatus,
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 3_600_000),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null as string | null,
    paymentBillId: "b1",
    posTerminal: null,
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr1" }] },
    coGiaoDichChoTay: false,
  };
  const phieuMo = { billId: "b1", tongTien: 6_732_000, dong: [{ paymentRequestId: "pr1", installmentNo: 1, ten: "Bé A", soTien: 6_732_000 }] };

  it("[POS1-VA-UI-01] trạng thái HIỂN THỊ khác trạng thái lưu ⇒ câu theo hiển thị, KHÔNG câu lưu cũ", () => {
    const go = dungPhieuPosView({
      intent: {
        ...base,
        status: "DA_THU",
        lastResultKind: "PAID",
        lastResultMessage: CAU_DA_THU,
        bankTransaction: { status: "UNMATCHED", allocations: [] },
        paymentBill: { status: "CLOSED", lines: [{ paymentRequestId: "pr1" }] },
      },
      phieuMo: null,
      now: NOW,
    });
    expect(go.hienThi).toBe("KE_TOAN_DA_GO");
    expect(go.thongDiep).not.toContain("đã ghi nhận");
    expect(go.thongDiep).toMatch(/Kế toán đã gỡ/);
    const dong = dungPhieuPosView({
      intent: {
        ...base,
        status: "THAT_BAI",
        lastResultMessage: "Giao dịch thất bại (mã THAT_BAI) — cho quẹt lại.",
        paymentBill: { status: "PAID", lines: [{ paymentRequestId: "pr1" }] },
      },
      phieuMo: null,
      now: NOW,
    });
    expect(dong.hienThi).toBe("PHIEU_DA_DONG");
    expect(dong.thongDiep).not.toMatch(/quẹt lại/);
    const het = dungPhieuPosView({
      intent: { ...base, lastResultMessage: "Chờ khách quẹt thẻ — quẹt xong bấm Kiểm tra thanh toán." },
      phieuMo,
      now: new Date(base.expiresAt.getTime() + 1),
    });
    expect(het.hienThi).toBe("HET_HAN");
    expect(het.thongDiep).toMatch(/hết hạn/);
    const ghi = dungPhieuPosView({
      intent: {
        ...base,
        status: "LECH_TIEN",
        lastResultMessage: "Máy đã thu 6.632.000đ, phiếu cần 6.732.000đ — đã chuyển kế toán xử lý. Đừng quẹt bù phần chênh.",
        bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] },
      },
      phieuMo: null,
      now: NOW,
    });
    expect(ghi.hienThi).toBe("KE_TOAN_DA_GHI");
    expect(ghi.thongDiep).toMatch(/Kế toán đã ghi nhận/);
    // Đối chứng: hiển thị TRÙNG trạng thái lưu ⇒ giữ câu lưu (câu của lượt kiểm thật).
    const daThu = dungPhieuPosView({
      intent: {
        ...base,
        status: "DA_THU",
        lastResultMessage: CAU_DA_THU,
        bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] },
      },
      phieuMo: null,
      now: NOW,
    });
    expect(daThu.thongDiep).toBe(CAU_DA_THU);
  });

  it("[POS1-VA-UI-02] T21 theo MÃ: còn giao dịch thẻ mang mã nằm hàng chờ ⇒ choKeToan, kể cả phiếu CHƯA nhận giao dịch", () => {
    for (const status of ["CAN_XU_LY", "CHO_QUET", "THAT_BAI"] as const) {
      expect(dungPhieuPosView({ intent: { ...base, status, coGiaoDichChoTay: true }, phieuMo, now: NOW }).choKeToan, status).toBe(true);
    }
    // Đối chứng: không giao dịch nào chờ tay ⇒ không chặn.
    expect(dungPhieuPosView({ intent: { ...base, status: "CAN_XU_LY" }, phieuMo, now: NOW }).choKeToan).toBe(false);
  });

  it("[POS1-VA-UI-03] DA_THU mà kết quả gần nhất là HỦY SAU GHI NHẬN ⇒ mức cảnh báo, không xanh", () => {
    const v = dungPhieuPosView({
      intent: {
        ...base,
        status: "DA_THU",
        lastResultKind: "CANCELLED_AFTER_PAID",
        bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr1" }] },
      },
      phieuMo: null,
      now: NOW,
    });
    expect(v.hienThi).toBe("DA_THU");
    expect(v.mucDo).toBe("canh_bao");
  });
});

describe("[POS1-UI-02d] chonPhieuPosHienThi — phiếu POS nào lên màn đơn", () => {
  // GĐ2 (docs/pos-gd2-thiet-ke.md §9.11): chữ ký thêm `now` + các trường `anKhoiManSale` đọc. Phiếu
  // ở đây TẠO NGAY lúc `now` (tuổi 0 ⇒ không bị ẩn) để khẳng định CŨ giữ nguyên; luật ẩn sau 30 phút
  // do `[POS2-HT-01/02]` canh.
  const p = (id: string, paymentBillId: string, status: PosIntentStatus) => ({
    id,
    paymentBillId,
    status,
    createdAt: TAO,
    lastResultKind: null,
    coGiaoDichChoTay: false,
  });

  it("ưu tiên phiếu MỚI NHẤT của phiếu gộp ĐANG MỞ (kể cả HET_HAN — ô dòng cần biết để mời tạo lại)", () => {
    const ds = [p("i3", "b2", "DA_THU"), p("i2", "b1", "HET_HAN"), p("i1", "b1", "HUY")];
    expect(chonPhieuPosHienThi(ds, "b1", TAO)?.id).toBe("i2");
  });

  it("không có phiếu gộp mở / không phiếu nào của nó ⇒ phiếu mới nhất KHÔNG phải HUY/HET_HAN", () => {
    const ds = [p("i3", "b2", "HUY"), p("i2", "b2", "HET_HAN"), p("i1", "b1", "DA_THU")];
    expect(chonPhieuPosHienThi(ds, null, TAO)?.id).toBe("i1");
    expect(chonPhieuPosHienThi(ds, "b9", TAO)?.id).toBe("i1");
    expect(chonPhieuPosHienThi([p("i1", "b1", "HUY")], null, TAO)).toBeNull();
    expect(chonPhieuPosHienThi([], "b1", TAO)).toBeNull();
  });
});

describe("[POS1-Q-09] lyDoKhongBaoAdmin — 'Báo admin' chỉ mở khi đủ BA vế (máy chủ hỏi lại, không tin nút)", () => {
  const du = { status: "CHO_QUET" as PosIntentStatus, lastResultKind: "NOT_FOUND" as const, createdAt: TAO };
  const sau10 = new Date(TAO.getTime() + BAO_ADMIN_SAU_MS);

  it("mở + lần kiểm gần nhất NOT_FOUND + đã ≥ 10 phút ⇒ cho báo (null)", () => {
    expect(lyDoKhongBaoAdmin(du, sau10)).toBeNull();
    expect(lyDoKhongBaoAdmin({ ...du, status: "THAT_BAI" }, sau10)).toBeNull();
  });

  it("thiếu vế nào ⇒ câu nói RÕ vế đó", () => {
    expect(lyDoKhongBaoAdmin(du, new Date(sau10.getTime() - 1))).toMatch(/10 phút/);
    expect(lyDoKhongBaoAdmin({ ...du, lastResultKind: "FAILED" }, sau10)).toMatch(/Chưa thấy giao dịch/);
    expect(lyDoKhongBaoAdmin({ ...du, lastResultKind: null }, sau10)).toMatch(/Kiểm tra thanh toán/);
    for (const s of ["DA_THU", "LECH_TIEN", "CAN_XU_LY", "HET_HAN", "HUY"] as const) {
      expect(lyDoKhongBaoAdmin({ ...du, status: s }, sau10), s).toMatch(/không còn chờ quẹt/);
    }
  });
});
