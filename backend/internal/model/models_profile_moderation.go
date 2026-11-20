package model

import "time"

type ProfileModerationRecord struct {
	ID              string     `json:"id" gorm:"primaryKey;size:36"`
	UserID          string     `json:"userId" gorm:"index;size:36;not null"`
	Username        string     `json:"username,omitempty" gorm:"column:username;->;-:migration"`
	UserDisplayName string     `json:"userDisplayName,omitempty" gorm:"column:user_display_name;->;-:migration"`
	Kind            string     `json:"kind" gorm:"index;size:16;not null"`
	Status          string     `json:"status" gorm:"index;size:16;not null"`
	Storage         string     `json:"-" gorm:"size:16;not null;default:''"`
	OriginalValue   string     `json:"originalValue,omitempty" gorm:"size:160;not null;default:''"`
	ResultValue     string     `json:"resultValue,omitempty" gorm:"size:160;not null;default:''"`
	Reason          string     `json:"reason" gorm:"size:160;not null;default:''"`
	Model           string     `json:"model,omitempty" gorm:"size:64;not null;default:''"`
	Score           float64    `json:"score,omitempty" gorm:"not null;default:0"`
	ContentType     string     `json:"-" gorm:"size:64;not null;default:''"`
	ImageData       []byte     `json:"-"`
	ReviewerID      string     `json:"reviewerId,omitempty" gorm:"size:36;not null;default:''"`
	ReviewedAt      *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt" gorm:"index"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}
