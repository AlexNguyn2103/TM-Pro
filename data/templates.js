// ============================================================
// PROJECT TEMPLATES (Pro feature)
// Each template defines sample tasks and roadmap milestones
// that get auto-created when a project is created from it.
// ============================================================

const TEMPLATES = {
  do_an_cntt: {
    id: 'do_an_cntt',
    name: '💻 Đồ án CNTT',
    description: 'Khung công việc cho đồ án môn học CNTT: phân tích, thiết kế, code, kiểm thử, báo cáo.',
    tasks: [
      { title: 'Phân tích yêu cầu đề tài', priority: 'high', days: 5 },
      { title: 'Thiết kế cơ sở dữ liệu', priority: 'high', days: 7 },
      { title: 'Thiết kế giao diện (UI/UX)', priority: 'medium', days: 7 },
      { title: 'Code chức năng chính (backend)', priority: 'urgent', days: 14 },
      { title: 'Code giao diện (frontend)', priority: 'high', days: 14 },
      { title: 'Kiểm thử & sửa lỗi', priority: 'medium', days: 5 },
      { title: 'Viết báo cáo đồ án', priority: 'medium', days: 5 },
      { title: 'Chuẩn bị slide thuyết trình', priority: 'low', days: 3 }
    ],
    roadmap: [
      { title: 'Phân tích & thiết kế', offsetStart: 0, durationDays: 10, color: '#004b87' },
      { title: 'Phát triển hệ thống', offsetStart: 10, durationDays: 20, color: '#ff00cc' },
      { title: 'Kiểm thử & hoàn thiện', offsetStart: 30, durationDays: 7, color: '#00ff88' },
      { title: 'Viết báo cáo & thuyết trình', offsetStart: 37, durationDays: 6, color: '#ffcc00' }
    ]
  },

  bao_cao_thuc_tap: {
    id: 'bao_cao_thuc_tap',
    name: '📋 Báo cáo thực tập',
    description: 'Lộ trình theo dõi quá trình thực tập doanh nghiệp và viết báo cáo tổng kết.',
    tasks: [
      { title: 'Tìm hiểu cơ cấu tổ chức doanh nghiệp', priority: 'medium', days: 5 },
      { title: 'Nhận nhiệm vụ thực tập từ đơn vị', priority: 'high', days: 3 },
      { title: 'Ghi chép nhật ký thực tập hàng tuần', priority: 'medium', days: 28 },
      { title: 'Thu thập số liệu / tài liệu thực tế', priority: 'medium', days: 10 },
      { title: 'Viết chương 1: Giới thiệu đơn vị thực tập', priority: 'medium', days: 4 },
      { title: 'Viết chương 2: Nội dung công việc thực tập', priority: 'high', days: 7 },
      { title: 'Viết chương 3: Nhận xét & kiến nghị', priority: 'medium', days: 4 },
      { title: 'Xin xác nhận & đánh giá của đơn vị thực tập', priority: 'urgent', days: 3 }
    ],
    roadmap: [
      { title: 'Tiếp nhận & làm quen môi trường', offsetStart: 0, durationDays: 7, color: '#004b87' },
      { title: 'Thực hiện công việc được giao', offsetStart: 7, durationDays: 21, color: '#ff00cc' },
      { title: 'Tổng hợp số liệu & viết báo cáo', offsetStart: 28, durationDays: 10, color: '#ffcc00' },
      { title: 'Hoàn thiện & xin xác nhận', offsetStart: 38, durationDays: 5, color: '#00ff88' }
    ]
  },

  khoa_luan: {
    id: 'khoa_luan',
    name: '🎓 Khóa luận tốt nghiệp',
    description: 'Lộ trình đầy đủ cho khóa luận/luận văn tốt nghiệp từ đề cương đến bảo vệ.',
    tasks: [
      { title: 'Xác định đề tài & đăng ký với giảng viên hướng dẫn', priority: 'urgent', days: 5 },
      { title: 'Viết đề cương chi tiết', priority: 'high', days: 10 },
      { title: 'Tổng quan tài liệu / cơ sở lý thuyết', priority: 'medium', days: 14 },
      { title: 'Phân tích & thiết kế hệ thống/giải pháp', priority: 'high', days: 14 },
      { title: 'Triển khai / thực nghiệm', priority: 'urgent', days: 30 },
      { title: 'Viết chương kết quả & đánh giá', priority: 'high', days: 10 },
      { title: 'Hoàn thiện toàn văn khóa luận', priority: 'high', days: 10 },
      { title: 'Chuẩn bị slide & phản biện thử', priority: 'medium', days: 5 },
      { title: 'Bảo vệ khóa luận', priority: 'urgent', days: 1 }
    ],
    roadmap: [
      { title: 'Đề cương & cơ sở lý thuyết', offsetStart: 0, durationDays: 24, color: '#004b87' },
      { title: 'Thiết kế & triển khai', offsetStart: 24, durationDays: 44, color: '#ff00cc' },
      { title: 'Viết & hoàn thiện khóa luận', offsetStart: 68, durationDays: 20, color: '#ffcc00' },
      { title: 'Bảo vệ tốt nghiệp', offsetStart: 88, durationDays: 6, color: '#00ff88' }
    ]
  }
};

function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({ id: t.id, name: t.name, description: t.description }));
}

function getTemplate(id) {
  return TEMPLATES[id] || null;
}

module.exports = { TEMPLATES, listTemplates, getTemplate };
