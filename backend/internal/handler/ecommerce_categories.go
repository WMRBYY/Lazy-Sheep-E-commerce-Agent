package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// Product taxonomy is distinct from administration of reusable skills.
func registerEcommerceCategoriesRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/ecommerce/categories", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		data, err := svc.EcommerceIndustryCategories(user, c.Query("parentId"), c.Query("q"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, data)
	})
}
