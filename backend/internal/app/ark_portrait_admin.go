package app

import (
	"context"
	"errors"

	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// AdminArkGroupQuery 是管理员素材组列表的筛选条件。
type AdminArkGroupQuery struct {
	Kind     string
	Scope    string
	Expiry   string
	Keyword  string
	Page     int
	PageSize int
}

type AdminArkGroupPage struct {
	Items         []ArkPortraitGroupView           `json:"items"`
	Total         int64                            `json:"total"`
	Page          int                              `json:"page"`
	PageSize      int                              `json:"pageSize"`
	Stats         repository.ArkPortraitGroupStats `json:"stats"`
	PendingReview int64                            `json:"pendingReview"`
	Sessions      []ArkPortraitSessionView         `json:"sessions"`
}

// AdminArkGroupCreateRequest 创建平台素材组：GroupID 为空时在方舟新建（虚拟 / 版权 IP），
// 非空时登记控制台已有的素材组（真人需为 LivenessFace）。
type AdminArkGroupCreateRequest struct {
	Kind         string   `json:"kind"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	GroupID      string   `json:"groupId"`
	GrantAll     bool     `json:"grantAll"`
	GrantUserIDs []string `json:"grantUserIds"`
}

// AdminArkGroupUpdateRequest 修改素材组；字段为 nil 表示不修改。授权只对平台素材组生效。
type AdminArkGroupUpdateRequest struct {
	Name         *string    `json:"name"`
	Description  *string    `json:"description"`
	GrantAll     *bool      `json:"grantAll"`
	GrantUserIDs *[]string  `json:"grantUserIds"`
	ExpiresAt    *time.Time `json:"expiresAt"`
}

type AdminArkReviewPage struct {
	Items    []ArkPortraitAssetView `json:"items"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
}

type AdminArkReviewResult struct {
	Succeeded []string               `json:"succeeded"`
	Failed    []AdminArkReviewFailed `json:"failed"`
}

type AdminArkReviewFailed struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

const maxArkGrantUsers = 500

func (s *Service) AdminArkGroup(actor *model.User, id string) (*ArkPortraitGroupView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	group, err := s.adminArkGroup(id)
	if err != nil {
		return nil, err
	}
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	views, err := s.adminArkGroupViews([]model.ArkPortraitGroup{*group}, setting, time.Now(), true)
	if err != nil {
		return nil, err
	}
	return &views[0], nil
}

// adminArkGroupViews 附带所有者、各状态素材数与授权用户；withAssets 时返回全部素材及上传者。
func (s *Service) adminArkGroupViews(groups []model.ArkPortraitGroup, setting arkPrivateAssetSettingValue, now time.Time, withAssets bool) ([]ArkPortraitGroupView, error) {
	groupIDs := make([]string, 0, len(groups))
	userIDs := make([]string, 0, len(groups))
	platformIDs := make([]string, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.ID)
		userIDs = append(userIDs, group.UserID)
		if group.Scope == arkGroupScopePlatform {
			platformIDs = append(platformIDs, group.ID)
		}
	}
	counts, err := s.repo.ArkPortraitAssetStatusCounts(groupIDs)
	if err != nil {
		return nil, err
	}
	grants, err := s.repo.ArkPortraitGroupGrantUsers(platformIDs)
	if err != nil {
		return nil, err
	}
	var members []model.ArkPortraitAsset
	if withAssets {
		if members, err = s.repo.ArkPortraitAssetsForGroups(groupIDs, nil); err != nil {
			return nil, err
		}
		for _, member := range members {
			userIDs = append(userIDs, member.UserID)
		}
	}
	for _, ids := range grants {
		userIDs = append(userIDs, ids...)
	}
	users, err := s.repo.UsersByIDs(uniqueStrings(userIDs))
	if err != nil {
		return nil, err
	}
	assetsByGroup := map[string][]ArkPortraitAssetView{}
	if withAssets {
		views, err := s.arkAssetViewsForUser("", members)
		if err != nil {
			return nil, err
		}
		for index, view := range views {
			view.Uploader = arkUserSummary(users, members[index].UserID)
			assetsByGroup[view.GroupID] = append(assetsByGroup[view.GroupID], view)
		}
	}
	items := make([]ArkPortraitGroupView, 0, len(groups))
	for _, group := range groups {
		view := arkPortraitGroupView(group, setting, now)
		view.Owner = arkUserSummary(users, group.UserID)
		view.AssetCounts = counts[group.ID]
		if view.AssetCounts == nil {
			view.AssetCounts = map[string]int64{}
		}
		for _, userID := range grants[group.ID] {
			if summary := arkUserSummary(users, userID); summary != nil {
				view.GrantUsers = append(view.GrantUsers, *summary)
			}
		}
		if items := assetsByGroup[group.ID]; items != nil {
			view.Assets = items
		}
		items = append(items, view)
	}
	return items, nil
}

