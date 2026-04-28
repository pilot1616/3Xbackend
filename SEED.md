# Seed 脚本说明

## 入口

种子脚本入口：

- [cmd/seed/main.go](/Users/zhangxinghui/Desktop/web/3Xbackend/cmd/seed/main.go)
- [internal/seed/seed.go](/Users/zhangxinghui/Desktop/web/3Xbackend/internal/seed/seed.go)

## 作用

这个脚本会自动完成以下事情：

- 创建演示账号
- 复制头像到 `public/images`
- 复制帖子演示图片到 `public/uploads`
- 批量生成帖子、评论、点赞、附件记录
- 自动回填帖子点赞数和评论数

脚本支持重复执行。

重复执行时：

- 已存在的用户会更新资料和头像路径
- 已存在的帖子会更新正文和状态
- 不会为同一条种子记录重复插入相同的评论、点赞、附件记录

## 默认数据规模

默认参数是千级数据：

- 用户：`80`
- 帖子：`1200`
- 每帖评论：`2-6`
- 每帖点赞：`4-10`
- 每帖附件：`1-3`

## 默认账号信息

- 登录密码：`Forum123`
- 密保答案：`1999`

手机号账号从 `13900000001` 开始连续生成。

## 执行方式

推荐直接使用任务命令：

```bash
task seed
```

如果 MySQL 运行在 Docker：

```bash
task seed:docker
```

也可以直接运行 Go 命令：

```bash
go run ./cmd/seed
```

## 可调参数

脚本支持命令行参数：

```bash
go run ./cmd/seed \
  -users 120 \
  -questions 2000 \
  -min-comments 3 \
  -max-comments 8 \
  -min-likes 5 \
  -max-likes 12 \
  -max-assets 4
```

参数说明：

- `-users`: 生成用户数
- `-questions`: 生成帖子数
- `-min-comments`: 每帖最少评论数
- `-max-comments`: 每帖最多评论数
- `-min-likes`: 每帖最少点赞数
- `-max-likes`: 每帖最多点赞数
- `-max-assets`: 每帖最多附件数

## 资源来源

帖子图片和头像会优先复用以下目录里的本地资源：

- [front/public/legacy/res/img](/Users/zhangxinghui/Desktop/web/3Xbackend/front/public/legacy/res/img)
- [public/uploads/pixabay](/Users/zhangxinghui/Desktop/web/3Xbackend/public/uploads/pixabay)

执行时会把资源复制到运行目录：

- [public/images](/Users/zhangxinghui/Desktop/web/3Xbackend/public/images)
- [public/uploads](/Users/zhangxinghui/Desktop/web/3Xbackend/public/uploads)

## 输出说明

脚本执行完成后会打印：

- 本次新增用户数
- 本次新增帖子数
- 本次新增评论数
- 本次新增点赞数
- 本次新增附件数
- 当前数据库里的总用户/帖子/评论/点赞/附件数量

## 建议

如果你只是想快速把本地页面铺满数据，直接用默认参数即可。

如果你要做分页、压力测试或长列表调试，建议把 `-questions` 调到 `2000` 或更高，然后再按需增大评论和点赞范围。
