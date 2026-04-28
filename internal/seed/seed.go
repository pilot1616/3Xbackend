package seed

import (
	"3Xbackend/internal/config"
	"3Xbackend/internal/database"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	seedPassword        = "Forum123"
	seedSecurityAnswer  = "1999"
	seedQuestionBaseQID = int64(2026042800000)
)

type Options struct {
	UserCount          int
	QuestionCount      int
	MinCommentsPerPost int
	MaxCommentsPerPost int
	MinLikesPerPost    int
	MaxLikesPerPost    int
	MaxAssetsPerPost   int
}

func DefaultOptions() Options {
	return Options{
		UserCount:          80,
		QuestionCount:      1200,
		MinCommentsPerPost: 2,
		MaxCommentsPerPost: 6,
		MinLikesPerPost:    4,
		MaxLikesPerPost:    10,
		MaxAssetsPerPost:   3,
	}
}

type Summary struct {
	Users          int
	Questions      int
	Comments       int
	Likes          int
	QuestionFiles  int
	CopiedAvatars  int
	CopiedUploads  int
	PreparedAssets int
}

type userSeed struct {
	Username string
	Nickname string
	Age      int
	Hobby    string
	Sign     string
	Question string
	Avatar   string
}

type assetRef struct {
	DiskName  string
	Source    string
	PublicRef string
}

type questionSeed struct {
	QID        int64
	Owner      string
	Text       string
	IsUpload   bool
	AssetNames []string
	Comments   []commentSeed
	LikeUsers  []string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type commentSeed struct {
	Username  string
	Text      string
	CreatedAt time.Time
}

var hobbyPool = []string{
	"摄影、旅行、徒步",
	"骑行、露营、手冲咖啡",
	"羽毛球、电影、城市漫步",
	"编程、桌游、轻阅读",
	"健身、做饭、拍短视频",
	"看展、写作、整理收纳",
}

var signPool = []string{
	"记录值得分享的瞬间。",
	"今天也在认真生活。",
	"喜欢把问题聊明白。",
	"一边折腾一边进步。",
	"热爱真实、有温度的表达。",
	"分享经验，也分享踩坑。",
}

var securityQuestionPool = []string{"year", "person", "book"}

var questionTopicPool = []string{
	"最近在整理自己的工作流，想看看大家有没有更顺手的笔记和任务管理方法？",
	"周末想去周边短途走走，大家有没有适合一个人放空半天的路线推荐？",
	"入门摄影后发现后期比拍照更费时间，有没有适合新手的轻量流程？",
	"想给工位重新布置一下，求一些真正提升效率而不是纯装饰的桌面搭配建议。",
	"最近看了不少关于习惯养成的内容，想问大家坚持一件小事最有效的办法是什么？",
	"有没有人长期使用机械键盘办公，实际体验到底是提升效率还是增加噪音？",
	"最近在练晨跑，但总是三天打鱼两天晒网，想听听大家如何稳定坚持。",
	"在做论坛类产品时，大家觉得首页应该优先展示最新内容还是高互动内容？",
	"我发现图片内容一多，列表页特别容易乱，大家通常怎么平衡信息量和整洁度？",
	"最近在学做饭，想整理一个适合上班族的快手晚餐清单，有没有推荐？",
	"大家平时会把评论区做成长讨论区，还是尽量把深度互动收敛到详情页？",
	"如果相册页想兼顾浏览体验和加载速度，图片尺寸和裁切策略一般怎么定？",
}

var commentTopicPool = []string{
	"这个问题我也踩过，后来是靠拆小步骤才慢慢稳定下来的。",
	"我建议先从最容易执行的一步开始，不然计划很容易变成压力。",
	"如果是我，会先看有没有现成模板或者成熟方案，再决定自己搭。",
	"可以把结果和过程分开看，很多时候不是方法错了，而是节奏不合适。",
	"这个点很真实，尤其是做久了以后，维护成本经常比实现成本更高。",
	"我试过类似做法，前期顺手，但一旦内容变多，结构设计就很重要了。",
	"我比较认同把复杂操作收进详情页，列表页越克制越耐看。",
	"如果只是想先跑通，我建议先用最稳的方案，后面再逐步美化和优化。",
}

func Run(db *gorm.DB, storage config.Storage, options Options) (*Summary, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}
	options = normalizeOptions(options)

	if err := os.MkdirAll(storage.ImageRoot(), 0o755); err != nil {
		return nil, fmt.Errorf("create image dir failed: %w", err)
	}
	if err := os.MkdirAll(storage.UploadRoot(), 0o755); err != nil {
		return nil, fmt.Errorf("create upload dir failed: %w", err)
	}

	assets := buildAssetPool(storage)
	summary := &Summary{}

	preparedAssets, copiedUploads, err := prepareUploadAssets(assets, storage.UploadRoot())
	if err != nil {
		return nil, err
	}
	summary.PreparedAssets = preparedAssets
	summary.CopiedUploads = copiedUploads

	users := buildUsers(options)
	createdUsers, copiedAvatars, err := seedUsers(db, storage.ImageRoot(), users)
	if err != nil {
		return nil, err
	}
	summary.Users = createdUsers
	summary.CopiedAvatars = copiedAvatars

	questions := buildQuestions(users, assets, options)
	questionSummary, err := seedQuestions(db, users, questions)
	if err != nil {
		return nil, err
	}

	summary.Questions = questionSummary.Questions
	summary.QuestionFiles = questionSummary.QuestionFiles
	summary.Comments = questionSummary.Comments
	summary.Likes = questionSummary.Likes

	return summary, nil
}

