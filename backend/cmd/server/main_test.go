package main

import (
	"net/http/httptest"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestEnsureBuiltinWorkbenchCatalogStartupWiring(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:workbench-startup?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	if err := ensureBuiltinWorkbenchCatalog(svc); err != nil {
		t.Fatal(err)
	}
	tools, err := repository.New(db).WorkbenchTools("image", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) == 0 {
		t.Fatal("startup initializer did not publish image workbench tools")
	}
}

func TestAllowedOriginWildcard(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "*")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if !allowedOrigin(context, "https://example.com") {
		t.Fatal("wildcard CORS should allow a valid HTTPS origin")
	}
	if allowedOrigin(context, "ftp://example.com") {
		t.Fatal("wildcard CORS should reject non-HTTP origins")
	}
}

func TestEnvironmentParsers(t *testing.T) {
	t.Setenv("CANVAS_AUTO_MIGRATE", "false")
	value, err := envBool("CANVAS_AUTO_MIGRATE", true)
	if err != nil || value {
		t.Fatalf("envBool = %v, %v", value, err)
	}
	t.Setenv("CANVAS_SHUTDOWN_TIMEOUT", "45s")
	duration, err := envDuration("CANVAS_SHUTDOWN_TIMEOUT", time.Minute)
	if err != nil || duration != 45*time.Second {
		t.Fatalf("envDuration = %v, %v", duration, err)
	}
}

func TestBackgroundWorkerModeDefaultsOnAndCanBeDisabledForCandidate(t *testing.T) {
	t.Setenv("CANVAS_BACKGROUND_WORKERS_ENABLED", "")
	enabled, err := shouldRunBackgroundWorkers()
	if err != nil || !enabled {
		t.Fatalf("default worker mode = %v, %v; want enabled", enabled, err)
	}
	t.Setenv("CANVAS_BACKGROUND_WORKERS_ENABLED", "false")
	enabled, err = shouldRunBackgroundWorkers()
	if err != nil || enabled {
		t.Fatalf("disabled worker mode = %v, %v; want disabled", enabled, err)
	}
	t.Setenv("CANVAS_BACKGROUND_WORKERS_ENABLED", "maybe")
	if _, err := shouldRunBackgroundWorkers(); err == nil {
		t.Fatal("invalid worker mode should be rejected")
	}
}

func TestAllowedOriginUsesForwardedHost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	context.Request.Header.Set("X-Forwarded-Host", " canvas.example.com, proxy.internal")
	if !allowedOrigin(context, "https://canvas.example.com") {
		t.Fatal("forwarded public host should be treated as same-origin")
	}
}

func TestParseCORSPolicyNormalizesConfiguredOrigins(t *testing.T) {
	policy, err := parseCORSPolicy(" https://Canvas.example.com/ , http://localhost:3000 ")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := policy.origins["https://canvas.example.com"]; !ok {
		t.Fatal("configured origin was not normalized")
	}
	if _, ok := policy.origins["http://localhost:3000"]; !ok {
		t.Fatal("configured port was not preserved")
	}
}

func TestParseCORSPolicyRejectsNonOriginValue(t *testing.T) {
	if _, err := parseCORSPolicy("https://example.com/app"); err == nil {
		t.Fatal("path-bearing CORS value should be rejected")
	}
	if _, err := parseCORSPolicy("ftp://example.com"); err == nil {
		t.Fatal("non-HTTP CORS value should be rejected")
	}
}

func TestAllowedOriginConfiguredListDoesNotFallbackToArbitraryLocalhost(t *testing.T) {
	t.Setenv("CANVAS_CORS_ORIGINS", "https://app.example.com")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "http://backend/api/health", nil)
	if allowedOrigin(context, "http://localhost:3000") {
		t.Fatal("configured CORS list should disable the implicit localhost fallback")
	}
}

func TestRedactCanvasSharePath(t *testing.T) {
	got := redactCanvasSharePath("/api/public/canvas-shares/private-token/resources/resource-1/file")
	if got != "/api/public/canvas-shares/:token/resources/resource-1/file" {
		t.Fatalf("unexpected redacted path: %s", got)
	}
	if got := redactCanvasSharePath("/api/tasks"); got != "/api/tasks" {
		t.Fatalf("unrelated path changed: %s", got)
	}
}

func TestCORSAllowsNullOriginOnlyForSameOriginFetchMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_CORS_ORIGINS", "https://example.com")
	middleware, err := cors()
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.Use(middleware)
	router.POST("/api/ecommerce/download", func(c *gin.Context) { c.Status(200) })
	for _, tc := range []struct {
		site string
		want int
	}{{"same-origin", 200}, {"cross-site", 403}, {"", 403}} {
		req := httptest.NewRequest("POST", "/api/ecommerce/download", nil)
		req.Host = "example.com"
		req.Header.Set("Origin", "null")
		if tc.site != "" {
			req.Header.Set("Sec-Fetch-Site", tc.site)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("Sec-Fetch-Site=%q: got %d want %d", tc.site, rec.Code, tc.want)
		}
	}
}
