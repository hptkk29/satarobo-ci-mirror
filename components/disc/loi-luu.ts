/** Dịch phản hồi lỗi của POST /api/disc/luu ra câu tiếng Việt cho người dùng — thuần. Không bao giờ lộ chi tiết kỹ thuật. */
import type { KetQuaGoi } from "./api-client";

export type LoiLuuHienThi = {
  thongBao: string;
  /** Lỗi gắn với ô cụ thể (soDienThoai | email | thanhPho | phuong). */
  truong: Partial<Record<"soDienThoai" | "email" | "thanhPho" | "phuong", string>>;
  /** Hành động hợp lý tiếp theo. */
  cachSua: "THU_LAI" | "SUA_HO_SO" | "SUA_O" | "SUA_BAI";
  /** Với cachSua = SUA_BAI: bài của ai cần làm lại (suy từ đường dẫn lỗi `bai.phuHuynh…` / `bai.hocSinh…`). */
  baiCanSua?: "phuHuynh" | "hocSinh";
};

export function loiLuuHienThi(r: Exclude<KetQuaGoi, { ok: true }>): LoiLuuHienThi {
  switch (r.loi) {
    case "MANG":
      return {
        thongBao: "Chưa kết nối được tới máy chủ nên kết quả CHƯA được lưu. Bài làm vẫn còn trên thiết bị này, bạn bấm “Thử lại” khi có mạng.",
        truong: {},
        cachSua: "THU_LAI",
      };
    case "QUA_NHIEU_LAN":
      return { thongBao: "Bạn thử quá nhiều lần trong thời gian ngắn nên kết quả CHƯA được lưu. Vui lòng đợi một lúc rồi bấm “Thử lại”.", truong: {}, cachSua: "THU_LAI" };
    case "ENGINE_CHUA_SAN_SANG":
      return {
        thongBao: "Hệ thống chấm bài chưa sẵn sàng nên kết quả CHƯA được lưu. Đây không phải lỗi của bạn. Bài làm vẫn còn trên thiết bị này, bạn bấm “Thử lại” sau ít phút.",
        truong: {},
        cachSua: "THU_LAI",
      };
    case "THIEU_HO_SO":
      return {
        thongBao: "Hồ sơ gia đình còn thiếu thông tin nên kết quả CHƯA được lưu. Vui lòng quay lại bước “Nhà mình” để bổ sung.",
        truong: {},
        cachSua: "SUA_HO_SO",
      };
    case "DU_LIEU_KHONG_HOP_LE": {
      const truong: LoiLuuHienThi["truong"] = {};
      for (const c of r.chiTiet ?? []) {
        if (c.truong === "soDienThoai" || c.truong === "email") truong[c.truong] = c.thongBao;
        else if (c.truong === "diaChi.thanhPho") truong.thanhPho = c.thongBao;
        else if (c.truong === "diaChi.phuong") truong.phuong = c.thongBao;
      }
      // Lỗi nằm ở CÂU TRẢ LỜI (vd hàng rào "trả lời phẳng"): câu của máy chủ đã nói đúng việc cần làm, và việc đó không phải
      // "sửa hồ sơ/số điện thoại" — đưa người dùng về đúng bài thay vì bảo họ kiểm tra lại thông tin.
      const loiBai = (r.chiTiet ?? []).find((c) => c.truong.startsWith("bai."));
      if (loiBai) {
        return {
          thongBao: `Kết quả CHƯA được lưu. ${loiBai.thongBao}`,
          truong,
          cachSua: "SUA_BAI",
          baiCanSua: loiBai.truong.startsWith("bai.phuHuynh") ? "phuHuynh" : "hocSinh",
        };
      }
      const coOCuThe = Object.keys(truong).length > 0;
      return {
        thongBao: coOCuThe ? "Kết quả CHƯA được lưu. Vui lòng sửa các ô được đánh dấu rồi bấm lại." : "Kết quả CHƯA được lưu vì thông tin chưa hợp lệ. Vui lòng kiểm tra lại hồ sơ và số điện thoại.",
        truong,
        cachSua: coOCuThe ? "SUA_O" : "SUA_HO_SO",
      };
    }
    case "LUU_THAT_BAI":
    default:
      return { thongBao: "Chưa lưu được kết quả — đây là lỗi phía chúng tôi, không phải do bạn. Bài làm vẫn còn trên thiết bị này, bạn bấm “Thử lại” sau ít phút.", truong: {}, cachSua: "THU_LAI" };
  }
}