func buildUsers(options Options) []userSeed {
	users := make([]userSeed, 0, options.UserCount)
	avatarPool := []string{
		"front/public/legacy/res/img/header.png",
		"front/public/legacy/res/img/header2.png",
		"front/public/legacy/res/img/gr_img2.jpg",
		"front/public/legacy/res/img/gr_img3.jpg",
		"front/public/legacy/res/img/gr_img4.jpg",
		"front/public/legacy/res/img/gr_img5.jpg",
		"front/public/legacy/res/img/sy_img1.jpg",
		"front/public/legacy/res/img/sy_img2.jpg",
		"front/public/legacy/res/img/sy_img3.jpg",
		"front/public/legacy/res/img/sy_img4.jpg",
		"front/public/legacy/res/img/sy_img5.jpg",
		"front/public/legacy/res/img/wy_img1.jpg",
		"front/public/legacy/res/img/wy_img2.jpg",
		"front/public/legacy/res/img/wy_img3.jpg",
		"front/public/legacy/res/img/wy_img4.jpg",
		"front/public/legacy/res/img/wy_img5.jpg",
	}

	for i := 0; i < options.UserCount; i++ {
		users = append(users, userSeed{
			Username: fmt.Sprintf("1390000%04d", i+1),
			Nickname: fmt.Sprintf("论坛用户%02d", i+1),
			Age:      21 + (i % 12),
			Hobby:    hobbyPool[i%len(hobbyPool)],
			Sign:     signPool[i%len(signPool)],
			Question: securityQuestionPool[i%len(securityQuestionPool)],
			Avatar:   avatarPool[i%len(avatarPool)],
		})
	}

	return users
}

