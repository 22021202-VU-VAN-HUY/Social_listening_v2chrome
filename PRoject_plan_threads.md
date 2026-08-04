# Kế hoạch thu thập Threads cho VinSmart Future

## Quyết định hiện tại

MVP dùng **Chrome Extension + Threads Web Search**, cùng mô hình vận hành với
Facebook. Người cài chỉ cần đăng nhập Threads trong Chrome và ghép extension với
backend; không cần vào Meta for Developers hay xin quyền
`threads_keyword_search`.

API chính thức của Meta được giữ như một phương án nâng cấp sau này nếu dự án có
Advanced Access phù hợp, nhưng không còn code/token/config API trong luồng hiện
tại.

## Mục tiêu MVP

1. Tìm bài công khai theo keyword, trước tiên là `VinSmart Future`.
2. Kiểm tra keyword tại máy trước khi gửi dữ liệu về API.
3. Mở bài phù hợp và lấy các reply/comment Threads đang hiển thị.
4. Chống trùng theo shortcode Threads.
5. Không lưu username, profile URL, cookie hoặc token đăng nhập.
6. Chỉ đọc/cuộn, tuyệt đối không Like, Reply, Follow hoặc đăng nội dung.
7. Báo `partial`/coverage trung thực khi UI không cho biết đã đọc hết.

## Flow triển khai

```text
Settings > Threads
  -> tạo crawl job waiting_extension
  -> extension nhận lease độc quyền
  -> mở một tab threads.com
  -> tìm từng keyword ở chế độ recent
  -> cuộn + trích xuất card + lọc keyword cục bộ
  -> mở từng post khớp
  -> cuộn reply đang hiển thị
  -> ingest batch vào API
  -> complete hoặc partial
  -> đóng tab do extension sở hữu
```

## Dữ liệu lưu

| Entity | Trường chính | Quy tắc |
|---|---|---|
| Source | `threads:public-keyword-search` | Một source hệ thống, không gắn tài khoản cá nhân. |
| Post | shortcode, body, thời gian, keyword hits | URL chuẩn `/t/{shortcode}/`, tác giả `unknown`. |
| Reply | shortcode, body, thời gian, thứ tự quan sát | MVP lưu cây phẳng nếu DOM không thể hiện parent ổn định. |
| Job | frozen keyword/time window, limits, progress | Một extension chỉ chạy một job web tại một thời điểm. |

## Những cách lấy dữ liệu và vai trò

| Cách | Setup | Bài theo keyword | Reply có keyword | Vai trò |
|---|---:|---:|---:|---|
| Extension + Threads Web | Thấp | Có, phụ thuộc UI/ranking | Có trong conversation đã mở | MVP hiện tại |
| Threads API chính thức | Cao, cần App Review | Tốt khi được cấp quyền | Tùy scope API | Nâng cấp production |
| Vendor social listening | Trung bình/cao | Tùy hợp đồng | Phải demo coverage | Fallback thương mại |
| Ghi nhận thủ công | Thấp | Có | Có | Đối chiếu kết quả |

Không phương án nào trong MVP được mô tả là “toàn bộ Threads”. Native Search có
ranking, phân trang ẩn và thay đổi DOM nên coverage luôn phải được ghi nhận.

## Giới hạn kỹ thuật ban đầu

- `maxScrollRounds`: 20 cho mỗi trang tìm kiếm.
- `maxCommentExpandRounds`: 30 cho mỗi trang bài.
- `maxPostsPerSource` và `maxCommentsPerPost` lấy từ Settings.
- Không click nút mở rộng mang tính tương tác; chỉ cuộn và đọc phần đã render.
- Tìm kiếm `recent` bằng URL Threads, sau đó vẫn match keyword cục bộ để loại kết
  quả không liên quan.
- Bài có thời gian rõ ràng ngoài frozen window bị bỏ qua; thời gian không đọc được
  được ghi `unknown` thay vì đoán.

## Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Threads đổi DOM | Adapter riêng, fixture test, fail closed. |
| Bị yêu cầu đăng nhập/xác minh | Dừng `needs_login`, người dùng xử lý thủ công. |
| Search thiếu kết quả | Hiển thị coverage `partial/unknown`, không tuyên bố đầy đủ. |
| Lộ danh tính | Chuẩn hóa URL bỏ handle; schema cấm username/profile URL. |
| Hai job tranh tab | Lease + fencing token + unique active-job index. |
| Hành vi ngoài ý muốn | Runner không click Like/Reply/Follow và chỉ đóng tab chính nó tạo. |

## Tiêu chí hoàn tất MVP

- [x] Manifest cho phép `threads.com` và `threads.net`.
- [x] Adapter nhận diện auth, post card, body, time và reply card.
- [x] Search URL recent và match keyword cục bộ.
- [x] Job Threads được claim qua extension, không qua worker/API token.
- [x] Ingest chấp nhận platform Threads và URL không chứa username.
- [x] Xóa connector/config/token Threads API khỏi worker.
- [x] Settings có tab Threads chạy được.
- [x] Unit test URL/DOM/privacy.
- [ ] Smoke test live sau khi reload extension 0.2.0.

Hướng dẫn vận hành: [`docs/THREADS_SETUP.md`](docs/THREADS_SETUP.md).
