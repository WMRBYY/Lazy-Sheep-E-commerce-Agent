package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestShopWorkflowSubmissionReviewHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.AuthSession{}, &model.User{}, &model.ShopWorkflowSubmission{}, &model.Resource{}, &model.CanvasTemplate{}, &model.UserFeedback{}); err != nil {
		t.Fatal(err)
	}
	insert := func(row any) {
		t.Helper()
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"owner", "other", "admin"} {
		role := model.UserRoleUser
		if id == "admin" {
			role = model.UserRoleAdmin
		}
		insert(&model.User{ID: id, Username: id, Email: id + "@example.test", Role: role, Status: model.UserStatusActive})
		insert(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)})
	}
	insert(&model.Resource{ID: "owner-media", UserID: "owner", Kind: "image", Status: model.ResourceStatusReady})
	insert(&model.Resource{ID: "private-media", UserID: "other", Kind: "image", Status: model.ResourceStatusReady})
	insert(&model.CanvasTemplate{ID: "template-queue", Status: model.CanvasTemplateStatusPending})
	insert(&model.UserFeedback{ID: "feedback-queue", Status: model.FeedbackStatusPending})
	insert(&model.UserFeedback{ID: "archived-feedback", Status: model.FeedbackStatusPending, Archived: true})

	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterShopWorkflowRoutes(router.Group("/api"), svc)

	send := func(actor, method, path, body string, status int) json.RawMessage {
		t.Helper()
		req := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if actor != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + ".test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != status {
			t.Fatalf("%s %s %s = %d, expected %d: %s", actor, method, path, out.Code, status, out.Body.String())
		}
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}
	const workflowID = "107bd9b5-4002-46d9-8e18-956ff3765e26"
	const mine = "/shop/workflow-submissions"
	const queue = "/admin/shop-workflow-submissions"
	const counts = "/admin/review-counts"
	const body = `{"workflowId":"%s","name":"蓝色外套","category":"服饰","description":"换装示例","nodes":[{"id":"source","type":"image","text":"素材图","x":100,"y":200,"resourceId":"%s"},{"id":"result","type":"draft","x":520,"y":200,"prompt":"保留纽扣质感","inputs":["source"]}]}`

	send("", "POST", mine, fmt.Sprintf(body, workflowID, "owner-media"), http.StatusUnauthorized)
	send("owner", "POST", mine, fmt.Sprintf(body, workflowID, "private-media"), http.StatusBadRequest)
	send("owner", "POST", mine, strings.Replace(fmt.Sprintf(body, workflowID, "owner-media"), `["source"]`, `["missing"]`, 1), http.StatusBadRequest)
	send("owner", "GET", counts, "", http.StatusForbidden)
	send("owner", "GET", queue, "", http.StatusForbidden)

	var submission model.ShopWorkflowSubmission
	if err := json.Unmarshal(send("owner", "POST", mine, fmt.Sprintf(body, workflowID, "owner-media"), http.StatusOK), &submission); err != nil {
		t.Fatal(err)
	}
	if submission.ID == "" || submission.Status != model.ShopWorkflowPending || submission.CoverResourceID != "owner-media" {
		t.Fatalf("unexpected submission: %#v", submission)
	}
	retry := send("owner", "POST", mine, fmt.Sprintf(body, workflowID, "owner-media"), http.StatusOK)
	if !strings.Contains(string(retry), submission.ID) {
		t.Fatalf("retry created a new submission: %s", retry)
	}
	if data := send("other", "GET", mine+"/"+workflowID, "", http.StatusOK); string(data) != `{"submission":null}` {
		t.Fatalf("another user sees submission: %s", data)
	}

	checkCounts := func(workflows int64) {
		t.Helper()
		var result repository.AdminReviewCounts
		if err := json.Unmarshal(send("admin", "GET", counts, "", http.StatusOK), &result); err != nil {
			t.Fatal(err)
		}
		if result.ShopWorkflows != workflows || result.CanvasTemplates != 1 || result.Feedback != 1 {
			t.Fatalf("unexpected review counts: %#v", result)
		}
	}
	checkCounts(1)
	list := send("admin", "GET", queue+"?status=pending", "", http.StatusOK)
	if !strings.Contains(string(list), submission.ID) || strings.Contains(string(list), "保留纽扣质感") {
		t.Fatalf("unexpected workflow summaries: %s", list)
	}
	detail := queue + "/" + submission.ID
	send("owner", "GET", detail, "", http.StatusForbidden)
	send("owner", "PATCH", detail+"/review", `{"status":"approved"}`, http.StatusForbidden)
	if data := send("admin", "GET", detail, "", http.StatusOK); !strings.Contains(string(data), "保留纽扣质感") {
		t.Fatalf("detail is missing graph: %s", data)
	}
	send("admin", "PATCH", detail+"/review", `{"status":"rejected"}`, http.StatusBadRequest)
	send("admin", "PATCH", detail+"/review", `{"status":"approved"}`, http.StatusOK)
	send("admin", "PATCH", detail+"/review", `{"status":"rejected","note":"重复处理"}`, http.StatusConflict)
	checkCounts(0)
	if data := send("owner", "GET", mine+"/"+workflowID, "", http.StatusOK); !strings.Contains(string(data), `"status":"approved"`) {
		t.Fatalf("owner cannot read review result: %s", data)
	}
}
