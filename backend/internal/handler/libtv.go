package handler

import (
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterLibTVRoutes(r *gin.RouterGroup, svc *service.Service) {

	r.POST("/canvas-projects/:id/import/libtv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.LibTVImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportLibTV(user.ID, c.Param("id"), strings.TrimSpace(req.UUID))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
