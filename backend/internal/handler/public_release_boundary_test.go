// Copyright (c) 2026 meiyeai. Licensed under the MIT License.
package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func TestPublicReleaseHasNoPrivateOrRemovedManagementRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), &service.Service{})
	removed := []string{
		"/api/video-replication", "/api/admin/video-replication", "/api/admin/video-parser",
		"/api/admin/system-update", "/api/admin/response-interception",
		"/api/admin/settings/response-interception", "/api/admin/settings/libtv",
		"/api/admin/settings/ark-private-assets", "/api/ark-portraits", "/api/admin/ark-portraits",
		"/api/admin/settings/appearance", "/api/yoru", "/api/public/yoru", "/api/admin/settings/yoru",
		"/api/appearance/live2d", "/api/appearance/avatar-bundles", "/api/appearance/avatar",
		"/api/public/appearance/live2d", "/api/public/appearance/avatar",
		"/api/admin/official-assets", "/api/admin/official-asset-recommendations",
		"/api/admin/skills", "/api/admin/skill-curation", "/api/admin/ecommerce/skills",
		"/api/admin/mcp", "/api/admin/plugins",
		"/api/admin/settings/drawing-engine", "/api/admin/workbench/tools",
		"/api/admin/agent-lessons", "/api/admin/agent-memory-documents",
		"/api/agent/memory", "/api/agent/memories",
	}
	aliases := map[string]bool{
		"POST /api/canvas-templates/:id/remix": true,
		"POST /api/plugins":                    true, "DELETE /api/plugins/:id": true,
		"POST /api/plugins/:id/enable": true, "POST /api/plugins/:id/disable": true,
		"POST /api/skills": true, "PUT /api/skills/:id": true, "DELETE /api/skills/:id": true,
		"PUT /api/skills/:id/files": true, "POST /api/skills/:id/sync": true,
		"POST /api/skills/install": true, "POST /api/skills/install/github": true,
		"POST /api/skills/discover/github": true,
	}
	for _, route := range router.Routes() {
		for _, prefix := range removed {
			if route.Path == prefix || strings.HasPrefix(route.Path, prefix+"/") {
				t.Errorf("removed route remains: %s %s", route.Method, route.Path)
			}
		}
		if aliases[route.Method+" "+route.Path] {
			t.Errorf("legacy management alias remains: %s %s", route.Method, route.Path)
		}
	}
	for _, prefix := range removed {
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete} {
			request := httptest.NewRequest(method, prefix+"?admin=true&enabled=true", strings.NewReader("{}"))
			request.Header.Set("Authorization", "Bearer synthetic-boundary-test")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound {
				t.Errorf("%s %s returned %d, want 404", method, prefix, recorder.Code)
			}
		}
	}
}

func TestPublicReleasePreservesCoreAndOrdinaryMediaRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/admin/users":                            false,
		"POST /api/admin/users":                           false,
		"GET /api/payments/providers":                     false,
		"POST /api/payments/orders":                       false,
		"POST /api/payments/notify/:providerId/:configId": false,
		"GET /api/canvas-projects":                        false,
		"POST /api/ecommerce/clips":                       false,
		"GET /api/ecommerce/clips":                        false,
		"POST /api/auth/login":                            false,
		"POST /api/tasks":                                 false,
		"GET /api/wallet":                                 false,
		"POST /api/wallet/redeem":                         false,
		"GET /api/resources":                              false,
		"GET /api/workbench/tools":                        false,
		"POST /api/workbench/tasks":                       false,
		"GET /api/ecommerce/projects":                     false,
		"POST /api/agent/generate":                        false,
		"GET /api/skills":                                 false,
		"GET /api/plugins/status":                         false,
		"GET /api/public/appearance":                      false,
		"GET /api/media-references/playback/:id":          false,
		"POST /api/media-references/preview":              false,
		"POST /api/media-references/clip":                 false,
		"POST /api/media-references/save":                 false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("preserved route missing: %s", route)
		}
	}
}