func arkUserSummary(users map[string]model.User, id string) *ArkUserSummary {
	user, ok := users[id]
	if !ok {
		if id == "" {
			return nil
		}
		return &ArkUserSummary{ID: id}
	}
	return &ArkUserSummary{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

// AdminCreateArkGroup 创建或登记平台素材组。真人素材组只能登记控制台已有的组或通过 H5 认证生成。

// AdminCreateArkPortraitSession 管理员为平台真人素材组发起 H5 认证；不收费、不占用户额度。

// AdminCreateArkPortraitAsset 管理员向平台素材组上传素材，免平台审核，直接提交方舟。

// AdminArkReviewQueue 返回待审核（默认）或已驳回的用户上传。

// AdminApproveArkAssets 通过待审核素材并提交方舟；单条失败保留为待审核并返回原因，不影响其他条目。

func (s *Service) approveArkAsset(ctx context.Context, actor *model.User, setting arkPrivateAssetSettingValue, asset *model.ArkPortraitAsset) error {
	if asset.Status != arkPortraitAssetPendingReview {
		return errors.New("该素材已处理，请刷新列表")
	}
	group, err := s.adminArkGroup(asset.GroupID)
	if err != nil {
		return err
	}
	resource, err := s.repo.ResourceForUser(asset.UserID, asset.ResourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errors.New("上传者已删除素材文件")
	}
	if err != nil {
		return err
	}
	if !arkPortraitGroupAvailable(*group, setting) {
		return errors.New("素材组所在的方舟项目已更换，无法提交")
	}
	if arkGroupExpired(*group, time.Now()) {
		return errors.New("真人素材组授权已过期")
	}
	if err := s.submitArkPortraitAsset(ctx, setting, *group, asset, resource); err != nil {
		return err
	}
	now := time.Now()
	asset.ReviewedBy, asset.ReviewedAt = actor.ID, &now
	return s.repo.SaveArkPortraitAsset(asset)
}

// AdminRejectArkAssets 驳回待审核素材；原因会展示给上传者。

func arkReviewIDs(ids []string) ([]string, error) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 || len(ids) > 100 {
		return nil, BadAuthRequest("每次请选择 1-100 份素材")
	}
	return ids, nil
}

func (s *Service) adminArkGroup(id string) (*model.ArkPortraitGroup, error) {
	group, err := s.repo.ArkPortraitGroup(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("素材组不存在")
	}
	return group, err
}

// validArkGrantUsers 去重并确认授权用户都存在。
func (s *Service) validArkGrantUsers(ids []string) ([]string, error) {
	ids = uniqueStrings(ids)
	if len(ids) > maxArkGrantUsers {
		return nil, BadAuthRequest("单个素材组最多逐个授权 500 位用户，更多用户请选择「全部用户」")
	}
	users, err := s.repo.UsersByIDs(ids)
	if err != nil {
		return nil, err
	}
	if len(users) != len(ids) {
		return nil, BadAuthRequest("授权用户中有不存在的账号，请刷新后重新选择")
	}
	return ids, nil
}
