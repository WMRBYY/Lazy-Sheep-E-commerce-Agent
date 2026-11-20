package app

import (
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) PublicCanvasAuthorAvatar(id string) ([]byte, error) {
	works, _, err := s.repo.QueryCanvasTemplates(repository.CanvasTemplateFilter{UserID: id, Statuses: []model.CanvasTemplateStatus{model.CanvasTemplateStatusApproved}, Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(works) == 0 {
		return nil, NotFound("作者头像不可用")
	}
	users, err := s.repo.UsersByIDs([]string{id})
	if err != nil {
		return nil, err
	}
	if users[id].AvatarMode != "custom" {
		return nil, NotFound("作者未设置自定义头像")
	}
	avatar, err := s.repo.UserAvatar(id)
	if err != nil {
		return nil, NotFound("作者头像不可用")
	}
	return avatar.Data, nil
}
