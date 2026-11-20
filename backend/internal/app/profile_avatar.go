package app

import (
	"context"
	"mime/multipart"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

func (s *Service) SetProfileAvatarModerator(moderator func(context.Context, []byte) (auth.ProfileAvatarDecision, error)) {
	if s == nil || moderator == nil {
		return
	}
	s.profileAvatarModerator = moderator
	s.auth.SetProfileAvatarModerator(moderator)
}

func (s *Service) UpdateProfileAvatar(actor *model.User, header *multipart.FileHeader) (*AuthUser, error) {
	return s.authDomain().UpdateProfileAvatar(actor, header)
}

func (s *Service) UseDefaultProfileAvatar(actor *model.User) (*AuthUser, error) {
	return s.authDomain().UseDefaultProfileAvatar(actor)
}

func (s *Service) SelectDefaultProfileAvatar(actor *model.User, preset string) (*AuthUser, error) {
	return s.authDomain().SelectDefaultProfileAvatar(actor, preset)
}

func (s *Service) ProfileAvatarContent(actor *model.User, targetUserID string) ([]byte, error) {
	return s.authDomain().ProfileAvatarContent(actor, targetUserID)
}
