# Firestore Security Specification (`My Photos`)

## 1. Data Invariants
1. Every document under `/users/{userId}/photos/{photoId}` and `/users/{userId}/albums/{albumId}` MUST have `user_id == userId` and `userId == request.auth.uid` with `request.auth.token.email_verified == true`.
2. Path IDs (`userId`, `photoId`, `albumId`) MUST match `^[a-zA-Z0-9_\-]+$` and be at most 128 characters.
3. On `create`, `createdAt` and `updatedAt` (for Photos) MUST equal `request.time`; on `update`, `createdAt`, `user_id`, `file_name`, `file_type`, `file_url`, and `file_size` are immutable, and `updatedAt` MUST equal `request.time`.
4. Only `is_favorite` and `album` (along with `updatedAt`) may change via action-scoped `update` rules.
5. All string fields enforce strict `.size()` upper bounds and no ghost/shadow fields are permitted (`hasOnly`).

## 2. Dirty Dozen Adversarial Payloads
1. **Cross-user read/list**: User B tries to read or list `/users/{userA}/photos`. Expected: `PERMISSION_DENIED`.
2. **Unverified email write**: Authenticated user with `email_verified: false` tries to create a photo. Expected: `PERMISSION_DENIED`.
3. **UID spoofing on create**: User A creates `/users/{userA}/photos/p1` with `user_id: "{userB}"`. Expected: `PERMISSION_DENIED`.
4. **Ghost/shadow field injection**: User A creates a photo with extra field `isAdmin: true`. Expected: `PERMISSION_DENIED`.
5. **Client timestamp forgery on create**: User A sends `createdAt: Timestamp(2020-01-01)`. Expected: `PERMISSION_DENIED`.
6. **Immutable field tampering on update**: User A updates `file_size: 0` or `file_url: "https://evil.test"` on an existing photo. Expected: `PERMISSION_DENIED`.
7. **Oversized string poisoning**: User A submits a 50KB `file_name` or 2KB `photoId`. Expected: `PERMISSION_DENIED`.
8. **Invalid type on favorite toggle**: User A updates `is_favorite: "yes"` instead of boolean. Expected: `PERMISSION_DENIED`.
9. **Negative or NaN file size**: User A creates a photo with `file_size: -500`. Expected: `PERMISSION_DENIED`.
10. **Invalid album name on Album create**: User A creates `/users/{userA}/albums/a1` with empty `name: ""`. Expected: `PERMISSION_DENIED`.
11. **Missing required key**: User A creates a photo omitting `file_url`. Expected: `PERMISSION_DENIED`.
12. **Unmatched collection access**: User A tries to read/write `/admin/config` or `/photos/p1`. Expected: `PERMISSION_DENIED`.
