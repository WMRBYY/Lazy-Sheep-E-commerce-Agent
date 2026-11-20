package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestStandaloneVideoSubmissionOwnershipReviewAndResourceScope(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	owner := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, resource := range []model.Resource{
		{ID: "shared-video", UserID: owner.ID, Kind: "video", MimeType: "video/mp4", Status: model.ResourceStatusReady},
		{ID: "shared-cover", UserID: owner.ID, Kind: "image", MimeType: "image/png", Status: model.ResourceStatusReady},
		{ID: "unselected-image", UserID: owner.ID, Kind: "image", Status: model.ResourceStatusReady},
		{ID: "other-video", UserID: "other", Kind: "video", Status: model.ResourceStatusReady},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := CanvasTemplateSubmitRequest{Title: "Uploaded video", Category: "ecommerce", VideoResourceID: "shared-video", CoverResourceID: "shared-cover", AllowDownload: true}
	card, err := svc.SubmitCanvasTemplate(owner, req)
	if err != nil {
		t.Fatal(err)
	}
	if card.CanvasID != "" || card.Status != string(model.CanvasTemplateStatusPending) || card.NodeCount != 0 {
		t.Fatalf("unexpected standalone submission: %+v", card)
	}
	if _, err := svc.approvedCanvasTemplate(card.ID); err == nil {
		t.Fatal("unreviewed video became public")
	}
	stored, err := svc.repo.CanvasTemplate(card.ID)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(stored.PayloadJSON), &payload); err != nil || len(payload) != 2 {
		t.Fatalf("standalone video exposed unexpected metadata: %v", err)
	}
	for _, id := range []string{"shared-video", "shared-cover"} {
		allowed, err := svc.repo.CanvasTemplateHasResource(card.ID, id)
		if err != nil || !allowed {
			t.Fatalf("selected media missing: %v", err)
		}
	}
	if allowed, err := svc.repo.CanvasTemplateHasResource(card.ID, "unselected-image"); err != nil || allowed {
		t.Fatal("unselected resource included in sharing scope")
	}
	req.Title = "Second uploaded video"
	second, err := svc.SubmitCanvasTemplate(owner, req)
	if err != nil || second.ID == card.ID {
		t.Fatalf("independent video submission failed: %v", err)
	}
	if _, err := svc.repo.CanvasTemplate(card.ID); err != nil {
		t.Fatal("second standalone submission replaced the first")
	}
	req.VideoResourceID = "other-video"
	if _, err := svc.SubmitCanvasTemplate(owner, req); err == nil {
		t.Fatal("cross-user media could be published")
	}
	if _, err := svc.SubmitCanvasTemplate(nil, req); err == nil {
		t.Fatal("anonymous video publication accepted")
	}
}
