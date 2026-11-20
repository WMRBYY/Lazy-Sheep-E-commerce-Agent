package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterWorkbenchRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.DELETE("/workbench/tryon/batches/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ids, err := svc.DeleteTryOnBatch(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assetIds": ids})
	})
	r.GET("/workbench/tools", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		kind := c.Query("kind")
		tools, err := svc.PublicWorkbenchTools(kind)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tools": tools})
	})
	r.GET("/workbench/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, err := parsePositiveQueryInt(c.Query("pageSize"), 50)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		tasks, err := svc.WorkbenchTasks(user.ID, c.Query("kind"), c.Query("activeOnly") == "true", limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, tasks)
	})
	r.DELETE("/workbench/video/history/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.HideWorkbenchVideoRecord(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/workbench/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		var req service.WorkbenchTaskInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		task, err := svc.CreateWorkbenchTask(user.ID, req, TraceID(c), RequestID(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})

}

func decodeWorkbenchJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("请求必须只包含一个 JSON 对象")
	}
	return nil
}
