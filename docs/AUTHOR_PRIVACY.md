# Quy tắc dữ liệu tác giả

Hệ thống chỉ dùng thông tin tác giả để phân biệt hai trường hợp hiển thị:

- người đăng/bình luận ẩn danh;
- người dùng thật với tên hiển thị tại thời điểm crawl.

## Trường được phép

```json
{
  "authorName": "Nguyễn Văn A",
  "isAnonymous": false,
  "authorKind": "real"
}
```

Với nội dung ẩn danh:

```json
{
  "authorName": null,
  "isAnonymous": true,
  "authorKind": "anonymous"
}
```

`authorKind` chỉ nhận `real`, `anonymous` hoặc `unknown`.

## Trường bị cấm

Không được thu thập, truyền, lưu hoặc render thành link:

- URL profile;
- Facebook user ID hoặc scoped ID;
- username/handle dùng để truy vết;
- avatar URL;
- URL chứa đường dẫn đến trang cá nhân;
- cookie, access token hoặc session Facebook.

Content script chỉ đọc phần text của tên. Nếu tên nằm trong thẻ `<a>`, code chỉ
lấy `textContent`; thuộc tính `href` không được đưa vào DTO.

API dùng schema strict và privacy guard để từ chối payload có khóa nhạy cảm, kể
cả khi khóa nằm sâu trong object. Database không có cột profile URL/user ID.

## Nhận diện ẩn danh

Adapter nhận diện các nhãn hiển thị phổ biến bằng so khớp đã normalize, sau đó
lưu `authorName = null` và để UI hiển thị nhãn “Ẩn danh”:

- `Thành viên ẩn danh`;
- `Người tham gia ẩn danh`;
- `Người dùng ẩn danh`;
- `Anonymous member`;
- `Anonymous participant`;
- `Anonymous user`.

Khi giao diện thay đổi và không xác định chắc chắn, dùng:

```json
{
  "authorName": null,
  "isAnonymous": false,
  "authorKind": "unknown"
}
```

UI hiển thị trường hợp này là “Không xác định”, không được gộp thành “Ẩn danh” và
không suy luận danh tính từ permalink, ảnh, DOM ID hoặc request mạng.

## Tiêu chí kiểm thử

1. Post thật chỉ trả tên hiển thị, không có profile URL.
2. Post ẩn danh trả `isAnonymous = true`.
3. Comment và reply áp dụng cùng quy tắc.
4. Payload chứa `profileUrl`, `authorId`, `userId`, `username`, `handle` hoặc
   khóa tương đương bị API từ chối.
5. UI hiển thị tên bằng text, không bọc trong link.
6. Log không chứa trường bị cấm.
