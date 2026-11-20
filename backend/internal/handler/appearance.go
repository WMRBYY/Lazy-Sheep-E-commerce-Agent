package handler

import (
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAppearanceRoutes(r *gin.RouterGroup, svc *service.Service) {

	r.GET("/public/appearance", func(c *gin.Context) {
		setting, err := svc.Appearance()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"appearance": setting})
	})

	r.GET("/public/appearance/assets/:slot", func(c *gin.Context) {
		delivery, err := svc.PrepareAppearanceAssetDelivery(c.Param("slot"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "public, no-cache", "")
	})

}
