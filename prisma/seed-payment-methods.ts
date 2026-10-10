import { PrismaClient, PaymentMethodType } from "@prisma/client";

// ⚠️ 30/08/2026 — bốn dòng dưới đây là phương thức DÙNG CHUNG (`centerId` để null): cơ
// sở nào cũng chọn được. Cố ý KHÔNG set centerId ở seed gốc, và cố ý KHÔNG đụng tới
// `centerId` trong nhánh `update`: người vận hành có thể đã gắn một dòng vào một cơ sở
// qua màn /payment-methods, và seed chạy lại mà ghi đè null là âm thầm mở phương thức
// riêng của cơ sở đó ra cho mọi cơ sở.
// Phương thức RIÊNG của cơ sở khai bằng tay ở màn quản trị (hoặc seed UAT), với mã có
// hậu tố cơ sở — `code` là @unique TOÀN CỤC nên hai cơ sở không dùng chung một mã.
const PAYMENT_METHODS = [
  {
    code: "CASH",
    name: "Tiền mặt",
    type: PaymentMethodType.CASH,
    description: "Thanh toán trực tiếp tại trung tâm",
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: true,
    canDeposit: false,
    displayOrder: 1,
    isActive: true,
  },
  {
    code: "BANK_TRANSFER",
    name: "Chuyển khoản ngân hàng",
    type: PaymentMethodType.BANK_TRANSFER,
    description:
      "Chuyển khoản đến tài khoản công ty, admin xác nhận thủ công",
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: true,
    canDeposit: false,
    displayOrder: 2,
    isActive: true,
  },
  {
    code: "VNPAY",
    name: "VNPAY",
    type: PaymentMethodType.VNPAY,
    description: "Cổng thanh toán VNPAY (chưa kích hoạt)",
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: false,
    canDeposit: false,
    displayOrder: 3,
    isActive: false, // disable đến khi integrate xong Sprint 5.6.5
  },
  {
    code: "TINGEE",
    name: "Tingee",
    type: PaymentMethodType.TINGEE,
    description: "Cổng thanh toán Tingee (chưa kích hoạt)",
    canBuyCourse: true,
    canBuyPackage: true,
    canBuyExam: true,
    canBuyProduct: false,
    canDeposit: false,
    displayOrder: 4,
    isActive: false, // disable đến khi integrate xong Sprint 5.6.5
  },
];

export async function seedPaymentMethods(prisma: PrismaClient) {
  for (const pm of PAYMENT_METHODS) {
    await prisma.paymentMethod.upsert({
      where: { code: pm.code },
      create: pm,
      update: {
        // Idempotent: refresh display fields; KHÔNG override isActive vì admin
        // có thể đã enable/disable thủ công qua UI.
        name: pm.name,
        type: pm.type,
        description: pm.description,
        canBuyCourse: pm.canBuyCourse,
        canBuyPackage: pm.canBuyPackage,
        canBuyExam: pm.canBuyExam,
        canBuyProduct: pm.canBuyProduct,
        canDeposit: pm.canDeposit,
        displayOrder: pm.displayOrder,
      },
    });
  }
  console.log(`Seeded ${PAYMENT_METHODS.length} payment methods`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedPaymentMethods(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