func buildAssetPool(storage config.Storage) []assetRef {
	candidates := []string{
		"front/public/legacy/res/img/ad.jpg",
		"front/public/legacy/res/img/banner.jpg",
		"front/public/legacy/res/img/bgimg1.jpg",
		"front/public/legacy/res/img/bgimg2.jpg",
		"front/public/legacy/res/img/down_img.jpg",
		"front/public/legacy/res/img/gr_img2.jpg",
		"front/public/legacy/res/img/gr_img3.jpg",
		"front/public/legacy/res/img/gr_img4.jpg",
		"front/public/legacy/res/img/gr_img5.jpg",
		"front/public/legacy/res/img/liuyan.jpg",
		"front/public/legacy/res/img/sy_img1.jpg",
		"front/public/legacy/res/img/sy_img2.jpg",
		"front/public/legacy/res/img/sy_img3.jpg",
		"front/public/legacy/res/img/sy_img4.jpg",
		"front/public/legacy/res/img/sy_img5.jpg",
		"front/public/legacy/res/img/wy_img1.jpg",
		"front/public/legacy/res/img/wy_img2.jpg",
		"front/public/legacy/res/img/wy_img3.jpg",
		"front/public/legacy/res/img/wy_img4.jpg",
		"front/public/legacy/res/img/wy_img5.jpg",
		"front/public/legacy/res/img/xc_img1.jpg",
		"front/public/legacy/res/img/xc_img3.jpg",
		"front/public/legacy/res/img/xc_img4.jpg",
		"front/public/legacy/res/img/xc_img5.jpg",
		"front/public/legacy/res/img/sy_img1.jpg",
		"front/public/legacy/res/img/sy_img2.jpg",
		"front/public/legacy/res/img/sy_img3.jpg",
		"front/public/legacy/res/img/sy_img4.jpg",
		"front/public/legacy/res/img/sy_img5.jpg",
		"public/uploads/pixabay/man-1281562_640.jpg",
		"public/uploads/pixabay/people-1979261_640.jpg",
	}

	assets := make([]assetRef, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, source := range candidates {
		if _, err := os.Stat(source); err != nil {
			continue
		}
		base := filepath.Base(source)
		diskName := "seed_" + base
		if _, ok := seen[diskName]; ok {
			continue
		}
		seen[diskName] = struct{}{}
		assets = append(assets, assetRef{
			DiskName:  diskName,
			Source:    source,
			PublicRef: filepath.ToSlash(filepath.Join(storage.UploadRoot(), diskName)),
		})
	}

	return assets
}

func prepareUploadAssets(assets []assetRef, uploadRoot string) (int, int, error) {
	prepared := 0
	copied := 0
	for _, asset := range assets {
		target := filepath.Join(uploadRoot, asset.DiskName)
		if _, err := os.Stat(target); err == nil {
			prepared++
			continue
		}
		if err := copyFile(asset.Source, target); err != nil {
			return prepared, copied, fmt.Errorf("copy upload asset %s failed: %w", asset.Source, err)
		}
		prepared++
		copied++
	}
	return prepared, copied, nil
}

func seedUsers(db *gorm.DB, imageRoot string, users []userSeed) (int, int, error) {
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(seedPassword), bcrypt.DefaultCost)
	if err != nil {
		return 0, 0, fmt.Errorf("hash seed password failed: %w", err)
	}
	securityHash, err := bcrypt.GenerateFromPassword([]byte(seedSecurityAnswer), bcrypt.DefaultCost)
	if err != nil {
		return 0, 0, fmt.Errorf("hash seed security answer failed: %w", err)
	}

	created := 0
	copiedAvatars := 0
	for _, item := range users {
		ext := strings.ToLower(filepath.Ext(item.Avatar))
		if ext == "" {
			ext = ".jpg"
		}
		avatarFile := item.Username + ext
		avatarPath := "/public/images/" + avatarFile
		avatarTarget := filepath.Join(imageRoot, avatarFile)
		if _, err := os.Stat(avatarTarget); os.IsNotExist(err) {
			if err := copyFile(item.Avatar, avatarTarget); err != nil {
				return created, copiedAvatars, fmt.Errorf("copy avatar %s failed: %w", item.Avatar, err)
			}
			copiedAvatars++
		}

		var user database.User
		err := db.Where("username = ?", item.Username).First(&user).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return created, copiedAvatars, fmt.Errorf("query user %s failed: %w", item.Username, err)
		}

		if err == gorm.ErrRecordNotFound {
			user = database.User{
				Username:           item.Username,
				PasswordHash:       string(passwordHash),
				Nickname:           item.Nickname,
				Age:                item.Age,
				Hobby:              item.Hobby,
				Sign:               item.Sign,
				SecurityQuestion:   item.Question,
				SecurityAnswerHash: string(securityHash),
				AvatarPath:         avatarPath,
			}
			if err := db.Create(&user).Error; err != nil {
				return created, copiedAvatars, fmt.Errorf("create user %s failed: %w", item.Username, err)
			}
			created++
			continue
		}

		if err := db.Model(&user).Updates(map[string]any{
			"nickname":          item.Nickname,
			"age":               item.Age,
			"hobby":             item.Hobby,
			"sign":              item.Sign,
			"avatar_path":       avatarPath,
			"security_question": item.Question,
		}).Error; err != nil {
			return created, copiedAvatars, fmt.Errorf("update user %s failed: %w", item.Username, err)
		}
	}

	return created, copiedAvatars, nil
}

type questionSeedSummary struct {
	Questions     int
	QuestionFiles int
	Comments      int
	Likes         int
}

