package handler

import (
	"errors"
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterShopWorkflowRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/shop/workflow-submissions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var input service.ShopWorkflowSubmitInput
		if err := decodeAgentJSON(c, &input, 512<<10); err != nil {
			fail(c, http.StatusBadRequest, errors.New("工作流格式无效或超过 512 KB"))
			return
		}
		row, err := svc.SubmitShopWorkflow(user, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, row)
	})
	r.GET("/shop/workflow-submissions/:workflowId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		row, err := svc.MyShopWorkflowSubmission(user, c.Param("workflowId"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"submission": row})
	})
	admin := r.Group("/admin/shop-workflow-submissions")
	admin.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, size, err := parsePaginationQuery(c, 24)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		rows, total, err := svc.AdminShopWorkflowSubmissions(user, model.ShopWorkflowStatus(c.Query("status")), c.Query("category"), strings.TrimSpace(c.Query("q")), page, size)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": rows, "total": total})
	})
	admin.GET("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminShopWorkflowDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, detail)
	})
	admin.PATCH("/:id/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var input struct {
			Status model.ShopWorkflowStatus `json:"status"`
			Note   string                   `json:"note"`
		}
		if err := decodeAgentJSON(c, &input, 8<<10); err != nil {
			fail(c, http.StatusBadRequest, errors.New("审核请求格式无效"))
			return
		}
		if err := svc.ReviewShopWorkflow(user, c.Param("id"), input.Status, input.Note); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"reviewed": true})
	})
	r.GET("/admin/review-counts", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		counts, err := svc.AdminReviewCounts(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, counts)
	})
}
