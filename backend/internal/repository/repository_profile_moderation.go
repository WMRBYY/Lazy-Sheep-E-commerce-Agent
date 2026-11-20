package repository

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreateProfileModeration(record *model.ProfileModerationRecord) error {
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	if record.UpdatedAt.IsZero() {
		record.UpdatedAt = record.CreatedAt
	}
	return r.db.Create(record).Error
}

func (r *Repository) UpdateOwnProfileWithModeration(userID string, name *string, avatarURL *string, records []model.ProfileModerationRecord) (*model.User, error) {
	var user model.User
	err := r.db.Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{"updated_at": gorm.Expr("CURRENT_TIMESTAMP")}
		if name != nil {
			updates["display_name"] = *name
			updates["profile_name_edited"] = true
		}
		if avatarURL != nil {
			updates["avatar_url"] = *avatarURL
			updates["profile_avatar_edited"] = true
			updates["avatar_mode"] = ""
			updates["avatar_version"] = ""
		}
		result := tx.Model(&model.User{}).Where("id = ? AND status = ?", userID, model.UserStatusActive).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		for i := range records {
			if err := tx.Create(&records[i]).Error; err != nil {
				return err
			}
		}
		return tx.First(&user, "id = ?", userID).Error
	})
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) ProfileModerationRecords(status string, limit, offset int) ([]model.ProfileModerationRecord, int64, error) {
	query := r.db.Model(&model.ProfileModerationRecord{})
	if status != "" {
		if status == "blocked" {
			query = query.Where("profile_moderation_records.status IN ?", []string{"block", "blocked"})
		} else {
			query = query.Where("profile_moderation_records.status = ?", status)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := make([]model.ProfileModerationRecord, 0)
	err := query.Select("profile_moderation_records.id, profile_moderation_records.user_id, profile_moderation_records.kind, profile_moderation_records.status, profile_moderation_records.original_value, profile_moderation_records.result_value, profile_moderation_records.reason, profile_moderation_records.model, profile_moderation_records.score, profile_moderation_records.reviewer_id, profile_moderation_records.reviewed_at, profile_moderation_records.created_at, profile_moderation_records.updated_at, users.username AS username, users.display_name AS user_display_name").
		Joins("LEFT JOIN users ON users.id = profile_moderation_records.user_id").
		Order("profile_moderation_records.created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error
	return rows, total, err
}

func (r *Repository) ProfileModerationRecord(id string) (*model.ProfileModerationRecord, error) {
	var record model.ProfileModerationRecord
	if err := r.db.First(&record, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &record, nil
}
