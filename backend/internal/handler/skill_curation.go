package handler

import (
	"github.com/gin-gonic/gin"

	"yingce/backend/internal/service"
)

func registerSkillCurationRoutes(r *gin.RouterGroup, svc *service.Service) {
	read := func(admin bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			result, err := svc.SkillCuration(actor, admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		}
	}
	r.GET("/skills/curation", read(false))

}