func seedQuestions(db *gorm.DB, users []userSeed, questions []questionSeed) (*questionSeedSummary, error) {
	userByUsername := make(map[string]userSeed, len(users))
	for _, item := range users {
		userByUsername[item.Username] = item
	}

	summary := &questionSeedSummary{}
	for _, item := range questions {
		owner, ok := userByUsername[item.Owner]
		if !ok {
			return nil, fmt.Errorf("seed owner not found: %s", item.Owner)
		}

		var question database.Question
		err := db.Where("q_id = ?", item.QID).First(&question).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("query question %d failed: %w", item.QID, err)
		}

		if err == gorm.ErrRecordNotFound {
			question = database.Question{
				QID:       item.QID,
				Username:  owner.Username,
				Nickname:  owner.Nickname,
				Text:      item.Text,
				IsUpload:  item.IsUpload,
				CreatedAt: item.CreatedAt,
				UpdatedAt: item.UpdatedAt,
			}
			if err := attachUserID(db, &question, owner.Username); err != nil {
				return nil, err
			}
			if err := db.Create(&question).Error; err != nil {
				return nil, fmt.Errorf("create question %d failed: %w", item.QID, err)
			}
			summary.Questions++
		} else {
			if err := attachUserID(db, &question, owner.Username); err != nil {
				return nil, err
			}
			if err := db.Model(&question).Updates(map[string]any{
				"user_id":    question.UserID,
				"username":   owner.Username,
				"nickname":   owner.Nickname,
				"text":       item.Text,
				"is_upload":  item.IsUpload,
				"created_at": item.CreatedAt,
				"updated_at": item.UpdatedAt,
			}).Error; err != nil {
				return nil, fmt.Errorf("update question %d failed: %w", item.QID, err)
			}
		}

		for _, assetName := range item.AssetNames {
			storedFileName := fmt.Sprintf("%d_%s", item.QID, assetName)
			var count int64
			if err := db.Model(&database.QuestionFile{}).Where("q_id = ? AND file_name = ?", item.QID, storedFileName).Count(&count).Error; err != nil {
				return nil, fmt.Errorf("count question file %s failed: %w", assetName, err)
			}
			if count == 0 {
				fileRecord := database.QuestionFile{
					QuestionID:   question.ID,
					QID:          item.QID,
					FileName:     storedFileName,
					OriginalName: assetName,
					CreatedAt:    item.CreatedAt,
				}
				if err := ensureQuestionAsset(fileRecord.FileName, assetName); err != nil {
					return nil, err
				}
				if err := db.Create(&fileRecord).Error; err != nil {
					return nil, fmt.Errorf("create question file %s failed: %w", assetName, err)
				}
				summary.QuestionFiles++
			}
		}

		for _, comment := range item.Comments {
			commentUser := userByUsername[comment.Username]
			var count int64
			if err := db.Model(&database.Comment{}).Where("q_id = ? AND username = ? AND text = ?", item.QID, comment.Username, comment.Text).Count(&count).Error; err != nil {
				return nil, fmt.Errorf("count comment failed: %w", err)
			}
			if count == 0 {
				record := database.Comment{
					QuestionID: question.ID,
					QID:        item.QID,
					Username:   comment.Username,
					Nickname:   commentUser.Nickname,
					Text:       comment.Text,
					CreatedAt:  comment.CreatedAt,
				}
				if err := db.Create(&record).Error; err != nil {
					return nil, fmt.Errorf("create comment failed: %w", err)
				}
				summary.Comments++
			}
		}

		for _, liker := range item.LikeUsers {
			likeUser := userByUsername[liker]
			var count int64
			if err := db.Model(&database.QuestionLike{}).Where("q_id = ? AND username = ?", item.QID, liker).Count(&count).Error; err != nil {
				return nil, fmt.Errorf("count like failed: %w", err)
			}
			if count == 0 {
				record := database.QuestionLike{
					QuestionID: question.ID,
					QID:        item.QID,
					Username:   liker,
					Nickname:   likeUser.Nickname,
					CreatedAt:  item.CreatedAt.Add(2 * time.Hour),
				}
				if err := db.Create(&record).Error; err != nil {
					return nil, fmt.Errorf("create like failed: %w", err)
				}
				summary.Likes++
			}
		}

		if err := syncQuestionCounters(db, question.ID); err != nil {
			return nil, err
		}
	}

	return summary, nil
}

func attachUserID(db *gorm.DB, question *database.Question, username string) error {
	var user database.User
	if err := db.Select("id").Where("username = ?", username).First(&user).Error; err != nil {
		return fmt.Errorf("query owner %s failed: %w", username, err)
	}
	question.UserID = user.ID
	return nil
}

func syncQuestionCounters(db *gorm.DB, questionID uint) error {
	var comments int64
	if err := db.Model(&database.Comment{}).Where("question_id = ?", questionID).Count(&comments).Error; err != nil {
		return fmt.Errorf("count comments failed: %w", err)
	}
	var likes int64
	if err := db.Model(&database.QuestionLike{}).Where("question_id = ?", questionID).Count(&likes).Error; err != nil {
		return fmt.Errorf("count likes failed: %w", err)
	}
	if err := db.Model(&database.Question{}).Where("id = ?", questionID).Updates(map[string]any{
		"comments_num": int(comments),
		"likes_num":    int(likes),
	}).Error; err != nil {
		return fmt.Errorf("update question counters failed: %w", err)
	}
	return nil
}

