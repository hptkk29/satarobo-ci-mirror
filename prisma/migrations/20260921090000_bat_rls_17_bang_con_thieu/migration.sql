-- BẬT RLS cho 17 bảng ra đời với RLS TẮT. Additive thuần, 0 policy.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VÌ SAO CÓ TỆP NÀY — ĐO ĐƯỢC, KHÔNG PHẢI PHÒNG XA
--
-- Migration `20260617…` bật RLS hàng loạt chỉ chạy **MỘT LẦN**. Mọi bảng sinh sau nó
-- phải **tự bật**, và đó là luật trong `.claude/rules/prisma-db.md`:
--
--   *"Bảng MỚI phải tự bật RLS: `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` ở cuối
--   file. Chỉ ENABLE, không FORCE, không policy."*
--
-- Quét lượt gộp `test` → `main` (21/09/2026): **19 migration tạo 25 bảng, trong đó 17
-- bảng KHÔNG có dòng ENABLE**. Nếu merge nguyên thì 17 bảng ấy ra đời trên prod với
-- RLS TẮT — đúng lớp sự cố **09/08/2026**, khi 31 bảng sinh sau `20260617` nằm trần
-- cho `anon`/`authenticated` (hai vai ấy có sẵn đủ DML qua PostgREST của Supabase).
--
-- Trong 17 bảng có `CenterCommissionAssignee` (ai hưởng hoa hồng của cơ sở) và cả bộ
-- `TrnExam*` (đề thi + bài làm + đáp án của đào tạo nội bộ). Không phải bảng vô hại.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VÌ SAO LÀ MỘT TỆP RIÊNG, ĐẶT CUỐI HÀNG
--
-- Chủ dự án chốt 21/09: *"migration riêng để nếu nó lỗi thì không kéo 19 cái kia
-- theo."* Nhét `ENABLE` vào từng tệp cũ thì một lỗi ở đây làm hỏng chính lượt tạo
-- bảng; tách ra thì 19 tệp kia đã xong xuôi trước khi tệp này chạy.
--
-- Dấu thời gian `20260921090000` LỚN HƠN mọi migration đang có (cuối cùng là
-- `20260920120000_payment_bill_ma_seq`), nên nó luôn chạy SAU — kể cả khi thứ tự áp
-- dụng trên prod khác trên test.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- `IF EXISTS`? KHÔNG — và đây là chủ đích
--
-- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` không có `IF EXISTS`, và ta KHÔNG bọc nó
-- trong `DO$$` bỏ lỗi. Bảng nào thiếu thì tệp này PHẢI nổ: một lệnh bảo mật im lặng
-- thất bại là thứ tệ hơn không có lệnh. Cả 17 bảng đều do chính lượt gộp này tạo, nên
-- tới lúc tệp này chạy thì chúng chắc chắn đã tồn tại.
--
-- ⚠️ CHỈ `ENABLE`, KHÔNG `FORCE`, KHÔNG policy — đúng khuôn các bảng tiền đã làm
-- (xem `20260916120000_payment_request_theo_con`). `ENABLE` chặn `anon`/`authenticated`
-- đi qua PostgREST; đường ứng dụng dùng service role nên KHÔNG bị ảnh hưởng.
-- `FORCE` thì chặn cả chủ bảng và sẽ làm chính ứng dụng chết — đừng thêm.
-- ─────────────────────────────────────────────────────────────────────────────

-- el13 — cờ theo dõi đào tạo nội bộ
ALTER TABLE "TrnWatchFlag" ENABLE ROW LEVEL SECURITY;

-- el14 — ngân hàng đề thi đào tạo nội bộ (đề · câu hỏi · lựa chọn · bài làm · đáp án)
ALTER TABLE "TrnQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnChoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnExam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnExamQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnExamAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnExamAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnExamUnlock" ENABLE ROW LEVEL SECURITY;

-- el15 — rubric chấm + bài nộp
ALTER TABLE "TrnRubric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnRubricCriterion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrnRubricScore" ENABLE ROW LEVEL SECURITY;

-- c01 — chỉ tiêu lead
ALTER TABLE "LeadTarget" ENABLE ROW LEVEL SECURITY;

-- g04 — tuỳ chọn bảng của từng người dùng
ALTER TABLE "UserTablePreference" ENABLE ROW LEVEL SECURITY;

-- d02 — chỉ tiêu ngân sách quảng cáo
ALTER TABLE "AdsBudgetTarget" ENABLE ROW LEVEL SECURITY;

-- hoa_hong_qc_qltt — AI HƯỞNG HOA HỒNG của cơ sở. Bảng nhạy cảm nhất trong danh sách.
ALTER TABLE "CenterCommissionAssignee" ENABLE ROW LEVEL SECURITY;

-- tran_chi_phi_goi_ra — bộ đếm trần chi phí gọi ra
ALTER TABLE "OutboundSpendCounter" ENABLE ROW LEVEL SECURITY;
