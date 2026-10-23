-- P2.4 — DANH SÁCH IP khi chấm công (11/10/2026). Additive: MỘT cột trống được trên `StaffTimeLog`.
--
-- `ipRule` = kết quả kiểm IP của lượt: mục danh sách đã khớp ("203.0.113.0/24"), hoặc NGOAI_DS · CHUA_KHAI ·
-- KHONG_XAC_DINH_IP · MIEN:<lý do>. NULL = chế độ OFF (không kiểm). Chế độ OBSERVE ghi cột này mà không chặn —
-- đó là dữ liệu để quyết có siết (ENFORCE) hay không. Danh sách IP dùng cột CÓ SẴN `WorkLocation.ipAllowlist`.
-- Chạy lại được (luật [MIG-01]).

ALTER TABLE "StaffTimeLog" ADD COLUMN IF NOT EXISTS "ipRule" TEXT;
