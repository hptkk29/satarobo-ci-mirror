// @vitest-environment node
/**
 * EL-10 — bucket R2 riêng cho media đào tạo.
 *
 * Toàn bộ tệp này canh MỘT thứ: không có đường nào rơi về bucket công khai. Với
 * ảnh marketing thì phát công khai là tính năng; với video đào tạo nội bộ (thẻ
 * bảo mật tới `CONFIDENTIAL`) thì đó là rò rỉ VĨNH VIỄN — tệp đã ra khỏi hệ
 * thống thì không thu về được.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getElearningBucket,
  isElearningBucketConfigured,
  ElearningStorageConfigError,
} from "@/lib/storage/elearning-storage";

const CU = { ...process.env };

beforeEach(() => {
  delete process.env.R2_ELEARNING_BUCKET_NAME;
  delete process.env.R2_BUCKET_NAME;
  delete process.env.R2_CHAT_BUCKET_NAME;
});
afterEach(() => {
  process.env = { ...CU };
});

describe("fail CLOSED — không có nhánh dự phòng nào", () => {
  it("chưa đặt env ⇒ THROW, không trả bucket mặc định", () => {
    // Một đường dự phòng "tạm dùng bucket công khai" sẽ chạy đúng trong lúc thử
    // và rò rỉ trên prod.
    expect(() => getElearningBucket()).toThrow(ElearningStorageConfigError);
  });

  it("env chỉ có khoảng trắng cũng tính là chưa đặt", () => {
    process.env.R2_ELEARNING_BUCKET_NAME = "   ";
    expect(() => getElearningBucket()).toThrow(ElearningStorageConfigError);
  });

  it("thông báo lỗi nói RÕ vì sao không được dùng tạm bucket chung", () => {
    // Người đọc lỗi này đang vội và sẽ tìm cách nhanh nhất để qua. Nếu thông báo
    // không nói vì sao, cách nhanh nhất chính là trỏ vào bucket công khai.
    try {
      getElearningBucket();
    } catch (e) {
      expect((e as Error).message).toContain("R2_BUCKET_NAME");
      expect((e as Error).message).toContain("công khai");
    }
  });
});

describe("chặn ngay tại cấu hình, không đợi lúc chạy", () => {
  it("trỏ đúng vào bucket CÔNG KHAI ⇒ THROW", () => {
    process.env.R2_BUCKET_NAME = "satarobo-public";
    process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-public";
    expect(() => getElearningBucket()).toThrow(ElearningStorageConfigError);
  });

  it("trùng bucket CHAT cũng THROW", () => {
    // Hai module có luật giữ/xoá khác nhau; dùng chung thì luật vòng đời của bên
    // này âm thầm áp lên tệp của bên kia.
    process.env.R2_CHAT_BUCKET_NAME = "satarobo-chat";
    process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-chat";
    expect(() => getElearningBucket()).toThrow(ElearningStorageConfigError);
  });

  it("bucket riêng, khác cả hai ⇒ trả về bình thường", () => {
    process.env.R2_BUCKET_NAME = "satarobo-public";
    process.env.R2_CHAT_BUCKET_NAME = "satarobo-chat";
    process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-elearning";
    expect(getElearningBucket()).toBe("satarobo-elearning");
  });

  it("bucket công khai CHƯA đặt thì không chặn nhầm", () => {
    // Ở môi trường chỉ dựng riêng e-learning, thiếu `R2_BUCKET_NAME` là bình
    // thường — không được biến nó thành lỗi cấu hình.
    process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-elearning";
    expect(getElearningBucket()).toBe("satarobo-elearning");
  });
});

describe("`isElearningBucketConfigured` đòi ĐỦ cả bốn env", () => {
  const dat = () => {
    process.env.R2_ELEARNING_BUCKET_NAME = "satarobo-elearning";
    process.env.R2_ACCOUNT_ID = "acc";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
  };

  it("đủ bốn ⇒ true", () => {
    dat();
    expect(isElearningBucketConfigured()).toBe(true);
  });

  it("thiếu bất kỳ credential nào ⇒ false", () => {
    for (const bo of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      dat();
      delete process.env[bo];
      expect(isElearningBucketConfigured(), bo).toBe(false);
    }
  });

  it("KHÔNG ném lỗi khi thiếu — đây là hàm để HỎI, không phải để chặn", () => {
    expect(() => isElearningBucketConfigured()).not.toThrow();
    expect(isElearningBucketConfigured()).toBe(false);
  });
});
