package app

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ShopWorkflowNode struct {
	ID               string   `json:"id"`
	Type             string   `json:"type"`
	X                float64  `json:"x"`
	Y                float64  `json:"y"`
	Text             string   `json:"text,omitempty"`
	Prompt           string   `json:"prompt,omitempty"`
	DraftKind        string   `json:"draftKind,omitempty"`
	MaterialCategory string   `json:"materialCategory,omitempty"`
	ResourceID       string   `json:"resourceId,omitempty"`
	Inputs           []string `json:"inputs,omitempty"`
}

type ShopWorkflowSubmitInput struct {
	WorkflowID  string             `json:"workflowId"`
	Name        string             `json:"name"`
	Category    string             `json:"category"`
	Description string             `json:"description"`
	Nodes       []ShopWorkflowNode `json:"nodes"`
}

type ShopWorkflowDetail struct {
	*model.ShopWorkflowSubmission
	Nodes []ShopWorkflowNode `json:"nodes"`
}

func shopWorkflowCategoryValid(category string) bool {
	return category == "商品" || category == "服饰" || category == "视频"
}

func (s *Service) MyShopWorkflowSubmission(user *model.User, workflowID string) (*model.ShopWorkflowSubmission, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	id, err := uuid.Parse(workflowID)
	if err != nil {
		return nil, BadAuthRequest("工作流 ID 无效")
	}
	row, err := s.repo.ShopWorkflowSubmissionForOwner(user.ID, id.String())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return row, err
}

func (s *Service) SubmitShopWorkflow(user *model.User, input ShopWorkflowSubmitInput) (*model.ShopWorkflowSubmission, error) {
	existing, err := s.MyShopWorkflowSubmission(user, input.WorkflowID)
	if err != nil || existing != nil {
		return existing, err
	}
	id, _ := uuid.Parse(input.WorkflowID)
	name := strings.TrimSpace(input.Name)
	description := strings.TrimSpace(input.Description)
	if name == "" || utf8.RuneCountInString(name) > 160 || utf8.RuneCountInString(description) > 500 || !shopWorkflowCategoryValid(input.Category) {
		return nil, BadAuthRequest("请填写有效的工作流名称、简介和分类")
	}
	resourceIDs, err := validateShopWorkflowNodes(input.Nodes)
	if err != nil {
		return nil, err
	}
	resources, err := s.repo.ResourcesForUserIDs(user.ID, resourceIDs)
	if err != nil {
		return nil, err
	}
	media := make(map[string]string, len(resources))
	for _, resource := range resources {
		if resource.Status == model.ResourceStatusReady && (resource.Kind == "image" || resource.Kind == "video") {
			media[resource.ID] = resource.Kind
		}
	}
	cover := ""
	for i := range input.Nodes {
		node := &input.Nodes[i]
		if node.ResourceID == "" {
			continue
		}
		kind, ok := media[node.ResourceID]
		if !ok {
			return nil, BadAuthRequest("工作流含有不可用的素材，请替换或移除后再提交")
		}
		if kind == "video" {
			node.Type = "video"
		} else {
			node.Type = "image"
			if cover == "" {
				cover = node.ResourceID
			}
		}
	}
	raw, err := json.Marshal(input.Nodes)
	if err != nil {
		return nil, err
	}
	row := &model.ShopWorkflowSubmission{
		ID: uuid.NewString(), SubmitterID: user.ID, WorkflowID: id.String(),
		Name: name, Description: description, Category: input.Category,
		NodesJSON: string(raw), NodeCount: len(input.Nodes), CoverResourceID: cover, Status: model.ShopWorkflowPending,
	}
	if err := s.repo.InsertShopWorkflowSubmission(row); err != nil {
		return nil, err
	}
	return s.repo.ShopWorkflowSubmissionForOwner(user.ID, id.String())
}

