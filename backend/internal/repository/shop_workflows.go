package repository

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm/clause"
)

func (r *Repository) InsertShopWorkflowSubmission(row *model.ShopWorkflowSubmission) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "submitter_id"}, {Name: "workflow_id"}},
		DoNothing: true,
	}).Create(row).Error
}

func (r *Repository) ShopWorkflowSubmissionForOwner(userID, workflowID string) (*model.ShopWorkflowSubmission, error) {
	var row model.ShopWorkflowSubmission
	err := r.db.Omit("nodes_json").Where("submitter_id = ? AND workflow_id = ?", userID, workflowID).Take(&row).Error
	return &row, err
}

func (r *Repository) ShopWorkflowSubmissionByID(id string) (*model.ShopWorkflowSubmission, error) {
	var row model.ShopWorkflowSubmission
	err := r.db.Take(&row, "id = ?", id).Error
	return &row, err
}

func (r *Repository) ShopWorkflowSubmissions(status model.ShopWorkflowStatus, category, keyword string, page, size int) ([]model.ShopWorkflowSubmission, int64, error) {
	rows := make([]model.ShopWorkflowSubmission, 0)
	query := r.db.Model(&model.ShopWorkflowSubmission{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?)", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Omit("nodes_json").Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	return rows, total, err
}

func (r *Repository) ReviewShopWorkflowSubmission(id, reviewerID string, status model.ShopWorkflowStatus, note string) (bool, error) {
	result := r.db.Model(&model.ShopWorkflowSubmission{}).
		Where("id = ? AND status = ?", id, model.ShopWorkflowPending).
		Updates(map[string]any{"status": status, "reviewer_id": reviewerID, "review_note": note, "reviewed_at": r.db.NowFunc()})
	return result.RowsAffected == 1, result.Error
}

type AdminReviewCounts struct {
	ShopWorkflows   int64 `json:"shopWorkflows"`
	CanvasTemplates int64 `json:"canvasTemplates"`
	Feedback        int64 `json:"feedback"`
}

func (r *Repository) AdminReviewCounts() (AdminReviewCounts, error) {
	var counts AdminReviewCounts
	err := r.db.Raw(`SELECT
		(SELECT count(*) FROM shop_workflow_submissions WHERE status = ?) AS shop_workflows,
		(SELECT count(*) FROM canvas_templates WHERE status = ?) AS canvas_templates,
		(SELECT count(*) FROM user_feedbacks WHERE status = ? AND archived = ?) AS feedback`,
		model.ShopWorkflowPending, model.CanvasTemplateStatusPending, model.FeedbackStatusPending, false).
		Scan(&counts).Error
	return counts, err
}
