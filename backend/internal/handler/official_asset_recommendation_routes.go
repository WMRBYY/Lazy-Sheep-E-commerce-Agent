package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type createOfficialAssetRecommendationRequest struct {
	AssetID        string `json:"assetId"`
	Note           string `json:"note"`
	ConsentVersion string `json:"consentVersion"`
}

type resubmitOfficialAssetRecommendationRequest struct {
	Note           string `json:"note"`
	ConsentVersion string `json:"consentVersion"`
}

func RegisterOfficialAssetRecommendationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/official-asset-recommendations/consent-policy", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"version": "commercial-use-v1"})
	})
	r.POST("/official-asset-recommendations", createOfficialAssetRecommendationHandler(svc))
	r.POST("/official-asset-recommendations/:id/resubmit", resubmitOfficialAssetRecommendationHandler(svc))

}

func resubmitOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req resubmitOfficialAssetRecommendationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ResubmitOfficialAssetRecommendation(user, c.Param("id"), req.Note, req.ConsentVersion)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func createOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req createOfficialAssetRecommendationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CreateOfficialAssetRecommendation(user, req.AssetID, req.Note, req.ConsentVersion)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}
