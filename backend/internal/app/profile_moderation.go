package app

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type AdminProfileModerationPage struct {
	Records  []model.ProfileModerationRecord `json:"records"`
	Total    int64                           `json:"total"`
	Page     int                             `json:"page"`
	PageSize int                             `json:"pageSize"`
}

func newProfileNicknameModeration(userID, original, result string, blocked bool) model.ProfileModerationRecord {
	now := time.Now()
	status, reason := "pass", "未命中内置违规昵称词表"
	if blocked {
		status, reason = "blocked", "命中内置违规昵称词表"
	}
	return model.ProfileModerationRecord{
		ID: kernel.NewID(), UserID: userID, Kind: "nickname", Status: status,
		OriginalValue: strings.TrimSpace(original), ResultValue: result, Reason: reason,
		Model: "builtin-cn-terms-v1", CreatedAt: now, UpdatedAt: now,
	}
}

func newProfileAvatarModeration(userID string, original []byte, decision auth.ProfileAvatarDecision) model.ProfileModerationRecord {
	now := time.Now()
	status := decision.Action
	reason := "本地色情内容分类器判定安全"
	var data []byte
	contentType := ""
	if decision.Action != "pass" {
		data = append([]byte(nil), original...)
		contentType = "image/jpeg"
		reason = "模型置信度处于拦截或人工复核区间"
	}
	return model.ProfileModerationRecord{
		ID: kernel.NewID(), UserID: userID, Kind: "avatar", Status: status,
		ResultValue: decision.Action, Reason: reason, Model: decision.Model, Score: decision.Score,
		ContentType: contentType, ImageData: data, CreatedAt: now, UpdatedAt: now,
	}
}

func (s *Service) AdminProfileModerationRecords(actor *model.User, status string, page, pageSize int) (*AdminProfileModerationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	status = strings.TrimSpace(status)
	if status != "" && status != "pass" && status != "block" && status != "review" && status != "blocked" {
		return nil, BadAuthRequest("审核状态筛选参数无效")
	}
	page, pageSize = normalizeAdminPage(page, pageSize)
	records, total, err := s.repo.ProfileModerationRecords(status, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	return &AdminProfileModerationPage{Records: records, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) AdminProfileModerationImage(actor *model.User, id string) (*model.ProfileModerationRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	record, err := s.repo.ProfileModerationRecord(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("审核记录不存在")
	}
	if err != nil {
		return nil, err
	}
	if len(record.ImageData) == 0 {
		return nil, NotFound("该审核记录没有待检查图片")
	}
	return record, nil
}
