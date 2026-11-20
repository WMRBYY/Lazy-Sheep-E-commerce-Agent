// 可见素材的读取与导入；权限和归属由 service 校验。
package handler

import (
	"errors"

	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

var errEmptyProjectID = errors.New("请选择要导入的项目")

// RegisterOfficialAssetRoutes 注册用户侧素材读取与导入路由。
func RegisterOfficialAssetRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/official-assets", listOfficialAssetsHandler(svc))
	r.GET("/official-assets/:id", getOfficialAssetHandler(svc))
	r.POST("/official-assets/:id/import", importOfficialAssetToLibraryHandler(svc))
	r.POST("/official-assets/:id/import-to-project", importOfficialAssetToProjectHandler(svc))
	r.GET("/official-assets/:id/reference", getOfficialAssetReferenceHandler(svc))

}

func copyOfficialCharacterHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CopyOfficialCharacterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("请求格式无效"))
			return
		}
		result, err := svc.CopyOfficialCharacter(user.ID, strings.TrimSpace(c.Param("id")), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func listOfficialAssetsHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		filter := service.OfficialAssetPageFilter{
			MediaType: c.Query("mediaType"),
			Category:  c.Query("category"),
			Tag:       c.Query("tag"),
			Query:     c.Query("q"),
		}
		result, err := svc.OfficialAssetsPage(user.ID, page, pageSize, filter)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func getOfficialAssetHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.OfficialAssetDetail(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	}
}

func importOfficialAssetToLibraryHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ImportOfficialAssetToLibrary(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

type importOfficialAssetToProjectRequest struct {
	ProjectID string `json:"projectId"`
}

func importOfficialAssetToProjectHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req importOfficialAssetToProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if strings.TrimSpace(req.ProjectID) == "" {
			fail(c, http.StatusBadRequest, errEmptyProjectID)
			return
		}
		result, err := svc.ImportOfficialAssetToProject(user.ID, req.ProjectID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

// getOfficialAssetReferenceHandler 返回路径 B（画布直接引用）的引用载荷。
// 本步骤只提供读取端：画布是否接受非 Asset 的引用载荷取决于 v1692 的
// 插入契约，待 Mac 核对后再决定是否启用。选择器先走路径 A（导入）。
func getOfficialAssetReferenceHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		reference, err := svc.OfficialAssetReferenceForUser(user.ID, strings.TrimSpace(c.Param("id")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, reference)
	}
}

type sortOfficialAssetRequest struct {
	SortOrder int `json:"sortOrder"`
}

// api.go 注册（一行，放到 RegisterCanvasAPI 里，RegisterAdminRoutes 附近）：
//
//	RegisterOfficialAssetRoutes(api, svc)
//
// 待 Mac 核对：v1692 的 RegisterCanvasAPI 签名与 api 变量名
// （快照里是 RegisterCanvasAPI(api *gin.RouterGroup, svc *service.Service)）。
