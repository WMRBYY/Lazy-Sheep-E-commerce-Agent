package model

import "time"

type ShopWorkflowStatus string

const (
	ShopWorkflowPending  ShopWorkflowStatus = "pending"
	ShopWorkflowApproved ShopWorkflowStatus = "approved"
	ShopWorkflowRejected ShopWorkflowStatus = "rejected"
)

// ShopWorkflowSubmission stores the graph shared for review. Media remains in the owner's resource library.
type ShopWorkflowSubmission struct {
	ID              string             `json:"id" gorm:"primaryKey;size:36"`
	SubmitterID     string             `json:"submitterId" gorm:"size:36;not null;uniqueIndex:idx_shop_workflow_submitter_source,priority:1"`
	WorkflowID      string             `json:"workflowId" gorm:"size:36;not null;uniqueIndex:idx_shop_workflow_submitter_source,priority:2"`
	Name            string             `json:"name" gorm:"size:160;not null"`
	Category        string             `json:"category" gorm:"size:16;not null"`
	Description     string             `json:"description,omitempty" gorm:"size:500"`
	NodesJSON       string             `json:"-" gorm:"type:text;not null"`
	NodeCount       int                `json:"nodeCount"`
	CoverResourceID string             `json:"coverResourceId,omitempty" gorm:"size:36"`
	Status          ShopWorkflowStatus `json:"status" gorm:"size:16;not null;index:idx_shop_workflow_review,priority:1"`
	ReviewNote      string             `json:"reviewNote,omitempty" gorm:"size:500"`
	ReviewerID      string             `json:"-" gorm:"size:36"`
	ReviewedAt      *time.Time         `json:"reviewedAt,omitempty"`
	CreatedAt       time.Time          `json:"createdAt" gorm:"index:idx_shop_workflow_review,priority:2"`
}
