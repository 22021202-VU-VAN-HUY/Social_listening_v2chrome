# Chính sách Facebook read-only

Extension của `listening_socialmediav2` là một data-collection agent chỉ đọc.
Nó không phải bot tương tác và không được tạo nội dung trên Facebook.

## Dữ liệu được đọc

- danh sách group mà tài khoản hiện tại đã tham gia và có quyền xem;
- metadata bài post khớp keyword:
  - group/source;
  - external ID và permalink bài;
  - nội dung bài;
  - tên hiển thị hoặc trạng thái ẩn danh của tác giả;
  - thời gian đăng;
  - thời gian extension thu thập;
  - trạng thái parse thời gian;
  - toàn bộ keyword đã khớp;
- comment và reply của bài khớp:
  - external ID, permalink nếu có và quan hệ comment cha;
  - nội dung;
  - tên hiển thị hoặc trạng thái ẩn danh;
  - thời gian comment;
  - thời gian extension thu thập;
  - trạng thái parse thời gian.

Post được lưu chỉ để làm metadata/ngữ cảnh cha. Comment/reply mới là dữ liệu
listening được đưa vào sentiment `positive | negative | neutral`.

## Thao tác UI được phép

Extension chỉ được điều hướng, scroll và click đúng allowlist các nút chỉ-đọc:

- xem/hiển thị thêm nội dung;
- tất cả bình luận;
- mở bộ lọc `Phù hợp nhất/Most relevant` để chọn `Tất cả bình luận/All comments`;
- xem thêm bình luận;
- xem bình luận trước;
- xem thêm reply/phản hồi.

Các biến thể số lượng như `View 12 more replies` hoặc `Xem thêm 12 phản hồi`
được phép bằng regex neo toàn chuỗi. Allowlist dùng phép so khớp nhãn chính xác
sau normalize; một nút không khớp toàn bộ allowlist phải bị bỏ qua.

## Thao tác bị cấm

- nhập hoặc dán text vào input, textarea hay `contenteditable`;
- bấm Like/Thích, reaction, Share/Chia sẻ;
- bấm Comment/Bình luận để mở composer;
- bấm Post/Đăng, Submit, Send/Gửi;
- gọi `form.submit()`, `form.requestSubmit()` hoặc API tạo nội dung;
- chỉnh sửa hoặc xóa bài/comment;
- upload file;
- tự động theo dõi profile, lưu profile URL, username/handle hoặc platform user
  ID.

Login, 2FA, checkpoint và CAPTCHA chỉ được phát hiện. Extension phải dừng job và
cleanup tab; không được bypass.

## Kiểm soát kỹ thuật

1. Mọi click đi qua một hàm allowlist read-only duy nhất.
2. DOM adapter chỉ đọc thuộc tính/text; DTO là closed shape.
3. Test fixture kiểm tra post metadata, comment/reply, thời gian, nhiều keyword,
   tác giả thật và ẩn danh.
4. Test safety kiểm tra các control ghi nội dung không bao giờ được click.
5. Runtime privacy guard chặn identity-tracking fields trước khi gửi batch.
6. Backend chỉ queue sentiment cho `entity_type = 'comment'`; worker cũng chỉ
   claim queue item loại `comment`.
7. Nếu không có marker DOM rõ ràng chứng minh đã tới cuối danh sách, coverage là
   `unknown/partial`, không được báo sai là đã lấy toàn bộ.