func validateShopWorkflowNodes(nodes []ShopWorkflowNode) ([]string, error) {
	if len(nodes) == 0 || len(nodes) > 100 {
		return nil, BadAuthRequest("工作流须包含 1 至 100 个节点")
	}
	seen := make(map[string]bool, len(nodes))
	resourceIDs := []string{}
	resourceSeen := make(map[string]bool)
	for _, node := range nodes {
		switch node.Type {
		case "text", "image", "video", "result", "draft":
		default:
			return nil, BadAuthRequest("工作流包含暂不支持的节点")
		}
		if node.ID == "" || len(node.ID) > 80 || seen[node.ID] || math.Abs(node.X) > 100000 || math.Abs(node.Y) > 100000 ||
			utf8.RuneCountInString(node.Text) > 1000 || utf8.RuneCountInString(node.Prompt) > 8000 || len(node.DraftKind) > 80 || len(node.MaterialCategory) > 80 || len(node.Inputs) > len(nodes) {
			return nil, BadAuthRequest("工作流节点内容或位置不符合要求")
		}
		seen[node.ID] = true
		if node.ResourceID != "" && !resourceSeen[node.ResourceID] {
			if validCanvasResourceID(node.ResourceID) != node.ResourceID {
				return nil, BadAuthRequest("工作流素材 ID 无效")
			}
			resourceSeen[node.ResourceID] = true
			resourceIDs = append(resourceIDs, node.ResourceID)
		}
	}
	for _, node := range nodes {
		linked := make(map[string]bool, len(node.Inputs))
		for _, source := range node.Inputs {
			if !seen[source] || source == node.ID || linked[source] {
				return nil, BadAuthRequest("工作流存在无效的节点连线")
			}
			linked[source] = true
		}
	}
	return resourceIDs, nil
}

func (s *Service) AdminShopWorkflowSubmissions(user *model.User, status model.ShopWorkflowStatus, category, keyword string, page, size int) ([]model.ShopWorkflowSubmission, int64, error) {
	if err := s.RequireAdmin(user); err != nil {
		return nil, 0, err
	}
	if (status != "" && status != model.ShopWorkflowPending && status != model.ShopWorkflowApproved && status != model.ShopWorkflowRejected) ||
		(category != "" && !shopWorkflowCategoryValid(category)) || utf8.RuneCountInString(keyword) > 160 || page < 1 || page > 100000 || size < 1 || size > 48 {
		return nil, 0, BadAuthRequest("工作流筛选条件无效")
	}
	return s.repo.ShopWorkflowSubmissions(status, category, keyword, page, size)
}

func (s *Service) AdminShopWorkflowDetail(user *model.User, id string) (*ShopWorkflowDetail, error) {
	if err := s.RequireAdmin(user); err != nil {
		return nil, err
	}
	row, err := s.repo.ShopWorkflowSubmissionByID(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("工作流投稿不存在")
	}
	if err != nil {
		return nil, err
	}
	var nodes []ShopWorkflowNode
	if err := json.Unmarshal([]byte(row.NodesJSON), &nodes); err != nil {
		return nil, err
	}
	return &ShopWorkflowDetail{ShopWorkflowSubmission: row, Nodes: nodes}, nil
}

func (s *Service) ReviewShopWorkflow(user *model.User, id string, status model.ShopWorkflowStatus, note string) error {
	if err := s.RequireAdmin(user); err != nil {
		return err
	}
	note = strings.TrimSpace(note)
	if (status != model.ShopWorkflowApproved && status != model.ShopWorkflowRejected) || utf8.RuneCountInString(note) > 500 || (status == model.ShopWorkflowRejected && note == "") {
		return BadAuthRequest("请填写有效的审核结果和原因")
	}
	updated, err := s.repo.ReviewShopWorkflowSubmission(id, user.ID, status, note)
	if err != nil {
		return err
	}
	if !updated {
		return kernel.NewAppError(http.StatusConflict, "该工作流已处理或不存在，请刷新列表")
	}
	return nil
}

func (s *Service) AdminReviewCounts(user *model.User) (repository.AdminReviewCounts, error) {
	if err := s.RequireAdmin(user); err != nil {
		return repository.AdminReviewCounts{}, err
	}
	return s.repo.AdminReviewCounts()
}