func ensureQuestionAsset(targetName, sourceName string) error {
	source := filepath.Join("public", "uploads", sourceName)
	target := filepath.Join("public", "uploads", targetName)
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	if err := copyFile(source, target); err != nil {
		return fmt.Errorf("copy question asset %s failed: %w", sourceName, err)
	}
	return nil
}

func buildQuestions(users []userSeed, assets []assetRef, options Options) []questionSeed {
	assetNames := make([]string, 0, len(assets))
	for _, item := range assets {
		assetNames = append(assetNames, item.DiskName)
	}

	questions := make([]questionSeed, 0, options.QuestionCount)
	baseTime := time.Date(2026, 4, 1, 9, 0, 0, 0, time.Local)
	for i := 0; i < options.QuestionCount; i++ {
		owner := users[i%len(users)]
		assetCount := 1 + (i % options.MaxAssetsPerPost)
		selectedAssets := make([]string, 0, assetCount)
		for j := 0; j < assetCount; j++ {
			selectedAssets = append(selectedAssets, assetNames[(i+j)%len(assetNames)])
		}

		commentSpan := options.MaxCommentsPerPost - options.MinCommentsPerPost + 1
		commentCount := options.MinCommentsPerPost + (i % commentSpan)
		comments := make([]commentSeed, 0, commentCount)
		for j := 0; j < commentCount; j++ {
			commentUser := users[(i+j+1)%len(users)]
			comments = append(comments, commentSeed{
				Username:  commentUser.Username,
				Text:      fmt.Sprintf("%s #%02d", commentTopicPool[(i+j)%len(commentTopicPool)], j+1),
				CreatedAt: baseTime.Add(time.Duration(i*6+j) * time.Hour),
			})
		}

		likeSpan := options.MaxLikesPerPost - options.MinLikesPerPost + 1
		likeCount := options.MinLikesPerPost + (i % likeSpan)
		likeUsers := make([]string, 0, likeCount)
		for j := 0; j < likeCount; j++ {
			likeUsers = append(likeUsers, users[(i+j+2)%len(users)].Username)
		}

		createdAt := baseTime.Add(time.Duration(i*3) * time.Hour)
		questions = append(questions, questionSeed{
			QID:        seedQuestionBaseQID + int64(i+1),
			Owner:      owner.Username,
			Text:       fmt.Sprintf("%s 第 %d 条扩展讨论：%s", questionTopicPool[i%len(questionTopicPool)], i+1, signPool[i%len(signPool)]),
			IsUpload:   i%7 != 0,
			AssetNames: selectedAssets,
			Comments:   comments,
			LikeUsers:  uniqueStrings(likeUsers),
			CreatedAt:  createdAt,
			UpdatedAt:  createdAt.Add(90 * time.Minute),
		})
	}

	return questions
}

func normalizeOptions(options Options) Options {
	defaults := DefaultOptions()
	if options.UserCount <= 0 {
		options.UserCount = defaults.UserCount
	}
	if options.QuestionCount <= 0 {
		options.QuestionCount = defaults.QuestionCount
	}
	if options.MinCommentsPerPost <= 0 {
		options.MinCommentsPerPost = defaults.MinCommentsPerPost
	}
	if options.MaxCommentsPerPost < options.MinCommentsPerPost {
		options.MaxCommentsPerPost = max(options.MinCommentsPerPost, defaults.MaxCommentsPerPost)
	}
	if options.MinLikesPerPost <= 0 {
		options.MinLikesPerPost = defaults.MinLikesPerPost
	}
	if options.MaxLikesPerPost < options.MinLikesPerPost {
		options.MaxLikesPerPost = max(options.MinLikesPerPost, defaults.MaxLikesPerPost)
	}
	if options.MaxAssetsPerPost <= 0 {
		options.MaxAssetsPerPost = defaults.MaxAssetsPerPost
	}
	return options
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		result = append(result, item)
	}
	return result
}

func copyFile(source, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(target)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return err
	}
	return nil
}

func Report(db *gorm.DB) (map[string]int64, error) {
	models := map[string]any{
		"users":          &database.User{},
		"questions":      &database.Question{},
		"question_files": &database.QuestionFile{},
		"comments":       &database.Comment{},
		"likes":          &database.QuestionLike{},
	}
	keys := make([]string, 0, len(models))
	for key := range models {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := make(map[string]int64, len(models))
	for _, key := range keys {
		var count int64
		if err := db.Model(models[key]).Count(&count).Error; err != nil {
			return nil, fmt.Errorf("count %s failed: %w", key, err)
		}
		result[key] = count
	}
	return result, nil
}
